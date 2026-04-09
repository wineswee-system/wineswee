import { useState, useEffect } from 'react'
import { Plus, ChevronDown, ChevronRight, Check, X, Trash2 } from 'lucide-react'
import { getChecklists, createChecklist, updateChecklist, deleteChecklist, getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = ['HR', '財務', '業務', '行政', '研發', '客服', '安全', '採購', '展店']

export default function Checklists() {
  const [checklists, setChecklists] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], assignee: '' })

  // Expanded checklist & items
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [newItemText, setNewItemText] = useState('')

  useEffect(() => {
    Promise.all([
      getChecklists(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([c, e, d]) => {
      setChecklists(c.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  // Load items when expanding
  const handleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    setItemsLoading(true)
    const { data } = await getChecklistItems(id)
    setItems(data || [])
    setItemsLoading(false)
    setNewItemText('')
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name) return
    const { data } = await createChecklist({
      name: form.name,
      category: form.category,
      assignee: form.assignee,
      items: 0,
      completed: 0,
    })
    if (data) {
      setChecklists(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', category: CATEGORIES[0], assignee: '' })
    }
  }

  const handleDeleteChecklist = async (id) => {
    if (!confirm('確定刪除此清單？（所有項目也會刪除）')) return
    await deleteChecklist(id)
    setChecklists(prev => prev.filter(c => c.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  // ── Item handlers ──
  const handleAddItem = async () => {
    if (!newItemText.trim() || !expandedId) return
    const { data } = await createChecklistItem({
      checklist_id: expandedId,
      title: newItemText.trim(),
      sort_order: items.length,
    })
    if (data) {
      setItems(prev => [...prev, data])
      setNewItemText('')
      // Update count
      const cl = checklists.find(c => c.id === expandedId)
      if (cl) {
        const newCount = (cl.items || 0) + 1
        await updateChecklist(expandedId, { items: newCount })
        setChecklists(prev => prev.map(c => c.id === expandedId ? { ...c, items: newCount } : c))
      }
    }
  }

  const handleToggleItem = async (item) => {
    const { data } = await updateChecklistItem(item.id, { checked: !item.checked })
    if (data) {
      setItems(prev => prev.map(i => i.id === item.id ? data : i))
      // Update completed count
      const newItems = items.map(i => i.id === item.id ? data : i)
      const completedCount = newItems.filter(i => i.checked).length
      await updateChecklist(expandedId, { completed: completedCount })
      setChecklists(prev => prev.map(c => c.id === expandedId ? { ...c, completed: completedCount } : c))
    }
  }

  const handleDeleteItem = async (itemId) => {
    await deleteChecklistItem(itemId)
    const newItems = items.filter(i => i.id !== itemId)
    setItems(newItems)
    // Update counts
    const totalCount = newItems.length
    const completedCount = newItems.filter(i => i.checked).length
    await updateChecklist(expandedId, { items: totalCount, completed: completedCount })
    setChecklists(prev => prev.map(c => c.id === expandedId ? { ...c, items: totalCount, completed: completedCount } : c))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const filtered = checklists.filter(c =>
    deptFilter === '' || getEmpDept(c.assignee) === deptFilter
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">☑️</span> 查核清單</h2>
            <p>作業查核項目管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增清單</button>
        </div>
      </div>

      {/* 部門篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="form-input" style={{ fontSize: 13 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成清單</div>
          <div className="stat-card-value">{filtered.filter(c => c.items > 0 && c.completed === c.items).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">進行中清單</div>
          <div className="stat-card-value">{filtered.filter(c => c.completed > 0 && c.completed < c.items).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">未開始清單</div>
          <div className="stat-card-value">{filtered.filter(c => c.completed === 0).length}</div>
        </div>
      </div>

      {/* Checklist Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            尚無查核清單，點擊「新增清單」開始
          </div>
        )}
        {filtered.map(c => {
          const pct = c.items > 0 ? Math.round(c.completed / c.items * 100) : 0
          const status = c.completed === c.items && c.items > 0 ? '已完成' : c.completed === 0 ? '未開始' : '進行中'
          const isExpanded = expandedId === c.id
          return (
            <div key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Card header */}
              <div
                style={{
                  padding: '14px 20px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onClick={() => handleExpand(c.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="badge badge-cyan">{c.category}</span>
                      {c.assignee && <span>👤 {c.assignee}</span>}
                      {getEmpDept(c.assignee) && <span style={{ color: 'var(--text-muted)' }}>({getEmpDept(c.assignee)})</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  {/* Progress */}
                  <div style={{ width: 100, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--border-medium)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${pct}%`,
                        background: pct === 100 ? 'var(--accent-green)' : pct > 50 ? 'var(--accent-cyan)' : 'var(--accent-orange)',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.completed}/{c.items}</span>
                  </div>
                  <span className={`badge ${status === '已完成' ? 'badge-success' : status === '進行中' ? 'badge-info' : 'badge-warning'}`}>
                    <span className="badge-dot"></span>{status}
                  </span>
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ color: 'var(--accent-red)', padding: '4px 6px' }}
                    onClick={e => { e.stopPropagation(); handleDeleteChecklist(c.id) }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Expanded: items */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 20px' }}>
                  {itemsLoading ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>載入中...</div>
                  ) : (
                    <>
                      {items.length === 0 && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>尚無項目，在下方新增</div>
                      )}
                      {items.map(item => (
                        <div key={item.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8, marginBottom: 4,
                          background: item.checked ? 'var(--accent-green-dim)' : 'transparent',
                          border: '1px solid var(--border-subtle)',
                        }}>
                          <button onClick={() => handleToggleItem(item)} style={{
                            width: 22, height: 22, borderRadius: 4,
                            border: `2px solid ${item.checked ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                            background: item.checked ? 'var(--accent-green)' : 'transparent',
                            color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, padding: 0,
                          }}>
                            {item.checked && <Check size={14} />}
                          </button>
                          <span style={{
                            flex: 1, fontSize: 13,
                            textDecoration: item.checked ? 'line-through' : 'none',
                            color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                          }}>{item.title}</span>
                          <button onClick={() => handleDeleteItem(item.id)} style={{
                            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, opacity: 0.5,
                          }}><X size={14} /></button>
                        </div>
                      ))}

                      {/* Add item */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <input
                          className="form-input"
                          type="text"
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
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showModal && (
        <Modal title="新增查核清單" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="清單名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：信義安和開店採購清單" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
                <option value="">請選擇負責人</option>
                {departments.map(d => (
                  <optgroup key={d.id} label={d.name}>
                    {employees.filter(e => e.dept === d.name).map(e => (
                      <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
