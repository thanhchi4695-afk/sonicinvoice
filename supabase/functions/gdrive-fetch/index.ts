const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Extracts file/folder IDs from various Google Drive URL formats:
 * - https://drive.google.com/drive/folders/FOLDER_ID
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/open?id=FILE_ID
 */
function parseGoogleDriveUrl(url: string): { type: "folder" | "file"; id: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("drive.google.com") && !u.hostname.includes("docs.google.com")) return null;

    // Folder: /drive/folders/ID
    const folderMatch = u.pathname.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return { type: "folder", id: folderMatch[1] };

    // File: /file/d/ID
    const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return { type: "file", id: fileMatch[1] };

    // Open: ?id=ID
    const idParam = u.searchParams.get("id");
    if (idParam) return { type: "file", id: idParam };

    return null;
  } catch {
    return null;
  }
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  // Use the Google Drive API v3 with API key for public folders
  const apiKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  
  // Try API key approach first, fallback to scraping approach
  if (apiKey) {
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${apiKey}`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      return (data.files || []) as DriveFile[];
    }
  }

  // Fallback: use the public embed/export approach
  // Fetch the folder page and extract file links
  const pageUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
  const resp = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  
  if (!resp.ok) {
    throw new Error("Could not access Google Drive folder. Make sure it's shared as 'Anyone with the link'.");
  }

  const html = await resp.text();
  
  // Extract file IDs and names from the embedded view
  const files: DriveFile[] = [];
  const regex = /data-id="([^"]+)"[^>]*>.*?<div class="flip-entry-title"[^>]*>([^<]+)/gs;
  let match;
  while ((match = regex.exec(html)) !== null) {
    files.push({ id: match[1], name: match[2].trim(), mimeType: "unknown" });
  }

  // Alternative parsing for newer Drive UI
  if (files.length === 0) {
    const idRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/g;
    const seen = new Set<string>();
    while ((match = idRegex.exec(html)) !== null) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        files.push({ id: match[1], name: `file_${files.length + 1}`, mimeType: "unknown" });
      }
    }
  }

  return files;
}

async function downloadFile(fileId: string): Promise<{ base64: string; mimeType: string; fileName: string }> {
  // Direct download URL for public files
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  
  const resp = await fetch(downloadUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`Could not download file ${fileId}. Make sure it's publicly shared.`);
  }

  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  const disposition = resp.headers.get("content-disposition") || "";
  const nameMatch = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)/i);
  const fileName = nameMatch ? decodeURIComponent(nameMatch[1]) : `file_${fileId}`;

  const buffer = await resp.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  
  // Convert to base64
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);

  return { base64, mimeType: contentType, fileName };
}

function getFileType(mimeType: string, fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const validExts = ["pdf", "jpg", "jpeg", "png", "webp"];
  if (validExts.includes(ext)) return ext === "jpg" ? "jpeg" : ext;

  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpeg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "Please provide a Google Drive URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = parseGoogleDriveUrl(url.trim());
    if (!parsed) {
      return new Response(
        JSON.stringify({ error: "Invalid Google Drive URL. Paste a folder or file link." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileIds: { id: string; name: string }[] = [];

    if (parsed.type === "folder") {
      console.log("Listing folder:", parsed.id);
      const files = await listFolderFiles(parsed.id);
      if (files.length === 0) {
        return new Response(
          JSON.stringify({ error: "No files found in folder. Make sure it's shared as 'Anyone with the link'." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      for (const f of files) {
        fileIds.push({ id: f.id, name: f.name });
      }
    } else {
      fileIds.push({ id: parsed.id, name: "file" });
    }

    // Download each file (max 10)
    const invoices: Array<{ fileName: string; base64: string; fileType: string }> = [];
    const errors: string[] = [];

    for (const f of fileIds.slice(0, 10)) {
      try {
        const { base64, mimeType, fileName } = await downloadFile(f.id);
        const fileType = getFileType(mimeType, fileName || f.name);
        if (!fileType) {
          errors.push(`${f.name}: unsupported format (${mimeType})`);
          continue;
        }
        // Skip files larger than 10MB base64 (~7.5MB raw)
        if (base64.length > 13_500_000) {
          errors.push(`${fileName}: too large (>10MB)`);
          continue;
        }
        invoices.push({ fileName: fileName || f.name, base64, fileType });
      } catch (err) {
        errors.push(`${f.name}: ${err instanceof Error ? err.message : "download failed"}`);
      }
    }

    return new Response(
      JSON.stringify({
        invoices,
        total_found: fileIds.length,
        downloaded: invoices.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Drive fetch error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to fetch from Google Drive" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
