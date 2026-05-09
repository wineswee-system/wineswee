import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Check, X, Tag as TagIcon } from 'lucide-react'
import { getTags, createTag, updateTag, deleteTag } from '../../../lib/db'
import LoadingSpinner from '../../../components/LoadingSpinner'

import { confirm } from '../../../lib/confirm'
const COLORS = [
  { value: 'var(--accent-cyan)',   label: 'Cyan' },
  { value: 'var(--accent-blue)',   label: 'Blue' },
  { value: 'var(--accent-green)',  label: 'Green' },
  { value: 'var(--accent-orange)', label: 'Orange' },
  { value: 'var(--accent-red)',    label: 'Red' },
  { value: 'var(--accent-purple)', label: 'Purple' },
]

export default function Tags() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0].value)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await getTags()
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    if (rows.some(r => r.name === name)) { setNewName(''); return }
    const nextOrder = (rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) || 0) + 10
    const { data, error } = await createTag({ name, color: newColor, sort_order: nextOrder })
    if (error) { setError(error.message); return }
    if (data) setRows(prev => [...prev, data])
    setNewName('')
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setEditName(r.name)
    setEditColor(r.color || COLORS[0].value)
  }

  const saveEdit = async () => {
    const name = editName.trim()
    if (!name) return
    const { data, error } = await updateTag(editingId, { name, color: editColor })
    if (error) { setError(error.message); return }
    if (data) setRows(prev => prev.map(r => r.id === editingId ? data : r))
    setEditingId(null)
  }

  const handleDelete = async (r) => {
    if (!(await confirm({ message: `確定刪除標籤「${r.name}」？` }))) return
    const { error } = await deleteTag(r.id)
    if (error) { setError(error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><TagIcon size={18} /></span> 標籤管理</h2>
            <p>Tags — 跨專案、任務與流程共用的標籤</p>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, padding: 12,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <input
          type="text"
          placeholder="新增標籤名稱"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
        />
        <select
          value={newColor}
          onChange={e => setNewColor(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
        >
          {COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={handleAdd}>
          <Plus size={14} /> 新增
        </button>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>順序</th>
                <th>標籤</th>
                <th style={{ width: 160 }}>顏色</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無標籤</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.sort_order}</td>
                  <td>
                    {editingId === r.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveEdit()}
                        autoFocus
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
                      />
                    ) : (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '2px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                        background: r.color ? `color-mix(in srgb, ${r.color} 15%, transparent)` : 'var(--bg-tertiary)',
                        color: r.color || 'var(--text-primary)',
                      }}>
                        <TagIcon size={12} /> {r.name}
                      </span>
                    )}
                  </td>
                  <td>
                    {editingId === r.id ? (
                      <select
                        value={editColor}
                        onChange={e => setEditColor(e.target.value)}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
                      >
                        {COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color || 'var(--bg-tertiary)', border: '1px solid var(--border)' }} />
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                          {COLORS.find(c => c.value === r.color)?.label || '—'}
                        </span>
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {editingId === r.id ? (
                        <>
                          <button className="btn btn-primary" style={{ padding: '4px 8px' }} onClick={saveEdit}><Check size={13} /></button>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setEditingId(null)}><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => startEdit(r)}><Edit3 size={13} /></button>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(r)}><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
