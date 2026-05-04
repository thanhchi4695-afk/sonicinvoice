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
 * How-To: Claude Integration
 * 420 frames @ 30fps = 14s
 *
 * Beats:
 *   0-30     Title fades in
 *   30-110   Supplier invoice arrives, supplier name detected
 *   110-200  Skills file (markdown) loads from library, slides into context
 *   200-300  Claude Sonnet 4.5 reasons over invoice + skills → structured rows stream out
 *   300-360  Confidence badges + Gemini fallback chip lights briefly
 *   360-420  Outro: "Claude · Skills · Fallback"
 */
export const HOWTO_CLAUDE_INTEGRATION_FRAMES = 420;

const fontStack =
  '"Syne", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const monoStack =
  '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

const SKILL_LINES = [
  "# tigerlily.md",
  "",
  "## Document structure",
  "- Header rows: 1-4 (skip)",
  "- Line items start at row 6",
  "",
  "## Cost field rules",
  "- Column `WSP` = wholesale cost",
  "- Column `RRP` ≠ cost (do not use)",
  "",
  "## SKU format",
  "- /^TL-[A-Z]{3}-\\d{2}$/",
  "",
  "## Corrections to apply",
  "- 'Frt' line → freight, not item",
  "- Size 'OS' → 'One Size'",
];

const ROWS = [
  { sku: "TL-SWM-08", name: "Mira One-Piece — Sand", qty: "4", cost: "$89.00", c: 96 },
  { sku: "TL-SWM-10", name: "Mira One-Piece — Sand", qty: "3", cost: "$89.00", c: 95 },
  { sku: "TL-DRS-OS", name: "Sundara Maxi — Floral", qty: "6", cost: "$124.00", c: 92 },
  { sku: "TL-TOP-S",  name: "Cove Crop — Ivory",     qty: "8", cost: "$54.00",  c: 89 },
];

