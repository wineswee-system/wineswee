import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Save, Trash2, GripVertical } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { loadPositions, LEVEL_LABELS } from '../../../lib/positions'
import LoadingSpinner from '../../../components/LoadingSpinner'

// 職位管理 — 後台自編職稱清單（新增/改名/分組/角色對應/排序/停用/刪除）
// 寫走 upsert_position / delete_position RPC（is_admin 擋）。存完 onSaved() 讓外層重載下拉。
const LEVELS = ['admin', 'manager', 'office_staff', 'store_staff']
const CAT_SUGGEST = ['管理職', '行政職', '門市職', '其他']

export default function PositionManagerModal({ open, onClose, onSaved }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(null)   // 正在存/刪的 key
  const [dragKey, setDragKey] = useState(null)

  const reload = async () => {
    setLoading(true)
    const data = await loadPositions(true)   // 含停用
    setRows(data.map(r => ({ ...r, _key: String(r.id) })))
    setLoading(false)
  }
  useEffect(() => { if (open) reload() }, [open])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const edit = (key, k, v) => setRows(rs => rs.map(r => r._key === key ? { ...r, [k]: v } : r))

  const addRow = () => setRows(rs => ([
    { id: null, _key: 'new-' + Date.now(), category: '管理職', label: '', level: 'store_staff',
      sort_order: (rs.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 10), is_active: true },
    ...rs,
  ]))

  const save = async (row) => {
    if (!row.label?.trim()) { setMsg({ type: 'error', text: '職稱不能空白' }); return }
    setBusy(row._key); setMsg(null)
    const { data, error } = await supabase.rpc('upsert_position', {
      p_id: row.id, p_category: row.category, p_label: row.label.trim(), p_level: row.level,
      p_sort_order: Number(row.sort_order) || 100, p_is_active: row.is_active,
    })
    setBusy(null)
    if (error || !data?.ok) {
      setMsg({ type: 'error', text: '儲存失敗：' + (data?.error === 'NOT_AUTHORIZED' ? '需管理員權限' : (data?.error || error?.message || '')) })
      return
    }
    setMsg({ type: 'success', text: `已儲存「${row.label.trim()}」` })
    await reload(); onSaved?.()
  }

  const del = async (row) => {
    if (row.id == null) { setRows(rs => rs.filter(r => r._key !== row._key)); return }
    if (!window.confirm(`確定刪除職位「${row.label}」？\n（若已有員工使用此職稱，員工資料不受影響，只是下拉不再出現）`)) return
    setBusy(row._key)
    const { data, error } = await supabase.rpc('delete_position', { p_id: row.id })
    setBusy(null)
    if (error || !data?.ok) { setMsg({ type: 'error', text: '刪除失敗：' + (data?.error || error?.message || '') }); return }
    setMsg({ type: 'success', text: `已刪除「${row.label}」` })
    await reload(); onSaved?.()
  }

  // 拖曳排序:把 dragKey 移到 targetKey 的位置 → 重編 sort_order → 存(reorder_positions)
  const handleDrop = async (targetKey) => {
    const from = rows.findIndex(r => r._key === dragKey)
    const to = rows.findIndex(r => r._key === targetKey)
    setDragKey(null)
    if (from < 0 || to < 0 || from === to) return
    const next = [...rows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const renum = next.map((r, i) => ({ ...r, sort_order: (i + 1) * 10 }))
    setRows(renum)
    const ids = renum.filter(r => r.id != null).map(r => r.id)
    const { data, error } = await supabase.rpc('reorder_positions', { p_ids: ids })
    if (error || !data?.ok) setMsg({ type: 'error', text: '排序儲存失敗' + (data?.error === 'NOT_AUTHORIZED' ? '：需管理員權限' : '') })
    else { setMsg({ type: 'success', text: '順序已更新' }); onSaved?.() }
  }

  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }
  const inp = { width: '100%', padding: '5px 8px', fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border-medium)', borderRadius: 6, color: 'var(--text-primary)' }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 14, width: 'min(920px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>職位管理</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              新增／改名／停用職稱，<b>拖曳左側握把</b>調整下拉出現順序（自動儲存）。<b>角色對應</b>決定新進員工未手動指定角色時的預設系統權限。
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}><X size={20} /></button>
        </div>

        {/* toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px' }}>
          <button onClick={addRow} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 700 }}>
            <Plus size={14} /> 新增職位
          </button>
          {msg && (
            <span style={{ fontSize: 12, fontWeight: 600, color: msg.type === 'error' ? 'var(--accent-red)' : 'var(--accent-green)' }}>{msg.text}</span>
          )}
        </div>

        {/* table */}
        <div style={{ overflow: 'auto', padding: '0 20px 20px' }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center' }}><LoadingSpinner /></div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'left' }}>
                  <th style={{ ...cell, width: 30 }}></th>
                  <th style={{ ...cell, width: 130 }}>分組</th>
                  <th style={{ ...cell }}>職稱</th>
                  <th style={{ ...cell, width: 200 }}>角色對應（權限）</th>
                  <th style={{ ...cell, width: 64 }}>啟用</th>
                  <th style={{ ...cell, width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r._key}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(r._key)}
                    style={{ opacity: r.is_active ? 1 : 0.5, background: dragKey === r._key ? 'var(--bg-secondary)' : undefined }}>
                    <td style={{ ...cell, width: 30, textAlign: 'center', cursor: 'grab' }}
                      draggable onDragStart={() => setDragKey(r._key)} onDragEnd={() => setDragKey(null)} title="拖曳調整順序">
                      <GripVertical size={15} style={{ color: 'var(--text-muted)' }} />
                    </td>
                    <td style={cell}>
                      <input list="pos-cat-list" style={inp} value={r.category || ''} onChange={e => edit(r._key, 'category', e.target.value)} />
                    </td>
                    <td style={cell}>
                      <input style={inp} value={r.label || ''} placeholder="職稱" onChange={e => edit(r._key, 'label', e.target.value)} />
                    </td>
                    <td style={cell}>
                      <select style={inp} value={r.level} onChange={e => edit(r._key, 'level', e.target.value)}>
                        {LEVELS.map(l => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
                      </select>
                    </td>
                    <td style={{ ...cell, textAlign: 'center' }}>
                      <input type="checkbox" checked={!!r.is_active} onChange={e => edit(r._key, 'is_active', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    </td>
                    <td style={cell}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button title="儲存" disabled={busy === r._key} onClick={() => save(r)}
                          style={{ padding: '5px 7px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>
                          <Save size={14} />
                        </button>
                        <button title="刪除" disabled={busy === r._key} onClick={() => del(r)}
                          style={{ padding: '5px 7px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>尚無職位，點「新增職位」開始</td></tr>
                )}
              </tbody>
            </table>
          )}
          <datalist id="pos-cat-list">{CAT_SUGGEST.map(c => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
    </div>,
    document.body
  )
}
