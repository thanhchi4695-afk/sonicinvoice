import { loadFont as loadSyne } from "@remotion/google-fonts/Syne";
import { loadFont as loadPlex } from "@remotion/google-fonts/IBMPlexMono";

const syne = loadSyne("normal", { weights: ["600", "700", "800"], subsets: ["latin"] });
const plex = loadPlex("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });

export const fontDisplay = syne.fontFamily;
export const fontMono = plex.fontFamily;
