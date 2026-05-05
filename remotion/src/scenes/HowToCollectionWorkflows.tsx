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
 * How-To: The 6 Collection Automation Workflows
 * Explains how Sonic fixes "broken" Shopify collections with Sola-style agents.
 *
 * Beats (30fps):
 *  0   – 90    Title
 *  90  – 210   W1 Invoice → Auto-Create Collections
 *  210 – 330   W2 Weekly Health Check
 *  330 – 450   W3 Stock Change → Membership Update
 *  450 – 570   W4 SEO Auto-Generation
 *  570 – 690   W5 Seasonal Lifecycle
 *  690 – 810   W6 Performance Monitor + Auto-Optimise
 *  810 – 900   Outro
 */
export const HOWTO_COLLECTION_WORKFLOWS_FRAMES = 900;

const fontStack =
  '"Syne", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const monoStack =
  '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

type Workflow = {
  num: string;
  title: string;
  trigger: string;
  bullets: string[];
  accent: string;
  accentSoft: string;
  icon: string;
};

const WORKFLOWS: Workflow[] = [
  {
    num: "01",
    title: "Invoice → Auto-Create Collections",
    trigger: "Trigger: invoice processed",
    bullets: [
      "Detects new brands & style lines",
      "Cross-checks collection_memory",
      "Approval ping to Lisa → auto-create in Shopify",
    ],
    accent: COLORS.primary,
    accentSoft: COLORS.primaryGlow,
    icon: "📥",
  },
  {
    num: "02",
    title: "Weekly Collection Health Check",
    trigger: "Trigger: Mondays 8am ACST",
    bullets: [
      "Flags 0-product & oversized collections",
      "Surfaces missing SEO descriptions",
      "Sends a 3-section digest email",
    ],
    accent: COLORS.accent,
    accentSoft: "#FFD27A",
    icon: "🩺",
  },
  {
    num: "03",
    title: "Stock Change → Membership Update",
    trigger: "Trigger: inventory hits 0 (or restocks)",
    bullets: [
      "Pulls sold-out products from New Arrivals",
      "Archives empty style-line collections",
      "Auto-restores when stock returns",
    ],
    accent: "#6366F1",
    accentSoft: "#A5B4FC",
    icon: "📦",
  },
  {
    num: "04",
    title: "SEO Content Auto-Generation",
    trigger: "Trigger: new collection without body HTML",
    bullets: [
      "Reads smart rule + 5 sample products",
      "Claude writes 250–350 word description",
      "Pushes meta title, description, internal links",
    ],
    accent: "#3BD982",
    accentSoft: "#86F0B4",
    icon: "✍️",
  },
  {
    num: "05",
    title: "Seasonal Lifecycle Management",
    trigger: "Trigger: season calendar + arrival tags",
    bullets: [
      "Spins up 'Summer 25/26 Arrivals' on day one",
      "Day 45: flags slow movers to markdown engine",
      "Day 90: archives season, opens Clearance",
    ],
    accent: "#FF7A45",
    accentSoft: "#FFB088",
    icon: "🌤️",
  },
  {
    num: "06",
    title: "Performance Monitor + Auto-Optimise",
    trigger: "Trigger: weekly analytics pull",
    bullets: [
      "Spots high-views / low-CTR pages",
      "Regenerates SEO with new keyword focus",
      "Reports zero-visit collections to fix nav",
    ],
    accent: "#FF4D6D",
    accentSoft: "#FF8FA3",
    icon: "📈",
  },
];

