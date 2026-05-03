/**
 * 任務到期提醒檢查器
 *
 * 掃描今天到期的任務，對負責人發送 LINE 提醒。
 * 用 sessionStorage 確保每次登入只跑一次，避免重複通知。
 */

import { supabase } from './supabase'
import { notifyTaskDailySummary } from './lineNotify'

const DAILY_SESSION_KEY = 'task_daily_notified'

/**
 * 每 session 執行一次：將所有逾期及今日到期任務，
 * 依負責人分組後，各發一則 LINE 輪播卡片。
 */
export async function checkAndNotifyDailyTasks() {
  if (sessionStorage.getItem(DAILY_SESSION_KEY)) return { skipped: true }
  sessionStorage.setItem(DAILY_SESSION_KEY, new Date().toISOString())

  const today = new Date().toISOString().slice(0, 10)

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, assignee, due_date, description, notes, store, status')
    .lte('due_date', today)
    .in('status', ['待簽核', '進行中'])
    .not('assignee', 'is', null)
    .order('due_date')

  if (!tasks?.length) return { sent: 0 }

  const byAssignee = {}
  for (const task of tasks) {
    if (!byAssignee[task.assignee]) byAssignee[task.assignee] = []
    byAssignee[task.assignee].push({
      ...task,
      isOverdue: task.due_date < today,
      approvalRequired: task.status === '待簽核',
    })
  }

  let sent = 0
  for (const [assignee, assigneeTasks] of Object.entries(byAssignee)) {
    try {
      const result = await notifyTaskDailySummary(assignee, assigneeTasks)
      if (result?.ok !== false) sent++
    } catch (err) {
      console.warn(`[TaskDueChecker] Failed to notify ${assignee}:`, err)
    }
  }

  return { sent, total: Object.keys(byAssignee).length }
}
