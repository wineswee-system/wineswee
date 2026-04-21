import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Check, X, FolderTree, FolderOpen, ListChecks, CheckSquare, Shield, Workflow } from 'lucide-react'
import { getCategories, createCategory, updateCategory, deleteCategory } from '../../../lib/db'
import LoadingSpinner from '../../../components/LoadingSpinner'

const SCOPES = [
  { value: 'project',   label: '專案',     icon: FolderOpen },
  { value: 'task',      label: '任務',     icon: ListChecks },
  { value: 'workflow',  label: '工作流程', icon: Workflow },
  { value: 'checklist', label: '查核清單', icon: CheckSquare },
  { value: 'approval',  label: '簽核',     icon: Shield },
]

const COLORS = [
  { value: 'var(--accent-cyan)',   label: 'Cyan' },
  { value: 'var(--accent-blue)',   label: 'Blue' },
  { value: 'var(--accent-green)',  label: 'Green' },
  { value: 'var(--accent-orange)', label: 'Orange' },
  { value: 'var(--accent-red)',    label: 'Red' },
  { value: 'var(--accent-purple)', label: 'Purple' },
]

export default function Categories() {
  const [scope, setScope] = useState('project')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0].value)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [error, setError] = useState(null)

  const load = async (s = scope) => {
    setLoading(true)
    const { data, error } = await getCategories(s)
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load(scope) /* eslint-disable-next-line */ }, [scope])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    if (rows.some(r => r.name === name)) { setNewName(''); return }
    const nextOrder = (rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) || 0) + 10
    const { data, error } = await createCategory({ scope, name, color: newColor, sort_order: nextOrder })
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
    const { data, error } = await updateCategory(editingId, { name, color: editColor })
    if (error) { setError(error.message); return }
    if (data) setRows(prev => prev.map(r => r.id === editingId ? data : r))
    setEditingId(null)
  }

  const handleDelete = async (r) => {
    if (!confirm(`確定刪除分類「${r.name}」？`)) return
    const { error } = await deleteCategory(r.id)
    if (error) { setError(error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  const currentScope = SCOPES.find(s => s.value === scope)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><FolderTree size={18} /></span> 分類管理</h2>
            <p>Categories — 統一管理專案、任務、流程、查核清單、簽核的分類</p>
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

      {/* Scope tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        background: 'var(--bg-card)', padding: 4, borderRadius: 8,
        width: 'fit-content', border: '1px solid var(--border)',
      }}>
        {SCOPES.map(s => {
          const Icon = s.icon
          const active = scope === s.value
          return (
            <button
              key={s.value}
              onClick={() => setScope(s.value)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 13,
                background: active ? 'var(--accent-cyan)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon size={13} /> {s.label}
            </button>
          )
        })}
      </div>

      {/* Add row */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, padding: 12,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <input
          type="text"
          placeholder={`新增 ${currentScope?.label || ''} 分類名稱`}
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

      {/* List */}
      {loading ? <LoadingSpinner /> : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>順序</th>
                <th>分類名稱</th>
                <th style={{ width: 160 }}>顏色</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  尚無 {currentScope?.label} 分類
                </td></tr>
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
                        {r.name}
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
