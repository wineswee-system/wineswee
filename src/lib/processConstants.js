/**
 * Process-module status constants — single source of truth for all status strings.
 *
 * Usage:
 *   import { TASK_STATUS, APPROVAL_STATUS, WORKFLOW_STATUS } from '../../lib/processConstants'
 *
 * Why a JS object instead of a TS enum: the project uses JSX throughout; object
 * literals give the same safety with no build overhead.
 */

// ── Task / workflow-step statuses ─────────────────────────────────────────────
export const TASK_STATUS = Object.freeze({
  /** Assigned and awaiting start — the status new deploy tasks receive. */
  PENDING:           '待處理',
  /** Actively being worked on. */
  IN_PROGRESS:       '進行中',
  /** Legacy initial status written by SOPTemplates (pre-fix deploys). */
  NOT_STARTED:       '未開始',
  /** Task finished. */
  COMPLETED:         '已完成',
  /** Submitted for manager sign-off. */
  AWAITING_APPROVAL: '待簽核',
})

// ── Approval form (header) statuses ───────────────────────────────────────────
export const APPROVAL_STATUS = Object.freeze({
  /** Created but no approver has acted yet. */
  PENDING:    '待簽',
  /** At least one step approved; waiting for subsequent steps. */
  IN_REVIEW:  '簽核中',
  /** All steps approved. */
  APPROVED:   '已通過',
  /** At least one step rejected; form closed. */
  REJECTED:   '已退回',
})

// ── Approval form-step statuses ───────────────────────────────────────────────
export const APPROVAL_STEP_STATUS = Object.freeze({
  /** This step is the current active step waiting for action. */
  PENDING:   '待簽',
  /** Approver approved this step. */
  APPROVED:  '已核准',
  /** Approver rejected this step. */
  REJECTED:  '已退回',
  /** Sequential mode: step is blocked until prior steps complete. */
  WAITING:   '等待中',
})

// ── Workflow-instance statuses ────────────────────────────────────────────────
export const WORKFLOW_STATUS = Object.freeze({
  IN_PROGRESS: '進行中',
  COMPLETED:   '已完成',
  CANCELLED:   '已取消',
})

// ── Task priority labels (used in createTask calls and filter strips) ─────────
export const TASK_PRIORITY = Object.freeze({
  LOW:    '低',
  MEDIUM: '中',
  HIGH:   '高',
})
