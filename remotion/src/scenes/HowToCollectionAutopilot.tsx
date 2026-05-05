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
 * How-To: Collection Autopilot
 * 720 frames @ 30fps = 24s
 *
 * Beats:
 *   0   – 90   Title / hero
 *   90  – 240  Post-publish hero card detecting new brands & style lines
 *   240 – 390  Onboarding modal — pick automation mode
 *   390 – 540  Sidebar widget + dashboard card (live pending count)
 *   540 – 690  Approval queue + weekly digest
 *   690 – 720  Outro
 */
export const HOWTO_COLLECTION_AUTOPILOT_FRAMES = 720;

const fontStack =
  '"Syne", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const monoStack =
  '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

const INDIGO = "#6366F1";
const INDIGO_GLOW = "#A5B4FC";
const INDIGO_BG = "rgba(30, 27, 75, 0.55)";
const INDIGO_BORDER = "rgba(99, 102, 241, 0.4)";

export const HowToCollectionAutopilot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = Math.sin(frame / 80) * 10;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1400px 900px at ${50 + drift}% 25%, ${COLORS.surface} 0%, ${COLORS.bg} 55%, ${COLORS.bgDeep} 100%)`,
        color: COLORS.text,
        fontFamily: fontStack,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.border}55 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}55 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          opacity: 0.15,
        }}
      />

      {/* ════════ Scene 1 — Title (0–90) ════════ */}
      <Sequence from={0} durationInFrames={95}>
        <TitleScene fps={fps} />
      </Sequence>

      {/* ════════ Scene 2 — Post-publish hero (90–240) ════════ */}
      <Sequence from={90} durationInFrames={155}>
        <HeroScene fps={fps} />
      </Sequence>

      {/* ════════ Scene 3 — Onboarding modal (240–390) ════════ */}
      <Sequence from={240} durationInFrames={155}>
        <OnboardingScene fps={fps} />
      </Sequence>

      {/* ════════ Scene 4 — Sidebar + dashboard (390–540) ════════ */}
      <Sequence from={390} durationInFrames={155}>
        <SurfacesScene fps={fps} />
      </Sequence>

      {/* ════════ Scene 5 — Approval queue + digest (540–690) ════════ */}
      <Sequence from={540} durationInFrames={155}>
        <QueueScene fps={fps} />
      </Sequence>

      {/* ════════ Outro (690–720) ════════ */}
      <Sequence from={690} durationInFrames={30}>
        <OutroScene fps={fps} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Scene 1 — Title
// ═════════════════════════════════════════════════════════════
const TitleScene: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const inSpring = spring({ frame, fps, config: { damping: 18 } });
  const out = interpolate(frame, [70, 95], [1, 0], { extrapolateRight: "clamp" });
  const botBob = Math.sin(frame / 9) * 6;

  return (
    <AbsoluteFill
      style={{
        opacity: out,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 28,
      }}
    >
      <div
        style={{
          fontSize: 130,
          transform: `translateY(${(1 - inSpring) * -40 + botBob}px) scale(${0.6 + inSpring * 0.4})`,
          filter: `drop-shadow(0 0 40px ${INDIGO}aa)`,
        }}
      >
        🤖
      </div>
      <div
        style={{
          fontFamily: monoStack,
          fontSize: 22,
          letterSpacing: 8,
          color: INDIGO_GLOW,
          textTransform: "uppercase",
          opacity: interpolate(frame, [10, 35], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        How it works · Collection Autopilot
      </div>
      <div
        style={{
          fontSize: 78,
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.05,
          maxWidth: 1500,
          transform: `translateY(${(1 - inSpring) * 24}px)`,
          opacity: inSpring,
        }}
      >
        Your store now runs its own{" "}
        <span style={{ color: INDIGO_GLOW }}>collection pages</span>
      </div>
      <div
        style={{
          fontSize: 28,
          color: COLORS.textMuted,
          opacity: interpolate(frame, [40, 65], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Detects · creates · approves · publishes — automatically
      </div>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Scene 2 — Post-publish hero card
// ═════════════════════════════════════════════════════════════
const HeroScene: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 140 } });
  const out = interpolate(frame, [135, 155], [1, 0], { extrapolateRight: "clamp" });

  // success bar slides in
  const succY = interpolate(intro, [0, 1], [-20, 0]);

  // hero card scales in just after
  const heroSpring = spring({
    frame: frame - 18,
    fps,
    config: { damping: 16, stiffness: 130 },
  });

  // Pills stagger
  const pill = (d: number) =>
    spring({ frame: frame - 30 - d, fps, config: { damping: 18, stiffness: 180 } });

  const newPills = ["Walnut Melbourne", "Marrakesh", "Madrid", "Paris"];
  const existingPills = ["Womens Dresses", "New Arrivals"];

  return (
    <AbsoluteFill style={{ opacity: out, padding: "80px 140px" }}>
      <SectionTitle
        eyebrow="Step 1 · After every Shopify push"
        title="Autopilot scans for new brands & style lines"
        fade={intro}
      />

      {/* Success bar */}
      <div
        style={{
          marginTop: 40,
          padding: "16px 22px",
          background: "rgba(59, 217, 130, 0.12)",
          border: `1px solid ${COLORS.good}66`,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 22,
          opacity: intro,
          transform: `translateY(${succY}px)`,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            background: COLORS.good,
            color: COLORS.bgDeep,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
          }}
        >
          ✓
        </div>
        <span style={{ fontWeight: 600 }}>
          29 products published to Splash Swimwear Darwin
        </span>
        <span style={{ marginLeft: "auto", color: COLORS.textMuted, fontSize: 18, fontFamily: monoStack }}>
          invoice 219077 · 2.1s
        </span>
      </div>

      {/* Hero card */}
      <div
        style={{
          marginTop: 28,
          padding: 36,
          borderRadius: 20,
          background: `linear-gradient(135deg, ${INDIGO_BG}, rgba(67, 56, 202, 0.25))`,
          border: `1px solid ${INDIGO_BORDER}`,
          boxShadow: `0 30px 80px -20px ${COLORS.bgDeep}, 0 0 60px ${INDIGO}33`,
          opacity: heroSpring,
          transform: `translateY(${(1 - heroSpring) * 24}px) scale(${0.96 + heroSpring * 0.04})`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `linear-gradient(135deg, ${INDIGO}, #4F46E5)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              boxShadow: `0 0 24px ${INDIGO}88`,
            }}
          >
            🤖
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 700 }}>
              Collection Autopilot detected{" "}
              <span style={{ color: INDIGO_GLOW }}>4 new collection opportunities</span>
            </div>
            <div style={{ fontSize: 18, color: COLORS.textMuted, marginTop: 4, fontFamily: monoStack }}>
              cross-checked against collection_memory · 0.4s
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <Label>New brand & style lines</Label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            {newPills.map((p, i) => (
              <Pill
                key={p}
                text={`✨ ${p}`}
                tone="indigo"
                reveal={pill(i * 5)}
              />
            ))}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <Label>Already in your store</Label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            {existingPills.map((p, i) => (
              <Pill
                key={p}
                text={p}
                tone="slate"
                reveal={pill(20 + i * 5)}
              />
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: 26,
            display: "flex",
            gap: 14,
            opacity: pill(40),
          }}
        >
          <CTA primary>Enable Autopilot →</CTA>
          <CTA>Review manually</CTA>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Scene 3 — Onboarding modal
// ═════════════════════════════════════════════════════════════
const OnboardingScene: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 140 } });
  const out = interpolate(frame, [135, 155], [1, 0], { extrapolateRight: "clamp" });

  // Cursor moves to "Brand only" then clicks
  const selectFrame = 70;
  const cursorX = interpolate(
    frame,
    [10, selectFrame],
    [820, 520],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const cursorY = interpolate(
    frame,
    [10, selectFrame],
    [320, 600],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const selected = frame >= selectFrame ? 1 : 0;
  const click = spring({ frame: frame - selectFrame, fps, config: { damping: 8, stiffness: 220 } });

  const opts = [
    { label: "Ask me before creating", hint: "recommended" },
    { label: "Auto-create brand pages only", hint: "" },
    { label: "Auto-create everything", hint: "" },
  ];

  return (
    <AbsoluteFill style={{ opacity: out, padding: "60px 140px" }}>
      <SectionTitle
        eyebrow="Step 2 · One-time setup"
        title="Pick how much control you want"
        fade={intro}
      />

      {/* Modal */}
      <div
        style={{
          marginTop: 50,
          marginLeft: "auto",
          marginRight: "auto",
          width: 720,
          padding: 40,
          borderRadius: 24,
          background: "linear-gradient(135deg, #0B1428 0%, #161E3D 100%)",
          border: `1px solid ${INDIGO_BORDER}`,
          boxShadow: `0 40px 100px -20px ${COLORS.bgDeep}, 0 0 80px ${INDIGO}33`,
          opacity: intro,
          transform: `translateY(${(1 - intro) * 30}px) scale(${0.95 + intro * 0.05})`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: `${INDIGO}22`,
              border: `1px solid ${INDIGO_BORDER}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
            }}
          >
            🤖
          </div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>Collection Autopilot</div>
          <div style={{ fontSize: 18, color: COLORS.textMuted }}>
            Your store now runs its own collection pages — automatically.
          </div>
        </div>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
          {opts.map((o, i) => {
            const isSel = selected === 1 && i === 1;
            return (
              <div
                key={o.label}
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: `1px solid ${isSel ? INDIGO_GLOW : "rgba(255,255,255,0.1)"}`,
                  background: isSel
                    ? "rgba(99, 102, 241, 0.18)"
                    : "rgba(255,255,255,0.03)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 18,
                  transform: isSel ? `scale(${1 + click * 0.02})` : "none",
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    border: `1px solid ${isSel ? INDIGO_GLOW : "#64748B"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isSel && (
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: INDIGO_GLOW }} />
                  )}
                </div>
                <span style={{ color: COLORS.text }}>{o.label}</span>
                {o.hint && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: INDIGO_GLOW,
                    }}
                  >
                    {o.hint}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 10 }}>
          <CTA primary fullWidth>
            Enable Collection Autopilot →
          </CTA>
        </div>
      </div>

      {/* Cursor */}
      <div
        style={{
          position: "absolute",
          left: cursorX,
          top: cursorY,
          fontSize: 36,
          filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.6))",
          transform: `scale(${1 - click * 0.15})`,
          opacity: intro,
        }}
      >
        🖱️
      </div>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Scene 4 — Sidebar widget + dashboard card
