import { useState, useEffect } from 'react'
import { ShieldCheck, AlertTriangle, RefreshCw, Users, Store as StoreIcon, Plus, X as XIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'

// 門市權責總表(唯讀):每間店誰能看/能排/能稽核 + 缺口。資料由 DEFINER RPC 一次算好。
// 階段二會在此加「開關」直接指派(寫 user_stores)。
export default function StoreResponsibility() {
  const [data, setData] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addRow, setAddRow] = useState(null)   // 正在加人的 store_id
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true); setError(null)
    const [ovRes, empRes] = await Promise.all([
      supabase.rpc('get_store_responsibility_overview'),
      supabase.rpc('list_org_active_employees'),
    ])
    const res = ovRes.data
    if (ovRes.error) { setError(ovRes.error.message); setLoading(false); return }
    if (!res?.ok) { setError(res?.error === 'NOT_ALLOWED' ? '只有管理員可檢視門市權責' : (res?.error || '載入失敗')); setLoading(false); return }
    setData(res); setEmployees(empRes.data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // 開關:加/移除某人對某店的額外存取(寫 user_stores)
  const setAccess = async (empId, storeId, grant) => {
    setBusy(true)
    const { data: res, error: err } = await supabase.rpc('set_store_extra_access', {
      p_employee_id: Number(empId), p_store_id: Number(storeId), p_grant: grant,
    })
    setBusy(false)
    if (err || !res?.ok) { toast.error('操作失敗：' + (err?.message || res?.error || '未知')); return }
    toast.success(grant ? '已加入' : '已移除')
    setAddRow(null)
    load()
  }

  if (loading) return <LoadingSpinner />

  const stores = data?.stores || []
  const allPeople = data?.all_store_people || []
  const gapCount = stores.filter(s => (s.gaps || []).length > 0).length

  const Chip = ({ children, tone = 'muted' }) => {
    const map = {
      muted:  { bg: 'var(--bg-secondary)',      fg: 'var(--text-secondary)' },
      cyan:   { bg: 'var(--accent-cyan-dim)',   fg: 'var(--accent-cyan)' },
      green:  { bg: 'var(--accent-green-dim)',  fg: 'var(--accent-green)' },
      red:    { bg: 'var(--accent-red-dim)',    fg: 'var(--accent-red)' },
      orange: { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' },
      purple: { bg: 'var(--accent-purple-dim)', fg: 'var(--accent-purple)' },
    }[tone]
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: map.bg, color: map.fg, whiteSpace: 'nowrap' }}>
        {children}
      </span>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><ShieldCheck size={20} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--accent-cyan)' }} />門市權責總表</h2>
            <p>每間門市誰能檢視 / 排班 / 稽核 —— 店負責人、區督導、額外指派 + 缺口一覽。可直接「加人／移除」指派額外存取</p>
          </div>
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新整理</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 16, color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!error && (
        <>
          {/* 全店權限者 */}
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <Users size={15} /> 全店權限者（下面每一間都能看＋能排）· {allPeople.length} 人
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allPeople.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
              {allPeople.map(p => (
                <Chip key={p.id} tone={p.role === 'super_admin' ? 'purple' : p.role === 'admin' ? 'cyan' : 'green'}>
                  {p.name}<span style={{ fontWeight: 400, opacity: 0.75 }}>· {p.reason}</span>
                </Chip>
              ))}
            </div>
          </div>

          {/* 缺口提示 */}
          {gapCount > 0 && (
            <div className="card" style={{ padding: '10px 16px', marginBottom: 16, background: 'var(--accent-orange-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} style={{ color: 'var(--accent-orange)' }} />
              <span style={{ fontSize: 13, color: 'var(--accent-orange)', fontWeight: 600 }}>{gapCount} 間門市有權責缺口（見下方紅字）</span>
            </div>
          )}

          {/* 門市表 */}
          <div className="card">
            <div className="data-table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr>
                  <th style={{ minWidth: 110 }}>門市</th>
                  <th style={{ minWidth: 90 }}>店負責人</th>
                  <th style={{ minWidth: 80 }}>區督導</th>
                  <th style={{ minWidth: 160 }}>額外可存取</th>
                  <th style={{ minWidth: 120 }}>缺口</th>
                </tr></thead>
                <tbody>
                  {stores.map(s => {
                    const gaps = s.gaps || []
                    const inactive = !s.is_active
                    return (
                      <tr key={s.store_id} style={{ opacity: inactive ? 0.5 : 1 }}>
                        <td style={{ fontWeight: 600 }}>
                          <StoreIcon size={12} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--text-muted)' }} />
                          {s.store_name}
                          {inactive && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>(停用)</span>}
                          {s.section_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 16 }}>{s.section_name}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {s.manager
                            ? <span>{s.manager.name}{!s.manager.can_schedule && <span style={{ color: 'var(--accent-red)', fontSize: 11 }}> ⚠無排班權</span>}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>{s.supervisor?.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                        <td style={{ fontSize: 12 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            {(s.extra || []).map(e => (
                              <span key={e.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 4px 2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                {e.name}{!e.can_schedule && <span style={{ opacity: 0.6, fontWeight: 400 }}>(僅看)</span>}
                                <button onClick={() => setAccess(e.id, s.store_id, false)} disabled={busy} title="移除存取"
                                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0, display: 'flex', lineHeight: 1 }}>
                                  <XIcon size={12} />
                                </button>
                              </span>
                            ))}
                            {addRow === s.store_id ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ minWidth: 190 }}>
                                  <SearchableSelect value="" onChange={v => v && setAccess(v, s.store_id, true)}
                                    options={empOptions(employees.filter(emp => {
                                      const ex = new Set([s.manager?.id, s.supervisor?.id, ...(s.extra || []).map(x => x.id)].filter(Boolean))
                                      return !ex.has(emp.id)
                                    }), { keyBy: 'id' })}
                                    placeholder="搜尋員工加入…" />
                                </div>
                                <button onClick={() => setAddRow(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>取消</button>
                              </span>
                            ) : (
                              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                onClick={() => setAddRow(s.store_id)} disabled={busy}>
                                <Plus size={11} /> 加人
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          {gaps.length === 0
                            ? <Chip tone="green">✓ 完整</Chip>
                            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{gaps.map((g, i) => <Chip key={i} tone="red">{g}</Chip>)}</div>}
                        </td>
                      </tr>
                    )
                  })}
                  {stores.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無門市資料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
            說明：能看/排/稽核某店的人 = 全店權限者 ＋ 該店負責人 ＋ 該區督導 ＋ 額外可存取者。<br />
            「額外可存取」＝個別指派（可用「加人／×」即時開關）；標「僅看」= 該員沒有排班編輯權限（能看班表/稽核,不能排班）。<br />
            指派給有 schedule.edit 的人（店長/督導/儲幹等）→ 立即可看＋可排該店；稽核「已核准」單依同一店範圍可見。
          </div>
        </>
      )}
    </div>
  )
}
