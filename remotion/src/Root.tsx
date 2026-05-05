import { Composition } from "remotion";
import { MainVideo, TOTAL_FRAMES } from "./MainVideo";
import {
  HowToUrlImporter,
  HOWTO_URL_IMPORTER_FRAMES,
} from "./scenes/HowToUrlImporter";
import {
  HowToInvoiceUpload,
  HOWTO_INVOICE_UPLOAD_FRAMES,
} from "./scenes/HowToInvoiceUpload";
import {
  HowToPriceLookup,
  HOWTO_PRICE_LOOKUP_FRAMES,
} from "./scenes/HowToPriceLookup";
import {
  HowToClaudeIntegration,
  HOWTO_CLAUDE_INTEGRATION_FRAMES,
} from "./scenes/HowToClaudeIntegration";
import {
  HowToCollectionAutopilot,
  HOWTO_COLLECTION_AUTOPILOT_FRAMES,
} from "./scenes/HowToCollectionAutopilot";

export const RemotionRoot = () => (
  <>
    <Composition
      id="main"
      component={MainVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="howto-url-importer"
      component={HowToUrlImporter}
      durationInFrames={HOWTO_URL_IMPORTER_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="howto-invoice-upload"
      component={HowToInvoiceUpload}
      durationInFrames={HOWTO_INVOICE_UPLOAD_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="howto-price-lookup"
      component={HowToPriceLookup}
      durationInFrames={HOWTO_PRICE_LOOKUP_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="howto-claude-integration"
      component={HowToClaudeIntegration}
      durationInFrames={HOWTO_CLAUDE_INTEGRATION_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