// ═════════════════════════════════════════════════════════════
const SurfacesScene: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const intro = spring({ frame, fps, config: { damping: 18 } });
  const out = interpolate(frame, [135, 155], [1, 0], { extrapolateRight: "clamp" });

  const sideSpring = spring({ frame: frame - 12, fps, config: { damping: 20 } });
  const cardSpring = spring({ frame: frame - 32, fps, config: { damping: 18 } });
  const pulseAlpha = 0.5 + Math.sin(frame / 4) * 0.5;

  return (
    <AbsoluteFill style={{ opacity: out, padding: "60px 140px" }}>
      <SectionTitle
        eyebrow="Step 3 · Always visible"
        title="Live status across your whole app"
        fade={intro}
      />

      <div style={{ display: "flex", gap: 40, marginTop: 50, alignItems: "flex-start" }}>
        {/* Sidebar widget */}
        <div
          style={{
            flex: "0 0 360px",
            opacity: sideSpring,
            transform: `translateX(${(1 - sideSpring) * -40}px)`,
          }}
        >
          <Label>Sidebar widget</Label>
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: INDIGO_BG,
              border: `1px solid ${INDIGO_BORDER}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: INDIGO_GLOW }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Collection Autopilot</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: COLORS.accentHot,
                  boxShadow: `0 0 12px ${COLORS.accentHot}`,
                  opacity: pulseAlpha,
                }}
              />
              <span style={{ fontSize: 13, color: "#FDBA74" }}>3 pending approvals</span>
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
              Last ran: 2 hours ago
            </div>
          </div>

          <div style={{ marginTop: 24, fontSize: 13, color: COLORS.textMuted, lineHeight: 1.6 }}>
            Pulses amber when work needs you · turns green when clear · click to open the queue.
          </div>
        </div>

        {/* Dashboard card */}
        <div
          style={{
            flex: 1,
            opacity: cardSpring,
            transform: `translateY(${(1 - cardSpring) * 20}px)`,
          }}
        >
          <Label>Dashboard card</Label>
          <div
            style={{
              marginTop: 12,
              padding: 24,
              borderRadius: 16,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>🤖</span>
              <span style={{ fontSize: 20, fontWeight: 700 }}>Collection Autopilot</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 13,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: `${INDIGO}22`,
                  color: INDIGO_GLOW,
                  fontFamily: monoStack,
                }}
              >
                Active
              </span>
            </div>
            <div style={{ marginTop: 16, color: COLORS.textMuted, fontSize: 13, marginBottom: 8 }}>
              Recent activity
            </div>
            {[
              { dot: COLORS.good, text: 'Created "Seafolly Mayflower"', when: "2h ago" },
              { dot: COLORS.good, text: 'Created "Bikini Bottoms"', when: "yesterday" },
              { dot: COLORS.textMuted, text: 'Archived "Summer 24/25"', when: "3d ago" },
            ].map((a, i) => {
              const r = spring({
                frame: frame - 50 - i * 8,
                fps,
                config: { damping: 18 },
              });
              return (
                <div
                  key={a.text}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    fontSize: 16,
                    opacity: r,
                    transform: `translateX(${(1 - r) * -10}px)`,
                  }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: a.dot }} />
                  <span>{a.text}</span>
                  <span style={{ marginLeft: "auto", color: COLORS.textMuted, fontSize: 13, fontFamily: monoStack }}>
                    {a.when}
                  </span>
                </div>
              );
            })}

            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${COLORS.border}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                opacity: spring({ frame: frame - 90, fps, config: { damping: 18 } }),
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: COLORS.accentHot,
                  opacity: pulseAlpha,
                  boxShadow: `0 0 12px ${COLORS.accentHot}`,
                }}
              />
              <span style={{ fontSize: 14, color: "#FDBA74" }}>3 pending approvals</span>
              <span style={{ marginLeft: "auto", color: INDIGO_GLOW, fontSize: 14, fontWeight: 600 }}>
                Review now →
              </span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Scene 5 — Approval queue + weekly digest
// ═════════════════════════════════════════════════════════════
const QueueScene: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const intro = spring({ frame, fps, config: { damping: 18 } });
  const out = interpolate(frame, [135, 155], [1, 0], { extrapolateRight: "clamp" });

  const queueItems = [
    { name: "Walnut Melbourne", count: 12, status: "pending" },
    { name: "Marrakesh", count: 6, status: "pending" },
    { name: "Madrid", count: 4, status: "approved" },
  ];

  return (
    <AbsoluteFill style={{ opacity: out, padding: "60px 140px" }}>
      <SectionTitle
        eyebrow="Step 4 · You stay in control"
        title="Approve, edit, or watch the weekly digest"
        fade={intro}
      />

      <div style={{ display: "flex", gap: 32, marginTop: 50, alignItems: "flex-start" }}>
        {/* Approval queue */}
        <div
          style={{
            flex: 1,
            padding: 24,
            borderRadius: 16,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            opacity: intro,
            transform: `translateY(${(1 - intro) * 20}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 20 }}>📋</span>
            <span style={{ fontSize: 20, fontWeight: 700 }}>Approval queue</span>
          </div>
          {queueItems.map((q, i) => {
            const r = spring({
              frame: frame - 30 - i * 12,
              fps,
              config: { damping: 18, stiffness: 160 },
            });
            const approved = q.status === "approved";
            return (
              <div
                key={q.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 12px",
                  borderRadius: 10,
                  marginBottom: 8,
                  background: approved ? "rgba(59, 217, 130, 0.08)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${approved ? `${COLORS.good}55` : "rgba(255,255,255,0.06)"}`,
                  opacity: r,
                  transform: `translateY(${(1 - r) * 12}px)`,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: approved ? COLORS.good : `${INDIGO}33`,
                    color: approved ? COLORS.bgDeep : INDIGO_GLOW,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 16,
                  }}
                >
                  {approved ? "✓" : "✨"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{q.name}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: monoStack }}>
                    {q.count} products · SEO drafted by AI
                  </div>
                </div>
                {approved ? (
                  <span style={{ fontSize: 12, color: COLORS.good, fontFamily: monoStack }}>APPROVED</span>
                ) : (
                  <>
                    <CTA size="sm">Edit</CTA>
                    <CTA size="sm" primary>Approve</CTA>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Weekly digest */}
        <div
          style={{
            flex: "0 0 460px",
            padding: 24,
            borderRadius: 16,
            background: `linear-gradient(135deg, ${INDIGO_BG}, rgba(67,56,202,0.18))`,
            border: `1px solid ${INDIGO_BORDER}`,
            opacity: spring({ frame: frame - 30, fps, config: { damping: 18 } }),
            transform: `translateX(${(1 - spring({ frame: frame - 30, fps, config: { damping: 18 } })) * 30}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>📬</span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>Weekly digest · Monday 9am</span>
          </div>

          {[
            { icon: "⚠️", label: "Needs attention", n: 3, tone: COLORS.accentHot },
            { icon: "✨", label: "New opportunities", n: 5, tone: INDIGO_GLOW },
            { icon: "✅", label: "Healthy collections", n: 47, tone: COLORS.good },
          ].map((d, i) => {
            const r = spring({
              frame: frame - 60 - i * 14,
              fps,
              config: { damping: 18, stiffness: 160 },
            });
            return (
              <div
                key={d.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  marginTop: 10,
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 10,
                  border: `1px solid rgba(255,255,255,0.06)`,
                  opacity: r,
                  transform: `translateY(${(1 - r) * 8}px)`,
                }}
              >
                <span style={{ fontSize: 22 }}>{d.icon}</span>
                <span style={{ fontSize: 16 }}>{d.label}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 22,
                    fontWeight: 700,
                    color: d.tone,
                    fontFamily: monoStack,
                  }}
                >
                  {d.n}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Outro
// ═════════════════════════════════════════════════════════════
const OutroScene: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div style={{ fontSize: 80, transform: `scale(${0.6 + s * 0.4})` }}>🤖</div>
      <div style={{ fontSize: 48, fontWeight: 700, opacity: s }}>
        Set it once. Ship collections forever.
      </div>
      <div
        style={{
          fontSize: 22,
          color: INDIGO_GLOW,
          fontFamily: monoStack,
          letterSpacing: 4,
          opacity: s,
        }}
      >
        sonic invoices · collection autopilot
      </div>
    </AbsoluteFill>
  );
};

// ═════════════════════════════════════════════════════════════
// Shared bits
// ═════════════════════════════════════════════════════════════
const SectionTitle: React.FC<{ eyebrow: string; title: string; fade: number }> = ({
  eyebrow,
  title,
  fade,
}) => (
  <div style={{ opacity: fade, transform: `translateY(${(1 - fade) * 12}px)` }}>
    <div
      style={{
        fontFamily: monoStack,
        fontSize: 16,
        letterSpacing: 5,
        textTransform: "uppercase",
        color: INDIGO_GLOW,
      }}
    >
      {eyebrow}
    </div>
    <div style={{ fontSize: 52, fontWeight: 700, marginTop: 8, lineHeight: 1.1 }}>
      {title}
    </div>
  </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: monoStack,
      fontSize: 12,
      letterSpacing: 3,
      textTransform: "uppercase",
      color: COLORS.textMuted,
    }}
  >
    {children}
  </div>
);

const Pill: React.FC<{ text: string; tone: "indigo" | "slate"; reveal: number }> = ({
  text,
  tone,
  reveal,
}) => (
  <div
    style={{
      padding: "8px 16px",
      borderRadius: 999,
      fontSize: 17,
      fontWeight: 500,
      background: tone === "indigo" ? "rgba(99,102,241,0.18)" : "rgba(148,163,184,0.12)",
      color: tone === "indigo" ? INDIGO_GLOW : "#CBD5E1",
      border: `1px solid ${tone === "indigo" ? INDIGO_BORDER : "rgba(148,163,184,0.25)"}`,
      opacity: reveal,
      transform: `translateY(${(1 - reveal) * 10}px) scale(${0.9 + reveal * 0.1})`,
    }}
  >
    {text}
  </div>
);

const CTA: React.FC<{
  children: React.ReactNode;
  primary?: boolean;
  fullWidth?: boolean;
  size?: "sm" | "md";
}> = ({ children, primary, fullWidth, size = "md" }) => (
  <div
    style={{
      padding: size === "sm" ? "8px 14px" : "12px 22px",
      borderRadius: 10,
      fontSize: size === "sm" ? 14 : 18,
      fontWeight: 600,
      background: primary ? `linear-gradient(135deg, ${INDIGO}, #4F46E5)` : "rgba(255,255,255,0.06)",
      color: primary ? "#fff" : COLORS.text,
      border: primary ? "none" : "1px solid rgba(255,255,255,0.12)",
      width: fullWidth ? "100%" : "auto",
      textAlign: "center",
      boxShadow: primary ? `0 8px 24px -8px ${INDIGO}aa` : "none",
    }}
  >
    {children}
  </div>
);
