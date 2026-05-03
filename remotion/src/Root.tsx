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
  </>
);
