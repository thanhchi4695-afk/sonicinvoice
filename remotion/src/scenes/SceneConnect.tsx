import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontDisplay, fontMono } from "../fonts";
import { BrandStrip, StepBadge } from "../components/Brand";

// Scene 02 — Connect JOOR
export const SceneConnect = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSp = spring({ frame: frame - 4, fps, config: { damping: 22 } });
  const titleY = interpolate(titleSp, [0, 1], [40, 0]);
  const titleOp = interpolate(frame, [4, 18], [0, 1], { extrapolateRight: "clamp" });

  const cardSp = spring({ frame: frame - 14, fps, config: { damping: 18, stiffness: 100 } });
  const cardScale = interpolate(cardSp, [0, 1], [0.92, 1]);
  const cardOp = interpolate(frame, [14, 28], [0, 1], { extrapolateRight: "clamp" });

  // connection pulse
  const pulse = (frame % 50) / 50;
  const pulseOp = interpolate(pulse, [0, 0.5, 1], [0.2, 1, 0.2]);

  // status flip from Disconnected -> Connected
  const connected = frame > 60;
  const flashOp = interpolate(frame, [56, 64, 72], [0, 1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <BrandStrip label="Setup" />
      <StepBadge index={1} total={4} />

      <div
        style={{
          position: "absolute",
          top: 200,
          left: 130,
          fontFamily: fontDisplay,
          fontWeight: 700,
          fontSize: 96,
          color: COLORS.text,
          letterSpacing: -2,
          transform: `translateY(${titleY}px)`,
          opacity: titleOp,
          lineHeight: 1,
        }}
      >
        Step 1 — <span style={{ color: COLORS.primary }}>Connect JOOR.</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 320,
          left: 130,
          fontFamily: fontMono,
          fontSize: 26,
          color: COLORS.textMuted,
          opacity: titleOp,
        }}
      >
        Link your buyer's room in 2 minutes — read-only, revocable.
      </div>

      {/* Connection card */}
      <div
        style={{
          position: "absolute",
          top: 470,
          left: 130,
          width: 1660,
          height: 360,
          borderRadius: 24,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          boxShadow: `0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px ${COLORS.primary}22 inset`,
          padding: "40px 56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          transform: `scale(${cardScale})`,
          transformOrigin: "left center",
          opacity: cardOp,
        }}
      >
        {/* Left: JOOR logo block */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div
            style={{
              width: 140,
              height: 140,
              borderRadius: 28,
              background: `linear-gradient(135deg, #1a1a1a, #2a2a2a)`,
              border: `1px solid ${COLORS.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fontDisplay,
              fontWeight: 800,
              fontSize: 44,
              color: COLORS.text,
              letterSpacing: 2,
            }}
          >
            JOOR
          </div>
          <div>
            <div style={{ fontFamily: fontMono, fontSize: 22, color: COLORS.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>
              Wholesale Connector
            </div>
            <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 56, color: COLORS.text, marginTop: 8 }}>
              JOOR Account
            </div>
            <div style={{ fontFamily: fontMono, fontSize: 22, color: COLORS.textMuted, marginTop: 6 }}>
              api.joor.com · OAuth 2.0
            </div>
          </div>
        </div>

        {/* Center: pulsing line */}
        <div style={{ flex: 1, margin: "0 60px", position: "relative", height: 4 }}>
          <div style={{
            position: "absolute", left: 0, right: 0, top: 0, height: 4,
            background: `linear-gradient(90deg, transparent, ${COLORS.primary}, transparent)`,
            opacity: pulseOp,
          }} />
          <div style={{
            position: "absolute", left: `${pulse * 100}%`, top: -6,
            width: 16, height: 16, borderRadius: "50%",
            background: COLORS.primary,
            boxShadow: `0 0 20px ${COLORS.primary}`,
            transform: "translateX(-50%)",
            opacity: connected ? 1 : 0.3,
          }} />
        </div>

        {/* Right: status pill */}
        <div
          style={{
            padding: "20px 36px",
            borderRadius: 999,
            background: connected ? `${COLORS.good}22` : `${COLORS.textMuted}22`,
            border: `2px solid ${connected ? COLORS.good : COLORS.textMuted}`,
            display: "flex",
            alignItems: "center",
            gap: 16,
            position: "relative",
          }}
        >
          <div style={{
            width: 16, height: 16, borderRadius: "50%",
            background: connected ? COLORS.good : COLORS.textMuted,
            boxShadow: connected ? `0 0 14px ${COLORS.good}` : "none",
          }} />
          <span style={{
            fontFamily: fontMono, fontSize: 28,
            color: connected ? COLORS.good : COLORS.textMuted,
            letterSpacing: 3, textTransform: "uppercase",
          }}>
            {connected ? "Connected" : "Disconnected"}
          </span>
          {/* flash */}
          <div style={{
            position: "absolute", inset: -2, borderRadius: 999,
            border: `2px solid ${COLORS.good}`,
            opacity: flashOp,
          }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
