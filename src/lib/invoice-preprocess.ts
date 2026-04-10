/**
 * Invoice photo preprocessing pipeline.
 * Cleans up phone photos before OCR/AI extraction:
 * - Auto orientation correction (EXIF + AI-assisted)
 * - Contrast enhancement & shadow removal
 * - Highlight/marker tolerance
 * - Region-of-interest cropping (line-item table)
 * - Multi-pass OCR preparation
 */

export interface PreprocessResult {
  /** Cleaned full-page image as base64 (JPEG) */
  cleanedFull: string;
  /** Cropped line-item region as base64 (if detected) */
  lineItemCrop: string | null;
  /** High-contrast enhanced version as base64 */
  highContrast: string;
  /** Best version to send to parser (auto-selected) */
  bestForOCR: string;
  /** Debug previews for the UI */
  debugPreviews: {
    original: string;
    rotated: string;
    cleaned: string;
    cropped: string | null;
    enhanced: string;
  };
  /** Detected rotation applied (degrees) */
  rotationApplied: number;
  /** Whether the image was significantly processed */
  wasProcessed: boolean;
  /** AI-detected regions (if available) */
  regions: DetectedRegions | null;
  /** Processing time in ms */
  processingTimeMs: number;
}

export interface DetectedRegions {
  header: { y: number; height: number } | null;
  lineItems: { y: number; height: number } | null;
  totals: { y: number; height: number } | null;
  orientation: "correct" | "rotated_90_cw" | "rotated_90_ccw" | "upside_down";
  confidence: number;
  isLandscape?: boolean;
}

// ── Main preprocessing pipeline ──

export async function preprocessInvoiceImage(
  file: File,
  aiRegionDetect?: (base64: string) => Promise<DetectedRegions | null>
): Promise<PreprocessResult> {
  const start = performance.now();

  // Step 1: Load image and read EXIF orientation
  const originalBase64 = await fileToBase64(file);
  const img = await loadImage(originalBase64);
  const exifRotation = await getExifRotation(file);

  // Step 2: Apply EXIF orientation correction
  const { canvas: rawOrientedCanvas, rotation: exifDeg } = applyExifOrientation(img, exifRotation);

  // Step 2.1: Resize large phone photos to save bandwidth & AI context
  const orientedCanvas = resizeIfNeeded(rawOrientedCanvas);

  // Step 2.5: Detect landscape orientation (wider than tall after EXIF correction)
  const isLandscapeRatio = orientedCanvas.width > orientedCanvas.height * 1.2;
  const orientedBase64 = canvasToBase64(orientedCanvas);

  // Step 3: AI-assisted region + orientation detection (if available)
  let regions: DetectedRegions | null = null;
  let aiRotation = 0;
  if (aiRegionDetect) {
    try {
      regions = await aiRegionDetect(orientedBase64);
      if (regions) {
        aiRotation = orientationToDegrees(regions.orientation);
        // Tag landscape detection for downstream consumers
        if (isLandscapeRatio && !regions.isLandscape) {
          regions.isLandscape = true;
        }
      }
    } catch (e) {
      console.warn("[Preprocess] AI region detection failed, using heuristics:", e);
    }
  }

  // Step 4: Apply AI rotation if needed (on top of EXIF)
  let rotatedCanvas = orientedCanvas;
  if (aiRotation !== 0) {
    rotatedCanvas = rotateCanvas(orientedCanvas, aiRotation);
  }
  const totalRotation = (exifDeg + aiRotation) % 360;
  const rotatedBase64 = canvasToBase64(rotatedCanvas);

  // Step 5: Contrast enhancement & shadow removal
  const cleanedCanvas = enhanceContrast(rotatedCanvas);
  const cleanedBase64 = canvasToBase64(cleanedCanvas);

  // Step 6: Highlight/marker neutralisation
  const neutralisedCanvas = neutraliseHighlights(cleanedCanvas);
  const neutralisedBase64 = canvasToBase64(neutralisedCanvas);

  // Step 7: Crop line-item region (if AI detected it)
  let lineItemCrop: string | null = null;
  let croppedBase64: string | null = null;
  if (regions?.lineItems) {
    const { y, height } = regions.lineItems;
    const cropCanvas = cropRegion(
      neutralisedCanvas,
      0, Math.floor(y * neutralisedCanvas.height),
      neutralisedCanvas.width,
      Math.floor(height * neutralisedCanvas.height)
    );
    lineItemCrop = canvasToBase64(cropCanvas);
    croppedBase64 = lineItemCrop;
  }

  // Step 8: High-contrast version for difficult text
  const hcCanvas = createHighContrast(neutralisedCanvas);
  const highContrastBase64 = canvasToBase64(hcCanvas);

  // Step 9: Select best version for OCR
  // Prefer: cropped line-item region > cleaned full > high-contrast
  const bestForOCR = lineItemCrop || neutralisedBase64;

  const processingTimeMs = Math.round(performance.now() - start);
  const wasProcessed = totalRotation !== 0 || true; // always true since we enhance

  return {
    cleanedFull: neutralisedBase64,
    lineItemCrop,
    highContrast: highContrastBase64,
    bestForOCR,
    debugPreviews: {
      original: originalBase64,
      rotated: rotatedBase64,
      cleaned: neutralisedBase64,
      cropped: croppedBase64,
      enhanced: highContrastBase64,
    },
    rotationApplied: totalRotation,
    wasProcessed,
    regions,
    processingTimeMs,
  };
}

