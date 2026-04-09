import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, url } = await req.json();

    if (action === "detect_platform") {
      const platform = detectPlatform(url);
      return new Response(
        JSON.stringify({ platform, supported: platform !== "unknown" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list_images") {
      const platform = detectPlatform(url);
      let imageUrls: { name: string; downloadUrl: string }[] = [];

      if (platform === "dropbox") {
        imageUrls = await listDropboxImages(url);
      } else if (platform === "google_drive") {
        imageUrls = await listGoogleDriveImages(url);
      } else if (platform === "wetransfer") {
        imageUrls = await listWeTransferImages(url);
      } else if (platform === "onedrive") {
        imageUrls = await listOneDriveImages(url);
      } else {
        return new Response(
          JSON.stringify({ error: "Unsupported platform. Use Dropbox, Google Drive, WeTransfer, or OneDrive." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ images: imageUrls, count: imageUrls.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "fetch_image_as_base64") {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SonicInvoices/1.0)" },
        redirect: "follow",
      });
      if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
      const contentType = resp.headers.get("content-type") || "image/jpeg";
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Encode to base64 in chunks to avoid stack overflow
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      return new Response(
        JSON.stringify({ base64, contentType }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("lookbook-fetch error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function detectPlatform(url: string): string {
  if (!url) return "unknown";
  if (url.includes("dropbox.com")) return "dropbox";
  if (url.includes("drive.google.com")) return "google_drive";
  if (url.includes("wetransfer.com")) return "wetransfer";
  if (url.includes("1drv.ms") || url.includes("onedrive.live.com") || url.includes("sharepoint.com")) return "onedrive";
  return "unknown";
}

async function listDropboxImages(url: string): Promise<{ name: string; downloadUrl: string }[]> {
  let downloadUrl = url
    .replace(/[?&]dl=0/, "")
    .replace(/[?&]e=\d+/, "")
    .replace(/[?&]st=[^&]+/, "");
  const separator = downloadUrl.includes("?") ? "&" : "?";
  downloadUrl = `${downloadUrl}${separator}dl=1`;

  const resp = await fetch(downloadUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SonicInvoices/1.0)" },
    redirect: "follow",
  });

  if (!resp.ok) throw new Error(`Dropbox download failed: ${resp.status}. Ensure the folder is set to 'Anyone with the link'.`);

  const contentType = resp.headers.get("content-type") || "";

  if (contentType.startsWith("image/")) {
    const filename = url.split("/").pop()?.split("?")[0] || "image.jpg";
    return [{ name: filename, downloadUrl }];
  }

  const buffer = await resp.arrayBuffer();
  const imageFiles = extractImageNamesFromZip(new Uint8Array(buffer));

  if (imageFiles.length === 0) {
    throw new Error("No images found in this Dropbox folder. The folder may contain only documents.");
  }

  // For Dropbox shared folders, individual file download uses raw=1
  const baseUrl = url.split("?")[0];
  return imageFiles.map(filename => ({
    name: filename.split("/").pop() || filename,
    downloadUrl: `${baseUrl}/${encodeURIComponent(filename)}?raw=1`,
  }));
}

function extractImageNamesFromZip(bytes: Uint8Array): string[] {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".tiff", ".gif"];
  const filenames: string[] = [];

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return [];

  const view = new DataView(bytes.buffer);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);

  let pos = cdOffset;
  const end = cdOffset + cdSize;

  while (pos < end) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const filenameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const filenameBytes = bytes.slice(pos + 46, pos + 46 + filenameLength);
    const filename = new TextDecoder("utf-8").decode(filenameBytes);
    const lower = filename.toLowerCase();
    const isImage = imageExtensions.some(ext => lower.endsWith(ext));
    const isNotMeta = !filename.startsWith("__MACOSX") && !filename.startsWith(".");
    if (isImage && isNotMeta) filenames.push(filename);
    pos += 46 + filenameLength + extraLength + commentLength;
  }

  return filenames;
}

async function listGoogleDriveImages(url: string): Promise<{ name: string; downloadUrl: string }[]> {
  const folderIdMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!folderIdMatch) throw new Error("Could not extract Google Drive folder ID from URL");
  const folderId = folderIdMatch[1];

  // Try without API key first (for truly public folders)
  const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/'`)}&fields=files(id,name,mimeType)`;
  const resp = await fetch(apiUrl);
  if (!resp.ok) {
    throw new Error("Could not list Google Drive folder. Ensure the folder is set to 'Anyone with the link can view'.");
  }

  const data = await resp.json();
  return (data.files || []).map((f: { id: string; name: string }) => ({
    name: f.name,
    downloadUrl: `https://drive.google.com/uc?id=${f.id}&export=download`,
  }));
}

async function listWeTransferImages(url: string): Promise<{ name: string; downloadUrl: string }[]> {
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!resp.ok) throw new Error("WeTransfer link may have expired (links last 7 days). Ask your supplier to resend.");
  const html = await resp.text();
  const downloadMatch = html.match(/"direct_link":"([^"]+)"/);
  if (!downloadMatch) {
    throw new Error("Could not extract WeTransfer download link. The link may have expired.");
  }
  const downloadUrl = downloadMatch[1].replace(/\\/g, "");
  return [{ name: "wetransfer_download.zip", downloadUrl }];
}

async function listOneDriveImages(url: string): Promise<{ name: string; downloadUrl: string }[]> {
  const encoded = btoa(url).replace(/\+/g, "-").replace(/\//g, "_");
  const apiUrl = `https://api.onedrive.com/v1.0/shares/u!${encoded}/driveItem/children`;

  const resp = await fetch(apiUrl, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    throw new Error("Could not access OneDrive folder. Ensure it is shared publicly.");
  }

  const data = await resp.json();
  return (data.value || [])
    .filter((item: { name: string }) => {
      const lower = item.name.toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp"].some(ext => lower.endsWith(ext));
    })
    .map((item: { name: string; "@microsoft.graph.downloadUrl": string }) => ({
      name: item.name,
      downloadUrl: item["@microsoft.graph.downloadUrl"],
    }));
}
