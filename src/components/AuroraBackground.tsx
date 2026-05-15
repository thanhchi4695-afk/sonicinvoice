import { useRef, useEffect } from 'react';

export default function AuroraBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mousePos = useRef({ x: 0.5, y: 0.5 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = w + 'px';
      canvas!.style.height = h + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onMouseMove(e: MouseEvent) {
      mousePos.current.x = e.clientX / window.innerWidth;
      mousePos.current.y = e.clientY / window.innerHeight;
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    resize();

    function draw(now: number) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t = now * 0.001;
      const mx = mousePos.current.x;

      ctx!.clearRect(0, 0, w, h);

      // Three aurora bands with gradient colors
      const bands = [
        { hue: 160, offset: -0.12, speed: 0.4, alpha: 0.25 },
        { hue: 45, offset: 0, speed: -0.55, alpha: 0.18 },
        { hue: 260, offset: 0.1, speed: 0.35, alpha: 0.15 },
      ];

      for (const band of bands) {
        const baseY = h * 0.45 + band.offset * h * 0.3;
        const wave1 = Math.sin(t * band.speed + mx * 2) * h * 0.08;
        const wave2 = Math.sin(t * band.speed * 1.7 + 1.3) * h * 0.04;
        const wave3 = Math.sin(t * band.speed * 0.6 + 2.7) * h * 0.02;
        const centerY = baseY + wave1 + wave2 + wave3;

        // Draw the band as a radial glow
        const radGrad = ctx!.createRadialGradient(
          w * (0.3 + mx * 0.4), centerY, 0,
          w * 0.5, centerY, w * 0.7
        );
        radGrad.addColorStop(0, `hsla(${band.hue}, 70%, 55%, ${band.alpha})`);
        radGrad.addColorStop(0.5, `hsla(${band.hue}, 60%, 40%, ${band.alpha * 0.5})`);
        radGrad.addColorStop(1, `hsla(${band.hue}, 50%, 20%, 0)`);

        ctx!.fillStyle = radGrad;
        ctx!.fillRect(0, 0, w, h);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
      className={className}
    />
  );
}
