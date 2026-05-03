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
 * How-To: Price Lookup
 * 360 frames @ 30fps = 12s
 *
 * Beats:
 *   0–25    Title fades in
 *   25–110  Type a product name into the lookup search
 *   110–160 "Search" pressed → API pings (Google, Amazon, brand site)
 *   160–280 Result rows stream in: source · price · currency
 *   280–340 Median + suggested RRP highlights
 *   340–360 Outro tagline
 */
export const HOWTO_PRICE_LOOKUP_FRAMES = 360;

const fontStack =
  '"Syne", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const monoStack =
  '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

const QUERY = "Bond Eye Mara One Piece — Ivory";

const RESULTS = [
  { src: "Google Shopping", price: "$248.00", flag: "AU", delay: 0 },
  { src: "Brand site", price: "$259.00", flag: "AU", delay: 10 },
  { src: "Net-A-Porter", price: "$265.00", flag: "AU", delay: 20 },
  { src: "Revolve", price: "$229.00", flag: "US→AU", delay: 30 },
  { src: "MyTheresa", price: "$272.00", flag: "EU→AU", delay: 40 },
];

export const HowToPriceLookup: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drift = Math.sin(frame / 60) * 8;

  // Title
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 25], [16, 0], {
    extrapolateRight: "clamp",
  });

  const step = frame < 110 ? 1 : frame < 160 ? 2 : frame < 280 ? 3 : 4;

  // Typing
  const typedLen = Math.max(
    0,
    Math.min(QUERY.length, Math.floor((frame - 25) / 1.4)),
  );
  const typedQuery = QUERY.slice(0, typedLen);
  const cursorOn = Math.floor(frame / 8) % 2 === 0;

  // Search button
  const searchPressScale = spring({
    frame: frame - 108,
    fps,
    config: { damping: 8, stiffness: 200 },
  });
  const searchPressed = frame >= 110;
  const spinnerAngle = ((frame - 110) * 18) % 360;

  // Result row reveal
  const reveal = (delay: number) =>
    spring({
      frame: frame - 160 - delay,
      fps,
      config: { damping: 18, stiffness: 160 },
    });

  // Highlights
  const medianReveal = spring({
    frame: frame - 280,
    fps,
    config: { damping: 18, stiffness: 160 },
  });
  const rrpReveal = spring({
    frame: frame - 300,
    fps,
    config: { damping: 12, stiffness: 180 },
  });

  // Outro
  const outroFade = interpolate(frame, [340, 360], [1, 0.4], {
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
      {/* Subtle grid */}
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
          Tools · Pricing · Price lookup
        </div>
        <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
          Look up retail prices{" "}
          <span style={{ color: COLORS.primary }}>across the web</span>
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
          gap: 40,
          fontFamily: monoStack,
          fontSize: 18,
          opacity: titleOpacity,
        }}
      >
        {[
          "1 · Enter product",
          "2 · Search APIs",
          "3 · Live results",
          "4 · Suggested RRP",
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

      {/* Search bar */}
      <div
        style={{
          position: "absolute",
          top: 310,
          left: 200,
          right: 200,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          padding: "18px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          boxShadow: `0 20px 60px -20px ${COLORS.bgDeep}`,
        }}
      >
        <div
          style={{
            flex: 1,
            background: COLORS.bgDeep,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: "12px 18px",
            fontFamily: monoStack,
            fontSize: 22,
            color: COLORS.text,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span style={{ color: COLORS.textMuted, marginRight: 10 }}>🔍</span>
          <span>{typedQuery}</span>
          {frame < 110 && cursorOn && (
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 24,
                background: COLORS.primary,
                marginLeft: 2,
              }}
            />
          )}
        </div>
        <button
          style={{
            background: searchPressed ? COLORS.primaryGlow : COLORS.primary,
            color: COLORS.bgDeep,
            border: "none",
            padding: "12px 22px",
            borderRadius: 10,
            fontFamily: fontStack,
            fontWeight: 700,
            fontSize: 20,
            transform: `scale(${searchPressed ? 0.95 + searchPressScale * 0.05 : 1})`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {searchPressed && frame < 160 ? (
            <span
              style={{
                display: "inline-block",
                width: 18,
                height: 18,
                borderRadius: 9,
                border: `3px solid ${COLORS.bgDeep}`,
                borderTopColor: "transparent",
                transform: `rotate(${spinnerAngle}deg)`,
              }}
            />
          ) : (
            "$"
          )}
          Lookup
        </button>
      </div>

      {/* Results table */}
      <Sequence from={160}>
        <div
          style={{
            position: "absolute",
            top: 430,
            left: 200,
            right: 200,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 24,
            boxShadow: `0 30px 80px -20px ${COLORS.bgDeep}`,
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr",
              gap: 20,
              padding: "8px 18px",
              fontFamily: monoStack,
              fontSize: 14,
              letterSpacing: 2,
              color: COLORS.textMuted,
              textTransform: "uppercase",
              borderBottom: `1px solid ${COLORS.border}`,
              marginBottom: 10,
            }}
          >
            <div>Source</div>
            <div>Region</div>
            <div style={{ textAlign: "right" }}>Price (AUD)</div>
          </div>

          {RESULTS.map((r) => {
            const o = reveal(r.delay);
            return (
              <div
                key={r.src}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr",
                  gap: 20,
                  alignItems: "center",
                  padding: "14px 18px",
                  borderRadius: 10,
                  background: o > 0.6 ? `${COLORS.bgDeep}80` : "transparent",
                  opacity: o,
                  transform: `translateY(${(1 - o) * 10}px)`,
                  fontSize: 22,
                }}
              >
                <div style={{ fontWeight: 600 }}>{r.src}</div>
                <div
                  style={{
                    fontFamily: monoStack,
                    fontSize: 16,
                    color: COLORS.textMuted,
                  }}
                >
                  {r.flag}
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: monoStack,
                    color: COLORS.text,
                  }}
                >
                  {r.price}
                </div>
              </div>
            );
          })}
        </div>
      </Sequence>

      {/* Median + RRP highlight */}
      <Sequence from={280}>
        <div
          style={{
            position: "absolute",
            bottom: 130,
            left: 200,
            right: 200,
            display: "flex",
            gap: 24,
          }}
        >
          <Stat
            label="Median market price"
            value="$259.00"
            reveal={medianReveal}
            tone={COLORS.text}
          />
          <Stat
            label="Suggested RRP"
            value="$269.00"
            reveal={rrpReveal}
            tone={COLORS.accent}
            highlight
          />
        </div>
      </Sequence>

      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 26,
          color: COLORS.text,
          opacity: interpolate(frame - 300, [10, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        One search · five sources ·{" "}
        <span style={{ color: COLORS.primary }}>price you can defend</span>
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{
  label: string;
  value: string;
  reveal: number;
  tone: string;
  highlight?: boolean;
}> = ({ label, value, reveal, tone, highlight }) => (
  <div
    style={{
      flex: 1,
      background: highlight ? `${COLORS.accent}14` : COLORS.surfaceHi,
      border: `1px solid ${highlight ? COLORS.accent : COLORS.border}`,
      borderRadius: 14,
      padding: "20px 24px",
      opacity: reveal,
      transform: `translateY(${(1 - reveal) * 12}px) scale(${0.96 + reveal * 0.04})`,
      boxShadow: highlight
        ? `0 0 40px ${COLORS.accent}33`
        : `0 10px 30px -15px ${COLORS.bgDeep}`,
    }}
  >
    <div
      style={{
        fontFamily: monoStack,
        fontSize: 13,
        letterSpacing: 2,
        color: COLORS.textMuted,
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 44, fontWeight: 700, color: tone }}>{value}</div>
  </div>
);
