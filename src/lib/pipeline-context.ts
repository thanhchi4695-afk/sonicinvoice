export interface PipelineContext {
  pipelineId: string;
  currentStep: number;
  completedSteps: string[];
  skippedSteps: string[];

  supplierName?: string;
  brands?: string[];
  productTypes?: string[];
  newProducts?: { title: string; shopifyId?: string; imageUrl?: string }[];
  newVariants?: { title: string; parentId?: string; colour: string }[];
  refills?: { title: string; sku: string; qtyAdded: number }[];
  pushSummary?: { created: number; updated: number; failed: number };

  stepStartedAt?: Record<string, number>;
  stepDoneAt?: Record<string, number>;

  /** Summary lines added by each step for the completion screen */
  summaryLines?: string[];
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

export function updatePipelineStep(stepId: string, data: Partial<PipelineContext>): void {
  const ctx = getPipelineContext();
  if (!ctx) return;
  const merged = { ...ctx, ...data };
  if (!merged.stepDoneAt) merged.stepDoneAt = {};
  merged.stepDoneAt[stepId] = Date.now();
  if (!merged.completedSteps.includes(stepId)) {
    merged.completedSteps.push(stepId);
  }
  setPipelineContext(merged);
}

export function isPipelineActive(): boolean {
  const ctx = getPipelineContext();
  if (!ctx) return false;
  // Not finished yet
  return ctx.currentStep >= 0;
}
