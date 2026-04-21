/**
 * Portal API — Supabase 串接層
 *
 * 讓 Employee Portal 的表單能真正寫入資料庫並觸發簽核流程。
 * 使用 Supabase JS CDN client（在 index.html 引入）。
 */

// ── Supabase Client ──
// 由 index.html 引入 CDN 後，window.supabase 可用
let _sb = null
function sb() {
  if (_sb) return _sb
  // 從 meta tag 或 fallback 讀取
  const url = document.querySelector('meta[name="supabase-url"]')?.content
  const key = document.querySelector('meta[name="supabase-key"]')?.content
  if (!url || !key) {
    console.warn('[Portal API] Supabase URL/Key not configured — running in demo mode')
    return null
  }
  _sb = window.supabase.createClient(url, key)
  return _sb
}

// ── 當前員工（從 LIFF 或 fallback） ──
let _currentEmployee = null

async function getCurrentEmployee() {
  if (_currentEmployee) return _currentEmployee

  const client = sb()
  if (!client) return null

  // 嘗試用 LIFF 取得 LINE user ID
  if (window.liff?.isLoggedIn?.()) {
    const profile = await window.liff.getProfile()
    const { data } = await client
      .from('employee_line_accounts')
      .select('employee_id, employees(id, name, dept, position, store)')
      .eq('line_user_id', profile.userId)
      .limit(1)
      .maybeSingle()
    if (data?.employees) {
      _currentEmployee = data.employees
      return _currentEmployee
    }
  }

  // Fallback: 用 data.js 的 EMPLOYEE 物件查找
  if (typeof EMPLOYEE !== 'undefined' && EMPLOYEE.name) {
    const { data } = await client
      .from('employees')
      .select('id, name, dept, position, store')
      .eq('name', EMPLOYEE.name)
      .eq('status', '在職')
      .maybeSingle()
    if (data) {
      _currentEmployee = data
      return _currentEmployee
    }
  }

  return null
}

// ── 簽核流程建立（簡化版，對應 workflowIntegration.js 邏輯）──
async function createPortalWorkflow(type, record, requesterName) {
  const client = sb()
  if (!client) return null

  const templates = {
    leave: { name: '請假簽核', steps: ['直屬主管審核', 'HR 確認'] },
    overtime: { name: '加班簽核', steps: ['直屬主管審核'] },
    expense: { name: '費用報帳簽核', steps: ['直屬主管審核', '財務確認'] },
    business_trip: { name: '出差申請簽核', steps: ['直屬主管審核', 'HR 確認'] },
  }
  const tpl = templates[type]
  if (!tpl) return null

  // 找主管
  const { data: emp } = await client
    .from('employees')
    .select('id, supervisor_id')
    .eq('name', requesterName)
    .eq('status', '在職')
    .maybeSingle()

  let supervisorName = null
  if (emp?.supervisor_id) {
    const { data: sup } = await client
      .from('employees')
      .select('name')
      .eq('id', emp.supervisor_id)
      .maybeSingle()
    supervisorName = sup?.name
  }

  // 建 workflow_instance
  const { data: instance } = await client
    .from('workflow_instances')
    .insert({
      template_name: tpl.name,
      status: '進行中',
      started_by: requesterName,
      assignee: supervisorName,
      store: record?.store || null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (!instance) return null

  // 建 workflow_steps
  const stepRows = tpl.steps.map((title, i) => ({
    instance_id: instance.id,
    step_order: i + 1,
    title,
    assignee: i === 0 ? supervisorName : null,
    status: '待處理',
    due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  }))

  await client.from('workflow_steps').insert(stepRows)

  // 通知
  if (supervisorName) {
    await client.from('notifications').insert({
      recipient: supervisorName,
      type: tpl.name,
      title: `${requesterName} 提交${tpl.name}，請審核`,
      link: '/process/workflows',
      read: false,
    })
  }

  return instance
}

// ══════════════════════════════════════
//  公開 API — 被 pages 的表單呼叫
// ══════════════════════════════════════

/**
 * 送出請假申請
 */
async function submitLeaveRequest(form) {
  const client = sb()
  const emp = await getCurrentEmployee()
  if (!client || !emp) return false

  const { data, error } = await client.from('leave_requests').insert({
    employee: emp.name,
    employee_id: emp.id,
    type: form.type,
    start_date: form.startDate,
    end_date: form.endDate,
    days: form.days,
    reason: form.reason,
    status: '待審核',
  }).select().single()

  if (error) { console.error('Leave submit failed:', error); return false }

  await createPortalWorkflow('leave', data, emp.name)
  return true
}

/**
 * 送出加班申請
 */
async function submitOvertimeRequest(form) {
  const client = sb()
  const emp = await getCurrentEmployee()
  if (!client || !emp) return false

  const { data, error } = await client.from('overtime_requests').insert({
    employee: emp.name,
    employee_id: emp.id,
    date: form.date,
    hours: Number(form.hours),
    reason: form.reason,
    status: '待審核',
  }).select().single()

  if (error) { console.error('OT submit failed:', error); return false }

  await createPortalWorkflow('overtime', data, emp.name)
  return true
}

/**
 * 送出費用申請
 */
async function submitExpenseRequest(form) {
  const client = sb()
  const emp = await getCurrentEmployee()
  if (!client || !emp) return false

  const { data, error } = await client.from('expenses').insert({
    employee: emp.name,
    employee_id: emp.id,
    category: form.category,
    amount: Number(form.amount),
    date: form.date,
    description: form.description,
    status: '待審核',
  }).select().single()

  if (error) { console.error('Expense submit failed:', error); return false }

  await createPortalWorkflow('expense', data, emp.name)
  return true
}

/**
 * 送出出差申請
 */
async function submitBusinessTrip(form) {
  const client = sb()
  const emp = await getCurrentEmployee()
  if (!client || !emp) return false

  const { data, error } = await client.from('business_trips').insert({
    employee: emp.name,
    employee_id: emp.id,
    destination: form.destination,
    start_date: form.startDate,
    end_date: form.endDate,
    purpose: form.purpose,
    estimated_amount: Number(form.estimatedAmount) || 0,
    status: '待審核',
  }).select().single()

  if (error) { console.error('Business trip submit failed:', error); return false }

  await createPortalWorkflow('business_trip', data, emp.name)
  return true
}

/**
 * 檢查 API 是否可用（Supabase 是否已設定）
 */
function isApiAvailable() {
  return !!sb()
}
