import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontDisplay, fontMono } from "../fonts";
import { BrandStrip, StepBadge } from "../components/Brand";

// Scene 05 — Audit & ROI close
export const SceneAudit = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOp = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  // counters
  const blocksTarget = 47;
  const savedTarget = 18420;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const tBlocks = ease(interpolate(frame, [16, 70], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" }));
  const tSaved = ease(interpolate(frame, [22, 80], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" }));
  const blocks = Math.round(tBlocks * blocksTarget);
  const saved = Math.round(tSaved * savedTarget);

  // bar chart bars
  const barH = (i: number, target: number) => {
    const sp = spring({ frame: frame - (24 + i * 4), fps, config: { damping: 18 } });
    return interpolate(sp, [0, 1], [0, target]);
  };
  const targets = [60, 110, 80, 165, 140, 210, 190];

  // outro
  const outroOp = interpolate(frame, [70, 95], [0, 1], { extrapolateRight: "clamp" });
  const outroSp = spring({ frame: frame - 72, fps, config: { damping: 16 } });
  const outroY = interpolate(outroSp, [0, 1], [30, 0]);

  return (
    <AbsoluteFill>
      <BrandStrip label="Receipts" />
      <StepBadge index={4} total={4} />

      <div style={{
        position: "absolute", top: 180, left: 130, fontFamily: fontDisplay, fontWeight: 700,
        fontSize: 88, color: COLORS.text, letterSpacing: -2, opacity: titleOp, lineHeight: 1,
      }}>
        Step 4 — <span style={{ color: COLORS.accent }}>See the receipts.</span>
      </div>
      <div style={{
        position: "absolute", top: 290, left: 130, fontFamily: fontMono,
        fontSize: 24, color: COLORS.textMuted, opacity: titleOp,
      }}>
        Every decision logged. Every dollar saved measured.
      </div>

      {/* KPI cards */}
      <div style={{
        position: "absolute", top: 410, left: 130, display: "flex", gap: 28,
      }}>
        <KpiCard label="Bad orders blocked · 30d" value={blocks.toString()} accent={COLORS.primary} />
        <KpiCard label="Margin protected · 30d" value={`$${saved.toLocaleString()}`} accent={COLORS.accent} />
        <KpiCard label="Avg response time" value="0.4s" accent={COLORS.good} />
      </div>

      {/* Bar chart */}
      <div style={{
        position: "absolute", top: 720, left: 130, width: 1100, height: 240,
        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: 24, padding: 28,
        opacity: interpolate(frame, [20, 34], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        <div style={{ fontFamily: fontMono, fontSize: 16, color: COLORS.textMuted, letterSpacing: 3, textTransform: "uppercase" }}>
          Blocks per week
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 26, marginTop: 24, height: 140 }}>
          {targets.map((t, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{
                width: "100%", height: barH(i, t),
                background: `linear-gradient(180deg, ${COLORS.primary}, ${COLORS.primary}55)`,
                borderRadius: 6,
                boxShadow: `0 0 14px ${COLORS.primary}55`,
              }}/>
              <div style={{ fontFamily: fontMono, fontSize: 14, color: COLORS.textMuted }}>W{i+1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Outro card */}
      <div style={{
        position: "absolute", right: 130, bottom: 140,
        width: 620, padding: 40, borderRadius: 24,
        background: `linear-gradient(160deg, ${COLORS.primary}1a, ${COLORS.surface})`,
        border: `1px solid ${COLORS.primary}`,
        boxShadow: `0 0 60px ${COLORS.primary}33`,
        opacity: outroOp, transform: `translateY(${outroY}px)`,
      }}>
        <div style={{ fontFamily: fontMono, fontSize: 18, color: COLORS.primary, letterSpacing: 4, textTransform: "uppercase" }}>
          Sonic Invoices · AI Automation
        </div>
        <div style={{
          fontFamily: fontDisplay, fontWeight: 800, fontSize: 70, lineHeight: 1,
          color: COLORS.text, marginTop: 14,
        }}>
          Margin Guardian.
        </div>
        <div style={{ marginTop: 18, fontFamily: fontMono, fontSize: 22, color: COLORS.textMuted, lineHeight: 1.5 }}>
          Plain-English rules. Real-time blocks. Zero lost margin.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const KpiCard = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div style={{
    width: 350, padding: 32, borderRadius: 22,
    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
    boxShadow: `0 20px 50px rgba(0,0,0,0.35)`,
  }}>
    <div style={{
      fontFamily: fontMono, fontSize: 16, color: COLORS.textMuted,
      letterSpacing: 3, textTransform: "uppercase",
    }}>
      {label}
    </div>
    <div style={{
      fontFamily: fontDisplay, fontWeight: 800, fontSize: 88, lineHeight: 1, marginTop: 18,
      color: accent, letterSpacing: -2,
      textShadow: `0 0 30px ${accent}44`,
    }}>
      {value}
    </div>
  </div>
);
