/**
 * Auto-trigger system for Image SEO optimization.
 * Dispatches a custom event when product imports complete,
 * so the app can offer to run image optimization.
 */

export interface ImageSeoTriggerDetail {
  source: "invoice" | "wholesale" | "lookbook";
  productCount: number;
}

const EVENT_NAME = "image-seo-trigger";

export function dispatchImageSeoTrigger(detail: ImageSeoTriggerDetail) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

export function onImageSeoTrigger(handler: (detail: ImageSeoTriggerDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ImageSeoTriggerDetail>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
