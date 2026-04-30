import { useCurrentFrame, interpolate } from "remotion";
import { COLORS } from "../theme";
import { fontDisplay, fontMono } from "../fonts";

export const BrandStrip = ({ label }: { label: string }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        left: 72,
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: op,
        fontFamily: fontMono,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: COLORS.primary,
          boxShadow: `0 0 14px ${COLORS.primary}`,
        }}
      />
      <span
        style={{
          color: COLORS.text,
          fontSize: 18,
          letterSpacing: 4,
          textTransform: "uppercase",
        }}
      >
        Sonic Invoices
      </span>
      <span style={{ color: COLORS.textMuted, fontSize: 18 }}>·</span>
      <span
        style={{
          color: COLORS.primary,
          fontSize: 18,
          letterSpacing: 4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
};

export const StepBadge = ({ index, total }: { index: number; total: number }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 72,
        opacity: op,
        fontFamily: fontMono,
        color: COLORS.textMuted,
        fontSize: 18,
        letterSpacing: 4,
      }}
    >
      <span style={{ color: COLORS.accent }}>0{index}</span>
      <span style={{ margin: "0 10px" }}>/</span>
      <span>0{total}</span>
    </div>
  );
};

export { fontDisplay, fontMono };
