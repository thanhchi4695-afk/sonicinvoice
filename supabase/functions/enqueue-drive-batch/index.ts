// ──────────────────────────────────────────────────────────────
// enqueue-drive-batch — Lists files in a public Google Drive
// folder (or a single file URL) and creates one row per file in
// processing_queue. The drive-worker (run by pg_cron) picks them
// up in the background, downloads each PDF/image server-side,
// uploads to invoice-originals storage and saves a stub
// invoice_patterns row marked review_status='pending_review'.
//
// Body: { url: "<drive folder or file url>" }
// Returns: { batch_id, queued: N, skipped: [...] }
// ──────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseGoogleDriveUrl(url: string): { type: "folder" | "file"; id: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("drive.google.com") && !u.hostname.includes("docs.google.com")) return null;
    const folderMatch = u.pathname.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return { type: "folder", id: folderMatch[1] };
    const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return { type: "file", id: fileMatch[1] };
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
  const apiKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (apiKey) {
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${apiKey}`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      return (data.files || []) as DriveFile[];
    }
  }
  const pageUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
  const resp = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!resp.ok) {
    throw new Error("Could not access Google Drive folder. Make sure it's shared as 'Anyone with the link'.");
  }
  const html = await resp.text();
  const files: DriveFile[] = [];
  const regex = /data-id="([^"]+)"[^>]*>.*?<div class="flip-entry-title"[^>]*>([^<]+)/gs;
  let match;
  while ((match = regex.exec(html)) !== null) {
    files.push({ id: match[1], name: match[2].trim(), mimeType: "unknown" });
  }
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

function inferFileType(mimeOrName: string): string {
  const m = mimeOrName.toLowerCase();
  if (m.includes("pdf") || m.endsWith(".pdf")) return "pdf";
  if (m.includes("png") || m.endsWith(".png")) return "png";
  if (m.includes("webp") || m.endsWith(".webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg") || m.endsWith(".jpg") || m.endsWith(".jpeg")) return "jpeg";
  return "pdf"; // sensible default for invoice folders
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = parseGoogleDriveUrl(url.trim());
    if (!parsed) {
      return new Response(JSON.stringify({ error: "Invalid Google Drive URL" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let files: DriveFile[];
    if (parsed.type === "folder") {
      files = await listFolderFiles(parsed.id);
    } else {
      files = [{ id: parsed.id, name: "drive_file", mimeType: "unknown" }];
    }

    if (files.length === 0) {
      return new Response(JSON.stringify({ error: "No files found in the Drive folder" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const batchId = crypto.randomUUID();
    const rows = files.slice(0, 100).map((f, i) => ({
      user_id: user.id,
      source: "drive",
      source_url: url.trim(),
      drive_file_id: f.id,
      file_name: f.name,
      file_type: inferFileType(f.mimeType !== "unknown" ? f.mimeType : f.name),
      batch_id: batchId,
      position: i,
      status: "queued",
    }));

    const { error: insErr } = await admin.from("processing_queue").insert(rows);
    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({ batch_id: batchId, queued: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("enqueue-drive-batch error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "failed to enqueue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