export const HowToCollectionWorkflows: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = Math.sin(frame / 90) * 12;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1500px 950px at ${50 + drift}% 28%, ${COLORS.surface} 0%, ${COLORS.bg} 55%, ${COLORS.bgDeep} 100%)`,
        color: COLORS.text,
        fontFamily: fontStack,
      }}
    >
      {/* Subtle grid */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.border}55 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}55 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          opacity: 0.13,
        }}
      />

      <Sequence from={0} durationInFrames={95}>
        <Title fps={fps} />
      </Sequence>

      {WORKFLOWS.map((wf, i) => (
        <Sequence key={wf.num} from={90 + i * 120} durationInFrames={125}>
          <WorkflowCard wf={wf} index={i} fps={fps} />
        </Sequence>
      ))}

      <Sequence from={810} durationInFrames={90}>
        <Outro fps={fps} />
      </Sequence>

      {/* Persistent progress dots */}
      <ProgressDots frame={frame} />
    </AbsoluteFill>
  );
};

/* ─────────────────── Title ─────────────────── */
const Title: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const a = spring({ frame, fps, config: { damping: 18, stiffness: 140 } });
  const b = spring({ frame: frame - 14, fps, config: { damping: 18 } });
  const c = spring({ frame: frame - 28, fps, config: { damping: 20 } });
  const out = interpolate(frame, [70, 95], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out }}>
      <div style={{ textAlign: "center", maxWidth: 1300, padding: 40 }}>
        <div
          style={{
            fontFamily: monoStack,
            fontSize: 22,
            letterSpacing: 8,
            color: COLORS.primary,
            opacity: a,
            transform: `translateY(${(1 - a) * 20}px)`,
          }}
        >
          ⚡ COLLECTIONS · ON · AUTOPILOT
        </div>
        <h1
          style={{
            fontSize: 130,
            fontWeight: 800,
            lineHeight: 1.02,
            margin: "28px 0 18px",
            opacity: b,
            transform: `translateY(${(1 - b) * 30}px)`,
            letterSpacing: -3,
          }}
        >
          Six workflows that fix
          <br />
          <span style={{ color: COLORS.primary }}>broken collection pages.</span>
        </h1>
        <p
          style={{
            fontSize: 30,
            color: COLORS.textMuted,
            margin: 0,
            opacity: c,
            transform: `translateY(${(1 - c) * 15}px)`,
          }}
        >
          Sola-style agents. Auditable. Always-on. Built into Sonic.
        </p>
      </div>
    </AbsoluteFill>
  );
};

/* ─────────────────── Workflow Card ─────────────────── */
const WorkflowCard: React.FC<{ wf: Workflow; index: number; fps: number }> = ({ wf, fps }) => {
  const frame = useCurrentFrame();
  const cardIn = spring({ frame, fps, config: { damping: 22, stiffness: 130 } });
  const cardOut = interpolate(frame, [105, 125], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = cardIn * (1 - cardOut);
  const ty = (1 - cardIn) * 50 + cardOut * -30;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 80 }}>
      <div
        style={{
          width: 1500,
          maxWidth: "100%",
          background: `linear-gradient(135deg, ${COLORS.surfaceHi} 0%, ${COLORS.surface} 100%)`,
          border: `1px solid ${wf.accent}55`,
          borderRadius: 28,
          padding: "56px 64px",
          boxShadow: `0 30px 80px -20px ${wf.accent}33, 0 0 0 1px ${wf.accent}22 inset`,
          opacity,
          transform: `translateY(${ty}px)`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Accent ring */}
        <div
          style={{
            position: "absolute",
            top: -200,
            right: -200,
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${wf.accent}33 0%, transparent 70%)`,
            filter: "blur(40px)",
          }}
        />

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 36, position: "relative" }}>
          <div
            style={{
              fontFamily: monoStack,
              fontSize: 88,
              fontWeight: 700,
              color: wf.accent,
              lineHeight: 1,
              letterSpacing: -2,
            }}
          >
            {wf.num}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: monoStack,
                fontSize: 18,
                color: wf.accentSoft,
                letterSpacing: 3,
                marginBottom: 10,
                textTransform: "uppercase",
              }}
            >
              Workflow {wf.num}
            </div>
            <h2
              style={{
                fontSize: 58,
                fontWeight: 700,
                margin: 0,
                lineHeight: 1.05,
                letterSpacing: -1.5,
              }}
            >
              {wf.title}
            </h2>
          </div>
          <div style={{ fontSize: 88, opacity: 0.9 }}>{wf.icon}</div>
        </div>

        {/* Trigger pill */}
        <TriggerPill text={wf.trigger} accent={wf.accent} delay={6} />

        {/* Bullets */}
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 18 }}>
          {wf.bullets.map((b, i) => (
            <Bullet key={i} text={b} accent={wf.accent} delay={20 + i * 10} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TriggerPill: React.FC<{ text: string; accent: string; delay: number }> = ({ text, accent, delay }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 22px",
        background: `${accent}15`,
        border: `1px solid ${accent}55`,
        borderRadius: 999,
        fontFamily: monoStack,
        fontSize: 20,
        color: accent,
        opacity: o,
        transform: `translateX(${(1 - o) * -20}px)`,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: accent,
          boxShadow: `0 0 16px ${accent}`,
        }}
      />
      {text}
    </div>
  );
};

