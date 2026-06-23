import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getReservationRules, upsertReservationRule, deleteReservationRule } from '../../lib/db/reservations'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Save, Plus, Trash2, Info } from 'lucide-react'

const DAYS = ['日', '一', '二', '三', '四', '五', '六']
const INTERVALS = [30, 60, 90, 120]

const DEFAULT_RULE = {
  open_time: '10:00', close_time: '22:00',
  slot_interval_minutes: 60, buffer_minutes: 30, end_buffer_minutes: 30,
  min_booking_hours: 1, max_booking_hours: 3,
  min_notice_minutes: 60, max_advance_days: 14, max_party_size: 10,
  is_closed: false, label: '',
}

export default function Rules() {
  const [stores, setStores]     = useState([])
  const [storeId, setStoreId]   = useState('')
  const [orgId, setOrgId]       = useState('')
  const [rules, setRules]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [tab, setTab]           = useState('weekly')
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState({ date_override: '', ...DEFAULT_RULE })
  const [saved, setSaved]       = useState(false)
  // local editable copy for global settings
  const [globalForm, setGlobalForm] = useState(DEFAULT_RULE)

  const weeklyRules  = rules.filter(r => r.date_override == null)
  const specialRules = rules.filter(r => r.date_override != null)
  const defaultRule  = weeklyRules.find(r => r.day_of_week == null) || null
  const dayRules     = Array.from({ length: 7 }, (_, i) => weeklyRules.find(r => r.day_of_week === i) || null)
  const effective    = defaultRule || DEFAULT_RULE

  useEffect(() => {
    supabase.from('stores').select('id,name,organization_id').then(({ data }) => {
      const list = data || []
      setStores(list)
      if (list.length) { setStoreId(list[0].id); setOrgId(list[0].organization_id) }
    })
  }, [])

  const loadRules = () => {
    if (!storeId) return
    setLoading(true)
    getReservationRules(storeId)
      .then(({ data }) => {
        setRules(data || [])
        const def = (data || []).find(r => r.day_of_week == null && r.date_override == null)
        if (def) setGlobalForm({ ...DEFAULT_RULE, ...def })
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadRules() }, [storeId]) // eslint-disable-line

  const upsertDay = async (dayOfWeek, patch) => {
    const existing = dayOfWeek === null ? defaultRule : dayRules[dayOfWeek]
    const base = existing
      ? { ...existing, ...patch }
      : { day_of_week: dayOfWeek, date_override: null, store_id: storeId, organization_id: orgId, ...DEFAULT_RULE, ...patch }
    await upsertReservationRule(base)
    loadRules()
  }

  const saveGlobal = async () => {
    const base = defaultRule
      ? { ...defaultRule, ...globalForm }
      : { day_of_week: null, date_override: null, store_id: storeId, organization_id: orgId, ...globalForm }
    setSaving(true)
    await upsertReservationRule(base)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    loadRules()
  }

  const delRule = async (id) => { await deleteReservationRule(id); loadRules() }

  const addSpecial = async () => {
    if (!addForm.date_override) return
    await upsertReservationRule({ ...addForm, day_of_week: null, store_id: storeId, organization_id: orgId })
    setAddForm({ date_override: '', ...DEFAULT_RULE }); setShowAdd(false); loadRules()
  }

  const inp = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const lbl = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>訂位規則</h1>
        <select value={storeId} onChange={e => { const s = stores.find(x => x.id === e.target.value); setStoreId(e.target.value); setOrgId(s?.organization_id || '') }}
          style={{ ...inp, width: 'auto' }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ display: 'flex', border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          {[{ k: 'weekly', t: '每週規則' }, { k: 'special', t: '特殊日期' }, { k: 'global', t: '全域設定' }].map(({ k, t }) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding: '6px 14px', border: 'none', background: tab === k ? 'var(--accent-cyan)' : 'transparent', color: tab === k ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: tab === k ? 600 : 400 }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── WEEKLY ── */}
      {tab === 'weekly' && (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={13}/> 未個別設定的天數將使用「全域設定」預設值。點擊「重設」可還原
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 10 }}>
              {DAYS.map((d, i) => {
                const r = dayRules[i]
                const isClosed = r ? r.is_closed : false
                return (
                  <div key={i} style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '12px 10px', border: `1px solid ${isClosed ? 'var(--accent-red-dim)' : r ? 'var(--accent-cyan)' : 'var(--border-primary)'}`, opacity: isClosed ? 0.65 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>星期{d}</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)' }}>
                        <input type="checkbox" checked={isClosed} onChange={e => upsertDay(i, { is_closed: e.target.checked })}/> 公休
                      </label>
                    </div>
                    {!isClosed && (
                      <>
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>開始</div>
                          <input type="time" value={r?.open_time || effective.open_time}
                            onChange={e => upsertDay(i, { open_time: e.target.value })}
                            style={{ ...inp, fontSize: 12, padding: '4px 6px' }}/>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>結束</div>
                          <input type="time" value={r?.close_time || effective.close_time}
                            onChange={e => upsertDay(i, { close_time: e.target.value })}
                            style={{ ...inp, fontSize: 12, padding: '4px 6px' }}/>
                        </div>
                        {r && (
                          <button onClick={() => delRule(r.id)} style={{ marginTop: 8, padding: '2px 4px', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}>重設為預設</button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── SPECIAL ── */}
      {tab === 'special' && (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>特殊日期 (優先覆蓋週規則)</span>
            <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              <Plus size={12}/> 新增特殊日
            </button>
          </div>
          {specialRules.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚無特殊日期設定</div>}
          {specialRules.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                  {r.date_override}
                  {r.label && <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: 'var(--accent-orange)' }}>{r.label}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {r.is_closed ? '公休' : `${r.open_time?.slice(0,5)} – ${r.close_time?.slice(0,5)} · 間距 ${r.slot_interval_minutes}分鐘`}
                </div>
              </div>
              <button onClick={() => delRule(r.id)} style={{ padding: '4px 6px', borderRadius: 6, border: 'none', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', cursor: 'pointer' }}><Trash2 size={12}/></button>
            </div>
          ))}
        </div>
      )}

      {/* ── GLOBAL ── */}
      {tab === 'global' && (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', padding: 24 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>以下為預設值，每週規則未個別設定時均適用</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-primary)' }}>營業時間</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>開始</label><input type="time" value={globalForm.open_time} onChange={e => setGlobalForm(f => ({ ...f, open_time: e.target.value }))} style={inp}/></div>
                <div><label style={lbl}>結束</label><input type="time" value={globalForm.close_time} onChange={e => setGlobalForm(f => ({ ...f, close_time: e.target.value }))} style={inp}/></div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-primary)' }}>時段設定</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>時段間距 (分鐘)</label>
                  <select value={globalForm.slot_interval_minutes} onChange={e => setGlobalForm(f => ({ ...f, slot_interval_minutes: Number(e.target.value) }))} style={inp}>
                    {INTERVALS.map(v => <option key={v} value={v}>{v} 分鐘</option>)}
                  </select>
                </div>
                <div><label style={lbl}>收桌前緩衝 (分鐘)</label><input type="number" min="0" max="120" value={globalForm.end_buffer_minutes} onChange={e => setGlobalForm(f => ({ ...f, end_buffer_minutes: Number(e.target.value) }))} style={inp}/></div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-primary)' }}>用餐時長</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>最短 (小時)</label>
                  <select value={globalForm.min_booking_hours} onChange={e => setGlobalForm(f => ({ ...f, min_booking_hours: Number(e.target.value) }))} style={inp}>
                    {[1,2,3].map(h => <option key={h} value={h}>{h} 小時</option>)}
                  </select>
                </div>
                <div><label style={lbl}>最長 (小時)</label>
                  <select value={globalForm.max_booking_hours} onChange={e => setGlobalForm(f => ({ ...f, max_booking_hours: Number(e.target.value) }))} style={inp}>
                    {[1,2,3,4,5].map(h => <option key={h} value={h}>{h} 小時</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-primary)' }}>桌位周轉</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>換桌緩衝 (分鐘)</label><input type="number" min="0" max="120" value={globalForm.buffer_minutes} onChange={e => setGlobalForm(f => ({ ...f, buffer_minutes: Number(e.target.value) }))} style={inp}/></div>
                <div><label style={lbl}>最大人數</label><input type="number" min="1" max="100" value={globalForm.max_party_size} onChange={e => setGlobalForm(f => ({ ...f, max_party_size: Number(e.target.value) }))} style={inp}/></div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-primary)' }}>預訂限制</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>最短提前通知 (分鐘)</label><input type="number" min="0" max="1440" value={globalForm.min_notice_minutes} onChange={e => setGlobalForm(f => ({ ...f, min_notice_minutes: Number(e.target.value) }))} style={inp}/></div>
                <div><label style={lbl}>最長預訂天數</label><input type="number" min="1" max="365" value={globalForm.max_advance_days} onChange={e => setGlobalForm(f => ({ ...f, max_advance_days: Number(e.target.value) }))} style={inp}/></div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={saveGlobal} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: saving ? 0.6 : 1 }}>
              <Save size={15}/> {saving ? '儲存中…' : '儲存全域設定'}
            </button>
            {saved && <span style={{ color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>✓ 已儲存</span>}
          </div>
        </div>
      )}

      {/* Add special date modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: 440, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>新增特殊日期</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1/-1' }}><label style={lbl}>日期 *</label><input type="date" value={addForm.date_override} onChange={e => setAddForm(f => ({ ...f, date_override: e.target.value }))} style={inp}/></div>
              <div style={{ gridColumn: '1/-1' }}><label style={lbl}>標籤 (例：情人節)</label><input value={addForm.label} onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))} style={inp}/></div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={addForm.is_closed} onChange={e => setAddForm(f => ({ ...f, is_closed: e.target.checked }))}/>此日公休
                </label>
              </div>
              {!addForm.is_closed && (
                <>
                  <div><label style={lbl}>開始時間</label><input type="time" value={addForm.open_time} onChange={e => setAddForm(f => ({ ...f, open_time: e.target.value }))} style={inp}/></div>
                  <div><label style={lbl}>結束時間</label><input type="time" value={addForm.close_time} onChange={e => setAddForm(f => ({ ...f, close_time: e.target.value }))} style={inp}/></div>
                  <div><label style={lbl}>時段間距</label>
                    <select value={addForm.slot_interval_minutes} onChange={e => setAddForm(f => ({ ...f, slot_interval_minutes: Number(e.target.value) }))} style={inp}>
                      {INTERVALS.map(v => <option key={v} value={v}>{v} 分</option>)}
                    </select>
                  </div>
                  <div><label style={lbl}>最大人數</label><input type="number" min="1" value={addForm.max_party_size} onChange={e => setAddForm(f => ({ ...f, max_party_size: Number(e.target.value) }))} style={inp}/></div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAdd(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
              <button onClick={addSpecial} disabled={!addForm.date_override}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: !addForm.date_override ? 0.5 : 1 }}>新增</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
