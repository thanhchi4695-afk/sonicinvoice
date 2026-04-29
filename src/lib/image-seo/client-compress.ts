/**
 * Client-side image compression using OffscreenCanvas / HTMLCanvasElement.
 * Used for direct uploads (instant feedback, no edge round-trip for the heavy bytes).
 *
 * Returns a base64 WebP that the caller forwards to `image-seo-process` (action: process_upload)
 * for storage + final size accounting.
 */

export interface ClientCompressOptions {
  maxDimension?: number; // longest side
  quality?: number; // 0–1
}

export interface ClientCompressResult {
  base64: string;
  blob: Blob;
  width: number;
  height: number;
  newSize: number;
  originalSize: number;
  contentType: "image/webp";
}

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_QUALITY = 0.82;

function loadImageBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let s = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export async function compressImageClient(
  file: File | Blob,
  options: ClientCompressOptions = {},
): Promise<ClientCompressResult> {
  const maxDim = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const originalSize = file.size;

  const bmp = await loadImageBitmap(file);
  let { width, height } = bmp;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : (() => {
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        return c;
      })();
  const ctx = (canvas as OffscreenCanvas).getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close?.();

  let blob: Blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: "image/webp", quality });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/webp",
        quality,
      );
    });
  }

  const base64 = await blobToBase64(blob);
  return {
    base64,
    blob,
    width,
    height,
    newSize: blob.size,
    originalSize,
    contentType: "image/webp",
  };
}
