// Shared "publish status" preference for newly-created products.
// Applies to both Shopify CSV exports (Status column) and Lightspeed
// X-Series CSV exports (active column).
export type PublishStatus = "active" | "draft";

const KEY = "sonic_invoice_publish_status";

export function getPublishStatus(): PublishStatus {
  if (typeof localStorage === "undefined") return "active";
  const v = localStorage.getItem(KEY);
  return v === "draft" ? "draft" : "active";
}

export function setPublishStatus(status: PublishStatus): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, status);
}

// Shopify: "active" or "draft" string in the Status column
export function shopifyStatusValue(s: PublishStatus): "active" | "draft" {
  return s;
}

// Lightspeed X-Series: active=1 (live) or active=0 (inactive/draft)
export function lightspeedActiveValue(s: PublishStatus): "1" | "0" {
  return s === "active" ? "1" : "0";
}
