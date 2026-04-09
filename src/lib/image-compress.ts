/**
 * Client-side image compression using Canvas API.
 * Resizes + re-encodes images for optimal Shopify performance.
 */

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "image/jpeg" | "image/webp";
}

export interface CompressionResult {
  blob: Blob;
  base64: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  savingsPct: number;
}

const DEFAULTS: Required<CompressionOptions> = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.80,
  format: "image/webp",
};

/**
 * Compress an image from a URL using Canvas.
 * Fetches → draws to canvas at target size → re-encodes at target quality.
 */
export async function compressImageFromUrl(
  imageUrl: string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULTS, ...options };

  // Fetch the image as a blob
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const originalBlob = await response.blob();
  const originalSize = originalBlob.size;

  return compressBlob(originalBlob, originalSize, opts);
}

/**
 * Compress an image from a File or Blob.
 */
export async function compressImageFromFile(
  file: File | Blob,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULTS, ...options };
  return compressBlob(file, file.size, opts);
}

async function compressBlob(
  blob: Blob,
  originalSize: number,
  opts: Required<CompressionOptions>
): Promise<CompressionResult> {
  // Create image element
  const img = await createImage(blob);

  // Calculate target dimensions (maintain aspect ratio)
  let { width, height } = img;
  const ratio = Math.min(
    opts.maxWidth / width,
    opts.maxHeight / height,
    1 // never upscale
  );
  width = Math.round(width * ratio);
  height = Math.round(height * ratio);

  // Draw to canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Use high-quality resampling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // Encode to target format
  const compressedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas compression failed"))),
      opts.format,
      opts.quality
    );
  });

  // Convert to base64 for upload
  const base64 = await blobToBase64(compressedBlob);

  return {
    blob: compressedBlob,
    base64,
    width,
    height,
    originalSize,
    compressedSize: compressedBlob.size,
    savingsPct: Math.round((1 - compressedBlob.size / originalSize) * 100),
  };
}

function createImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(blob);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
