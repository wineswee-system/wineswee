// ════════════════════════════════════════════════════════════════════════════
// 比對 harness：get_expense_request_chain_full（新 RPC） vs 舊前端 openDetail 邏輯
//
// 把 src/lib/buildChainSteps.js (buildChainBasedSteps + mergeExtraSteps) 與
// src/pages/workflow/ExpenseRequests.jsx openDetail 的組裝邏輯「原樣移植」到這裡，
// 用 service_role 跑，對同一批單同時算「舊結果」與「新 RPC 結果」，逐欄 deep-diff。
//
// 用法：node scripts/_diff_chain_full.mjs [id1 id2 ...]
//   不給 id → 自動抓各狀態樣本。
//
// ⚠️ service_role 會繞過 RLS；building block 都是 SECURITY DEFINER（本來就繞 RLS），
//    但舊邏輯的直查表（approval_chain_steps / employees / snapshots / extra_steps）
//    在瀏覽器是吃 RLS 的。對「RPC 是否忠實複製 JS 邏輯」這個目的，service_role 是對的。
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

// ──────────────────────────────────────────────────────────────────────────
// 移植：src/lib/buildChainSteps.js
// ──────────────────────────────────────────────────────────────────────────
function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (ms < 0) return null
  let mins = Math.floor(ms / 60000)
  if (mins < 1) return '不到 1 分'
  const days = Math.floor(mins / (60 * 24)); mins -= days * 60 * 24
  const hours = Math.floor(mins / 60);       mins -= hours * 60
  const parts = []
  if (days  > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小時`)
  if (mins  > 0 || parts.length === 0) parts.push(`${mins} 分`)
  return parts.join(' ')
}

async function buildChainBasedSteps({ row, applicantName, applicantCreatedAt, approverMap = {}, sourceTable = null }) {
  const applicantStep = { label: '申請人', name: applicantName || '—', status: 'completed', completedAt: applicantCreatedAt, isApplicant: true }
  if (!row?.approval_chain_id) {
    if (row?.status === '已核准') return [applicantStep, { label: '主管核示', name: row.approver?.name || '', status: 'completed', completedAt: row.approved_at }]
    if (row?.status === '已駁回' || row?.status === '已拒絕' || row?.status === '已退回') return [applicantStep, { label: '主管核示', name: row.approver?.name || '', status: 'rejected', rejectReason: row.reject_reason }]
    return [applicantStep, { label: '主管核示', name: '', status: 'current' }]
  }
  const applicantEmpId = row.employee_id || row.employee_emp_id || null
  const REQUEST_TYPE_MAP = { expense_requests: 'expense_request', leave_requests: 'leave_request', overtime_requests: 'overtime_request', business_trips: 'trip', clock_corrections: 'correction', resignation_requests: 'resignation', leave_of_absence_requests: 'loa', personnel_transfer_requests: 'transfer', headcount_requests: 'headcount', form_submissions: 'form_submission' }
  const requestType = sourceTable ? REQUEST_TYPE_MAP[sourceTable] : null
  let chainSteps = []
  let usedSnapshot = false
  if (requestType && row?.id) {
    const { data: snapData } = await supabase.rpc('get_request_chain_display_names', { p_request_type: requestType, p_request_id: row.id, p_applicant_emp_id: applicantEmpId })
    if (Array.isArray(snapData) && snapData.length > 0) { chainSteps = snapData; usedSnapshot = true }
  }
  if (!usedSnapshot) {
    const { data } = await supabase.rpc('get_chain_step_display_names', { p_chain_id: row.approval_chain_id, p_applicant_emp_id: applicantEmpId })
    chainSteps = Array.isArray(data) ? data : []
  }
  const totalSteps = chainSteps?.length || 0
  let cur = row.current_step || 0
  if (cur < 0 || cur > totalSteps + 1) cur = Math.max(0, Math.min(cur, totalSteps + 1))
  const steps = chainSteps.map((s) => {
    const idx = s.step_order
    let status
    if (row.status === '已駁回' || row.status === '已拒絕' || row.status === '已退回') status = idx === cur ? 'rejected' : (idx < cur ? 'completed' : 'pending')
    else if (row.status === '已核准' || row.status === '已核銷') status = 'completed'
    else status = idx < cur ? 'completed' : (idx === cur ? 'current' : 'pending')
    const targetName = s.names || (s.target_emp_id ? (approverMap[s.target_emp_id] || '') : (s.role_name || ''))
    return {
      label: s.label || s.role_name || `第${idx}關`,
      name: targetName,
      target_emp_id: s.target_emp_id || null,
      role_name: s.role_name || null,
      status,
      completedAt: status === 'completed' && idx === totalSteps - 1 ? row.approved_at : undefined,
      completedBy: status === 'completed' ? targetName : null,
      rejectReason: status === 'rejected' ? row.reject_reason : '',
    }
  })
  const allSteps = [applicantStep, ...steps]
  if (sourceTable && row?.id) return await mergeExtraSteps(allSteps, sourceTable, row.id, approverMap)
  return allSteps
}

async function mergeExtraSteps(baseSteps, sourceTable, sourceId, approverMap = {}) {
  const { data: extras } = await supabase.from('approval_extra_steps')
    .select('id, source_id, insert_before_step, assignee_id, requested_by_id, reason, reject_reason, status, approved_at, created_at')
    .eq('source_table', sourceTable).eq('source_id', sourceId).neq('status', 'cancelled').order('created_at')
  if (!extras || extras.length === 0) return baseSteps
  const needIds = new Set()
  for (const e of extras) { if (!approverMap[e.assignee_id]) needIds.add(e.assignee_id); if (!approverMap[e.requested_by_id]) needIds.add(e.requested_by_id) }
  let nameMap = { ...approverMap }
  if (needIds.size > 0) {
    const { data: emps } = await supabase.from('employees').select('id, name').in('id', Array.from(needIds))
    for (const e of (emps || [])) nameMap[e.id] = e.name
  }
  const extraSteps = extras.map(e => {
    let status = 'pending'
    if (e.status === 'pending') status = 'current'
    else if (e.status === 'approved') status = 'completed'
    else if (e.status === 'rejected') status = 'rejected'
    const durationText = e.approved_at ? fmtDuration(e.created_at, e.approved_at) : null
    return { kind: 'extra', label: '加簽', name: nameMap[e.assignee_id] || '', status, completedAt: e.approved_at, completedBy: nameMap[e.assignee_id] || '', durationText, rejectReason: e.reject_reason || '', extraReason: e.reason || '', extraRequesterName: nameMap[e.requested_by_id] || '', _insertBefore: e.insert_before_step, _insertOrder: e.insert_before_step - 0.5 }
  })
  const indexed = []
  let chainIdx = 0
  for (let i = 0; i < baseSteps.length; i++) {
    const s = baseSteps[i]
    if (s.isApplicant) indexed.push({ _order: -1, step: s })
    else { indexed.push({ _order: chainIdx, step: s }); chainIdx += 1 }
  }
  for (const ex of extraSteps) indexed.push({ _order: ex._insertOrder, step: ex })
  indexed.sort((a, b) => a._order - b._order)
  return indexed.map(x => x.step)
}

// ──────────────────────────────────────────────────────────────────────────
// 移植：openDetail（src/pages/workflow/ExpenseRequests.jsx 380-585）
// ──────────────────────────────────────────────────────────────────────────
async function oldOpenDetail(req) {
  const isPending = req.status === '待核銷'
  const isSettled = req.status === '已核銷'
  const inSettleStage = isPending || isSettled

  let approverMap = {}
  if (req.approval_chain_id) {
    const { data: rawSteps } = await supabase.from('approval_chain_steps').select('target_emp_id').eq('chain_id', req.approval_chain_id)
    const empIds = [...new Set((rawSteps || []).map(s => s.target_emp_id).filter(Boolean))]
    if (empIds.length > 0) {
      const { data: emps } = await supabase.from('employees').select('id, name').in('id', empIds)
      approverMap = Object.fromEntries((emps || []).map(e => [e.id, e.name]))
    }
  }
  const fakeRow = {
    id: req.id, approval_chain_id: req.approval_chain_id || null, current_step: req.current_step || 0,
    employee_id: req.employee_id, status: req.status === '待核銷' ? '已核准' : req.status,
    approved_at: req.approved_at, reject_reason: req.reject_reason,
    approver: req.approved_by ? { name: req.approved_by } : null,
  }
  let baseSteps = []
  try { baseSteps = await buildChainBasedSteps({ row: fakeRow, applicantName: req.employee, applicantCreatedAt: req.created_at, approverMap, sourceTable: 'expense_requests' }) }
  catch (e) { console.error('buildChainBasedSteps failed:', e) }

  try {
    const { data: timeline } = await supabase.rpc('get_approval_timeline', { p_request_type: 'expense_request', p_request_id: req.id })
    const tlByStep = {}; (timeline || []).forEach(t => { tlByStep[t.step_order] = t })
    let chainStepIdx = 0
    baseSteps = baseSteps.map(s => {
      if (s.isApplicant) return s
      if (s.kind === 'extra') return s
      const tl = tlByStep[chainStepIdx]; chainStepIdx += 1
      if (!tl || !tl.exited_at) return s
      if (s.status !== 'completed' && s.status !== 'rejected') return s
      return { ...s, completedAt: tl.exited_at, durationText: tl.duration_text }
    })
  } catch (e) { console.warn('[get_approval_timeline] failed:', e) }

  let finalSteps = baseSteps
  if (inSettleStage) {
    if (req.settle_chain_id) {
      let rawSettleSteps = []
      const { data: snapRows } = await supabase.from('request_chain_snapshots')
        .select('step_order, label, role_name, target_type, target_emp_id')
        .eq('request_type', 'expense_settle').eq('request_id', req.id).order('step_order')
      if (snapRows?.length > 0) {
        const snapEmpIds = [...new Set(snapRows.map(s => s.target_emp_id).filter(Boolean))]
        let snapEmpMap = {}
        if (snapEmpIds.length > 0) { const { data: snapEmps } = await supabase.from('employees').select('id, name').in('id', snapEmpIds); snapEmpMap = Object.fromEntries((snapEmps || []).map(e => [e.id, e.name])) }
        rawSettleSteps = snapRows.map(s => ({ ...s, names: s.target_emp_id ? (snapEmpMap[s.target_emp_id] || '') : (s.role_name || s.label || '') }))
      } else {
        const { data: resolvedSettleSteps } = await supabase.rpc('get_chain_step_display_names', { p_chain_id: req.settle_chain_id, p_applicant_emp_id: req.employee_id })
        rawSettleSteps = Array.isArray(resolvedSettleSteps) ? resolvedSettleSteps : []
      }
      const curStep = req.settle_current_step ?? 0
      const totalSteps = rawSettleSteps.length
      const settleTlByStep = {}
      let settleSnapshotCreatedAt = null
      try {
        const [{ data: settleTl }, { data: snapshotRow }] = await Promise.all([
          supabase.rpc('get_approval_timeline', { p_request_type: 'expense_settle', p_request_id: req.id }),
          supabase.from('request_chain_snapshots').select('created_at').eq('request_type', 'expense_settle').eq('request_id', req.id).limit(1).maybeSingle(),
        ])
        ;(settleTl || []).forEach(t => { settleTlByStep[t.step_order] = t })
        settleSnapshotCreatedAt = snapshotRow?.created_at || null
      } catch (_) {}
      const settleSteps = rawSettleSteps.map(s => {
        const empName = s.names || ''
        const isLastStep = s.step_order === totalSteps - 1
        let stepStatus, stepName, completedAt, durationText
        if (isSettled) { stepStatus = 'completed'; stepName = isLastStep ? (req.settled_by || empName) : empName; completedAt = isLastStep ? req.settled_at : undefined }
        else if (s.step_order < curStep) { stepStatus = 'completed'; stepName = empName }
        else if (s.step_order === curStep) { stepStatus = 'current'; stepName = empName }
        else { stepStatus = 'pending'; stepName = empName }
        const tl = settleTlByStep[s.step_order]
        if (tl?.exited_at && (stepStatus === 'completed')) { completedAt = completedAt || tl.exited_at; durationText = tl.duration_text }
        return { label: s.label || s.role_name || `核銷第 ${s.step_order + 1} 關`, name: stepName, status: stepStatus, completedAt, durationText, archival: false, isSettle: true }
      })
      const settleStartAt = settleSnapshotCreatedAt || settleTlByStep[0]?.entered_at || null
      let settleIntervalText = null
      if (settleStartAt && req.approved_at) {
        const diffSec = Math.floor((new Date(settleStartAt) - new Date(req.approved_at)) / 1000)
        if (diffSec < 3600) settleIntervalText = `核准後 ${Math.floor(diffSec / 60)} 分鐘送核銷(驗收)`
        else if (diffSec < 86400) settleIntervalText = `核准後 ${Math.floor(diffSec / 3600)} 小時送核銷(驗收)`
        else settleIntervalText = `核准後 ${Math.floor(diffSec / 86400)} 天送核銷(驗收)`
      }
      const settleApplicantStep = { label: '申請人（送核銷/驗收）', name: req.employee, status: 'completed', completedAt: settleStartAt, noteText: settleIntervalText, isSettle: true, isApplicant: true }
      finalSteps = [...baseSteps, { kind: 'settle_divider' }, settleApplicantStep, ...settleSteps]
    } else {
      finalSteps = [...baseSteps, { label: '財務核章', name: isSettled ? (req.settled_by || '') : '', status: isSettled ? 'completed' : 'current', completedAt: isSettled ? req.settled_at : undefined, archival: false, isSettle: true }]
    }
  }
  return finalSteps
}

// ──────────────────────────────────────────────────────────────────────────
// deep diff（時間正規化成 epoch；null/undefined 視為「不存在」）
// ──────────────────────────────────────────────────────────────────────────
const isTs = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)
function norm(step) {
  const o = {}
  for (const [k, v] of Object.entries(step || {})) {
    if (v === null || v === undefined) continue        // null == 不存在
    if (k.startsWith('_')) continue                    // 內部排序欄
    o[k] = isTs(v) ? new Date(v).getTime() : v
  }
  return o
}
function diffSteps(oldArr, newArr) {
  const diffs = []
  const n = Math.max(oldArr.length, newArr.length)
  for (let i = 0; i < n; i++) {
    const a = norm(oldArr[i]); const b = norm(newArr[i])
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        diffs.push(`  [#${i} ${oldArr[i]?.label || newArr[i]?.label || '?'}] ${k}: 舊=${JSON.stringify(a[k])}  新=${JSON.stringify(b[k])}`)
      }
    }
  }
  return diffs
}

