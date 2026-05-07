// Sonic proactive employee — task graph
// Defines what naturally follows what, plus labels for chat messages.

export type TaskType =
  | 'parse_invoice'
  | 'generate_tags'
  | 'generate_seo'
  | 'update_feed'
  | 'write_social'
  | 'stock_check'
  | 'reorder'
  | 'markdown_ladder'
  | 'morning_briefing'
  | 'pipeline_new_arrivals'
  | 'pipeline_restock'
  | 'pipeline_seo_boost'
  | 'pipeline_marketing'
  | 'pipeline_season_close'
  | 'product_enrichment_review';

export type TriggerSource =
  | 'invoice_parse'
  | 'scheduled'
  | 'step_complete'
  | 'stock_alert'
  | 'user_request'
  | 'pipeline_handoff';

// What naturally follows each completed task
export const TASK_NEXT_MAP: Record<TaskType, TaskType | null> = {
  parse_invoice: 'generate_tags',
  generate_tags: 'generate_seo',
  generate_seo: 'update_feed',
  update_feed: 'write_social',
  write_social: null,
  stock_check: 'reorder',
  reorder: null,
  markdown_ladder: null,
  morning_briefing: null,
  pipeline_new_arrivals: 'pipeline_seo_boost',
  pipeline_restock: null,
  pipeline_seo_boost: 'pipeline_marketing',
  pipeline_marketing: null,
  pipeline_season_close: null,
  product_enrichment_review: null,
};

// Which pipeline to suggest after each individual task chain
export const TASK_PIPELINE_SUGGESTION: Record<TaskType, string | null> = {
  parse_invoice: 'new_arrivals',
  generate_tags: 'new_arrivals',
  generate_seo: 'seo_boost',
  update_feed: 'marketing_launch',
  write_social: null,
  stock_check: 'restock',
  reorder: null,
  markdown_ladder: 'season_close',
  morning_briefing: null,
  pipeline_new_arrivals: 'seo_boost',
  pipeline_restock: null,
  pipeline_seo_boost: 'marketing_launch',
  pipeline_marketing: null,
  pipeline_season_close: null,
};

// Human-readable labels for chat messages
export const TASK_LABELS: Record<TaskType, string> = {
  parse_invoice: 'Parse invoice',
  generate_tags: 'Generate tags',
  generate_seo: 'Write SEO titles',
  update_feed: 'Update Google feed',
  write_social: 'Write social captions',
  stock_check: 'Stock check',
  reorder: 'Draft reorder email',
  markdown_ladder: 'Build markdown ladder',
  morning_briefing: 'Morning briefing',
  pipeline_new_arrivals: 'New arrivals pipeline',
  pipeline_restock: 'Restock pipeline',
  pipeline_seo_boost: 'SEO boost pipeline',
  pipeline_marketing: 'Marketing launch pipeline',
  pipeline_season_close: 'Season close pipeline',
};

// Pipeline display names
export const PIPELINE_LABELS: Record<string, string> = {
  new_arrivals: 'New arrivals',
  restock: 'Restock only',
  seo_boost: 'SEO & visibility',
  marketing_launch: 'Marketing launch',
  season_close: 'Season close',
};

// Which pipeline naturally follows another pipeline (keyed by pipelineId)
export const PIPELINE_NEXT_PIPELINE: Record<string, string | null> = {
  new_arrivals: 'seo_boost',
  seo_boost: 'marketing_launch',
  marketing_launch: null,
  restock: null,
  season_close: null,
};

export function nextTaskFor(task: TaskType): TaskType | null {
  return TASK_NEXT_MAP[task] ?? null;
}

export function suggestedPipelineFor(task: TaskType): string | null {
  return TASK_PIPELINE_SUGGESTION[task] ?? null;
}

export function taskLabel(task: TaskType): string {
  return TASK_LABELS[task] ?? task;
}

export function pipelineLabel(pipeline: string): string {
  return PIPELINE_LABELS[pipeline] ?? pipeline;
}
