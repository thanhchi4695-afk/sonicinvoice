import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Crop, Check, RotateCcw, Move } from "lucide-react";

interface ImageCropToolProps {
  imageSrc: string;
  onCrop: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

/**
 * Canvas-based crop tool — user draws a bounding box to select
 * the line items area of an invoice photo.
 */
const ImageCropTool = ({ imageSrc, onCrop, onCancel }: ImageCropToolProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [endPos, setEndPos] = useState({ x: 0, y: 0 });
  const [hasSelection, setHasSelection] = useState(false);
  const [scale, setScale] = useState(1);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const container = canvas.parentElement;
      if (!container) return;
      const maxW = container.clientWidth;
      const maxH = 400;
      const s = Math.min(maxW / img.width, maxH / img.height, 1);
      setScale(s);
      canvas.width = img.width * s;
      canvas.height = img.height * s;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Redraw image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (!hasSelection && !drawing) return;

    const x = Math.min(startPos.x, endPos.x);
    const y = Math.min(startPos.y, endPos.y);
    const w = Math.abs(endPos.x - startPos.x);
    const h = Math.abs(endPos.y - startPos.y);

    if (w < 5 || h < 5) return;

    // Dim outside selection
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - x - w, h);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);

    // Selection border
    ctx.strokeStyle = "hsl(var(--primary))";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Corner handles
    const hs = 6;
    ctx.fillStyle = "hsl(var(--primary))";
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
  }, [startPos, endPos, hasSelection, drawing]);

  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPos(e);
    setStartPos(pos);
    setEndPos(pos);
    setDrawing(true);
    setHasSelection(false);
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    setEndPos(getPos(e));
  };

  const handleEnd = () => {
    setDrawing(false);
    const w = Math.abs(endPos.x - startPos.x);
    const h = Math.abs(endPos.y - startPos.y);
    if (w > 10 && h > 10) {
      setHasSelection(true);
    }
  };

  const handleCrop = () => {
    const img = imgRef.current;
    if (!img || !hasSelection) return;

    // Convert canvas coords back to original image coords
    const x = Math.min(startPos.x, endPos.x) / scale;
    const y = Math.min(startPos.y, endPos.y) / scale;
    const w = Math.abs(endPos.x - startPos.x) / scale;
    const h = Math.abs(endPos.y - startPos.y) / scale;

    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    onCrop(offscreen.toDataURL("image/jpeg", 0.9));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Crop className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold">Draw a box around the line items</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        <Move className="w-3 h-3 inline mr-1" />
        Drag to select the table area — this removes header/footer noise
      </p>
      <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair touch-none"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Skip crop
        </Button>
        <Button size="sm" className="flex-1" onClick={handleCrop} disabled={!hasSelection}>
          <Check className="w-3.5 h-3.5 mr-1" /> Use selection
        </Button>
      </div>
    </div>
  );
};

export default ImageCropTool;
