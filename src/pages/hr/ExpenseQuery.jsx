import { useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps, mergeStepSignTimes } from '../../lib/buildChainSteps'

// 三種費用表單 → 來源表 / 標籤(獨立於 HR 表單查詢)
//  非經常性費用申請 = expense_requests.doc_type='expense'
//  叫貨申請單       = expense_requests.doc_type='order'
//  經常性費用報銷   = expenses 表
const TYPES = [
  { k: '', l: '全部費用單' },
  { k: 'expense', l: '非經常性費用申請' },
  { k: 'order', l: '叫貨申請單' },
  { k: 'reimburse', l: '經常性費用報銷' },
]

const STATUS_OPTIONS = ['', '申請中', '已核准', '待核銷', '已核銷', '已駁回', '核銷已退回']

const STATUS_STYLE = (st) => {
  const s = String(st || '')
  if (['已核准', '已核銷', '簽核完成'].some(x => s.includes(x))) return { bg: 'var(--accent-green-dim)', c: 'var(--accent-green)' }
  if (s.includes('駁回') || s.includes('退回') || s.includes('拒絕')) return { bg: 'var(--accent-red-dim)', c: 'var(--accent-red)' }
  return { bg: 'var(--accent-orange-dim)', c: 'var(--accent-orange)' } // 申請中/待核銷…
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const money = (v) => (v == null || v === '') ? '—' : `$${Number(v).toLocaleString('en-US')}`

export default function ExpenseQuery() {
  const { profile, role } = useAuth()
  const isAdmin = ['admin', 'super_admin'].includes(role?.name)
  const [selected, setSelected] = useState(new Set()) // "source-id"
  const [acting, setActing] = useState(false)
  const [typeK, setTypeK] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const size = 100
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const toEnd = to ? `${to}T23:59:59` : null
    // expense_requests(非經常 + 叫貨)
    let erQ = supabase.from('expense_requests')
      .select('id, employee, employee_id, department, title, description, estimated_amount, actual_amount, status, doc_type, store, supplier, reject_reason, approved_by, approved_at, current_step, approval_chain_id, created_at')
      .is('deleted_at', null).in('doc_type', ['expense', 'order'])
    // expenses(經常性報銷)
    let exQ = supabase.from('expenses')
      .select('id, employee, employee_id, category, amount, date, description, status, reject_reason, approver, approved_by, created_at, approval_chain_id, current_step')
      .is('deleted_at', null)
    if (profile?.organization_id) { erQ = erQ.eq('organization_id', profile.organization_id); exQ = exQ.eq('organization_id', profile.organization_id) }
    if (from) { erQ = erQ.gte('created_at', from); exQ = exQ.gte('created_at', from) }
    if (toEnd) { erQ = erQ.lte('created_at', toEnd); exQ = exQ.lte('created_at', toEnd) }

    const [er, ex] = await Promise.all([erQ, exQ])
    const list = [
      ...((er.data || []).map(r => ({
        source: 'expense_requests', id: r.id, type: r.doc_type === 'order' ? 'order' : 'expense',
        typeLabel: r.doc_type === 'order' ? '叫貨申請單' : '非經常性費用申請',
        applicant: r.employee, applicant_id: r.employee_id, department: r.department,
        title: r.title || r.description || '', amount: r.actual_amount ?? r.estimated_amount,
        status: r.status, store: r.store, created_at: r.created_at, _raw: r,
      }))),
      ...((ex.data || []).map(r => ({
        source: 'expenses', id: r.id, type: 'reimburse', typeLabel: '經常性費用報銷',
        applicant: r.employee, applicant_id: r.employee_id, department: null,
        title: r.description || r.category || '', amount: r.amount,
        status: r.status, store: null, created_at: r.created_at, _raw: r,
      }))),
    ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    setRows(list)
    setLoading(false)
  }, [from, to, profile?.organization_id])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1); setSelected(new Set()) }, [typeK, status, search, from, to])

  const rowKey = (r) => r.source + '-' + r.id
  const toggleSel = (r) => setSelected(prev => { const n = new Set(prev); const k = rowKey(r); n.has(k) ? n.delete(k) : n.add(k); return n })

  const handleForceApprove = async () => {
    const sel = rows.filter(r => selected.has(rowKey(r)))
    if (!sel.length) return
    const rejected = sel.filter(r => ['駁回', '退回', '拒絕'].some(x => String(r.status).includes(x)))
    if (rejected.length) {
      const ok = window.confirm(`選取的 ${sel.length} 張中有 ${rejected.length} 張「已駁回」。\n已駁回的費用單不能直接壓過(要走重新送出),這幾張會被擋、略過。\n其餘要繼續強制通過嗎?`)
      if (!ok) return
    }
    const reason = window.prompt(`強制通過 ${sel.length} 張費用單(已駁回的會被擋)。\n這會直接核准並記錄稽核。\n\n請填強制通過原因:`)
    if (!reason || !reason.trim()) return
    setActing(true)
    let ok = 0, fail = 0, blocked = 0
    for (const r of sel) {
      const { data: res, error } = await supabase.rpc('force_approve_expense', { p_source: r.source, p_id: r.id, p_reason: reason.trim() })
      if (error || !res?.ok) { if (res?.error === 'REJECTED_NEEDS_RESUBMIT') blocked++; else fail++ } else ok++
    }
    setActing(false); setSelected(new Set())
    const msg = `強制通過:成功 ${ok}${blocked ? `、已駁回略過 ${blocked}` : ''}${fail ? `、失敗 ${fail}` : ''}`
    if (fail || blocked) toast.error(msg); else toast.success(msg)
    load()
  }

  const handleWithdraw = async () => {
    const sel = rows.filter(r => selected.has(rowKey(r)))
    if (!sel.length) return
    if (!(await confirm({ message: `確定抽單(撤回)這 ${sel.length} 張費用單?撤回後不再進行簽核。`, danger: true }))) return
    setActing(true)
    let ok = 0, fail = 0
    for (const r of sel) {
      const { error } = await supabase.rpc('soft_delete_request', { p_table: r.source, p_id: r.id, p_deleted_by: profile?.id ?? null })
      if (error) fail++; else ok++
    }
    setActing(false); setSelected(new Set())
    if (fail) toast.error(`抽單:成功 ${ok}、失敗 ${fail}`); else toast.success(`已抽單 ${ok} 張`)
    load()
  }

  // 前端篩選(類型/狀態/搜尋)
  const filtered = rows.filter(r => {
    if (typeK && r.type !== typeK) return false
    if (status && r.status !== status) return false
    if (search) {
      const q = search.trim().toLowerCase()
      if (!(String(r.applicant || '').toLowerCase().includes(q) || String(r.id).includes(q) || String(r.title || '').toLowerCase().includes(q))) return false
    }
    return true
  })
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / size))
  const pageRows = filtered.slice((page - 1) * size, page * size)
  const sumAmount = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  // 詳細
  const _fmtD = d => d ? String(d).slice(0, 10) : '—'
  const buildFields = (r) => {
    const raw = r._raw, f = []
    f.push({ label: '類型', value: r.typeLabel })
    if (raw.supplier) f.push({ label: '廠商', value: raw.supplier })
    if (raw.category) f.push({ label: '費用類別', value: raw.category })
    if (r.amount != null) f.push({ label: '金額', value: money(r.amount) })
    if (raw.estimated_amount != null && raw.actual_amount != null) f.push({ label: '預估／實際', value: `${money(raw.estimated_amount)} ／ ${money(raw.actual_amount)}` })
    if (raw.date) f.push({ label: '日期', value: _fmtD(raw.date) })
    if (r.store) f.push({ label: '門市', value: r.store })
    const desc = raw.description || raw.title
    if (desc) f.push({ label: '事由 / 說明', value: desc })
    if (raw.reject_reason) f.push({ label: '退回原因', value: raw.reject_reason })
    return f
  }

  const openDetail = async (r) => {
    const table = r.source
    const { data: rec, error } = await supabase.from(table).select('*').eq('id', r.id).maybeSingle()
    if (error || !rec) { toast.error('讀取失敗：' + (error?.message || '找不到')); return }
    const empCols = 'id, name, name_en, position, dept, status, employee_number, avatar_url'
    const empName = rec.employee || r.applicant
    const { data: emp } = rec.employee_id
      ? await supabase.from('employees').select(empCols).eq('id', rec.employee_id).maybeSingle()
      : await supabase.from('employees').select(empCols).eq('name', empName).maybeSingle()
    setDetail({ r: { ...r, _raw: rec }, emp, chainSteps: null })
    // 只有 expense_requests 走完整簽核鏈(buildChainSteps 支援);expenses 用簡易兩節點
    if (table === 'expense_requests') {
      try {
        let steps = await buildFormChainSteps({
          formType: 'expense', organizationId: profile?.organization_id,
          applicantName: emp?.name || empName, applicantId: emp?.id || rec.employee_id,
          applicantCreatedAt: rec.created_at, recordStatus: rec.status,
          approverName: rec.approved_by, approvedAt: rec.approved_at, rejectReason: rec.reject_reason,
          requestType: 'expense_request', requestId: rec.id, currentStep: rec.current_step, sourceTable: 'expense_requests',
        })
        steps = await mergeStepSignTimes('expense', rec.id, steps)
        setDetail(d => (d && d.r?.id === rec.id && d.r?.source === table) ? { ...d, chainSteps: steps } : d)
      } catch {
        setDetail(d => (d && d.r?.id === rec.id) ? { ...d, chainSteps: [] } : d)
      }
    } else {
      const done = String(rec.status).includes('核') && !String(rec.status).includes('駁') && !String(rec.status).includes('退')
      setDetail(d => (d && d.r?.id === rec.id) ? { ...d, chainSteps: [
        { label: '申請', name: empName, status: 'approved', at: rec.created_at },
        { label: '審核', name: rec.approver || rec.approved_by || '', status: String(rec.status).includes('駁') || String(rec.status).includes('退') ? 'rejected' : (done ? 'approved' : 'pending') },
      ] } : d)
    }
  }

  return (
    <div className="fade-in" style={{ padding: 16 }}>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div className="page-header-row"><h2><span className="header-icon">💰</span> 費用查詢</h2></div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 類型側欄 */}
        <div style={{ width: 180, flexShrink: 0, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10, padding: 8 }}>
          {TYPES.map(t => (
            <button key={t.k || 'all'} onClick={() => setTypeK(t.k)}
              style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: typeK === t.k ? 'var(--accent-cyan-dim)' : 'transparent',
                color: typeK === t.k ? 'var(--accent-cyan)' : 'var(--text-primary)',
                fontWeight: typeK === t.k ? 700 : 500, fontSize: 13.5, marginBottom: 2 }}>
              {t.l}
            </button>
          ))}
        </div>

        {/* 主區 */}
        <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12 }}>
          {/* 篩選列 */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--border-medium)' }}>
            <select className="form-input" style={{ fontSize: 13, width: 120 }} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || '不限狀態'}</option>)}
            </select>
            <input className="form-input" type="date" style={{ fontSize: 13, width: 140 }} value={from} onChange={e => setFrom(e.target.value)} />
            <span style={{ color: 'var(--text-muted)' }}>—</span>
            <input className="form-input" type="date" style={{ fontSize: 13, width: 140 }} value={to} onChange={e => setTo(e.target.value)} />
            <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" placeholder="申請人 / 單號 / 事由" style={{ paddingLeft: 32, fontSize: 13, width: '100%' }}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {isAdmin && selected.size > 0 ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                <span style={{ fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 600 }}>已選 {selected.size} 張</span>
                <button disabled={acting} onClick={handleForceApprove}
                  style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: 'var(--accent-green)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>✅ 強制通過 ({selected.size})</button>
                <button disabled={acting} onClick={handleWithdraw}
                  style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-red)', background: 'transparent', border: '1px solid var(--accent-red)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>↩ 抽單 ({selected.size})</button>
              </div>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                共 {total} 筆 · 合計 <strong style={{ color: 'var(--accent-cyan)' }}>{money(sumAmount)}</strong>
              </span>
            )}
          </div>

          {/* 表格 */}
          <div style={{ maxHeight: '62vh', overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {isAdmin && (
                    <th style={{ padding: '10px 14px', width: 32 }}>
                      <input type="checkbox"
                        checked={pageRows.length > 0 && pageRows.every(r => selected.has(rowKey(r)))}
                        onChange={e => setSelected(e.target.checked ? new Set(pageRows.map(rowKey)) : new Set())} />
                    </th>
                  )}
                  {['單號', '申請人', '部門', '類型', '金額', '狀態', '申請日期'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === '金額' ? 'right' : 'left', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</td></tr>
                ) : pageRows.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>查無符合的費用單</td></tr>
                ) : pageRows.map(r => {
                  const ss = STATUS_STYLE(r.status)
                  return (
                    <tr key={r.source + '-' + r.id} onClick={() => openDetail(r)}
                      style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', background: selected.has(rowKey(r)) ? 'var(--accent-cyan-dim)' : 'transparent' }}>
                      {isAdmin && (
                        <td style={{ padding: '9px 14px' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(rowKey(r))} onChange={() => toggleSel(r)} />
                        </td>
                      )}
                      <td style={{ padding: '9px 14px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>#{r.id}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 600 }}>{r.applicant || '—'}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{r.department || '—'}</td>
                      <td style={{ padding: '9px 14px' }}>{r.typeLabel}</td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{money(r.amount)}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: ss.bg, color: ss.c, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span>
                      </td>
                      <td style={{ padding: '9px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{(r.created_at || '').slice(0, 10)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 分頁 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid var(--border-medium)', fontSize: 13 }}>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ padding: '4px 10px' }}>‹</button>
            <span>{page} / {totalPages}</span>
            <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{ padding: '4px 10px' }}>›</button>
          </div>
        </div>
      </div>

      {detail && (
        <ApprovalDetailModal
          open={!!detail}
          onClose={() => setDetail(null)}
          docTitle={detail.r.typeLabel}
          docNo={detail.r.id}
          status={detail.r._raw.status}
          applicant={{
            name: detail.emp?.name || detail.r._raw.employee || detail.r.applicant,
            name_en: detail.emp?.name_en, position: detail.emp?.position, dept: detail.emp?.dept,
            status: detail.emp?.status,
            employee_no: detail.emp?.employee_number || (detail.r._raw.employee_id ? `ID ${detail.r._raw.employee_id}` : undefined),
            avatar_url: detail.emp?.avatar_url,
          }}
          fields={buildFields(detail.r)}
          attachments={(detail.r._raw.attachments || []).map(url => ({ url, name: decodeURIComponent(String(url).split('?')[0].split('/').pop() || '附件') }))}
          createdAt={detail.r._raw.created_at}
          chainSteps={detail.chainSteps == null ? [{ label: '載入中…', name: '', status: 'pending' }] : detail.chainSteps}
          requestType={detail.r.source === 'expense_requests' ? 'expense' : 'reimburse'}
          requestId={detail.r.id}
        />
      )}
    </div>
  )
}