// ── Canvas Utilities ──

/** Maximum pixel dimension for images sent to the AI model.
 *  Phone photos are 3000-4000px — downsizing saves bandwidth and
 *  keeps the AI context window manageable without losing OCR quality. */
const MAX_IMAGE_DIMENSION = 2048;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix to get raw base64
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

function canvasToBase64(canvas: HTMLCanvasElement, quality = 0.92): string {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1];
}

/** Downscale a canvas if either dimension exceeds MAX_IMAGE_DIMENSION.
 *  Preserves aspect ratio. Returns the same canvas if no resize needed. */
function resizeIfNeeded(source: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = source;
  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) return source;

  const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext("2d")!;
  // Use high-quality downscaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, newW, newH);
  return canvas;
}

// ── EXIF Orientation ──

async function getExifRotation(file: File): Promise<number> {
  try {
    const buffer = await file.slice(0, 65536).arrayBuffer();
    const view = new DataView(buffer);

    // Check JPEG SOI marker
    if (view.getUint16(0) !== 0xFFD8) return 1;

    let offset = 2;
    while (offset < view.byteLength - 2) {
      const marker = view.getUint16(offset);
      offset += 2;

      if (marker === 0xFFE1) {
        // APP1 (EXIF)
        const length = view.getUint16(offset);
        offset += 2;

        // Check "Exif\0\0"
        if (view.getUint32(offset) !== 0x45786966) return 1;
        offset += 6;

        const tiffStart = offset;
        const bigEndian = view.getUint16(offset) === 0x4D4D;

        const getU16 = (o: number) => bigEndian ? view.getUint16(o) : view.getUint16(o, true);

        offset += 2; // byte order
        offset += 2; // magic 0x002A
        const ifdOffset = bigEndian ? view.getUint32(offset) : view.getUint32(offset, true);
        offset = tiffStart + ifdOffset;

        const entries = getU16(offset);
        offset += 2;

        for (let i = 0; i < entries; i++) {
          const tag = getU16(offset);
          if (tag === 0x0112) {
            // Orientation tag
            const value = getU16(offset + 8);
            return value;
          }
          offset += 12;
        }
        return 1;
      } else if ((marker & 0xFF00) === 0xFF00) {
        const length = view.getUint16(offset);
        offset += length;
      } else {
        break;
      }
    }
  } catch {
    // EXIF parse failed — assume normal
  }
  return 1;
}

function applyExifOrientation(
  img: HTMLImageElement,
  orientation: number
): { canvas: HTMLCanvasElement; rotation: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  let rotation = 0;

  switch (orientation) {
    case 3: // 180°
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.translate(img.width, img.height);
      ctx.rotate(Math.PI);
      rotation = 180;
      break;
    case 6: // 90° CW
      canvas.width = img.height;
      canvas.height = img.width;
      ctx.translate(img.height, 0);
      ctx.rotate(Math.PI / 2);
      rotation = 90;
      break;
    case 8: // 90° CCW
      canvas.width = img.height;
      canvas.height = img.width;
      ctx.translate(0, img.width);
      ctx.rotate(-Math.PI / 2);
      rotation = 270;
      break;
    default: // Normal (1) or mirror variants
      canvas.width = img.width;
      canvas.height = img.height;
      break;
  }

  ctx.drawImage(img, 0, 0);
  return { canvas, rotation };
}

