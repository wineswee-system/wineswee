import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import {
  getResTables, createResTable, updateResTable, deleteResTable,
  getTableCombinations, createTableCombination, deleteTableCombination,
} from '../../lib/db/reservations'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Plus, Trash2, Save, Map, List } from 'lucide-react'

const SHAPES = { rect: '方形', round: '圓形', booth: 'Booth' }
const DEF = { table_number: '', capacity: 4, shape: 'rect', x_pos: 0, y_pos: 0, is_combinable: false, is_active: true }
const CELL_W = 90
const CELL_H = 74

export default function Tables() {
  const [stores, setStores]       = useState([])
  const [storeId, setStoreId]     = useState('')
  const [orgId, setOrgId]         = useState('')
  const [tables, setTables]       = useState([])
  const [combos, setCombos]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('list')
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(DEF)
  const [saving, setSaving]       = useState(false)
  const [showCombo, setShowCombo] = useState(false)
  const [comboForm, setComboForm] = useState({ name: '', table_ids: [], combined_capacity: 0 })

  // drag-and-drop state
  const canvasRef = useRef(null)
  const dragRef   = useRef(null) // { id, origX, origY, curX, curY, offX, offY }
  const [dragPos, setDragPos] = useState(null) // { id, x, y } — render-only

  useEffect(() => {
    supabase.from('stores').select('id,name,organization_id').then(({ data }) => {
      const list = data || []
      setStores(list)
      if (list.length) { setStoreId(list[0].id); setOrgId(list[0].organization_id) }
    })
  }, [])

  const loadData = () => {
    if (!storeId) return
    setLoading(true)
    Promise.all([getResTables(storeId), getTableCombinations(storeId)])
      .then(([t, c]) => { setTables(t.data || []); setCombos(c.data || []) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadData() }, [storeId]) // eslint-disable-line

  const maxX = Math.max(9,  ...tables.map(t => t.x_pos))
  const maxY = Math.max(6,  ...tables.map(t => t.y_pos))
  const gridCols = Math.max(12, maxX + 3)
  const gridRows = Math.max(8,  maxY + 3)

  // global drag handlers — window-level so fast swipes don't escape the canvas
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d || !canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const nx = Math.max(0, Math.min(gridCols - 1, Math.round((e.clientX - rect.left - d.offX) / CELL_W)))
      const ny = Math.max(0, Math.min(gridRows - 1, Math.round((e.clientY - rect.top  - d.offY) / CELL_H)))
      if (nx !== d.curX || ny !== d.curY) {
        dragRef.current = { ...d, curX: nx, curY: ny }
        setDragPos({ id: d.id, x: nx, y: ny })
      }
    }
    const onUp = async () => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      setDragPos(null)
      const { id, origX, origY, curX, curY } = d
      if (curX !== origX || curY !== origY) {
        await updateResTable(id, { x_pos: curX, y_pos: curY })
        loadData()
      } else {
        // pure click → open edit modal
        const t = tables.find(tb => tb.id === id)
        if (t) {
          setEditing(t.id)
          setForm({ table_number: t.table_number, capacity: t.capacity, shape: t.shape, x_pos: t.x_pos, y_pos: t.y_pos, is_combinable: t.is_combinable, is_active: t.is_active })
        }
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [tables, gridCols, gridRows]) // eslint-disable-line

  const handleTableMouseDown = (e, t) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = canvasRef.current.getBoundingClientRect()
    dragRef.current = {
      id: t.id, origX: t.x_pos, origY: t.y_pos, curX: t.x_pos, curY: t.y_pos,
      offX: (e.clientX - rect.left) - t.x_pos * CELL_W,
      offY: (e.clientY - rect.top)  - t.y_pos * CELL_H,
    }
    setDragPos({ id: t.id, x: t.x_pos, y: t.y_pos })
  }

  // click on empty canvas cell → add new table
  const handleCanvasClick = (e) => {
    if (e.target !== canvasRef.current) return // hit a table div
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(gridCols - 1, Math.floor((e.clientX - rect.left) / CELL_W)))
    const y = Math.max(0, Math.min(gridRows - 1, Math.floor((e.clientY - rect.top)  / CELL_H)))
    const occupied = tables.find(t => t.x_pos === x && t.y_pos === y)
    if (!occupied) { setEditing('new'); setForm({ ...DEF, x_pos: x, y_pos: y }) }
  }

  const saveTable = async () => {
    let resolvedOrgId = orgId
    if (!resolvedOrgId) {
      // stores.organization_id is NULL for this store — borrow from another store that has it
      const { data: s } = await supabase
        .from('stores').select('organization_id')
        .not('organization_id', 'is', null).limit(1).single()
      if (!s?.organization_id) { alert('無法取得組織資訊，請確認其他門市已設定組織'); return }
      resolvedOrgId = s.organization_id
      setOrgId(resolvedOrgId)
    }
    setSaving(true)
    const data = { ...form, store_id: storeId, organization_id: resolvedOrgId, capacity: Number(form.capacity), x_pos: Number(form.x_pos), y_pos: Number(form.y_pos) }
    const res = editing === 'new' ? await createResTable(data) : await updateResTable(editing, data)
    setSaving(false)
    if (res.error) { alert(`儲存失敗：${res.error.message}`); return }
    setEditing(null); loadData()
  }

  const delTable = async (id) => {
    if (!window.confirm('確定刪除此桌位？')) return
    await deleteResTable(id); loadData()
  }

  const toggleActive = async (t) => { await updateResTable(t.id, { is_active: !t.is_active }); loadData() }

  const saveCombo = async () => {
    if (!comboForm.name || comboForm.table_ids.length < 2) return
    await createTableCombination({ ...comboForm, store_id: storeId, organization_id: orgId })
    setComboForm({ name: '', table_ids: [], combined_capacity: 0 }); setShowCombo(false); loadData()
  }

  const inp = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const lbl = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>桌位設定</h1>
        <select value={storeId} onChange={e => { const s = stores.find(x => x.id === e.target.value); setStoreId(e.target.value); setOrgId(s?.organization_id || '') }}
          style={{ ...inp, width: 'auto' }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ display: 'flex', border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          {[{ k: 'list', icon: List, t: '清單' }, { k: 'map', icon: Map, t: '平面圖' }].map(({ k, icon: Icon, t }) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding: '6px 14px', border: 'none', background: tab === k ? 'var(--accent-cyan)' : 'transparent', color: tab === k ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, fontWeight: tab === k ? 600 : 400 }}>
              <Icon size={13}/> {t}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditing('new'); setForm(DEF) }} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          <Plus size={14}/> 新增桌位
        </button>
      </div>

      {tab === 'list' && (
        <>
          {/* Table list */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 60px 80px 70px 70px auto', padding: '10px 16px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, gap: 8 }}>
              <span>桌號</span><span>形狀</span><span>容量</span><span>位置</span><span>可合併</span><span>狀態</span><span></span>
            </div>
            {tables.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>尚無桌位，點「新增桌位」開始設定</div>}
            {tables.map(t => (
              <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '80px 80px 60px 80px 70px 70px auto', padding: '10px 16px', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-primary)' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.table_number}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{SHAPES[t.shape] || t.shape}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t.capacity}人</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({t.x_pos},{t.y_pos})</span>
                <span style={{ fontSize: 12, color: t.is_combinable ? 'var(--accent-green)' : 'var(--text-muted)' }}>{t.is_combinable ? '是' : '否'}</span>
                <button onClick={() => toggleActive(t)} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: t.is_active ? 'var(--accent-green-dim)' : 'var(--bg-tertiary)', color: t.is_active ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  {t.is_active ? '啟用' : '停用'}
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setEditing(t.id); setForm({ table_number: t.table_number, capacity: t.capacity, shape: t.shape, x_pos: t.x_pos, y_pos: t.y_pos, is_combinable: t.is_combinable, is_active: t.is_active }) }}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>編輯</button>
                  <button onClick={() => delTable(t.id)} style={{ padding: '4px 6px', borderRadius: 6, border: 'none', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 12, cursor: 'pointer' }}><Trash2 size={12}/></button>
                </div>
              </div>
            ))}
          </div>

          {/* Combinations */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>合併桌組合</span>
              <button onClick={() => setShowCombo(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                <Plus size={12}/> 新增組合
              </button>
            </div>
            {combos.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚無合併桌組合</div>}
            {combos.map(c => {
              const cTables = tables.filter(t => (c.table_ids || []).includes(t.id))
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border-primary)', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{cTables.map(t => t.table_number).join(' + ')} · {c.combined_capacity} 人</div>
                  </div>
                  <button onClick={() => deleteTableCombination(c.id).then(loadData)} style={{ padding: '4px 6px', borderRadius: 6, border: 'none', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', cursor: 'pointer' }}><Trash2 size={12}/></button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── MAP TAB — drag-and-drop floor plan ── */}
      {tab === 'map' && tables.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '64px 24px', background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>🪑</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>此門市尚無桌位資料</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>請先在清單新增桌位，再回來配置平面圖</div>
          </div>
          <button
            onClick={() => { setTab('list'); setEditing('new'); setForm(DEF) }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            <Plus size={14}/> 前往新增桌位
          </button>
        </div>
      )}

      {tab === 'map' && tables.length > 0 && (
        <div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
            拖曳桌位移動位置 · 點空格新增桌位 · 點桌位編輯詳情
          </p>
          <div style={{ overflowX: 'auto', overflowY: 'auto' }}>
            <div
              ref={canvasRef}
              onClick={handleCanvasClick}
              style={{
                position: 'relative',
                width:  gridCols * CELL_W,
                height: gridRows * CELL_H,
                border: '1px solid var(--border-primary)',
                borderRadius: 12,
                background: 'var(--bg-secondary)',
                // grid lines via CSS repeating gradient
                backgroundImage: [
                  `linear-gradient(to right, var(--border-primary) 1px, transparent 1px)`,
                  `linear-gradient(to bottom, var(--border-primary) 1px, transparent 1px)`,
                ].join(', '),
                backgroundSize: `${CELL_W}px ${CELL_H}px`,
                cursor: dragPos ? 'grabbing' : 'default',
                userSelect: 'none',
              }}
            >
              {tables.map(t => {
                const isD = dragPos?.id === t.id
                const x   = isD ? dragPos.x : t.x_pos
                const y   = isD ? dragPos.y : t.y_pos
                const pad = 5
                return (
                  <div
                    key={t.id}
                    onMouseDown={(e) => handleTableMouseDown(e, t)}
                    style={{
                      position: 'absolute',
                      left:   x * CELL_W + pad,
                      top:    y * CELL_H + pad,
                      width:  CELL_W - pad * 2,
                      height: CELL_H - pad * 2,
                      background: isD
                        ? 'var(--accent-cyan)'
                        : t.is_active ? 'var(--accent-cyan-dim)' : 'var(--bg-tertiary)',
                      border: `2px solid ${t.is_active ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
                      borderRadius:
                        t.shape === 'round' ? '50%' :
                        t.shape === 'booth' ? '4px 4px 14px 14px' : 10,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      cursor: dragPos ? 'grabbing' : 'grab',
                      zIndex: isD ? 20 : 1,
                      boxShadow: isD
                        ? '0 8px 24px rgba(0,0,0,0.45)'
                        : '0 1px 4px rgba(0,0,0,0.2)',
                      opacity: t.is_active ? 1 : 0.45,
                      // instant snap while dragging, smooth settle after drop
                      transition: isD ? 'none' : 'left 0.12s ease, top 0.12s ease',
                      pointerEvents: dragPos && !isD ? 'none' : 'auto',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: isD ? '#fff' : 'var(--accent-cyan)', pointerEvents: 'none', letterSpacing: 0.5 }}>
                      {t.table_number}
                    </div>
                    <div style={{ fontSize: 10, color: isD ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)', pointerEvents: 'none', marginTop: 2 }}>
                      {t.capacity}人
                    </div>
                  </div>
                )
              })}

            </div>
          </div>
        </div>
      )}

      {/* Edit / new table modal */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: 420, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{editing === 'new' ? '新增桌位' : '編輯桌位'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div><label style={lbl}>桌號 *</label><input value={form.table_number} onChange={e => setForm(f => ({ ...f, table_number: e.target.value }))} placeholder="A1" style={inp}/></div>
              <div><label style={lbl}>容量 (人)</label><input type="number" min="1" max="50" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} style={inp}/></div>
              <div><label style={lbl}>形狀</label>
                <select value={form.shape} onChange={e => setForm(f => ({ ...f, shape: e.target.value }))} style={inp}>
                  {Object.entries(SHAPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div></div>
              <div><label style={lbl}>X 位置 (欄)</label><input type="number" min="0" max="30" value={form.x_pos} onChange={e => setForm(f => ({ ...f, x_pos: Number(e.target.value) }))} style={inp}/></div>
              <div><label style={lbl}>Y 位置 (列)</label><input type="number" min="0" max="20" value={form.y_pos} onChange={e => setForm(f => ({ ...f, y_pos: Number(e.target.value) }))} style={inp}/></div>
              <div style={{ gridColumn: '1/-1', display: 'flex', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={form.is_combinable} onChange={e => setForm(f => ({ ...f, is_combinable: e.target.checked }))}/>可合併
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}/>啟用
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
              <button onClick={saveTable} disabled={saving || !form.table_number}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: saving ? 0.6 : 1 }}>
                <Save size={14}/>{saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Combo modal */}
      {showCombo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>新增合併桌組合</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={lbl}>組合名稱</label><input value={comboForm.name} onChange={e => setComboForm(f => ({ ...f, name: e.target.value }))} placeholder="大桌組合" style={inp}/></div>
              <div>
                <label style={lbl}>選擇桌位 (需勾選 2 桌以上，且桌位需設為「可合併」)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {tables.filter(t => t.is_combinable).map(t => {
                    const checked = comboForm.table_ids.includes(t.id)
                    return (
                      <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 10px', borderRadius: 8, border: `1px solid ${checked ? 'var(--accent-cyan)' : 'var(--border-primary)'}`, background: checked ? 'var(--accent-cyan-dim)' : 'transparent', fontSize: 13, color: checked ? 'var(--accent-cyan)' : 'var(--text-secondary)', userSelect: 'none' }}>
                        <input type="checkbox" checked={checked} style={{ display: 'none' }}
                          onChange={e => {
                            const ids = e.target.checked ? [...comboForm.table_ids, t.id] : comboForm.table_ids.filter(id => id !== t.id)
                            const cap = tables.filter(x => ids.includes(x.id)).reduce((s, x) => s + x.capacity, 0)
                            setComboForm(f => ({ ...f, table_ids: ids, combined_capacity: cap }))
                          }}/>
                        {t.table_number}
                      </label>
                    )
                  })}
                  {tables.filter(t => t.is_combinable).length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>請先在清單中將桌位設為「可合併」</p>}
                </div>
              </div>
              {comboForm.table_ids.length >= 2 && (
                <div><label style={lbl}>合計容量</label><input type="number" value={comboForm.combined_capacity} onChange={e => setComboForm(f => ({ ...f, combined_capacity: Number(e.target.value) }))} style={inp}/></div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowCombo(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
              <button onClick={saveCombo} disabled={!comboForm.name || comboForm.table_ids.length < 2}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: (!comboForm.name || comboForm.table_ids.length < 2) ? 0.5 : 1 }}>
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
