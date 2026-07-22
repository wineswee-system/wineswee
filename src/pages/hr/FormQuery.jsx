import { useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// form_type → 實表名（抽單 soft_delete_request 用）
const TYPE_TABLE = {
  leave: 'leave_requests', overtime: 'overtime_requests', trip: 'business_trips',
  correction: 'clock_corrections', resignation: 'resignation_requests',
  loa: 'leave_of_absence_requests', transfer: 'personnel_transfer_requests', headcount: 'headcount_requests',
}

// 分類 → 子類型（對齊 v_hr_forms_unified 的 category / form_type）
const CATEGORIES = [
  { key: '', label: '全部', types: [] },
  { key: '假勤', label: '假勤類', types: [
    { k: 'leave', l: '請假' }, { k: 'overtime', l: '加班' },
    { k: 'trip', l: '出差' }, { k: 'correction', l: '補打卡' },
  ] },
  { key: '異動', label: '異動類', types: [
    { k: 'resignation', l: '離職' }, { k: 'loa', l: '留停' },
    { k: 'transfer', l: '人事異動' }, { k: 'headcount', l: '人力需求' },
  ] },
]

const STATUS_OPTIONS = ['', '待審核', '簽核中', '申請中', '已核准', '簽核完成', '已駁回', '已退回']

const STATUS_STYLE = (st) => {
  if (['已核准', '簽核完成'].includes(st)) return { bg: 'var(--accent-green-dim)', c: 'var(--accent-green)' }
  if (['已駁回', '已退回', '已拒絕'].includes(st)) return { bg: 'var(--accent-red-dim)', c: 'var(--accent-red)' }
  return { bg: 'var(--accent-orange-dim)', c: 'var(--accent-orange)' }  // 待審核/簽核中/申請中
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

export default function FormQuery() {
  const { profile } = useAuth()
  const [category, setCategory] = useState('')
  const [formType, setFormType] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [size] = useState(100)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())  // "type-id"
  const [acting, setActing] = useState(false)
  const isAdmin = ['admin', 'super_admin'].includes(profile?.role)

  const rowKey = (r) => r.form_type + '-' + r.id
  const toggleSel = (r) => setSelected(prev => { const n = new Set(prev); const k = rowKey(r); n.has(k) ? n.delete(k) : n.add(k); return n })
  const selectedRows = () => data.rows.filter(r => selected.has(rowKey(r)))

  const handleForceApprove = async () => {
    const rows = selectedRows()
    if (!rows.length) return
    const reason = window.prompt(`強制通過 ${rows.length} 張表單。\n這會直接核准並觸發後續（離職→離職、加班→計薪…），且記錄稽核。\n\n請填強制通過原因：`)
    if (!reason || !reason.trim()) return
    setActing(true)
    let ok = 0, fail = 0
    for (const r of rows) {
      const { data: res, error } = await supabase.rpc('force_approve_request', { p_type: r.form_type, p_id: r.id, p_reason: reason.trim() })
      if (error || !res?.ok) fail++; else ok++
    }
    setActing(false); setSelected(new Set())
    if (fail) toast.error(`強制通過完成：成功 ${ok}、失敗 ${fail}`)
    else toast.success(`已強制通過 ${ok} 張`)
    load()
  }

  const handleWithdraw = async () => {
    const rows = selectedRows()
    if (!rows.length) return
    if (!(await confirm({ message: `確定抽單（撤回）這 ${rows.length} 張表單？撤回後不再進行簽核。`, danger: true }))) return
    setActing(true)
    let ok = 0, fail = 0
    for (const r of rows) {
      const { error } = await supabase.rpc('soft_delete_request', { p_table: TYPE_TABLE[r.form_type], p_id: r.id, p_deleted_by: profile?.id ?? null })
      if (error) fail++; else ok++
    }
    setActing(false); setSelected(new Set())
    if (fail) toast.error(`抽單完成：成功 ${ok}、失敗 ${fail}`)
    else toast.success(`已抽單 ${ok} 張`)
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error } = await supabase.rpc('list_hr_forms', {
      p_status: status || null,
      p_from: from || null,
      p_to: to || null,
      p_search: search || null,
      p_category: category || null,
      p_form_type: formType || null,
      p_page: page,
      p_size: size,
    })
    if (error) { setData({ rows: [], total: 0 }) }
    else setData({ rows: res?.rows || [], total: res?.total || 0 })
    setLoading(false)
  }, [status, from, to, search, category, formType, page, size, profile?.organization_id])

  useEffect(() => { load() }, [load])
  // 篩選改變時回第 1 頁 + 清選取
  useEffect(() => { setPage(1); setSelected(new Set()) }, [status, from, to, search, category, formType])

  const totalPages = Math.max(1, Math.ceil(data.total / size))

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: 'calc((100vh - var(--topnav-height)) / var(--app-font-scale, 1))', overflow: 'hidden' }}>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div className="page-header-row">
          <h2><span className="header-icon">📋</span> 表單查詢</h2>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 12, overflow: 'hidden', minHeight: 0 }}>
        {/* 分類側欄 */}
        <div style={{ width: 180, flexShrink: 0, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10, padding: 8 }}>
          {CATEGORIES.map(cat => (
            <div key={cat.key || 'all'}>
              <button onClick={() => { setCategory(cat.key); setFormType('') }}
                style={{ width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: category === cat.key && !formType ? 'var(--accent-cyan-dim)' : 'transparent',
                  color: category === cat.key && !formType ? 'var(--accent-cyan)' : 'var(--text-primary)',
                  fontWeight: category === cat.key && !formType ? 700 : 500, fontSize: 14 }}>
                {cat.label}
              </button>
              {cat.types.map(t => (
                <button key={t.k} onClick={() => { setCategory(cat.key); setFormType(t.k) }}
                  style={{ width: '100%', textAlign: 'left', padding: '6px 12px 6px 28px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: formType === t.k ? 'var(--accent-cyan-dim)' : 'transparent',
                    color: formType === t.k ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    fontWeight: formType === t.k ? 700 : 400, fontSize: 13 }}>
                  {t.l}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* 主區 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12 }}>
          {/* 篩選列 */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--border-medium)', flexShrink: 0 }}>
            <select className="form-input" style={{ fontSize: 13, width: 120 }} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || '不限狀態'}</option>)}
            </select>
            <input className="form-input" type="date" style={{ fontSize: 13, width: 140 }} value={from} onChange={e => setFrom(e.target.value)} />
            <span style={{ color: 'var(--text-muted)' }}>—</span>
            <input className="form-input" type="date" style={{ fontSize: 13, width: 140 }} value={to} onChange={e => setTo(e.target.value)} />
            <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" placeholder="中英姓名 / 單號" style={{ paddingLeft: 32, fontSize: 13, width: '100%' }}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {isAdmin && selected.size > 0 ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                <span style={{ fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 600 }}>已選 {selected.size} 張</span>
                <button disabled={acting} onClick={handleForceApprove}
                  style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: 'var(--accent-green)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                  ✅ 強制通過 ({selected.size})
                </button>
                <button disabled={acting} onClick={handleWithdraw}
                  style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-red)', background: 'transparent', border: '1px solid var(--accent-red)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                  ↩ 抽單 ({selected.size})
                </button>
              </div>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>共 {data.total} 筆</span>
            )}
          </div>

          {/* 表格 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {isAdmin && (
                    <th style={{ padding: '10px 14px', width: 32 }}>
                      <input type="checkbox"
                        checked={data.rows.length > 0 && data.rows.every(r => selected.has(rowKey(r)))}
                        onChange={e => setSelected(e.target.checked ? new Set(data.rows.map(rowKey)) : new Set())} />
                    </th>
                  )}
                  {['表單編號', '申請人', '部門', '表單', '摘要資訊', '狀態', '申請日期'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</td></tr>
                ) : data.rows.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>查無符合的表單</td></tr>
                ) : data.rows.map(r => {
                  const ss = STATUS_STYLE(r.status)
                  return (
                    <tr key={r.form_type + '-' + r.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: selected.has(rowKey(r)) ? 'var(--accent-cyan-dim)' : 'transparent' }}>
                      {isAdmin && (
                        <td style={{ padding: '9px 14px' }}>
                          <input type="checkbox" checked={selected.has(rowKey(r))} onChange={() => toggleSel(r)} />
                        </td>
                      )}
                      <td style={{ padding: '9px 14px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{r.form_no}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 600 }}>{r.applicant}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{r.dept || '—'}</td>
                      <td style={{ padding: '9px 14px' }}>{r.form_label}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{r.summary}</td>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid var(--border-medium)', flexShrink: 0, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>共 {data.total} 筆 · {totalPages} 頁</span>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ padding: '4px 10px' }}>‹</button>
            <span>{page} / {totalPages}</span>
            <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{ padding: '4px 10px' }}>›</button>
          </div>
        </div>
      </div>
    </div>
  )
}
