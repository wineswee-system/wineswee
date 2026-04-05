import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Pencil, Trash2 } from 'lucide-react'
import { getWorkflows, createWorkflow, updateWorkflow } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = ['HR', '財務', '業務', '行政', '研發', '客服', '營運']

export default function Workflows() {
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], steps: '', description: '' })
  const [editForm, setEditForm] = useState({ name: '', category: '', steps: '', description: '', status: '' })

  useEffect(() => {
    getWorkflows().then(({ data }) => { setWorkflows(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setE = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  const toggleStatus = async (w) => {
    const newStatus = w.status === '已啟用' ? '已停用' : '已啟用'
    const { data } = await updateWorkflow(w.id, { status: newStatus })
    if (data) setWorkflows(prev => prev.map(x => x.id === w.id ? data : x))
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const { data } = await createWorkflow({
      name: form.name,
      category: form.category,
      steps: Number(form.steps) || 1,
      description: form.description,
      status: '草稿',
      active_instances: 0,
    })
    if (data) {
      setWorkflows(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', category: CATEGORIES[0], steps: '', description: '' })
    }
  }

  const openEdit = (w) => {
    setEditTarget(w)
    setEditForm({
      name: w.name || '',
      category: w.category || CATEGORIES[0],
      steps: String(w.steps || ''),
      description: w.description || '',
      status: w.status || '草稿',
    })
    setShowEditModal(true)
  }

  const handleEdit = async () => {
    if (!editTarget || !editForm.name) return
    const { data } = await updateWorkflow(editTarget.id, {
      name: editForm.name,
      category: editForm.category,
      steps: Number(editForm.steps) || 1,
      description: editForm.description,
      status: editForm.status,
    })
    if (data) {
      setWorkflows(prev => prev.map(w => w.id === editTarget.id ? data : w))
      setShowEditModal(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此流程？')) return
    await supabase.from('workflows').delete().eq('id', id)
    setWorkflows(prev => prev.filter(w => w.id !== id))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 流程</h2>
            <p>標準作業流程設計與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增流程</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已啟用</div>
          <div className="stat-card-value">{workflows.filter(w => w.status === '已啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">執行中實例</div>
          <div className="stat-card-value">{workflows.reduce((s, w) => s + (w.active_instances || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">草稿</div>
          <div className="stat-card-value">{workflows.filter(w => w.status === '草稿').length}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>流程名稱</th><th>分類</th><th>步驟數</th><th>執行中</th><th>說明</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {workflows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無流程</td></tr>}
              {workflows.map(w => (
                <tr key={w.id}>
                  <td style={{ fontWeight: 600 }}>{w.name}</td>
                  <td><span className="badge badge-cyan">{w.category}</span></td>
                  <td>{w.steps}</td>
                  <td style={{ fontWeight: 600, color: w.active_instances > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>{w.active_instances}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 12, maxWidth: 300 }}>{w.description}</td>
                  <td><span className={`badge ${w.status === '已啟用' ? 'badge-success' : w.status === '已停用' ? 'badge-danger' : 'badge-warning'}`}><span className="badge-dot"></span>{w.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => openEdit(w)} title="編輯">
                        <Pencil size={12} />
                      </button>
                      <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => toggleStatus(w)} title={w.status === '已啟用' ? '停用' : '啟用'}>
                        {w.status === '已啟用' ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                      <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(w.id)} title="刪除">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增流程 */}
      {showModal && (
        <Modal title="新增流程" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="流程名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：請假審核流程" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="步驟數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="1" min="1" value={form.steps} onChange={e => set('steps', e.target.value)} />
            </Field>
          </div>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} placeholder="流程說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* 編輯流程 */}
      {showEditModal && editTarget && (
        <Modal title={`編輯流程 — ${editTarget.name}`} onClose={() => setShowEditModal(false)} onSubmit={handleEdit} submitText="儲存變更">
          <Field label="流程名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.name} onChange={e => setE('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={editForm.category} onChange={e => setE('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="步驟數">
              <input className="form-input" type="number" style={{ width: '100%' }} min="1" value={editForm.steps} onChange={e => setE('steps', e.target.value)} />
            </Field>
          </div>
          <Field label="狀態">
            <select className="form-input" style={{ width: '100%' }} value={editForm.status} onChange={e => setE('status', e.target.value)}>
              <option>草稿</option>
              <option>已啟用</option>
              <option>已停用</option>
            </select>
          </Field>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} value={editForm.description} onChange={e => setE('description', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