const Bullet: React.FC<{ text: string; accent: string; delay: number }> = ({ text, accent, delay }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tx = (1 - o) * 30;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 18,
        opacity: o,
        transform: `translateX(${tx}px)`,
      }}
    >
      <div
        style={{
          marginTop: 12,
          width: 14,
          height: 14,
          borderRadius: 4,
          background: accent,
          boxShadow: `0 0 14px ${accent}99`,
          flexShrink: 0,
        }}
      />
      <div style={{ fontSize: 30, color: COLORS.text, lineHeight: 1.35, fontWeight: 500 }}>{text}</div>
    </div>
  );
};

/* ─────────────────── Progress Dots ─────────────────── */
const ProgressDots: React.FC<{ frame: number }> = ({ frame }) => {
  // Active workflow index based on frame
  const inWorkflow = frame >= 90 && frame < 810;
  const activeIdx = inWorkflow ? Math.min(5, Math.floor((frame - 90) / 120)) : -1;
  const opacity = interpolate(frame, [85, 100, 800, 815], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 50,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        gap: 16,
        opacity,
      }}
    >
      {WORKFLOWS.map((wf, i) => {
        const active = i === activeIdx;
        const done = i < activeIdx;
        return (
          <div
            key={wf.num}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              borderRadius: 999,
              background: active ? `${wf.accent}25` : "transparent",
              border: `1px solid ${active ? wf.accent : COLORS.border}`,
              fontFamily: monoStack,
              fontSize: 13,
              color: active ? wf.accent : done ? COLORS.textMuted : COLORS.textMuted,
              transition: "none",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: active ? wf.accent : done ? COLORS.textMuted : "#2a3a48" }} />
            {wf.num}
          </div>
        );
      })}
    </div>
  );
};

/* ─────────────────── Outro ─────────────────── */
const Outro: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const a = spring({ frame, fps, config: { damping: 20 } });
  const b = spring({ frame: frame - 12, fps, config: { damping: 20 } });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", padding: 60 }}>
        <div
          style={{
            fontFamily: monoStack,
            fontSize: 22,
            letterSpacing: 8,
            color: COLORS.primary,
            opacity: a,
            transform: `translateY(${(1 - a) * 20}px)`,
            marginBottom: 24,
          }}
        >
          ⚡ ONE SYSTEM · SIX AGENTS
        </div>
        <h1
          style={{
            fontSize: 110,
            fontWeight: 800,
            lineHeight: 1.05,
            margin: 0,
            opacity: b,
            transform: `translateY(${(1 - b) * 30}px)`,
            letterSpacing: -3,
          }}
        >
          Lisa buys.
          <br />
          <span style={{ color: COLORS.primary }}>Sonic ships the rest.</span>
        </h1>
      </div>
    </AbsoluteFill>
  );
};