// ──────────────────────────────────────────────────────────────────────────
async function pickSamples() {
  const { data: reqs } = await supabase.from('expense_requests')
    .select('id,status,approval_chain_id,settle_chain_id').order('id', { ascending: false }).limit(200)
  const byStatus = {}
  for (const r of (reqs || [])) (byStatus[r.status] ??= []).push(r.id)
  const picks = new Set()
  for (const ids of Object.values(byStatus)) ids.slice(0, 3).forEach(id => picks.add(id))
  // 確保含加簽單
  const { data: extras } = await supabase.from('approval_extra_steps').select('source_id').eq('source_table', 'expense_requests').neq('status', 'cancelled')
  for (const e of (extras || [])) picks.add(e.source_id)
  return [...picks]
}

const argIds = process.argv.slice(2).map(Number).filter(Boolean)
const ids = argIds.length ? argIds : await pickSamples()
console.log(`比對 ${ids.length} 張單：${ids.join(', ')}\n`)

let pass = 0, fail = 0, errors = 0
for (const id of ids) {
  const { data: req } = await supabase.from('expense_requests').select('*').eq('id', id).maybeSingle()
  if (!req) { console.log(`#${id}  ⚠ 找不到`); continue }
  const oldArr = await oldOpenDetail(req)
  const { data: newArr, error } = await supabase.rpc('get_expense_request_chain_full', { p_id: id, p_applicant_emp_id: req.employee_id })
  if (error) { console.log(`#${id} [${req.status}]  ✗ RPC error: ${error.message}`); errors++; continue }
  const diffs = diffSteps(oldArr, Array.isArray(newArr) ? newArr : [])
  if (oldArr.length !== (newArr?.length || 0)) diffs.unshift(`  長度不同：舊=${oldArr.length} 新=${newArr?.length || 0}`)
  if (diffs.length === 0) { console.log(`#${id} [${req.status}]  ✓ 一致（${oldArr.length} 關）`); pass++ }
  else { console.log(`#${id} [${req.status}]  ✗ 不一致：`); diffs.forEach(d => console.log(d)); fail++ }
}
console.log(`\n結果：✓${pass}  ✗${fail}  error${errors}`)
process.exit(fail || errors ? 1 : 0)
