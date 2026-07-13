import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Trash2, Upload, CloudRain, MapPin, Users, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const TYPE_OPTS = ['颱風', '地震', '水災', '其他']
const NO_SHOW = {
  paid:         { label: '照給薪（不扣）', color: 'var(--accent-green)' },
  annual_leave: { label: '扣特休',        color: 'var(--accent-blue)' },
  unpaid:       { label: '不支薪',        color: 'var(--accent-orange)' },
}
const parseHrsMoney = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}
// Excel 日期序號 / 字串 → YYYY-MM-DD
const normDate = (v) => {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim().replace(/\//g, '-')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

export default function DisasterManagement() {
  const { profile, hasPermission } = useAuth()
  const orgId = profile?.organization_id
  const canManage = hasPermission('hr_form.delete_all') || hasPermission('salary.edit') // admin 類

  const [loading, setLoading] = useState(true)
  const [disasters, setDisasters] = useState([])
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState(null)      // 選中的天災日
  const [allowances, setAllowances] = useState([])    // 選中日的津貼
  const [attendance, setAttendance] = useState([])    // 選中日出勤名單

  // 宣告 modal
  const [showDecl, setShowDecl] = useState(false)
  const EMPTY_FORM = { disaster_type: '颱風', start_date: '', start_time: '00:00', end_date: '', end_time: '23:59', store_ids: [], no_show_handling: 'paid', note: '' }
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // 匯入
  const [preview, setPreview] = useState(null)        // { rows:[{no,name,date,amount,employee_id,matched}], fileName }
  const [importing, setImporting] = useState(false)

  // 沒來結算
  const [noShowChecked, setNoShowChecked] = useState(new Set())
  const [settling, setSettling] = useState(false)

  const load = async () => {
    if (!orgId) return
    setLoading(true)
    const [dRes, sRes, eRes] = await Promise.all([
      supabase.from('disaster_days').select('*').eq('organization_id', orgId).order('date', { ascending: false }),
      supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
      supabase.from('employees').select('id, name, employee_number, store_id, store').eq('organization_id', orgId).eq('status', '在職'),
    ])
    setDisasters(dRes.data || [])
    setStores(sRes.data || [])
    setEmployees(eRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])  // eslint-disable-line react-hooks/exhaustive-deps

  const empByNo = useMemo(() => {
    const m = new Map()
    for (const e of employees) if (e.employee_number) m.set(String(e.employee_number).trim(), e)
    return m
  }, [employees])
  const storeName = (id) => stores.find(s => s.id === id)?.name || `#${id}`

  // 宣告 row → 起訖日（fallback 單一 date，向下相容舊 row）
  const dRange = (d) => ({
    start: d?.start_at ? d.start_at.slice(0, 10) : d?.date,
    end:   d?.end_at ? d.end_at.slice(0, 10) : d?.date,
  })
  // 顯示區間文字：YYYY-MM-DD HH:mm ~ …（同一天只顯示結束時間）
  const fmtRange = (d) => {
    if (!d?.start_at) return d?.date || ''
    const s = d.start_at.slice(0, 16).replace('T', ' ')
    if (!d.end_at) return s
    return d.end_at.slice(0, 10) === d.start_at.slice(0, 10)
      ? `${s} ~ ${d.end_at.slice(11, 16)}`
      : `${s} ~ ${d.end_at.slice(0, 16).replace('T', ' ')}`
  }

  // 沒來名單：範圍內（門市/全部）當天沒打卡的人
  const noShowList = useMemo(() => {
    if (!selected) return []
    const inScope = selected.store_ids?.length
      ? employees.filter(e => selected.store_ids.includes(e.store_id))
      : employees
    const clockedIds = new Set(attendance.map(a => a.employee_id))
    const clockedNames = new Set(attendance.map(a => a.employee))
    return inScope.filter(e => !clockedIds.has(e.id) && !clockedNames.has(e.name))
  }, [selected, employees, attendance])
  useEffect(() => { setNoShowChecked(new Set(noShowList.map(e => e.id))) }, [noShowList])

  const settleNoShows = async () => {
    const ids = [...noShowChecked]
    if (!ids.length) return toast.warning('沒有勾選要結算的人')
    setSettling(true)
    const { data, error } = await supabase.rpc('disaster_settle_no_shows', { p_disaster_id: selected.id, p_employee_ids: ids })
    setSettling(false)
    if (error) return toast.error('結算失敗：' + error.message)
    if (!data?.ok) return toast.error('結算失敗：' + (data?.error || ''))
    toast.success(`已為 ${data.created} 人產生「${data.leave_type}」假單`)
  }

  // 選中天災日 → 載津貼 + 出勤
  const selectDisaster = async (d) => {
    setSelected(d)
    setPreview(null)
    const { start, end } = dRange(d)
    const [aRes, attRes] = await Promise.all([
      supabase.from('disaster_allowances').select('*').eq('organization_id', orgId).gte('date', start).lte('date', end),
      supabase.from('attendance_records').select('employee, employee_id, clock_in, clock_out, store, total_hours, date')
        .gte('date', start).lte('date', end).not('clock_in', 'is', null),
    ])
    setAllowances(aRes.data || [])
    // 若宣告限門市，出勤只留那幾家
    let att = attRes.data || []
    if (d.store_ids?.length) {
      const names = d.store_ids.map(storeName)
      att = att.filter(a => names.includes(a.store))
    }
    setAttendance(att)
  }

  // ── 宣告 ──
  const submitDecl = async () => {
    if (!form.start_date) { toast.warning('請選開始日期'); return false }
    const startDate = form.start_date
    const startTime = form.start_time || '00:00'
    const endDate   = form.end_date || startDate
    const endTime   = form.end_time || '23:59'
    const start_at = `${startDate}T${startTime}:00`
    const end_at   = `${endDate}T${endTime}:00`
    if (end_at < start_at) { toast.warning('結束時間不能早於開始時間'); return false }  // ISO 字串可直接比大小
    setSaving(true)
    const { data, error } = await supabase.from('disaster_days').insert({
      organization_id: orgId,
      disaster_type: form.disaster_type,
      date: startDate,              // 主日=開始日（向下相容：allowances/attendance 主鍵、顯示 fallback）
      start_at,
      end_at,
      store_ids: form.store_ids.length ? form.store_ids : null,
      no_show_handling: form.no_show_handling,
      note: form.note || null,
      created_by: profile?.id || null,
    }).select().single()
    setSaving(false)
    if (error) { toast.error('宣告失敗：' + error.message); return false }
    setDisasters(prev => [data, ...prev])
    setShowDecl(false)
    setForm(EMPTY_FORM)
    toast.success('已宣告天災')
  }

  const deleteDecl = async (d) => {
    if (!(await confirm({ message: `刪除 ${fmtRange(d)} ${d.disaster_type} 宣告？（該區間津貼不會自動刪）` }))) return
    const { error } = await supabase.from('disaster_days').delete().eq('id', d.id)
    if (error) return toast.error('刪除失敗：' + error.message)
    setDisasters(prev => prev.filter(x => x.id !== d.id))
    if (selected?.id === d.id) setSelected(null)
    toast.success('已刪除')
  }

  // ── 津貼匯入 ──
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selected) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      const hi = rows.findIndex(r => r.some(c => String(c).includes('員工編號')))
      if (hi < 0) return toast.error('找不到「員工編號」表頭列')
      const H = rows[hi].map(c => String(c).trim())
      const col = (...names) => H.findIndex(h => names.some(n => h.includes(n)))
      const cNo = col('員工編號'), cAmt = col('津貼', '金額'), cDate = col('日期'), cName = col('姓名')
      if (cNo < 0 || cAmt < 0) return toast.error('需要「員工編號」與「津貼金額」欄')
      const parsed = rows.slice(hi + 1)
        .filter(r => String(r[cNo] || '').trim())
        .map(r => {
          const no = String(r[cNo]).trim()
          const emp = empByNo.get(no)
          return {
            no, name: emp?.name || (cName >= 0 ? String(r[cName] || '') : ''),
            date: (cDate >= 0 ? normDate(r[cDate]) : null) || selected.date,
            amount: parseHrsMoney(r[cAmt]),
            employee_id: emp?.id || null, matched: !!emp,
          }
        })
      setPreview({ rows: parsed, fileName: file.name })
    } catch (err) {
      toast.error('讀檔失敗：' + err.message)
    }
  }

  const doImport = async () => {
    if (!preview) return
    const valid = preview.rows.filter(r => r.matched && r.amount > 0)
    if (!valid.length) return toast.warning('沒有可匯入的有效資料（對不到員工或金額為 0）')
    setImporting(true)
    const payload = valid.map(r => ({
      organization_id: orgId, employee_id: r.employee_id, date: r.date,
      amount: r.amount, source: 'import', imported_by: profile?.id || null,
    }))
    const { error } = await supabase.from('disaster_allowances')
      .upsert(payload, { onConflict: 'employee_id,date' })
    setImporting(false)
    if (error) return toast.error('匯入失敗：' + error.message)
    toast.success(`已匯入 ${valid.length} 筆津貼（重複同員工同日已覆蓋）`)
    setPreview(null)
    selectDisaster(selected)
  }

  if (loading) return <LoadingSpinner />

  const totalAllowance = allowances.reduce((s, a) => s + Number(a.amount || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><CloudRain size={20} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--accent-cyan)' }} />天災管理</h2>
            <p>宣告天災停班日、匯入天災津貼、查看當日出勤</p>
          </div>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setShowDecl(true)}><Plus size={14} /> 新增天災宣告</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
        {/* 左：宣告清單 */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>天災宣告</div>
          {disasters.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>尚無宣告</div>}
          {disasters.map(d => (
            <div key={d.id} onClick={() => selectDisaster(d)}
              style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                border: `1px solid ${selected?.id === d.id ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                background: selected?.id === d.id ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{fmtRange(d)}</span>
                <span className="badge badge-info" style={{ flexShrink: 0 }}>{d.disaster_type}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={10} />{d.store_ids?.length ? d.store_ids.map(storeName).join('、') : '全公司'}
              </div>
              <div style={{ fontSize: 11, marginTop: 3, color: NO_SHOW[d.no_show_handling]?.color }}>
                沒來：{NO_SHOW[d.no_show_handling]?.label}
              </div>
              {canManage && (
                <button onClick={(e) => { e.stopPropagation(); deleteDecl(d) }}
                  style={{ marginTop: 4, background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Trash2 size={11} /> 刪除
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 右：明細 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!selected ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>← 選一個天災日查看津貼與出勤</div>
          ) : (
            <>
              {/* 津貼匯入 */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 700 }}><FileSpreadsheet size={15} style={{ verticalAlign: -2, marginRight: 5, color: 'var(--accent-green)' }} />天災津貼 — {fmtRange(selected)}</div>
                  {canManage && (
                    <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: 13 }}>
                      <Upload size={14} /> 匯入 Excel
                      <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={onFile} />
                    </label>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  欄位：員工編號 / 姓名 / 日期（可略，預設本日）/ 津貼金額。靠員工編號對應、同員工同日重匯覆蓋。
                </div>

                {preview ? (
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 6 }}>
                      預覽 <b>{preview.fileName}</b>：{preview.rows.length} 列，
                      對到 <b style={{ color: 'var(--accent-green)' }}>{preview.rows.filter(r => r.matched).length}</b>、
                      對不到 <b style={{ color: 'var(--accent-red)' }}>{preview.rows.filter(r => !r.matched).length}</b>
                    </div>
                    <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                      {preview.rows.map((r, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 70px', gap: 8, padding: '4px 10px', fontSize: 12, borderBottom: '1px solid var(--border-subtle)', color: r.matched ? undefined : 'var(--accent-red)' }}>
                          <span style={{ fontFamily: 'monospace' }}>{r.no}</span>
                          <span>{r.name || (r.matched ? '' : '⚠ 查無此編號')}</span>
                          <span>{r.date}</span>
                          <span style={{ textAlign: 'right', fontWeight: 600 }}>${r.amount}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button className="btn btn-primary" disabled={importing} onClick={doImport}>
                        {importing ? '匯入中…' : `確認匯入 ${preview.rows.filter(r => r.matched && r.amount > 0).length} 筆`}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setPreview(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: 8, fontSize: 13 }}>
                      目前 <b>{allowances.length}</b> 人有津貼，合計 <b style={{ color: 'var(--accent-green)' }}>NT$ {totalAllowance.toLocaleString()}</b>
                    </div>
                    {allowances.length > 0 && (
                      <div style={{ maxHeight: 200, overflow: 'auto' }}>
                        {allowances.map(a => {
                          const e = employees.find(x => x.id === a.employee_id)
                          return (
                            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                              <span>{e?.name || `#${a.employee_id}`} <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{e?.employee_number || ''}</span></span>
                              <span style={{ fontWeight: 600 }}>NT$ {Number(a.amount).toLocaleString()}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 當日出勤名單 */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}><Users size={15} style={{ verticalAlign: -2, marginRight: 5, color: 'var(--accent-orange)' }} />區間出勤（有打卡） — {attendance.length} 人</div>
                {attendance.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>當日無人打卡</div>
                ) : (
                  <div style={{ maxHeight: 260, overflow: 'auto' }}>
                    {attendance.map((a, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 60px', gap: 8, padding: '5px 8px', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                        <span><b>{a.employee}</b> <span style={{ color: 'var(--text-muted)' }}>{a.store || ''}</span></span>
                        <span>{a.clock_in || '-'}</span>
                        <span>{a.clock_out || '-'}</span>
                        <span style={{ textAlign: 'right' }}>{a.total_hours ? `${a.total_hours}h` : '-'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 沒來人員結算 */}
              {selected.no_show_handling !== 'paid' && (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700 }}>沒來人員結算 — 產生「{selected.no_show_handling === 'annual_leave' ? '特休' : '無薪假'}」假單</div>
                    {canManage && noShowList.length > 0 && (
                      <button className="btn btn-primary" disabled={settling} onClick={settleNoShows}>
                        {settling ? '結算中…' : `結算 ${noShowChecked.size} 人`}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    範圍內整段期間都沒打卡的人；勾選要結算的，會為<b>區間內每一天</b>各產一張已核准假單（{selected.no_show_handling === 'annual_leave' ? '扣特休、薪照給' : '不支薪、計薪自動扣'}）。重複結算不會重建。
                  </div>
                  {noShowList.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>範圍內全部都有打卡 🎉</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                      {noShowList.map(e => {
                        const on = noShowChecked.has(e.id)
                        return (
                          <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                            background: on ? 'var(--accent-orange-dim)' : 'var(--bg-secondary)', border: `1px solid ${on ? 'var(--accent-orange)' : 'var(--border-subtle)'}` }}>
                            <input type="checkbox" checked={on} onChange={() => setNoShowChecked(prev => { const n = new Set(prev); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n })} />
                            {e.name}<span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{e.employee_number || ''}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 宣告 modal */}
      {showDecl && (
        <Modal title="新增天災宣告" onClose={() => setShowDecl(false)} onSubmit={submitDecl} submitting={saving}>
          <Field label="類型">
            <select className="form-input" style={{ width: '100%' }} value={form.disaster_type} onChange={e => setForm(f => ({ ...f, disaster_type: e.target.value }))}>
              {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="開始日期" required>
              <input type="date" className="form-input" style={{ width: '100%' }} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </Field>
            <Field label="開始時間" required>
              <input type="time" className="form-input" style={{ width: '100%' }} value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </Field>
            <Field label="結束日期" required>
              <input type="date" className="form-input" style={{ width: '100%' }} value={form.end_date} min={form.start_date || undefined} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </Field>
            <Field label="結束時間" required>
              <input type="time" className="form-input" style={{ width: '100%' }} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </Field>
          </div>
          <Field label="沒來上班的處理（套用該日全員）">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(NO_SHOW).map(([k, v]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${form.no_show_handling === k ? v.color : 'var(--border-subtle)'}`,
                  background: form.no_show_handling === k ? 'var(--bg-tertiary)' : 'transparent', color: v.color, fontSize: 13 }}>
                  <input type="radio" name="noshow" checked={form.no_show_handling === k} onChange={() => setForm(f => ({ ...f, no_show_handling: k }))} />
                  {v.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="適用門市（不選 = 全公司）">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflow: 'auto' }}>
              {stores.map(s => {
                const on = form.store_ids.includes(s.id)
                return (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    background: on ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)', border: `1px solid ${on ? 'var(--accent-cyan)' : 'var(--border-subtle)'}` }}>
                    <input type="checkbox" checked={on} onChange={() => setForm(f => ({ ...f, store_ids: on ? f.store_ids.filter(x => x !== s.id) : [...f.store_ids, s.id] }))} />
                    {s.name}
                  </label>
                )
              })}
            </div>
          </Field>
          <Field label="備註">
            <input className="form-input" style={{ width: '100%' }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="選填" />
          </Field>
        </Modal>
      )}
    </div>
  )
}
