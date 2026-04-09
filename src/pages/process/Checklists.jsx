import { useState, useEffect } from 'react'
import { Plus, Check, X, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { getChecklists, createChecklist, deleteChecklist, updateChecklist, getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Checklists() {
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')

  // Expanded checklist
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState([])
  const [newItemText, setNewItemText] = useState('')
  const [editingItemId, setEditingItemId] = useState(null)
  const [editingText, setEditingText] = useState('')

  useEffect(() => {
    getChecklists().then(({ data }) => {
      setChecklists(data || [])
    }).finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    const { data } = await createChecklist({ name: newName.trim(), items: 0, completed: 0 })
    if (data) {
      setChecklists(prev => [...prev, data])
      setShowModal(false)
      setNewName('')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此清單？')) return
    await deleteChecklist(id)
    setChecklists(prev => prev.filter(c => c.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const handleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    const { data } = await getChecklistItems(id)
    setItems(data || [])
    setNewItemText('')
  }

  // ── Item handlers ──
  const handleAddItem = async () => {
    if (!newItemText.trim() || !expandedId) return
    const { data } = await createChecklistItem({
      checklist_id: expandedId, title: newItemText.trim(), sort_order: items.length,
    })
    if (data) {
      setItems(prev => {
        const updated = [...prev, data]
        // Use updated length to avoid stale closure
        updateChecklist(expandedId, { items: updated.length })
        setChecklists(p => p.map(c => c.id === expandedId ? { ...c, items: updated.length } : c))
        return updated
      })
      setNewItemText('')
    }
  }

  const handleToggle = async (item) => {
    const { data } = await updateChecklistItem(item.id, { checked: !item.checked })
    if (data) {
      const newItems = items.map(i => i.id === item.id ? data : i)
      setItems(newItems)
      const completed = newItems.filter(i => i.checked).length
      await updateChecklist(expandedId, { completed })
      setChecklists(prev => prev.map(c => c.id === expandedId ? { ...c, completed } : c))
    }
  }

  const handleSaveEdit = async (item) => {
    if (!editingText.trim() || editingText.trim() === item.title) { setEditingItemId(null); return }
    const { data } = await updateChecklistItem(item.id, { title: editingText.trim() })
    if (data) setItems(prev => prev.map(i => i.id === item.id ? data : i))
    setEditingItemId(null)
  }

  const handleDeleteItem = async (id) => {
    await deleteChecklistItem(id)
    const newItems = items.filter(i => i.id !== id)
    setItems(newItems)
    const completed = newItems.filter(i => i.checked).length
    await updateChecklist(expandedId, { items: newItems.length, completed })
    setChecklists(prev => prev.map(c => c.id === expandedId ? { ...c, items: newItems.length, completed } : c))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">☑️</span> 查核清單</h2>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={14} /> 新增清單
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {checklists.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            尚無清單，點擊「新增清單」開始
          </div>
        )}
        {checklists.map(c => {
          const isOpen = expandedId === c.id
          const done = c.completed || 0
          const total = c.items || 0
          return (
            <div key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header */}
              <div
                onClick={() => handleExpand(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                  {total > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {done}/{total}
                    </span>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(c.id) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Items */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px' }}>
                  {items.map(item => (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 0', borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <button onClick={() => handleToggle(item)} style={{
                        width: 20, height: 20, borderRadius: 4, flexShrink: 0, padding: 0,
                        border: `2px solid ${item.checked ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                        background: item.checked ? 'var(--accent-green)' : 'transparent',
                        color: '#fff', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.checked && <Check size={13} />}
                      </button>
                      {editingItemId === item.id ? (
                        <input
                          className="form-input"
                          style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
                          value={editingText}
                          onChange={e => setEditingText(e.target.value)}
                          onBlur={() => handleSaveEdit(item)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(item); if (e.key === 'Escape') setEditingItemId(null) }}
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingItemId(item.id); setEditingText(item.title) }}
                          style={{
                            flex: 1, fontSize: 13, cursor: 'pointer', padding: '4px 0',
                            textDecoration: item.checked ? 'line-through' : 'none',
                            color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                          }}
                        >
                          {item.title}
                          <Pencil size={11} style={{ marginLeft: 6, color: 'var(--text-muted)', opacity: 0.4, verticalAlign: 'middle' }} />
                        </span>
                      )}
                      <button onClick={() => handleDeleteItem(item.id)} style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', padding: 2, opacity: 0.4,
                      }}><X size={14} /></button>
                    </div>
                  ))}

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      className="form-input" type="text"
                      style={{ flex: 1, fontSize: 13 }}
                      placeholder="新增項目..."
                      value={newItemText}
                      onChange={e => setNewItemText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                    />
                    <button className="btn btn-sm btn-primary" onClick={handleAddItem} style={{ fontSize: 12 }}>
                      <Plus size={12} /> 新增
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showModal && (
        <Modal title="新增清單" onClose={() => setShowModal(false)} onSubmit={handleCreate}>
          <Field label="清單名稱">
            <input className="form-input" type="text" style={{ width: '100%' }}
              placeholder="例：開店採購清單"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  )
}
