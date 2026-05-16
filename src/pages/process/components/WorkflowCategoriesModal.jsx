import Modal from '../../../components/Modal'
import { Plus, Trash2 } from 'lucide-react'

export default function WorkflowCategoriesModal({
  categories,
  newCategoryName,
  setNewCategoryName,
  onAdd,
  onDelete,
  onClose,
}) {
  return (
    <Modal
      title="管理流程分類"
      onClose={onClose}
      onSubmit={onClose}
      submitLabel="完成"
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="form-input" type="text" placeholder="新分類名稱" style={{ flex: 1 }}
          value={newCategoryName}
          onChange={e => setNewCategoryName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }} />
        <button className="btn btn-primary" onClick={onAdd} style={{ fontSize: 13 }}>
          <Plus size={13} /> 新增
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {categories.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>尚無分類</div>
        ) : categories.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: 13 }}>{c.name}</span>
            <button onClick={() => onDelete(c)} style={{
              background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 4,
            }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
