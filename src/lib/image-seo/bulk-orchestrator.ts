/**
 * Bulk orchestrator: queues image-SEO jobs with a concurrency limit and
 * emits per-item progress callbacks for the results table.
 */

import { supabase } from "@/integrations/supabase/client";
import { buildFilename, buildAltText, type TemplateVariables } from "./template-engine";
import { compressImageClient } from "./client-compress";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_ID}.functions.supabase.co`;

export type JobStatus = "queued" | "processing" | "done" | "error" | "pushed";

export interface ImageSeoJob {
  id: string; // local UUID
  sourceType: "url" | "shopify" | "upload";
  // input
  imageUrl?: string; // for url + shopify
  file?: File; // for upload
  variables: TemplateVariables;
  // shopify context (only for shopify mode)
  shopifyProductId?: string;
  shopifyMediaId?: string;
  // output
  status: JobStatus;
  newFilename?: string;
  altText?: string;
  newUrl?: string;
  originalSize?: number;
  newSize?: number;
  savingsPct?: number;
  width?: number;
  height?: number;
  error?: string;
  shopifyMediaIdNew?: string;
}

export interface OrchestratorOptions {
  filenameTemplate: string;
  altTemplate: string;
  maxDimension: number;
  quality: number; // 1–100 for edge, 0–1 for client
  concurrency?: number;
  onUpdate?: (job: ImageSeoJob) => void;
  persistToDb?: boolean;
}

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function callEdge<T = unknown>(fn: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const resp = await fetch(`${FN_BASE}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error || `Edge ${resp.status}`);
  return json as T;
}

async function processOne(job: ImageSeoJob, opts: OrchestratorOptions): Promise<ImageSeoJob> {
  const filename = buildFilename(opts.filenameTemplate, job.variables);
  const altText = buildAltText(opts.altTemplate, job.variables);
  job.newFilename = filename;
  job.altText = altText;
  job.status = "processing";
  opts.onUpdate?.({ ...job });

  try {
    if (job.sourceType === "upload") {
      if (!job.file) throw new Error("No file");
      // Client-side compression first (instant, fewer bytes over the wire)
      const clientResult = await compressImageClient(job.file, {
        maxDimension: opts.maxDimension,
        quality: opts.quality / 100,
      });
      // Forward to edge to persist + final size accounting
      const result = await callEdge<{
        publicUrl: string; newSize: number; originalSize: number; savingsPct: number; width: number; height: number;
      }>("image-seo-process", {
        action: "process_upload",
        base64: clientResult.base64,
        contentType: clientResult.contentType,
        filename,
        originalSize: clientResult.originalSize,
        options: { maxDimension: opts.maxDimension, quality: opts.quality },
      });
      job.newUrl = result.publicUrl;
      job.newSize = result.newSize;
      job.originalSize = result.originalSize;
      job.savingsPct = result.savingsPct;
      job.width = result.width;
      job.height = result.height;
    } else {
      // url + shopify both download server-side (faster + avoids CORS)
      if (!job.imageUrl) throw new Error("No imageUrl");
      const result = await callEdge<{
        publicUrl: string; newSize: number; originalSize: number; savingsPct: number; width: number; height: number;
      }>("image-seo-process", {
        action: "process_url",
        imageUrl: job.imageUrl,
        filename,
        options: { maxDimension: opts.maxDimension, quality: opts.quality },
      });
      job.newUrl = result.publicUrl;
      job.newSize = result.newSize;
      job.originalSize = result.originalSize;
      job.savingsPct = result.savingsPct;
      job.width = result.width;
      job.height = result.height;
    }

    job.status = "done";
    opts.onUpdate?.({ ...job });

    if (opts.persistToDb !== false) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("image_seo_jobs").insert({
          user_id: user.id,
          source_type: job.sourceType,
          source_ref: job.imageUrl ?? job.file?.name ?? null,
          product_id: job.shopifyProductId ?? null,
          product_title: (job.variables.title as string) ?? null,
          vendor: (job.variables.vendor as string) ?? null,
          original_url: job.imageUrl ?? null,
          original_size: job.originalSize ?? null,
          new_url: job.newUrl ?? null,
          new_size: job.newSize ?? null,
          new_filename: job.newFilename ?? null,
          alt_text: job.altText ?? null,
          width: job.width ?? null,
          height: job.height ?? null,
          savings_pct: job.savingsPct ?? null,
          status: "done",
        });
      }
    }
    return job;
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : "Unknown error";
    opts.onUpdate?.({ ...job });
    return job;
  }
}

export async function runJobs(jobs: ImageSeoJob[], opts: OrchestratorOptions): Promise<ImageSeoJob[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  const queue = [...jobs];
  const results: ImageSeoJob[] = [];
  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        const out = await processOne(job, opts);
        results.push(out);
      }
    })());
  }

  await Promise.all(workers);
  return results;
}

/** Push completed jobs back to Shopify (replace product images + alt). Sequential. */
export async function pushJobsToShopify(
  jobs: ImageSeoJob[],
  onUpdate?: (job: ImageSeoJob) => void,
): Promise<{ successes: number; failures: number }> {
  // Group by product
  const byProduct = new Map<string, ImageSeoJob[]>();
  for (const j of jobs) {
    if (j.status !== "done" || !j.shopifyProductId || !j.newUrl) continue;
    if (!byProduct.has(j.shopifyProductId)) byProduct.set(j.shopifyProductId, []);
    byProduct.get(j.shopifyProductId)!.push(j);
  }

  let successes = 0;
  let failures = 0;

  for (const [productId, group] of byProduct) {
    try {
      const replacements = group.map((j) => ({
        oldMediaId: j.shopifyMediaId,
        newImageUrl: j.newUrl!,
        altText: j.altText || "",
        filename: j.newFilename,
      }));
      const result = await callEdge<{
        results: Array<{ ok: boolean; filename?: string; newMediaId?: string; error?: string; oldMediaId?: string }>;
      }>("image-seo-shopify-push", { action: "replace_image", productId, replacements });

      for (const r of result.results) {
        const job = group.find((g) => g.newFilename === r.filename || g.shopifyMediaId === r.oldMediaId);
        if (!job) continue;
        if (r.ok) {
          job.status = "pushed";
          job.shopifyMediaIdNew = r.newMediaId;
          successes++;
        } else {
          job.status = "error";
          job.error = r.error;
          failures++;
        }
        onUpdate?.({ ...job });
      }
    } catch (e) {
      for (const job of group) {
        job.status = "error";
        job.error = e instanceof Error ? e.message : "Push failed";
        failures++;
        onUpdate?.({ ...job });
      }
    }
  }

  return { successes, failures };
}
