import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontDisplay, fontMono } from "../fonts";
import { BrandStrip, StepBadge } from "../components/Brand";

// Scene 04 — Live block at JOOR cart
export const SceneBlock = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOp = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  // Cart appears
  const cartSp = spring({ frame: frame - 10, fps, config: { damping: 22 } });
  const cartOp = interpolate(cartSp, [0, 1], [0, 1]);
  const cartY = interpolate(cartSp, [0, 1], [40, 0]);

  // Margin meter fills
  const meter = interpolate(frame, [30, 70], [0, 0.42], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });

  // Block overlay
  const blockSp = spring({ frame: frame - 75, fps, config: { damping: 14, stiffness: 140 } });
  const blockOp = interpolate(blockSp, [0, 1], [0, 1]);
  const blockScale = interpolate(blockSp, [0, 1], [0.85, 1]);

  // shake on block
  const shakeP = interpolate(frame, [75, 95], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const shake = Math.sin(frame * 1.2) * (1 - shakeP) * (frame > 75 ? 6 : 0);

  return (
    <AbsoluteFill>
      <BrandStrip label="Live Guard" />
      <StepBadge index={3} total={4} />

      <div style={{
        position: "absolute", top: 180, left: 130, fontFamily: fontDisplay, fontWeight: 700,
        fontSize: 88, color: COLORS.text, letterSpacing: -2, opacity: titleOp, lineHeight: 1,
      }}>
        Step 3 — <span style={{ color: COLORS.danger }}>Real-time block.</span>
      </div>
      <div style={{
        position: "absolute", top: 290, left: 130, fontFamily: fontMono,
        fontSize: 24, color: COLORS.textMuted, opacity: titleOp,
      }}>
        While the buyer shops in JOOR, Guardian watches every line.
      </div>

      {/* JOOR cart card */}
      <div style={{
        position: "absolute", top: 410, left: 130, width: 1100, height: 540,
        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: 24, padding: 36,
        boxShadow: `0 30px 80px rgba(0,0,0,0.5)`,
        opacity: cartOp, transform: `translate(${shake}px, ${cartY + shake * 0.4}px)`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <span style={{ fontFamily: fontMono, fontSize: 18, color: COLORS.textMuted, letterSpacing: 4, textTransform: "uppercase" }}>
            JOOR · Buyer Cart
          </span>
          <span style={{ fontFamily: fontMono, fontSize: 22, color: COLORS.text }}>SS25 · 14 SKUs</span>
        </div>

        {[
          { sku: "SS-25-AURA-RED", qty: 24, price: "$48", margin: 62, ok: true },
          { sku: "SS-25-WAVE-BLU", qty: 36, price: "$54", margin: 58, ok: true },
          { sku: "SS-25-LUMI-BLK", qty: 48, price: "$39", margin: 41, ok: false },
          { sku: "SS-25-NOVA-WHT", qty: 18, price: "$72", margin: 67, ok: true },
        ].map((row, i) => (
          <div key={row.sku} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px", borderBottom: `1px solid ${COLORS.border}`,
            background: !row.ok && frame > 65 ? `${COLORS.danger}1a` : "transparent",
            opacity: interpolate(frame, [16 + i * 4, 26 + i * 4], [0, 1], { extrapolateRight: "clamp" }),
          }}>
            <span style={{ fontFamily: fontMono, fontSize: 22, color: COLORS.text, width: 280 }}>{row.sku}</span>
            <span style={{ fontFamily: fontMono, fontSize: 22, color: COLORS.textMuted, width: 80 }}>×{row.qty}</span>
            <span style={{ fontFamily: fontMono, fontSize: 22, color: COLORS.text, width: 80 }}>{row.price}</span>
            <span style={{
              fontFamily: fontMono, fontSize: 22,
              color: row.ok ? COLORS.good : COLORS.danger, fontWeight: 600, width: 80, textAlign: "right",
            }}>
              {row.margin}%
            </span>
          </div>
        ))}

        {/* margin meter */}
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontFamily: fontMono, fontSize: 18, color: COLORS.textMuted, letterSpacing: 3, textTransform: "uppercase" }}>
              Cart margin
            </span>
            <span style={{ fontFamily: fontMono, fontSize: 22, color: meter < 0.55 ? COLORS.danger : COLORS.good, fontWeight: 600 }}>
              {(meter * 100).toFixed(1)}%  /  55%
            </span>
          </div>
          <div style={{ height: 14, borderRadius: 999, background: COLORS.bgDeep, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${meter * 100 / 0.7}%`,
              background: meter < 0.55 ? `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.danger})` : COLORS.good,
              boxShadow: meter < 0.55 ? `0 0 20px ${COLORS.danger}` : `0 0 14px ${COLORS.good}`,
            }}/>
            {/* threshold marker at 55/70 */}
            <div style={{ position: "relative", marginTop: -14, height: 14, width: `${55/70*100}%`, borderRight: `2px dashed ${COLORS.text}` }}/>
          </div>
        </div>
      </div>

      {/* Block alert card */}
      <div style={{
        position: "absolute", top: 470, right: 130, width: 540,
        padding: 36, borderRadius: 24,
        background: `linear-gradient(160deg, ${COLORS.danger}33, ${COLORS.surface})`,
        border: `2px solid ${COLORS.danger}`,
        boxShadow: `0 0 60px ${COLORS.danger}66`,
        opacity: blockOp, transform: `scale(${blockScale})`,
      }}>
        <div style={{ fontFamily: fontMono, fontSize: 18, color: COLORS.danger, letterSpacing: 4, textTransform: "uppercase" }}>
          ⚠ Guardian
        </div>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 64, color: COLORS.text, marginTop: 12, lineHeight: 1 }}>
          Checkout blocked.
        </div>
        <div style={{ marginTop: 22, fontFamily: fontMono, fontSize: 22, color: COLORS.text, lineHeight: 1.5 }}>
          Cart margin <b style={{ color: COLORS.danger }}>42%</b> below your floor of <b>55%</b>.
          Triggered by <b>SS-25-LUMI-BLK</b>.
        </div>
        <div style={{
          marginTop: 24, padding: "12px 22px", borderRadius: 12,
          background: COLORS.bgDeep, border: `1px solid ${COLORS.border}`,
          fontFamily: fontMono, fontSize: 18, color: COLORS.textMuted,
        }}>
          Sent to Slack · #margins · 0.4s
        </div>
      </div>
    </AbsoluteFill>
  );
};
