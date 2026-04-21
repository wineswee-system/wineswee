/**
 * 任務到期提醒檢查器
 *
 * 掃描今天到期的任務，對負責人發送 LINE 提醒。
 * 用 sessionStorage 確保每次登入只跑一次，避免重複通知。
 */

import { supabase } from './supabase'
import { notifyTaskDue } from './lineNotify'

const SESSION_KEY = 'task_due_checked'

/**
 * 檢查今天到期的任務，發送 LINE 提醒給負責人。
 * 每個 session 只執行一次。
 */
export async function checkAndNotifyDueTasks() {
  // 每個 session 只跑一次
  if (sessionStorage.getItem(SESSION_KEY)) return { skipped: true }
  sessionStorage.setItem(SESSION_KEY, new Date().toISOString())

  const today = new Date().toISOString().slice(0, 10)

  // 找今天到期、未完成、有負責人的任務
  const { data: dueTasks } = await supabase
    .from('tasks')
    .select('id, title, assignee, due_date')
    .eq('due_date', today)
    .in('status', ['待處理', '進行中'])
    .not('assignee', 'is', null)

  if (!dueTasks?.length) return { sent: 0 }

  let sent = 0
  for (const task of dueTasks) {
    try {
      const result = await notifyTaskDue(task.assignee, task.title, task.due_date)
      if (result?.ok !== false) sent++
    } catch {
      // LINE 推播失敗不阻擋
    }
  }

  return { sent, total: dueTasks.length }
}
