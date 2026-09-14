import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, X, Play, Pause, RotateCcw, Pencil, Check, Trash2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'

// 暢飲計時（純前端小工具，資料存本機 localStorage，依門市分開）
//  - 一桌可多組時間（不同客人/不同開始時間各自計時）
//  - 計時用時間戳算，重整/暫存都不失準；金額 = 時數 × 時薪（可調）
const DEFAULT_RATE = 290
const TYPE_META = {
  round:  { label: '大圓桌', color: 'var(--accent-blue)' },
  square: { label: '小方桌', color: 'var(--accent-green)' },
  two:    { label: '2人桌',  color: 'var(--accent-purple)' },
  room:   { label: '包間',   color: 'var(--accent-orange)' },
}
const TYPE_ORDER = ['round', 'square', 'two', 'room']

// 各店預設桌位（頁內可再編輯，改動存 localStorage）
const PRESETS = {
  '信義安和': [
    { name: '大圓桌1', type: 'round', floor: '一樓' },
    { name: '大圓桌2', type: 'round', floor: '一樓' },
    { name: '小方桌3', type: 'square', floor: '一樓' },
    { name: '小方桌4', type: 'square', floor: '一樓' },
    { name: '小方桌5', type: 'square', floor: '一樓' },
    { name: '小方桌6', type: 'square', floor: '一樓' },
    { name: '小方桌7', type: 'square', floor: '一樓' },
    { name: '小方桌8', type: 'square', floor: '二樓' },
    { name: '小方桌9', type: 'square', floor: '二樓' },
    { name: '小方桌10', type: 'square', floor: '二樓' },
    { name: '小方桌11', type: 'square', floor: '二樓' },
    { name: '小方桌12', type: 'square', floor: '二樓' },
    { name: '小方桌13', type: 'square', floor: '二樓' },
    { name: '小方桌14', type: 'square', floor: '二樓' },
    { name: '小方桌15', type: 'square', floor: '二樓' },
    { name: '大圓桌16', type: 'round', floor: '二樓' },
    { name: '大圓桌17', type: 'round', floor: '二樓' },
    { name: '大圓桌18', type: 'round', floor: '二樓' },
    { name: '2人桌19', type: 'two', floor: '二樓' },
    { name: '2人桌20', type: 'two', floor: '二樓' },
    { name: '2人桌21', type: 'two', floor: '二樓' },
    { name: '小包間22', type: 'room', floor: '二樓' },
  ],
}
const GENERIC = Array.from({ length: 6 }, (_, i) => ({ name: `桌${i + 1}`, type: 'square', floor: '' }))

