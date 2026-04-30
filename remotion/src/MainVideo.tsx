import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { PersistentBackground } from "./components/PersistentBackground";
import { SceneHook } from "./scenes/SceneHook";
import { SceneConnect } from "./scenes/SceneConnect";
import { SceneRule } from "./scenes/SceneRule";
import { SceneBlock } from "./scenes/SceneBlock";
import { SceneAudit } from "./scenes/SceneAudit";

// Scene durations (frames @ 30fps)
const D_HOOK = 130;     // ~4.3s cinematic intro
const D_CONNECT = 110;  // ~3.7s
const D_RULE = 140;     // ~4.7s
const D_BLOCK = 150;    // ~5.0s
const D_AUDIT = 160;    // ~5.3s
const T_DUR = 18;       // transition overlap

// Total = sum - 4 transitions overlap
export const TOTAL_FRAMES =
  D_HOOK + D_CONNECT + D_RULE + D_BLOCK + D_AUDIT - 4 * T_DUR;

export const MainVideo = () => {
  return (
    <AbsoluteFill>
      <PersistentBackground />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={D_HOOK}>
          <SceneHook />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-right" })}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T_DUR })}
        />

        <TransitionSeries.Sequence durationInFrames={D_CONNECT}>
          <SceneConnect />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T_DUR })}
        />

        <TransitionSeries.Sequence durationInFrames={D_RULE}>
          <SceneRule />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-bottom" })}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T_DUR })}
        />

        <TransitionSeries.Sequence durationInFrames={D_BLOCK}>
          <SceneBlock />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T_DUR })}
        />

        <TransitionSeries.Sequence durationInFrames={D_AUDIT}>
          <SceneAudit />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
