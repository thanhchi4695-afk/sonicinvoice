import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontDisplay, fontMono } from "../fonts";

// Scene 01 — cinematic hook: "Margin Guardian" reveal
export const SceneHook = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lineGrow = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const lineWidth = interpolate(lineGrow, [0, 1], [0, 320]);

  const titleSpring = spring({ frame: frame - 12, fps, config: { damping: 18, stiffness: 110 } });
  const titleY = interpolate(titleSpring, [0, 1], [60, 0]);
  const titleOp = interpolate(frame, [12, 28], [0, 1], { extrapolateRight: "clamp" });

  const subOp = interpolate(frame, [30, 46], [0, 1], { extrapolateRight: "clamp" });

  // animated price line dropping
  const priceProgress = interpolate(frame, [40, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const priceY = interpolate(priceProgress, [0, 1], [0, 220], { easing: (t) => t * t * (3 - 2 * t) });

  // shield draw
  const shieldDraw = interpolate(frame, [70, 110], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const shieldOp = interpolate(frame, [70, 88], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ paddingLeft: 130, paddingTop: 220 }}>
      {/* eyebrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 32 }}>
        <div style={{ height: 2, width: lineWidth, background: COLORS.primary, boxShadow: `0 0 12px ${COLORS.primary}` }} />
        <span style={{
          fontFamily: fontMono, color: COLORS.primary, letterSpacing: 6,
          fontSize: 22, textTransform: "uppercase", opacity: interpolate(lineGrow, [0.5, 1], [0, 1]),
        }}>
          AI Automation · 02
        </span>
      </div>

      {/* huge title */}
      <div
        style={{
          fontFamily: fontDisplay,
          fontWeight: 800,
          fontSize: 220,
          lineHeight: 0.92,
          color: COLORS.text,
          letterSpacing: -4,
          transform: `translateY(${titleY}px)`,
          opacity: titleOp,
        }}
      >
        Margin
      </div>
      <div
        style={{
          fontFamily: fontDisplay,
          fontWeight: 800,
          fontSize: 220,
          lineHeight: 0.92,
          letterSpacing: -4,
          color: COLORS.primary,
          transform: `translateY(${titleY * 0.6}px)`,
          opacity: titleOp,
          textShadow: `0 0 60px ${COLORS.primary}55`,
        }}
      >
        Guardian.
      </div>

      <div
        style={{
          marginTop: 36,
          fontFamily: fontMono,
          fontSize: 30,
          color: COLORS.textMuted,
          opacity: subOp,
          maxWidth: 1100,
        }}
      >
        Your AI buyer's-room watchdog. Set margin rules in plain English —
        we block bad orders before they cost you.
      </div>

      {/* falling price line on right */}
      <div
        style={{
          position: "absolute",
          right: 180,
          top: 280,
          width: 360,
          opacity: interpolate(frame, [40, 70], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        <svg width={360} height={420} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="dropGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.accent} />
              <stop offset="100%" stopColor={COLORS.danger} />
            </linearGradient>
          </defs>
          <path
            d={`M 0 40 L 360 ${40 + priceY}`}
            stroke="url(#dropGrad)"
            strokeWidth={4}
            fill="none"
          />
          <circle cx={360} cy={40 + priceY} r={10} fill={COLORS.danger} />
          <text x={290} y={30 + priceY} fontFamily={fontMono} fontSize={22} fill={COLORS.danger}>
            -38%
          </text>

          {/* shield */}
          <g transform={`translate(120, ${30 + priceY - 130})`} opacity={shieldOp}>
            <path
              d={`M 60 0 L 120 24 L 120 80 Q 120 150 60 180 Q 0 150 0 80 L 0 24 Z`}
              fill="none"
              stroke={COLORS.primary}
              strokeWidth={4}
              strokeDasharray={520}
              strokeDashoffset={520 - 520 * shieldDraw}
              style={{ filter: `drop-shadow(0 0 18px ${COLORS.primary})` }}
            />
            <path
              d={`M 38 92 L 56 110 L 88 70`}
              fill="none"
              stroke={COLORS.primaryGlow}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={interpolate(frame, [100, 115], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" })}
            />
          </g>
        </svg>
      </div>
    </AbsoluteFill>
  );
};
