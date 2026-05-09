import { useState, useEffect } from 'react'
import { Plus, X, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { createChecklist, deleteChecklist, updateChecklist, getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem, drainEntity } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'

import { confirm } from '../../lib/confirm'
export default function Checklists() {
  const { profile } = useAuth()
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')

  // Edit checklist overlay
  const [editChecklist, setEditChecklist] = useState(null)
  const [editName, setEditName] = useState('')
  const [editAssignee, setEditAssignee] = useState('')

  // Expanded checklist
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState([])
  const [newItemText, setNewItemText] = useState('')
  const [editingItemId, setEditingItemId] = useState(null)
  const [editingText, setEditingText] = useState('')

  useEffect(() => {
    supabase.from('checklists')
      .select('*, task_checklists(task_id, tasks(id, title, workflow, assignee))')
      .order('id')
      .then(({ data }) => setChecklists(data || []))
      .finally(() => setLoading(false))
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

  const handleOpenEdit = async (c) => {
    setEditChecklist(c)
    setEditName(c.name)
    setEditAssignee(c.assignee || '')
    setExpandedId(c.id)
    const { data } = await getChecklistItems(c.id)
    setItems(data || [])
    setNewItemText('')
  }

  const handleSaveEditChecklist = async () => {
    if (!editName.trim() || !editChecklist) return
    const updates = { name: editName.trim(), assignee: editAssignee.trim() || null }
    const { data } = await updateChecklist(editChecklist.id, updates)
    if (data) setChecklists(prev => prev.map(c => c.id === editChecklist.id ? { ...c, ...updates } : c))
    setEditChecklist(null)
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定刪除此清單？資料會移入回收暫存區保留備份（可供復原）。' }))) return
    const checklist = checklists.find(c => c.id === id)
    const { data: clItems } = await getChecklistItems(id)
    if (checklist) {
      await drainEntity({
        entityType: 'checklist',
        entityId: id,
        entityName: checklist.name,
        payload: checklist,
        relatedData: { items: clItems || [] },
        deletedBy: profile?.name || '管理員',
        organizationId: null,
      })
    }
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
      const newItems = [...items, data]
      setItems(newItems)
      setNewItemText('')
      const newCount = newItems.length
      await updateChecklist(expandedId, { items: newCount })
      setChecklists(prev => prev.map(c => c.id === expandedId ? { ...c, items: newCount } : c))
    }
  }

  const handleSaveEdit = async (item) => {
    if (!editingText.trim() || editingText.trim() === item.title) { setEditingItemId(null); return }
    const { data } = await updateChecklistItem(item.id, { title: editingText.trim() })
    if (data) setItems(prev => prev.map(i => i.id === item.id ? data : i))
    setEditingItemId(null)
  }

  const handleDeleteItem = async (id) => {
    const item = items.find(i => i.id === id)
    if (item) {
      await drainEntity({
        entityType: 'checklist_item',
        entityId: id,
        entityName: item.title,
        payload: item,
        relatedData: null,
        deletedBy: profile?.name || '管理員',
        organizationId: null,
      })
    }
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
          const linkedTasks = (c.task_checklists || []).map(tc => tc.tasks).filter(Boolean)
          const firstTask = linkedTasks[0]
          return (
            <div key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header */}
              <div
                onClick={() => handleExpand(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', cursor: 'pointer', gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>{c.name}</span>
                  {total > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {done}/{total}
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 4 }}>
                    {c.assignee && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--glass-light)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                        👤 {c.assignee}
                      </span>
                    )}
                    {firstTask && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.2)', whiteSpace: 'nowrap' }}>
                        📋 {firstTask.title}
                        {linkedTasks.length > 1 && ` +${linkedTasks.length - 1}`}
                      </span>
                    )}
                    {firstTask?.workflow && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: '1px solid rgba(168,85,247,0.2)', whiteSpace: 'nowrap' }}>
                        🔄 {firstTask.workflow}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    onClick={e => { e.stopPropagation(); handleOpenEdit(c) }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(c.id) }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Items */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px' }}>
                  {items.map((item, idx) => (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 0', borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, minWidth: 20 }}>{idx + 1}.</span>
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
                          style={{ flex: 1, fontSize: 13, cursor: 'pointer', padding: '4px 0' }}
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

      {editChecklist && (
        <div onClick={() => setEditChecklist(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 16, padding: 28, width: 520, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            {/* Title bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>✏️ 編輯清單</h3>
              <button onClick={() => setEditChecklist(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
            </div>
            {/* Name + assignee */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <Field label="清單名稱 *">
                <input className="form-input" style={{ width: '100%' }} autoFocus
                  value={editName} onChange={e => setEditName(e.target.value)} />
              </Field>
              <Field label="負責人">
                <input className="form-input" style={{ width: '100%' }} placeholder="負責人姓名"
                  value={editAssignee} onChange={e => setEditAssignee(e.target.value)} />
              </Field>
            </div>
            {/* Items */}
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>項目清單</div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
              {items.map((item, idx) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 20 }}>{idx + 1}.</span>
                  {editingItemId === item.id ? (
                    <input className="form-input" style={{ flex: 1, fontSize: 13, padding: '3px 8px' }}
                      value={editingText} onChange={e => setEditingText(e.target.value)}
                      onBlur={() => handleSaveEdit(item)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(item); if (e.key === 'Escape') setEditingItemId(null) }}
                      autoFocus />
                  ) : (
                    <span onClick={() => { setEditingItemId(item.id); setEditingText(item.title) }}
                      style={{ flex: 1, fontSize: 13, cursor: 'pointer', padding: '3px 0' }}>
                      {item.title}
                      <Pencil size={10} style={{ marginLeft: 6, color: 'var(--text-muted)', opacity: 0.4, verticalAlign: 'middle' }} />
                    </span>
                  )}
                  <button onClick={() => handleDeleteItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, opacity: 0.5 }}><X size={13} /></button>
                </div>
              ))}
            </div>
            {/* Add item */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input className="form-input" style={{ flex: 1, fontSize: 13 }} placeholder="新增項目..."
                value={newItemText} onChange={e => setNewItemText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddItem()} />
              <button className="btn btn-sm btn-primary" onClick={handleAddItem} style={{ fontSize: 12 }}><Plus size={12} /> 新增</button>
            </div>
            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setEditChecklist(null)}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveEditChecklist}>儲存</button>
            </div>
          </div>
        </div>
      )}

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
