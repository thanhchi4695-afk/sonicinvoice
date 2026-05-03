import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";
import { COLORS } from "../theme";

/**
 * How-To: Invoice Upload → Catalog-ready
 * 360 frames @ 30fps = 12s
 *
 * Beats:
 *   0-30    Title fades in
 *   30-110  Drag-and-drop invoice file animation
 *   110-180 Azure / AI extraction scan-line over invoice
 *   180-280 Line items materialise into a structured table
 *   280-330 Confidence badges + "ready to push" indicator
 *   330-360 Outro
 */
export const HOWTO_INVOICE_UPLOAD_FRAMES = 360;

const fontStack =
  '"Syne", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const monoStack =
  '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

const ROWS = [
  { sku: "SLK-DRS-IVR-08", name: "Silk Midi Dress", qty: "6", cost: "$142.00", c: 96 },
  { sku: "SLK-DRS-BLK-10", name: "Silk Midi Dress", qty: "4", cost: "$142.00", c: 94 },
  { sku: "LIN-BLZ-OAT-M", name: "Linen Blazer", qty: "3", cost: "$189.00", c: 88 },
  { sku: "CTN-TEE-WHT-S", name: "Cotton Tee", qty: "12", cost: "$28.00", c: 91 },
];

export const HowToInvoiceUpload: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drift = Math.sin(frame / 60) * 8;

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 25], [16, 0], {
    extrapolateRight: "clamp",
  });

  const step =
    frame < 110 ? 1 : frame < 180 ? 2 : frame < 280 ? 3 : 4;

  // Drop zone + file drop animation 30→110
  const fileDropProgress = interpolate(frame, [30, 95], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fileY = interpolate(fileDropProgress, [0, 1], [-180, 0]);
  const fileRot = interpolate(fileDropProgress, [0, 1], [-12, 0]);
  const fileLanded = frame >= 95;
  const dropPulse = fileLanded
    ? spring({
        frame: frame - 95,
        fps,
        config: { damping: 8, stiffness: 220 },
      })
    : 0;

  // Scan line 110→180
  const scanProgress = interpolate(frame, [110, 175], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Table reveal 180→280 — stagger rows
  const rowReveal = (i: number) =>
    spring({
      frame: frame - 180 - i * 14,
      fps,
      config: { damping: 18, stiffness: 160 },
    });

  // Push to catalog 280→330
  const arrowProgress = interpolate(frame, [280, 320], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const checkSpring = spring({
    frame: frame - 320,
    fps,
    config: { damping: 10, stiffness: 200 },
  });

  const outroFade = interpolate(frame, [340, 360], [1, 0.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 800px at ${50 + drift}% 30%, ${COLORS.surface} 0%, ${COLORS.bg} 60%, ${COLORS.bgDeep} 100%)`,
        color: COLORS.text,
        fontFamily: fontStack,
        opacity: outroFade,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.border}55 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}55 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          opacity: 0.18,
        }}
      />

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 70,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: 6,
            color: COLORS.primary,
            fontFamily: monoStack,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          How it works · 2 of N
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
          Drop an invoice{" "}
          <span style={{ color: COLORS.primary }}>→</span> catalog-ready in
          seconds
        </div>
      </div>

      {/* Step ribbon */}
      <div
        style={{
          position: "absolute",
          top: 230,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 40,
          fontFamily: monoStack,
          fontSize: 18,
          opacity: titleOpacity,
        }}
      >
        {[
          "1 · Drop file",
          "2 · AI scans",
          "3 · Lines extracted",
          "4 · Push to catalog",
        ].map((label, i) => {
          const active = step === i + 1;
          const done = step > i + 1;
          return (
            <div
              key={label}
              style={{
                color: active
                  ? COLORS.accent
                  : done
                    ? COLORS.good
                    : COLORS.textMuted,
                opacity: active ? 1 : 0.7,
                transform: active ? "scale(1.05)" : "scale(1)",
              }}
            >
              {done ? "✓ " : ""}
              {label}
            </div>
          );
        })}
      </div>

      {/* Drop zone / invoice surface */}
      <div
        style={{
          position: "absolute",
          top: 310,
          left: 200,
          right: 200,
          height: 540,
          background: COLORS.surface,
          border: `2px dashed ${fileLanded ? COLORS.primary : COLORS.border}`,
          borderRadius: 18,
          padding: 28,
          boxShadow: `0 30px 80px -20px ${COLORS.bgDeep}`,
          overflow: "hidden",
          transform: `scale(${1 + dropPulse * 0.02})`,
        }}
      >
        {/* Zone label (only before file drops) */}
        {frame < 95 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 14,
              fontFamily: monoStack,
              color: COLORS.textMuted,
              fontSize: 22,
              opacity: 1 - fileDropProgress * 0.6,
            }}
          >
            <div style={{ fontSize: 60 }}>⬇</div>
            <div>Drop invoice (PDF · JPG · PNG)</div>
          </div>
        )}

        {/* The invoice "page" that drops in */}
        {frame < 180 && (
          <div
            style={{
              position: "absolute",
              top: 60,
              left: "50%",
              width: 420,
              height: 420,
              marginLeft: -210,
              background: "#F5F1E8",
              color: "#1B2730",
              borderRadius: 8,
              padding: 24,
              fontFamily: monoStack,
              fontSize: 14,
              transform: `translateY(${fileY}px) rotate(${fileRot}deg)`,
              boxShadow: `0 24px 50px -12px ${COLORS.bgDeep}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontFamily: fontStack,
                fontSize: 22,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              INVOICE #4821
            </div>
            <div style={{ color: "#5C6870", marginBottom: 16 }}>
              Maison Atelier · Paris
            </div>
            {[
              "Silk Midi Dress — Ivory  6 × $142.00",
              "Silk Midi Dress — Black  4 × $142.00",
              "Linen Blazer — Oat       3 × $189.00",
              "Cotton Tee — White      12 ×  $28.00",
              "─────────────────────────────",
              "Subtotal              $2,498.00",
              "Freight                  $48.00",
              "TOTAL                 $2,546.00",
            ].map((line, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                {line}
              </div>
            ))}

            {/* Scan line overlay */}
            {frame >= 110 && (
              <>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: scanProgress * 420,
                    height: 4,
                    background: COLORS.primary,
                    boxShadow: `0 0 24px ${COLORS.primary}, 0 0 60px ${COLORS.primaryGlow}`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: scanProgress * 420,
                    background: `linear-gradient(180deg, ${COLORS.primary}10, ${COLORS.primary}25)`,
                  }}
                />
              </>
            )}
          </div>
        )}

        {/* Extracted line-item table */}
        {frame >= 180 && (
          <div style={{ paddingTop: 6 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1.6fr 0.5fr 0.8fr 0.7fr",
                gap: 12,
                padding: "10px 14px",
                fontFamily: monoStack,
                fontSize: 14,
                letterSpacing: 2,
                color: COLORS.textMuted,
                textTransform: "uppercase",
                borderBottom: `1px solid ${COLORS.border}`,
              }}
            >
              <div>SKU</div>
              <div>Name</div>
              <div>Qty</div>
              <div>Cost</div>
              <div style={{ textAlign: "right" }}>Confidence</div>
            </div>
            {ROWS.map((r, i) => {
              const reveal = rowReveal(i);
              return (
                <div
                  key={r.sku}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1.6fr 0.5fr 0.8fr 0.7fr",
                    gap: 12,
                    padding: "16px 14px",
                    alignItems: "center",
                    borderBottom: `1px solid ${COLORS.border}55`,
                    background:
                      i % 2 === 0 ? "transparent" : `${COLORS.surfaceHi}55`,
                    opacity: reveal,
                    transform: `translateY(${(1 - reveal) * 14}px)`,
                  }}
                >
                  <div style={{ fontFamily: monoStack, fontSize: 18 }}>
                    {r.sku}
                  </div>
                  <div style={{ fontSize: 20 }}>{r.name}</div>
                  <div style={{ fontFamily: monoStack, fontSize: 20 }}>
                    {r.qty}
                  </div>
                  <div
                    style={{
                      fontFamily: monoStack,
                      fontSize: 20,
                      color: COLORS.accent,
                    }}
                  >
                    {r.cost}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        padding: "4px 12px",
                        borderRadius: 999,
                        fontFamily: monoStack,
                        fontSize: 14,
                        background:
                          r.c >= 90
                            ? `${COLORS.good}26`
                            : `${COLORS.accent}26`,
                        color: r.c >= 90 ? COLORS.good : COLORS.accent,
                        border: `1px solid ${
                          r.c >= 90 ? COLORS.good : COLORS.accent
                        }55`,
                      }}
                    >
                      {r.c}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Push to catalog */}
      <Sequence from={280}>
        <div
          style={{
            position: "absolute",
            bottom: 80,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 32,
            fontFamily: monoStack,
            fontSize: 22,
            color: COLORS.textMuted,
          }}
        >
          <span style={{ color: COLORS.text, fontWeight: 600 }}>Invoice</span>
          <div
            style={{
              flex: "0 0 360px",
              height: 4,
              background: COLORS.border,
              borderRadius: 2,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${arrowProgress * 100}%`,
                background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`,
              }}
            />
          </div>
          <span style={{ color: COLORS.text, fontWeight: 600 }}>
            Catalog · POS · Shopify
          </span>
          {checkSpring > 0.05 && (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                background: COLORS.good,
                color: COLORS.bgDeep,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 800,
                transform: `scale(${checkSpring})`,
                boxShadow: `0 0 30px ${COLORS.good}66`,
              }}
            >
              ✓
            </div>
          )}
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
