// ── Pipeline execution context ──
// Shared state that flows between pipeline steps, persisted in sessionStorage.

export type StepExecutionStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface StepLog {
  stepId: string;
  status: StepExecutionStatus;
  message: string;
  timestamp: number;
}

export interface PipelineContext {
  pipelineId: string;
  currentStep: number;
  completedSteps: string[];
  skippedSteps: string[];
  stepStatuses: Record<string, StepExecutionStatus>;

  // ── Shared data passed between steps ──
  supplierName?: string;
  brands?: string[];
  productTypes?: string[];

  products?: { title: string; shopifyId?: string; imageUrl?: string; sku?: string; vendor?: string }[];
  variants?: { title: string; parentId?: string; colour: string; size?: string; sku?: string }[];
  newProducts?: { title: string; shopifyId?: string; imageUrl?: string }[];
  newVariants?: { title: string; parentId?: string; colour: string }[];
  refills?: { title: string; sku: string; qtyAdded: number }[];

  invoiceData?: {
    documentId?: string;
    documentNumber?: string;
    supplierName?: string;
    total?: number;
    gst?: number;
    lineCount?: number;
  };

  stockClassification?: {
    newCount: number;
    refillCount: number;
    variantCount: number;
  };

  seoData?: {
    titlesGenerated?: number;
    metaDescriptions?: number;
    collectionsOptimised?: number;
    blogPostsCreated?: number;
  };

  images?: { url: string; altText?: string; productTitle?: string }[];

  pricing?: {
    adjustedCount?: number;
    avgMargin?: number;
    belowFloorCount?: number;
  };

  pushSummary?: { created: number; updated: number; failed: number };

  // ── Execution tracking ──
  stepStartedAt?: Record<string, number>;
  stepDoneAt?: Record<string, number>;
  stepErrors?: Record<string, string>;
  retryCount?: Record<string, number>;
  logs: StepLog[];

  /** Human-readable summary lines for the completion screen */
  summaryLines?: string[];

  /** Trigger type that started this pipeline */
  trigger?: "invoice_upload" | "manual" | "scheduled";
}

const STORAGE_KEY = "pipeline_context";

export function getPipelineContext(): PipelineContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setPipelineContext(ctx: PipelineContext): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
}

export function clearPipelineContext(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function addPipelineLog(stepId: string, status: StepExecutionStatus, message: string): void {
  const ctx = getPipelineContext();
  if (!ctx) return;
  ctx.logs.push({ stepId, status, message, timestamp: Date.now() });
  setPipelineContext(ctx);
}

export function setStepStatus(stepId: string, status: StepExecutionStatus): void {
  const ctx = getPipelineContext();
  if (!ctx) return;
  ctx.stepStatuses[stepId] = status;
  setPipelineContext(ctx);
}

export function updatePipelineStep(stepId: string, data: Partial<PipelineContext>): void {
  const ctx = getPipelineContext();
  if (!ctx) return;
  const merged = { ...ctx, ...data };
  if (!merged.stepDoneAt) merged.stepDoneAt = {};
  merged.stepDoneAt[stepId] = Date.now();
  merged.stepStatuses[stepId] = "success";
  if (!merged.completedSteps.includes(stepId)) {
    merged.completedSteps.push(stepId);
  }
  merged.logs.push({ stepId, status: "success", message: `${stepId} completed`, timestamp: Date.now() });
  setPipelineContext(merged);
}

export function markStepFailed(stepId: string, error: string): void {
  const ctx = getPipelineContext();
  if (!ctx) return;
  ctx.stepStatuses[stepId] = "failed";
  if (!ctx.stepErrors) ctx.stepErrors = {};
  ctx.stepErrors[stepId] = error;
  ctx.logs.push({ stepId, status: "failed", message: error, timestamp: Date.now() });
  setPipelineContext(ctx);
}

export function incrementRetry(stepId: string): number {
  const ctx = getPipelineContext();
  if (!ctx) return 0;
  if (!ctx.retryCount) ctx.retryCount = {};
  ctx.retryCount[stepId] = (ctx.retryCount[stepId] ?? 0) + 1;
  ctx.logs.push({ stepId, status: "running", message: `Retry #${ctx.retryCount[stepId]}`, timestamp: Date.now() });
  setPipelineContext(ctx);
  return ctx.retryCount[stepId];
}

export function isPipelineActive(): boolean {
  const ctx = getPipelineContext();
  if (!ctx) return false;
  return ctx.currentStep >= 0;
}

export function createFreshContext(pipelineId: string, trigger: PipelineContext["trigger"] = "manual"): PipelineContext {
  return {
    pipelineId,
    currentStep: 0,
    completedSteps: [],
    skippedSteps: [],
    stepStatuses: {},
    stepStartedAt: {},
    stepDoneAt: {},
    stepErrors: {},
    retryCount: {},
    logs: [],
    summaryLines: [],
    trigger,
  };
}