import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Sequence } from "remotion";
import { COLORS } from "../theme";
import { fontDisplay, fontMono } from "../fonts";
import { BrandStrip, StepBadge } from "../components/Brand";

// Scene 03 — Build a rule with the Condition Builder
export const SceneRule = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOp = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  // Cards stagger
  const card = (delay: number) => {
    const sp = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 110 } });
    return {
      opacity: interpolate(sp, [0, 1], [0, 1]),
      transform: `translateY(${interpolate(sp, [0, 1], [50, 0])}px) scale(${interpolate(sp, [0, 1], [0.95, 1])})`,
    };
  };

  return (
    <AbsoluteFill>
      <BrandStrip label="Builder" />
      <StepBadge index={2} total={4} />

      <div style={{
        position: "absolute", top: 180, left: 130,
        fontFamily: fontDisplay, fontWeight: 700, fontSize: 88,
        color: COLORS.text, letterSpacing: -2, opacity: titleOp, lineHeight: 1,
      }}>
        Step 2 — Write a rule. <span style={{ color: COLORS.primary }}>No code.</span>
      </div>
      <div style={{
        position: "absolute", top: 290, left: 130, fontFamily: fontMono,
        fontSize: 24, color: COLORS.textMuted, opacity: titleOp,
      }}>
        Click conditions like LEGO blocks. Plain English in, profit guardrails out.
      </div>

      {/* Builder card */}
      <div style={{
        position: "absolute", top: 410, left: 130, width: 1660,
        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: 28, padding: 44,
        boxShadow: `0 30px 80px rgba(0,0,0,0.45)`,
        opacity: interpolate(frame, [10, 24], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        <div style={{ fontFamily: fontMono, fontSize: 18, color: COLORS.textMuted, letterSpacing: 4, textTransform: "uppercase", marginBottom: 28 }}>
          Condition Builder · SunnySwim
        </div>

        {/* WHEN row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 22, ...card(20) }}>
          <Tag label="WHEN" tone="muted" />
          <Tag label="Brand" tone="surface" />
          <Op label="is" />
          <Tag label="SunnySwim" tone="primary" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 22, ...card(34) }}>
          <Tag label="AND" tone="muted" />
          <Tag label="Margin %" tone="surface" />
          <Op label="<" />
          <Tag label="55%" tone="accent" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 36, ...card(48) }}>
          <Tag label="AND" tone="muted" />
          <Tag label="Order Total" tone="surface" />
          <Op label="≥" />
          <Tag label="$2,000" tone="surface" />
        </div>

        {/* THEN row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, ...card(64) }}>
          <Tag label="THEN" tone="muted" emphasised />
          <Tag label="Block checkout" tone="danger" />
          <Op label="+" />
          <Tag label="Notify buyer" tone="surface" />
          <Op label="+" />
          <Tag label="Slack #margins" tone="surface" />
        </div>

        {/* Save chip */}
        <div style={{
          position: "absolute", right: 44, top: 44,
          padding: "14px 28px", borderRadius: 999,
          background: COLORS.primary, color: COLORS.bgDeep,
          fontFamily: fontMono, fontSize: 22, fontWeight: 600, letterSpacing: 2,
          boxShadow: `0 0 30px ${COLORS.primary}88`,
          opacity: interpolate(frame, [80, 92], [0, 1], { extrapolateRight: "clamp" }),
          transform: `scale(${interpolate(spring({ frame: frame - 80, fps, config: { damping: 12 }}), [0,1], [0.7, 1])})`,
        }}>
          ✓ RULE SAVED
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Tag = ({ label, tone, emphasised }: { label: string; tone: "muted" | "surface" | "primary" | "accent" | "danger"; emphasised?: boolean }) => {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    muted:   { bg: "transparent",      color: COLORS.textMuted, border: COLORS.border },
    surface: { bg: COLORS.surfaceHi,   color: COLORS.text,      border: COLORS.border },
    primary: { bg: `${COLORS.primary}1f`, color: COLORS.primary, border: COLORS.primary },
    accent:  { bg: `${COLORS.accent}22`,  color: COLORS.accent,  border: COLORS.accent },
    danger:  { bg: `${COLORS.danger}22`,  color: COLORS.danger,  border: COLORS.danger },
  };
  const s = styles[tone];
  return (
    <div style={{
      padding: "16px 28px", borderRadius: 14,
      background: s.bg, color: s.color,
      border: `2px solid ${s.border}`,
      fontFamily: emphasised ? "inherit" : "inherit",
      fontSize: 32, fontWeight: 600,
      letterSpacing: tone === "muted" ? 4 : 0,
      textTransform: tone === "muted" ? "uppercase" : "none",
    }}>
      {label}
    </div>
  );
};

const Op = ({ label }: { label: string }) => (
  <div style={{ fontFamily: fontMono, fontSize: 30, color: COLORS.textMuted, padding: "0 6px" }}>
    {label}
  </div>
);
