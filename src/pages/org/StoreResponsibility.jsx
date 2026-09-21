import { useState, useEffect } from 'react'
import { ShieldCheck, AlertTriangle, RefreshCw, Users, Store as StoreIcon, X as XIcon, Settings, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { ModalOverlay } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'

// 門市權責總表(唯讀):每間店誰能看/能排/能稽核 + 缺口。資料由 DEFINER RPC 一次算好。
// 階段二會在此加「開關」直接指派(寫 user_stores)。
export default function StoreResponsibility() {
  const [data, setData] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [managingId, setManagingId] = useState(null)  // 開「管理」視窗的 store_id
  const [addEdit, setAddEdit] = useState(false)       // 加人時是否同時給排班編輯權
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])                  // 管理視窗的變更紀錄

  const loadLog = async (storeId) => {
    if (storeId == null) { setLog([]); return }
    const { data: res } = await supabase.rpc('get_store_access_log', { p_store_id: Number(storeId) })
    setLog(res?.ok ? (res.items || []) : [])
  }
  useEffect(() => { loadLog(managingId) }, [managingId]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const setAccess = async (empId, storeId, grant, canEdit = false, reason = null) => {
    setBusy(true)
    const { data: res, error: err } = await supabase.rpc('set_store_extra_access', {
      p_employee_id: Number(empId), p_store_id: Number(storeId), p_grant: grant, p_can_edit: canEdit, p_reason: reason,
    })
    setBusy(false)
    if (err || !res?.ok) { toast.error('操作失敗：' + (err?.message || res?.error || '未知')); return }
    toast.success(grant ? (canEdit ? '已加入（可排班）' : '已加入（僅看）') : '已移除')
    setAddEdit(false)
    load()          // 重載後 managing 由 stores 即時重算,視窗內容自動更新
    loadLog(storeId) // 更新變更紀錄
  }

  if (loading) return <LoadingSpinner />

  const stores = data?.stores || []
  const allPeople = data?.all_store_people || []
  const managing = managingId != null ? stores.find(s => s.store_id === managingId) : null
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
                  <th style={{ minWidth: 130 }}>可排班</th>
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
                          {(s.schedulers || []).length > 0
                            ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {s.schedulers.map((n, i) => <Chip key={i} tone="cyan">{n}</Chip>)}
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>＋全店</span>
                              </div>
                            : (s.is_active
                                ? <Chip tone="red">⚠ 僅全店的人能排</Chip>
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>)}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            {(s.extra || []).map(e => (
                              <Chip key={e.id} tone={e.can_schedule ? 'cyan' : 'muted'}>
                                {e.name}<span style={{ fontWeight: 400, opacity: 0.7 }}>·{e.can_schedule ? '可排' : '僅看'}{e.home_store ? `·本店${e.home_store}` : ''}</span>
                              </Chip>
                            ))}
                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onClick={() => { setManagingId(s.store_id); setAddEdit(false) }} disabled={busy}>
                              <Settings size={11} /> 管理
                            </button>
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
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無門市資料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
            說明：能看/排/稽核某店的人 = 全店權限者 ＋ 該店負責人 ＋ 該區督導 ＋ 額外可存取者。<br />
            點各店「管理」可加人／移除、切換「可看／可排」。「可排」= 給該員排班編輯權（能排這間店＋他本店）；「僅看」= 只能看班表/稽核。
          </div>
        </>
      )}

      {/* 管理視窗:單店的加人/移除/可看↔可排 */}
      {managing && (
        <ModalOverlay onClose={() => setManagingId(null)}>
          <div className="modal-shell modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-shell-header">
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                <Building2 size={16} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--accent-cyan)' }} />
                管理「{managing.store_name}」存取
              </h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setManagingId(null)}><XIcon size={20} /></button>
            </div>

            <div className="modal-shell-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 固定角色(唯讀提示) */}
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <div>店負責人：<b>{managing.manager?.name || '未指派'}</b>{managing.manager && !managing.manager.can_schedule && <span style={{ color: 'var(--accent-red)' }}> ⚠ 無排班權</span>}</div>
                <div>區督導：<b>{managing.supervisor?.name || '無'}</b></div>
                <div style={{ color: 'var(--text-muted)' }}>＋ 全店權限者（admin/督導長等 {allPeople.length} 人）本來就能存取</div>
              </div>

              {/* 額外指派的人 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>額外指派</div>
                {(managing.extra || []).length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 4 }}>尚無額外指派的人。</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(managing.extra || []).map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{e.name}{e.home_store && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>本店：{e.home_store}</span>}</span>
                      {e.can_schedule
                        ? <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>可排班</span>
                        : <>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>僅看</span>
                            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 10px', color: 'var(--accent-cyan)' }}
                              onClick={() => setAccess(e.id, managing.store_id, true, true)} disabled={busy}>改為可排</button>
                          </>}
                      <button onClick={() => { const r = window.prompt(`移除「${e.name}」對 ${managing.store_name} 的存取。\n原因（可留空,會記錄）：`); if (r === null) return; setAccess(e.id, managing.store_id, false, false, r) }} disabled={busy} title="移除此人"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', display: 'flex' }}>
                        <XIcon size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 加人 */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>加入新的人</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <SearchableSelect value="" onChange={v => v && setAccess(v, managing.store_id, true, addEdit)}
                    options={empOptions(employees.filter(emp => {
                      const ex = new Set([managing.manager?.id, managing.supervisor?.id, ...(managing.extra || []).map(x => x.id)].filter(Boolean))
                      return !ex.has(emp.id)
                    }), { keyBy: 'id' })}
                    placeholder="搜尋員工姓名/部門/門市…" />
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={addEdit} onChange={e => setAddEdit(e.target.checked)} style={{ accentColor: 'var(--accent-cyan)' }} />
                    給排班編輯權（勾了＝可排班；不勾＝只能看）
                  </label>
                </div>
              </div>
              {/* 變更紀錄 */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>變更紀錄</div>
                {log.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無紀錄（之後在此頁的加人/移除都會留痕）。</div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                      {log.map((l, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{(l.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                          <span><b>{l.actor_name}</b> {l.action} <b>{l.employee_name}</b>{l.reason ? `· ${l.reason}` : ''}</span>
                        </div>
                      ))}
                    </div>}
              </div>
            </div>

            <div className="modal-shell-footer">
              <button className="btn btn-secondary" onClick={() => setManagingId(null)}>關閉</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