export const HowToClaudeIntegration: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drift = Math.sin(frame / 70) * 6;

  // Title
  const titleOpacity = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 28], [18, 0], { extrapolateRight: "clamp" });

  // Step
  const step = frame < 110 ? 1 : frame < 200 ? 2 : frame < 300 ? 3 : 4;

  // Beat 1: invoice slides in from left
  const invoiceProg = interpolate(frame, [30, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const invoiceX = interpolate(invoiceProg, [0, 1], [-60, 0]);

  // Supplier detect chip pops at ~95
  const detectSpring = spring({
    frame: frame - 95,
    fps,
    config: { damping: 10, stiffness: 200 },
  });

  // Beat 2: skill file slides in from right at 110
  const skillProg = interpolate(frame, [110, 190], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const skillX = interpolate(skillProg, [0, 1], [60, 0]);
  const skillOpacity = interpolate(skillProg, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });

  // Skill line typewriter
  const skillLinesShown = Math.floor(
    interpolate(frame, [130, 195], [0, SKILL_LINES.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  // Beat 3: Claude reasoning at 200
  const claudeGlow = interpolate(frame, [200, 230, 290, 300], [0, 1, 1, 0.4], {
    extrapolateRight: "clamp",
  });
  // pulsing thinking dots
  const thinkPulse = (frame % 30) / 30;

  // Rows reveal staggered from 230
  const rowReveal = (i: number) =>
    spring({
      frame: frame - 230 - i * 16,
      fps,
      config: { damping: 18, stiffness: 160 },
    });

  // Beat 4: Fallback chip flashes 300-340
  const fallbackPulse = interpolate(
    frame,
    [300, 312, 326, 340],
    [0, 1, 0.4, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Outro fade
  const outroFade = interpolate(frame, [400, 420], [1, 0.4], {
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
      {/* Grid */}
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
          How it works · Claude integration
        </div>
        <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
          Skills + Claude{" "}
          <span style={{ color: COLORS.primary }}>=</span>{" "}
          extraction that learns
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
          gap: 36,
          fontFamily: monoStack,
          fontSize: 17,
          opacity: titleOpacity,
        }}
      >
        {[
          "1 · Detect supplier",
          "2 · Load skills file",
          "3 · Claude extracts",
          "4 · Resilient fallback",
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

      {/* MAIN STAGE — split: Invoice (left) · Claude core (center) · Skills (right) */}
      <div
        style={{
          position: "absolute",
          top: 300,
          left: 80,
          right: 80,
          height: 560,
          display: "grid",
          gridTemplateColumns: "1fr 1.1fr 1fr",
          gap: 28,
        }}
      >
        {/* LEFT — Invoice */}
        <div
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: 22,
            transform: `translateX(${invoiceX}px)`,
            opacity: invoiceProg,
            boxShadow: `0 24px 60px -20px ${COLORS.bgDeep}`,
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: monoStack,
              fontSize: 13,
              letterSpacing: 2,
              color: COLORS.textMuted,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Inbound invoice
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            INVOICE #SS-9214
          </div>
          <div style={{ color: COLORS.textMuted, marginBottom: 16, fontSize: 16 }}>
            Tigerlily · Byron Bay
          </div>

          <div style={{ fontFamily: monoStack, fontSize: 13, lineHeight: 1.7, color: COLORS.text }}>
            {[
              "TL-SWM-08  Mira 1pc Sand   4   89.00",
              "TL-SWM-10  Mira 1pc Sand   3   89.00",
              "TL-DRS-OS  Sundara Floral  6  124.00",
              "TL-TOP-S   Cove Crop Ivry  8   54.00",
              "Frt                              48.00",
            ].map((line, i) => (
              <div key={i} style={{ opacity: 0.9 }}>{line}</div>
            ))}
          </div>

          {/* Detected supplier chip */}
          {detectSpring > 0.05 && (
            <div
              style={{
                position: "absolute",
                top: 18,
                right: 18,
                padding: "6px 12px",
                borderRadius: 999,
                background: `${COLORS.primary}26`,
                border: `1px solid ${COLORS.primary}77`,
                color: COLORS.primaryGlow,
                fontFamily: monoStack,
                fontSize: 12,
                letterSpacing: 1,
                transform: `scale(${detectSpring})`,
                boxShadow: `0 0 24px ${COLORS.primary}55`,
              }}
            >
              ⚡ TIGERLILY
            </div>
          )}
        </div>

        {/* CENTER — Claude core */}
        <div
          style={{
            background: `linear-gradient(180deg, ${COLORS.surfaceHi}, ${COLORS.surface})`,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: 22,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
            boxShadow: `0 0 ${40 + claudeGlow * 60}px ${COLORS.primary}${claudeGlow > 0.3 ? "44" : "11"}`,
          }}
        >
          {/* Halo */}
          <div
            style={{
              position: "absolute",
              inset: -20,
              background: `radial-gradient(400px 300px at 50% 35%, ${COLORS.primary}${Math.floor(claudeGlow * 40).toString(16).padStart(2, "0")}, transparent 70%)`,
              pointerEvents: "none",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, zIndex: 1 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: COLORS.primary,
                boxShadow: `0 0 16px ${COLORS.primary}`,
              }}
            />
            <div style={{ fontFamily: monoStack, fontSize: 13, letterSpacing: 2, color: COLORS.textMuted, textTransform: "uppercase" }}>
              anthropic / claude-sonnet-4-5
            </div>
          </div>

          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, zIndex: 1 }}>
            Reasoning over invoice + skills
          </div>

          {/* Thinking dots while frame < 230 */}
          {frame >= 200 && frame < 230 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, zIndex: 1 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: COLORS.primary,
                    opacity: 0.3 + Math.abs(Math.sin((thinkPulse + i * 0.3) * Math.PI)) * 0.7,
                  }}
                />
              ))}
            </div>
          )}

          {/* Extracted rows table appears 230+ */}
          {frame >= 230 && (
            <div style={{ marginTop: 16, zIndex: 1 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1.4fr 0.4fr 0.7fr",
                  gap: 8,
                  padding: "6px 10px",
                  fontFamily: monoStack,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: COLORS.textMuted,
                  textTransform: "uppercase",
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                <div>SKU</div>
                <div>Name</div>
                <div>Qty</div>
                <div style={{ textAlign: "right" }}>Conf</div>
              </div>
              {ROWS.map((r, i) => {
                const reveal = rowReveal(i);
                return (
                  <div
                    key={r.sku}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1.4fr 0.4fr 0.7fr",
                      gap: 8,
                      padding: "10px 10px",
                      alignItems: "center",
                      borderBottom: `1px solid ${COLORS.border}55`,
                      opacity: reveal,
                      transform: `translateY(${(1 - reveal) * 12}px)`,
                    }}
                  >
                    <div style={{ fontFamily: monoStack, fontSize: 14 }}>{r.sku}</div>
                    <div style={{ fontSize: 14 }}>{r.name}</div>
                    <div style={{ fontFamily: monoStack, fontSize: 14, color: COLORS.accent }}>{r.qty}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div
                        style={{
                          padding: "3px 9px",
                          borderRadius: 999,
                          fontFamily: monoStack,
                          fontSize: 11,
                          background: r.c >= 90 ? `${COLORS.good}26` : `${COLORS.accent}26`,
                          color: r.c >= 90 ? COLORS.good : COLORS.accent,
                          border: `1px solid ${(r.c >= 90 ? COLORS.good : COLORS.accent)}55`,
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

        {/* RIGHT — Skill file (markdown) */}
        <div
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: 22,
            transform: `translateX(${skillX}px)`,
            opacity: skillOpacity,
            boxShadow: `0 24px 60px -20px ${COLORS.bgDeep}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: monoStack,
              fontSize: 13,
              letterSpacing: 2,
              color: COLORS.textMuted,
              textTransform: "uppercase",
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: COLORS.accent }}>◆</span> Skills library
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 14 }}>
            Supplier rules · markdown
          </div>

          <div
            style={{
              fontFamily: monoStack,
              fontSize: 12.5,
              lineHeight: 1.65,
              color: COLORS.text,
              background: COLORS.bgDeep,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 14,
              minHeight: 320,
            }}
          >
            {SKILL_LINES.slice(0, skillLinesShown).map((line, i) => {
              const isHeading = line.startsWith("#");
              const isBullet = line.startsWith("-");
              return (
                <div
                  key={i}
                  style={{
                    color: isHeading
                      ? COLORS.primary
                      : isBullet
                        ? COLORS.text
                        : COLORS.textMuted,
                    fontWeight: isHeading ? 700 : 400,
                    minHeight: 18,
                  }}
                >
                  {line || "\u00A0"}
                </div>
              );
            })}
            {/* blinking caret while typing */}
            {frame >= 130 && frame < 195 && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 14,
                  marginLeft: 2,
                  background: COLORS.primary,
                  opacity: (frame % 30) < 15 ? 1 : 0,
                  verticalAlign: "middle",
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom: Fallback chip + outro */}
      <Sequence from={300}>
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 18,
            fontFamily: monoStack,
            fontSize: 16,
            color: COLORS.textMuted,
          }}
        >
          <span>Resilient by design:</span>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: `${COLORS.primary}33`,
              color: COLORS.primaryGlow,
              border: `1px solid ${COLORS.primary}88`,
            }}
          >
            claude-sonnet-4-5
          </div>
          <span style={{ color: COLORS.textMuted }}>↳ if unreachable ↳</span>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: `${COLORS.accent}${Math.floor(20 + fallbackPulse * 60).toString(16).padStart(2, "0")}`,
              color: COLORS.accent,
              border: `1px solid ${COLORS.accent}88`,
              boxShadow: fallbackPulse > 0.2 ? `0 0 ${20 * fallbackPulse}px ${COLORS.accent}88` : "none",
              transform: `scale(${1 + fallbackPulse * 0.05})`,
            }}
          >
            gemini-2.5-flash
          </div>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
