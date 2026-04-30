import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { COLORS } from "../theme";

export const PersistentBackground = () => {
  const frame = useCurrentFrame();
  // gentle ambient drift
  const x = interpolate(frame, [0, 750], [-40, 40]);
  const y = interpolate(frame, [0, 750], [20, -20]);
  const rot = interpolate(frame, [0, 750], [0, 8]);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgDeep, overflow: "hidden" }}>
      {/* base radial */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 80% at 70% 20%, ${COLORS.surface} 0%, ${COLORS.bgDeep} 60%, ${COLORS.bgDeep} 100%)`,
        }}
      />
      {/* large drifting glow */}
      <div
        style={{
          position: "absolute",
          width: 1400,
          height: 1400,
          left: -200 + x,
          top: -300 + y,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.primary}22 0%, transparent 60%)`,
          filter: "blur(40px)",
          transform: `rotate(${rot}deg)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          right: -250 - x,
          bottom: -350 - y,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accent}1a 0%, transparent 60%)`,
          filter: "blur(60px)",
        }}
      />
      {/* grid overlay */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.border}33 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}33 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          opacity: 0.45,
        }}
      />
      {/* vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
