/**
 * ScanMode image preprocessing utilities:
 * - Dimension validation
 * - Deskew / perspective correction via canvas
 * - Barcode region detection
 */

export interface DimensionCheck {
  ok: boolean;
  width: number;
  height: number;
  message?: string;
}

/** Check image dimensions — warn if too small for reliable OCR */
export function checkImageDimensions(img: HTMLImageElement): DimensionCheck {
  const { width, height } = img;
  if (width < 800 || height < 600) {
    return {
      ok: false,
      width,
      height,
      message: `Image too small (${width}×${height}px) — please move closer or use a PDF.`,
    };
  }
  return { ok: true, width, height };
}

/** Load a File or data URL into an HTMLImageElement */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Simple canvas-based deskew.
 * Detects the dominant edge angle by scanning rows for transitions,
 * then rotates to straighten. Works well for slightly tilted document photos.
 */
export async function deskewImage(dataUrl: string): Promise<{ result: string; angle: number }> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Downscale for analysis
  const analysisScale = Math.min(1, 800 / Math.max(img.width, img.height));
  const aw = Math.round(img.width * analysisScale);
  const ah = Math.round(img.height * analysisScale);
  canvas.width = aw;
  canvas.height = ah;
  ctx.drawImage(img, 0, 0, aw, ah);

  // Convert to grayscale and find edges using horizontal scan
  const imageData = ctx.getImageData(0, 0, aw, ah);
  const pixels = imageData.data;

  // Simple edge detection: find first dark pixel per row from left
  const leftEdges: { x: number; y: number }[] = [];
  const threshold = 128;
  const sampleStep = Math.max(1, Math.floor(ah / 60));

  for (let y = Math.floor(ah * 0.1); y < ah * 0.9; y += sampleStep) {
    for (let x = 0; x < aw * 0.4; x++) {
      const idx = (y * aw + x) * 4;
      const gray = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
      if (gray < threshold) {
        leftEdges.push({ x, y });
        break;
      }
    }
  }

  // Estimate angle using linear regression on left edge points
  let angle = 0;
  if (leftEdges.length >= 5) {
    const n = leftEdges.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumYY = 0;
    for (const p of leftEdges) {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumYY += p.y * p.y;
    }
    const denom = n * sumYY - sumY * sumY;
    if (Math.abs(denom) > 0.001) {
      const slope = (n * sumXY - sumX * sumY) / denom;
      angle = Math.atan(slope) * (180 / Math.PI);
    }
  }

  // Only correct if angle is small (< 15°) to avoid false positives
  if (Math.abs(angle) < 0.3 || Math.abs(angle) > 15) {
    // No significant skew detected
    return { result: dataUrl, angle: 0 };
  }

  // Apply rotation to original image
  const rad = -angle * (Math.PI / 180);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(img.width * cos + img.height * sin);
  const newH = Math.ceil(img.width * sin + img.height * cos);

  canvas.width = newW;
  canvas.height = newH;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, newW, newH);
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  return {
    result: canvas.toDataURL("image/jpeg", 0.9),
    angle: Math.round(angle * 10) / 10,
  };
}

/**
 * Extract potential barcode/invoice number from image using AI.
 * Returns the detected barcode string or null.
 */
export async function detectBarcodeFromImage(
  dataUrl: string,
  invokeAI: (body: Record<string, unknown>) => Promise<{ data: any; error: any }>,
): Promise<string | null> {
  try {
    const { data, error } = await invokeAI({
      input: dataUrl,
      mode: "image",
      ocrMode: true,
      barcodeOnly: true,
    });
    if (error) return null;
    return data?.barcode || data?.invoice_number || null;
  } catch {
    return null;
  }
}
