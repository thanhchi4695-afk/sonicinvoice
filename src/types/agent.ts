// Sonic Agent Phase 1 — TypeScript types
// Mirrors the sonic_* tables created in the Phase 1 migration.
// Names are namespaced to avoid clashing with the existing agent_* system.

export type ShopRole = "owner" | "admin" | "member";

export interface Shop {
  id: string;
  name: string;
  timezone: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopUser {
  id: string;
  shop_id: string;
  user_id: string;
  role: ShopRole;
  created_at: string;
}

export type AgentTriggerType =
  | "invoice_received"
  | "cron_daily_briefing"
  | "cron_slow_stock"
  | "cron_reorder"
  | "cron_ad_check"
  | "user_chat"
  | "webhook";

export type AgentRunStatus =
  | "planning"
  | "executing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface SonicAgentRun {
  id: string;
  shop_id: string;
  user_id: string | null;
  trigger_type: AgentTriggerType;
  trigger_payload: Record<string, unknown>;
  status: AgentRunStatus;
  planner_model: string | null;
  executor_model: string | null;
  plan_summary: string | null;
  dry_run: boolean;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export type AutonomyLevel = "autonomous" | "approval_gated" | "never_agentic";

export type AgentActionStatus =
  | "pending"
  | "executing"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed"
  | "rolled_back";

export interface SonicAgentAction {
  id: string;
  run_id: string;
  flow_name: string;
  autonomy_level: AutonomyLevel;
  status: AgentActionStatus;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown> | null;
  diff_summary: string | null;
  approval_queue_id: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
}

export type ApprovalPriority = "low" | "medium" | "high" | "urgent";
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";
export type ApprovalCategory =
  | "money_out"
  | "live_ads"
  | "live_catalog"
  | "other";

export interface ProposedAction {
  flow_name: string;
  input_payload: Record<string, unknown>;
  estimated_impact?: Record<string, unknown>;
  summary?: string;
}

export interface EstimatedImpact {
  money_out?: number;
  products_affected?: number;
  currency?: string;
  [k: string]: unknown;
}

export interface SonicApprovalQueueItem {
  id: string;
  shop_id: string;
  run_id: string | null;
  title: string;
  description: string | null;
  proposed_actions: ProposedAction[];
  estimated_impact: EstimatedImpact;
  priority: ApprovalPriority;
  status: ApprovalStatus;
  category: ApprovalCategory;
  created_at: string;
  expires_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
}

export interface SonicScheduledTask {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  trigger_type: AgentTriggerType;
  trigger_payload: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export type AuditEventType =
  | "action_started"
  | "action_completed"
  | "action_failed"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "rollback"
  | "manual_override";

export interface SonicAuditLogEntry {
  id: string;
  shop_id: string;
  run_id: string | null;
  action_id: string | null;
  event_type: AuditEventType;
  actor: string; // "agent" | "system" | user uuid
  payload: Record<string, unknown>;
  created_at: string;
}