let _seq = 0
const uid = (p) => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`

function seedTables(store) {
  const src = PRESETS[store] || GENERIC
  return src.map(t => ({ id: uid('tb'), ...t }))
}

const LS_KEY = (s) => `drinktimer_v1_${s}`

export default function DrinkTimer() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [stores, setStores] = useState([])
  const [store, setStore] = useState('')
  const [data, setData] = useState({ rate: DEFAULT_RATE, tables: [], sessions: {} })
  const [now, setNow] = useState(Date.now())
  const [editMode, setEditMode] = useState(false)

  // 每秒 tick 讓時間/金額更新
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  // 載入門市清單
  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data: rows }) => {
        const list = (rows || []).filter(s => s.name)
        setStores(list)
        const def = list.find(s => s.name === profile?.store)?.name || list[0]?.name || ''
        setStore(def)
      })
  }, [profile])

  // 切換門市 → 載入該店資料（無則用預設桌位）
  useEffect(() => {
    if (!store) return
    const raw = localStorage.getItem(LS_KEY(store))
    if (raw) {
      try { const d = JSON.parse(raw); setData({ rate: DEFAULT_RATE, sessions: {}, tables: [], ...d }); return } catch { /* fall through */ }
    }
    setData({ rate: DEFAULT_RATE, tables: seedTables(store), sessions: {} })
    setEditMode(false)
  }, [store]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next) => { setData(next); if (store) localStorage.setItem(LS_KEY(store), JSON.stringify(next)) }

  // ── 計時組操作 ──
  const groupsOf = (tableId) => data.sessions[tableId] || []

  const addGroup = (tableId) => {
    const g = { gid: uid('g'), status: 'stopped', lastTick: 0, accumulated: 0, displayStartTime: null, memo: '' }
    persist({ ...data, sessions: { ...data.sessions, [tableId]: [...groupsOf(tableId), g] } })
  }
  const delGroup = (tableId, gid) => {
    if (!confirm('刪除此組計時？')) return
    persist({ ...data, sessions: { ...data.sessions, [tableId]: groupsOf(tableId).filter(g => g.gid !== gid) } })
  }
  const mutateGroup = (tableId, gid, fn) => {
    persist({ ...data, sessions: { ...data.sessions, [tableId]: groupsOf(tableId).map(g => g.gid === gid ? fn(g) : g) } })
  }
  const act = (tableId, gid, action) => {
    const g = groupsOf(tableId).find(x => x.gid === gid); if (!g) return
    if (action === 'start') {
      if (g.status === 'running') return
      const d = new Date()
      mutateGroup(tableId, gid, x => ({
        ...x, status: 'running', lastTick: Date.now(),
        displayStartTime: x.displayStartTime || `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      }))
    } else if (action === 'stop') {
      if (g.status !== 'running') return
      mutateGroup(tableId, gid, x => ({ ...x, status: 'stopped', accumulated: x.accumulated + (Date.now() - x.lastTick) }))
    } else if (action === 'reset') {
      if (!confirm('確定歸零這組？')) return
      mutateGroup(tableId, gid, x => ({ ...x, status: 'stopped', accumulated: 0, lastTick: 0, displayStartTime: null }))
    }
  }
  const setMemo = (tableId, gid, memo) => mutateGroup(tableId, gid, x => ({ ...x, memo }))

  const elapsedMs = (g) => g.accumulated + (g.status === 'running' ? now - g.lastTick : 0)
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  const price = (ms) => Math.round((ms / 1000 / 60) * (data.rate / 60))

  // ── 桌位編輯 ──
  const addTable = () => persist({ ...data, tables: [...data.tables, { id: uid('tb'), name: '新桌', type: 'square', floor: data.tables.at(-1)?.floor || '' }] })
  const updTable = (id, patch) => persist({ ...data, tables: data.tables.map(t => t.id === id ? { ...t, ...patch } : t) })
  const delTable = (id) => {
    if (!confirm('刪除此桌？（該桌計時資料一併移除）')) return
    const s = { ...data.sessions }; delete s[id]
    persist({ ...data, tables: data.tables.filter(t => t.id !== id), sessions: s })
  }
  const reseedTables = () => {
    if (!confirm(`還原「${store}」的預設桌位？\n會覆蓋目前的桌位設定與所有計時資料。`)) return
    persist({ ...data, tables: seedTables(store), sessions: {} })
  }

  const resetAll = () => {
    if (!confirm(`⚠️ 打烊清除「${store}」全部計時資料？（桌位設定保留）`)) return
    persist({ ...data, sessions: {} })
  }

  // 依樓層分組
  const floors = [...new Set(data.tables.map(t => t.floor || ''))]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/process/applications')} style={{ padding: '6px 10px' }}><ChevronLeft size={16} /></button>
            <div><h2>🍷 暢飲計時</h2><p>桌位計時看板（資料存本機，一桌可多組）</p></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="form-input" value={store} onChange={e => setStore(e.target.value)} style={{ minWidth: 130, fontSize: 13 }}>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={() => setEditMode(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {editMode ? <><Check size={15} /> 完成</> : <><Pencil size={15} /> 編輯桌位</>}
            </button>
            <button className="btn" onClick={resetAll} style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={15} /> 打烊全清
            </button>
          </div>
        </div>
      </div>

      {/* 編輯桌位模式 */}
      {editMode && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>時薪計費</span>
            <input type="number" className="form-input" value={data.rate} min={0} onChange={e => persist({ ...data, rate: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 100 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>元 / 小時（金額按時間比例計）</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.tables.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="form-input" value={t.name} onChange={e => updTable(t.id, { name: e.target.value })} placeholder="桌名" style={{ flex: 2, fontSize: 13 }} />
                <select className="form-input" value={t.type} onChange={e => updTable(t.id, { type: e.target.value })} style={{ width: 110, fontSize: 13 }}>
                  {TYPE_ORDER.map(k => <option key={k} value={k}>{TYPE_META[k].label}</option>)}
                </select>
                <input className="form-input" value={t.floor || ''} onChange={e => updTable(t.id, { floor: e.target.value })} placeholder="樓層(可空)" style={{ width: 110, fontSize: 13 }} />
                <button className="btn btn-secondary" onClick={() => delTable(t.id)} style={{ padding: '6px 8px', color: 'var(--accent-red)' }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={addTable} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={15} /> 新增桌位</button>
            {PRESETS[store] && (
              <button className="btn btn-secondary" onClick={reseedTables} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><RotateCcw size={15} /> 還原預設桌位</button>
            )}
          </div>
        </div>
      )}

      {/* 計時看板 */}
      {!editMode && data.tables.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          尚未設定桌位。點右上「編輯桌位」新增。
        </div>
      )}

      {!editMode && floors.map(fl => (
        <div key={fl || '_'} style={{ marginBottom: 16 }}>
          {floors.length > 1 || fl ? <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>{fl || '座位'}</div> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.tables.filter(t => (t.floor || '') === fl).map(t => {
              const meta = TYPE_META[t.type] || TYPE_META.square
              const groups = groupsOf(t.id)
              return (
                <div key={t.id} className="card" style={{ display: 'flex', padding: 0, overflow: 'hidden', borderLeft: `5px solid ${meta.color}` }}>
                  {/* 桌號 + 加組 */}
                  <div style={{ width: 96, flexShrink: 0, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.15 }}>{t.name}</div>
                    <button className="btn btn-sm" onClick={() => addGroup(t.id)} style={{ background: 'var(--accent-cyan)', color: '#fff', border: 'none', fontSize: 12, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Plus size={12} /> 組</button>
                  </div>
                  {/* 各組計時（橫向） */}
                  <div style={{ flex: 1, display: 'flex', gap: 8, padding: 8, overflowX: 'auto', minHeight: 96, alignItems: 'stretch' }}>
                    {groups.length === 0 && <div style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 13 }}>（空桌 · 按「＋組」開始）</div>}
                    {groups.map((g, idx) => {
                      const running = g.status === 'running'
                      const ms = elapsedMs(g)
                      return (
                        <div key={g.gid} style={{
                          width: 150, flexShrink: 0, borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
                          background: running ? 'var(--accent-green-dim)' : 'var(--bg-card)',
                          border: `1px solid ${running ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                        }}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input className="form-input" value={g.memo || ''} onChange={e => setMemo(t.id, g.gid, e.target.value)} placeholder="備註.." style={{ flex: 1, fontSize: 12, padding: '3px 6px' }} />
                            <button onClick={() => delGroup(t.id, g.gid)} title="刪除此組" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}><X size={14} /></button>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.displayStartTime ? `${g.displayStartTime} 開始` : '--:--'}</div>
                            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1.1 }}>{fmt(ms)}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-purple)' }}>${price(ms)}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button onClick={() => act(t.id, g.gid, 'start')} title="開始" style={{ flex: 1, border: 'none', borderRadius: 4, padding: '4px 0', background: 'var(--accent-green)', color: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'center' }}><Play size={13} /></button>
                            <button onClick={() => act(t.id, g.gid, 'stop')} title="暫停" style={{ flex: 1, border: 'none', borderRadius: 4, padding: '4px 0', background: 'var(--accent-orange)', color: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'center' }}><Pause size={13} /></button>
                            <button onClick={() => act(t.id, g.gid, 'reset')} title="歸零" style={{ flex: 1, border: 'none', borderRadius: 4, padding: '4px 0', background: 'var(--text-muted)', color: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'center' }}><RotateCcw size={13} /></button>
                          </div>
                          {idx === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>第 1 組</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