function rotateCanvas(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const newCanvas = document.createElement("canvas");
  const ctx = newCanvas.getContext("2d")!;

  if (degrees === 90 || degrees === 270) {
    newCanvas.width = canvas.height;
    newCanvas.height = canvas.width;
  } else {
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height;
  }

  ctx.translate(newCanvas.width / 2, newCanvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return newCanvas;
}

// ── Image Enhancement ──

function enhanceContrast(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Adaptive histogram stretching
  // Find the actual min/max luminance (ignore outlier 1%)
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[lum]++;
  }

  const totalPixels = data.length / 4;
  const clipLow = totalPixels * 0.01;
  const clipHigh = totalPixels * 0.99;

  let minL = 0, maxL = 255;
  let cumSum = 0;
  for (let i = 0; i < 256; i++) {
    cumSum += histogram[i];
    if (cumSum >= clipLow) { minL = i; break; }
  }
  cumSum = 0;
  for (let i = 255; i >= 0; i--) {
    cumSum += histogram[i];
    if (cumSum >= (totalPixels - clipHigh)) { maxL = i; break; }
  }

  const range = maxL - minL || 1;

  // Apply contrast stretch + slight brightness boost for shadows
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let val = data[i + c];
      val = ((val - minL) / range) * 255;
      // Gamma correction to lift shadows (gamma < 1 brightens darks)
      val = 255 * Math.pow(Math.max(0, Math.min(1, val / 255)), 0.85);
      data[i + c] = Math.max(0, Math.min(255, Math.round(val)));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function neutraliseHighlights(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Detect yellow/green highlighter: high R+G, low B, high saturation
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;

    // Yellow highlight: R>180, G>180, B<140, sat>0.2
    const isYellowHighlight = r > 180 && g > 180 && b < 140 && sat > 0.2;
    // Pink highlight: R>180, G<160, B>140, sat>0.15
    const isPinkHighlight = r > 180 && g < 160 && b > 140 && sat > 0.15 && r > b;
    // Green highlight: G>180, R<180, B<150, sat>0.2
    const isGreenHighlight = g > 180 && r < 180 && b < 150 && sat > 0.2;
    // Orange highlight: R>200, G>130, G<180, B<100
    const isOrangeHighlight = r > 200 && g > 130 && g < 180 && b < 100;

    if (isYellowHighlight || isPinkHighlight || isGreenHighlight || isOrangeHighlight) {
      // Replace highlight with white-ish background (preserve any text underneath)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 200) {
        // Very bright highlight — make white
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      } else {
        // Darker region under highlight (likely text) — boost contrast
        const factor = 1.3;
        data[i] = Math.min(255, Math.round(r * factor * 0.7));
        data[i + 1] = Math.min(255, Math.round(g * factor * 0.7));
        data[i + 2] = Math.min(255, Math.round(b * factor * 0.9));
      }
    }

    // Detect pen/marker strokes (very dark, high saturation)
    // These are annotations — don't remove, but don't let them break row detection
    // Leave dark marks as-is (they're usually lines/circles around quantities)
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createHighContrast(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Adaptive thresholding for high contrast
  // Use local mean for better results on uneven lighting
  const w = canvas.width;
  const h = canvas.height;
  const blockSize = Math.max(15, Math.floor(Math.min(w, h) / 30));

  // Build grayscale array
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4;
    gray[i] = 0.299 * data[pi] + 0.587 * data[pi + 1] + 0.114 * data[pi + 2];
  }

  // Compute integral image for fast local mean
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = rowSum + integral[y * (w + 1) + (x + 1)];
    }
  }

  const half = Math.floor(blockSize / 2);
  const threshold = 0.85; // % of local mean to consider "dark" (text)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const y0 = Math.max(0, y - half);
      const x1 = Math.min(w, x + half + 1);
      const y1 = Math.min(h, y + half + 1);
      const area = (x1 - x0) * (y1 - y0);

      const sum =
        integral[y1 * (w + 1) + x1] -
        integral[y0 * (w + 1) + x1] -
        integral[y1 * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];

      const localMean = sum / area;
      const pi = (y * w + x) * 4;

      if (gray[y * w + x] < localMean * threshold) {
        // Dark (text) — make black
        data[pi] = 0;
        data[pi + 1] = 0;
        data[pi + 2] = 0;
      } else {
        // Light (background) — make white
        data[pi] = 255;
        data[pi + 1] = 255;
        data[pi + 2] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function cropRegion(
  source: HTMLCanvasElement,
  x: number, y: number,
  width: number, height: number
): HTMLCanvasElement {
  // Clamp to canvas bounds
  const sx = Math.max(0, x);
  const sy = Math.max(0, y);
  const sw = Math.min(width, source.width - sx);
  const sh = Math.min(height, source.height - sy);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function orientationToDegrees(orient: DetectedRegions["orientation"]): number {
  switch (orient) {
    case "rotated_90_cw": return 270; // AI says image is rotated CW, so rotate CCW to fix
    case "rotated_90_ccw": return 90;
    case "upside_down": return 180;
    default: return 0;
  }
}

// ── Exported helpers for edge function integration ──

/**
 * Quick check: is this file likely a photo (not a clean PDF/scan)?
 * Photos benefit most from preprocessing.
 */
export function isLikelyPhotoInvoice(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  // Images from phone cameras
  if (["jpg", "jpeg", "heic", "heif"].includes(ext)) return true;
  // PNG could be screenshot or photo
  if (ext === "png" && file.size > 500_000) return true;
  return false;
}

/**
 * Minimal preprocessing: just orientation + contrast.
 * For when full AI region detection isn't needed.
 */
export async function quickPreprocess(file: File): Promise<string> {
  const result = await preprocessInvoiceImage(file);
  return result.cleanedFull;
}
