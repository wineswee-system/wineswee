/**
 * Shared task audit helpers used across Tasks, Workflows, Projects,
 * TaskModal, and TaskDetailPanel.
 *
 * Usage in any React component:
 *   import { diffAndLogTask } from '../lib/taskAudit'
 *   const { logFieldChange, logAction } = useAuditLog()
 *
 *   // After updateTask succeeds:
 *   diffAndLogTask(logFieldChange, oldTask, newData)
 */

/** Human-readable Chinese labels for every tracked task field. */
export const TASK_FIELD_LABELS = {
  title:                '標題',
  status:               '狀態',
  priority:             '優先度',
  assignee:             '負責人',
  store:                '門市',
  category:             '分類',
  bucket:               '類型',
  planned_start:        '計畫開始日',
  due_date:             '預計完成日',
  due_time:             '預計完成時間',
  reminder_at:          '提醒時間',
  notes:                '備註',
  description:          '說明',
  workflow_instance_id: '工作流',
  project_id:           '專案',
  confirmation_mode:    '簽核模式',
  completed_at:         '實際完成日',
  recurrence_rule:      '週期規則',
  approval_chain_id:    '簽核鏈',
  section_id:           '所在欄位',
}

/**
 * Diffs two task objects and fires one logFieldChange entry per changed field.
 * Fire-and-forget safe — errors are caught and silenced internally.
 *
 * @param {Function} logFieldChange  from useAuditLog()
 * @param {Object}   oldTask         task record before the update
 * @param {Object}   newTask         task record returned from DB after the update
 */
export function diffAndLogTask(logFieldChange, oldTask, newTask) {
  const label = oldTask?.title || newTask?.title || `task#${newTask?.id}`
  return Promise.all(
    Object.entries(TASK_FIELD_LABELS)
      .filter(([key]) => String(oldTask?.[key] ?? '') !== String(newTask?.[key] ?? ''))
      .map(([key, fieldLabel]) =>
        logFieldChange('tasks', newTask.id, fieldLabel, oldTask?.[key], newTask[key], label)
      )
  ).catch(() => {})
}
