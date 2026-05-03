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
 * How-To: Paste Product URL → Ready for Shopify
 * 360 frames @ 30fps = 12s
 *
 * Beats:
 *   0-30   Title fades in
 *   30-110 Browser-like URL bar typing animation
 *   110-150 "Fetch" button press + spinner
 *   150-260 Product card materialises (image, title, price, variants)
 *   260-330 "Push to Shopify" arrow + checkmark
 *   330-360 Outro
 */
export const HOWTO_URL_IMPORTER_FRAMES = 360;

const fontStack =
  '"Syne", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const monoStack =
  '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

const FULL_URL = "https://brand.com/products/silk-midi-dress";

export const HowToUrlImporter: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // ── Background drift ─────────────────────────────────────
  const drift = Math.sin(frame / 60) * 8;

  // ── Title ───────────────────────────────────────────────
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 25], [16, 0], {
    extrapolateRight: "clamp",
  });

  // ── Step pill ───────────────────────────────────────────
  const step =
    frame < 110 ? 1 : frame < 150 ? 2 : frame < 260 ? 3 : 4;

  // ── URL typing 30→110 ───────────────────────────────────
  const typedLen = Math.max(
    0,
    Math.min(FULL_URL.length, Math.floor((frame - 30) / 1.6)),
  );
  const typedUrl = FULL_URL.slice(0, typedLen);
  const cursorOn = Math.floor(frame / 8) % 2 === 0;

  // ── Fetch button + spinner 110→150 ──────────────────────
  const fetchPressScale = spring({
    frame: frame - 108,
    fps,
    config: { damping: 8, stiffness: 200 },
  });
  const fetchPressed = frame >= 110;
  const spinnerAngle = ((frame - 110) * 18) % 360;

  // ── Product card 150→260 ────────────────────────────────
  const cardSpring = spring({
    frame: frame - 150,
    fps,
    config: { damping: 18, stiffness: 140 },
  });
  const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);
  const cardY = interpolate(cardSpring, [0, 1], [24, 0]);

  // Stagger inner reveals
  const reveal = (delay: number) =>
    spring({
      frame: frame - 150 - delay,
      fps,
      config: { damping: 18, stiffness: 160 },
    });

  // ── Shopify push 260→330 ────────────────────────────────
  const arrowProgress = interpolate(frame, [260, 305], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const checkSpring = spring({
    frame: frame - 305,
    fps,
    config: { damping: 10, stiffness: 200 },
  });

  // ── Outro fade 340→360 ──────────────────────────────────
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
          How it works · 1 of 4
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
          Paste a product URL{" "}
          <span style={{ color: COLORS.primary }}>→</span> ready for Shopify
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
          "1 · Copy URL",
          "2 · Paste & Fetch",
          "3 · Auto-extract",
          "4 · Push to Shopify",
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
                transition: "none",
              }}
            >
              {done ? "✓ " : ""}
              {label}
            </div>
          );
        })}
      </div>

      {/* Browser bar */}
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
        <div style={{ display: "flex", gap: 8 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div
              key={c}
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: c,
              }}
            />
          ))}
        </div>
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
          <span style={{ color: COLORS.textMuted, marginRight: 6 }}>🔗</span>
          <span>{typedUrl}</span>
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
            background: fetchPressed ? COLORS.primaryGlow : COLORS.primary,
            color: COLORS.bgDeep,
            border: "none",
            padding: "12px 22px",
            borderRadius: 10,
            fontFamily: fontStack,
            fontWeight: 700,
            fontSize: 20,
            transform: `scale(${fetchPressed ? 0.95 + fetchPressScale * 0.05 : 1})`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {fetchPressed && frame < 150 ? (
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
            "⚡"
          )}
          Fetch
        </button>
      </div>

      {/* Product card */}
      <Sequence from={150}>
        <div
          style={{
            position: "absolute",
            top: 430,
            left: 200,
            right: 200,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 32,
            display: "flex",
            gap: 28,
            opacity: cardOpacity,
            transform: `translateY(${cardY}px)`,
            boxShadow: `0 30px 80px -20px ${COLORS.bgDeep}`,
          }}
        >
          {/* Image placeholder */}
          <div
            style={{
              width: 240,
              height: 280,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${COLORS.surfaceHi}, ${COLORS.bg})`,
              border: `1px solid ${COLORS.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 80,
              opacity: reveal(0),
            }}
          >
            👗
          </div>

          {/* Details */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Product name" value="Silk Midi Dress — Ivory" reveal={reveal(4)} />
            <Field label="Price" value="$289.00 AUD" reveal={reveal(10)} accent />
            <Field
              label="Description"
              value="Bias-cut washed silk midi with adjustable straps."
              reveal={reveal(16)}
              small
            />
            <div style={{ display: "flex", gap: 10, opacity: reveal(22) }}>
              <Pill text="Colour: Ivory" />
              <Pill text="Colour: Black" />
              <Pill text="Size: 6–14" />
              <Pill text="4 images" />
            </div>
          </div>
        </div>
      </Sequence>

      {/* Push to Shopify */}
      <Sequence from={260}>
        <div
          style={{
            position: "absolute",
            top: 800,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 32,
            fontFamily: monoStack,
            fontSize: 22,
            color: COLORS.textMuted,
          }}
        >
          <span style={{ color: COLORS.text, fontWeight: 600 }}>Sonic Invoice</span>
          <div
            style={{
              flex: "0 0 360px",
              height: 4,
              background: COLORS.border,
              borderRadius: 2,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${arrowProgress * 100}%`,
                background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`,
              }}
            />
          </div>
          <span style={{ color: COLORS.text, fontWeight: 600 }}>
            Shopify
          </span>
          {checkSpring > 0.05 && (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                background: COLORS.good,
                color: COLORS.bgDeep,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 800,
                transform: `scale(${checkSpring})`,
                boxShadow: `0 0 30px ${COLORS.good}66`,
              }}
            >
              ✓
            </div>
          )}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 80,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 28,
            color: COLORS.text,
            opacity: interpolate(frame - 260, [10, 30], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          One paste · zero typing ·{" "}
          <span style={{ color: COLORS.primary }}>ready to publish</span>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  reveal: number;
  accent?: boolean;
  small?: boolean;
}> = ({ label, value, reveal, accent, small }) => (
  <div
    style={{
      opacity: reveal,
      transform: `translateY(${(1 - reveal) * 8}px)`,
    }}
  >
    <div
      style={{
        fontFamily: monoStack,
        fontSize: 13,
        letterSpacing: 2,
        color: COLORS.textMuted,
        textTransform: "uppercase",
        marginBottom: 4,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: small ? 20 : 28,
        fontWeight: small ? 400 : 600,
        color: accent ? COLORS.accent : COLORS.text,
      }}
    >
      {value}
    </div>
  </div>
);

const Pill: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      padding: "6px 14px",
      borderRadius: 999,
      border: `1px solid ${COLORS.border}`,
      background: COLORS.bgDeep,
      fontSize: 16,
      fontFamily: monoStack,
      color: COLORS.text,
    }}
  >
    {text}
  </div>
);
