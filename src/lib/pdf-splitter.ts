// Splits large PDFs into smaller per-page chunks so each can be parsed within
// Supabase Edge Function's 150s idle limit. Also offers a "first page only"
// mode for users who know their invoice fits on page 1 (most common case for
// gmail-forwarded supplier invoices).

import { PDFDocument } from "pdf-lib";

export interface PdfChunk {
  /** 1-indexed page number this chunk starts at */
  startPage: number;
  /** 1-indexed page number this chunk ends at (inclusive) */
  endPage: number;
  /** New File ready to upload */
  file: File;
}

const DEFAULT_PAGES_PER_CHUNK = 1;

/**
 * Heuristic: PDFs over this byte threshold are likely to time out the
 * 150 s Edge Function limit when parsed in a single pass.
 */
export const LARGE_PDF_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB

export function isLargePdf(file: File): boolean {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return false;
  return file.size > LARGE_PDF_THRESHOLD_BYTES;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Split a PDF into chunks of `pagesPerChunk` pages each. Returns one File per
 * chunk. The original file is left untouched.
 */
export async function splitPdf(
  file: File,
  pagesPerChunk: number = DEFAULT_PAGES_PER_CHUNK,
): Promise<PdfChunk[]> {
  const buf = await file.arrayBuffer();
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = src.getPageCount();
  const chunks: PdfChunk[] = [];
  const baseName = file.name.replace(/\.pdf$/i, "");

  for (let start = 0; start < total; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, total);
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await out.copyPages(src, indices);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const chunkFile = new File(
      [blob],
      `${baseName}_p${start + 1}-${end}.pdf`,
      { type: "application/pdf" },
    );
    chunks.push({ startPage: start + 1, endPage: end, file: chunkFile });
  }

  return chunks;
}

/** Extract just one specific page (1-indexed) as its own File. */
export async function extractPdfPage(file: File, pageNumber: number): Promise<File> {
  const buf = await file.arrayBuffer();
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [pageNumber - 1]);
  out.addPage(page);
  const bytes = await out.save();
  const baseName = file.name.replace(/\.pdf$/i, "");
  return new File([bytes], `${baseName}_p${pageNumber}.pdf`, { type: "application/pdf" });
}
