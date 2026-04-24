// Maps PipelineRunner step IDs to the 6 canonical agent steps that the
// run-agent-step edge function understands. Steps that don't map (e.g. SEO
// sub-steps) bypass the agent entirely and execute as before.

export type AgentStep = "capture" | "extract" | "stock_check" | "enrich" | "price" | "publish";

const MAP: Record<string, AgentStep> = {
  upload_invoice: "extract",            // upload + parse covered in one agent step
  stock_check: "stock_check",
  stock_check_refills: "stock_check",
  push_shopify: "publish",
  update_inventory: "publish",
  image_optimise: "enrich",
  seo_tags: "enrich",
  collection_seo: "enrich",
  price_lookup: "price",
  accounting_push: "publish",
};

export function toAgentStep(pipelineStepId: string): AgentStep | null {
  return MAP[pipelineStepId] ?? null;
}
