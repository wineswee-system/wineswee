import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, Trash2, Edit3, X, Search, Building2 } from 'lucide-react'
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../../lib/db/purchasing'
import { useOrgId } from '../../contexts/AuthContext'
import { confirm } from '../../lib/confirm'
import LoadingSpinner from '../../components/LoadingSpinner'

const emptyForm = () => ({ name: '', contact_person: '', phone: '', payment_terms: '', address: '' })
const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }
const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }

export default function SupplierManager() {
  const orgId = useOrgId()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await getSuppliers(orgId)
    if (error) setError(error.message); else setRows((data || []).filter(s => s.status !== 'inactive'))
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  const openNew = () => { setForm(emptyForm()); setEditingId(null); setError(null); setShowModal(true) }
  const openEdit = (r) => {
    setForm({ name: r.name || '', contact_person: r.contact_person || '', phone: r.phone || '', payment_terms: r.payment_terms || '', address: r.address || '' })
    setEditingId(r.id); setError(null); setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('請填廠商名稱'); return }
    setSaving(true); setError(null)
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person?.trim() || null,
      phone: form.phone?.trim() || null,
      payment_terms: form.payment_terms?.trim() || null,
      address: form.address?.trim() || null,
    }
    const { error } = editingId
      ? await updateSupplier(editingId, payload)
      : await createSupplier({ ...payload, status: 'active', organization_id: orgId })
    setSaving(false)
    if (error) { setError(error.message); return }
    setShowModal(false); load()
  }

  const handleDelete = async (r) => {
    if (!(await confirm({ message: `刪除廠商「${r.name}」?（已開的叫貨單不受影響)` }))) return
    const { error } = await deleteSupplier(r.id)
    if (error) setError(error.message); else setRows(prev => prev.filter(x => x.id !== r.id))
  }

  const filtered = rows.filter(r => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return [r.name, r.contact_person, r.phone].some(f => (f || '').toLowerCase().includes(q))
  })

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Building2 size={20} /> 廠商管理</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>建立廠商後,叫貨申請單的「供應商」就能直接選</div>
        </div>
        <button onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={16} /> 新增廠商
        </button>
      </div>

      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 12 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋廠商 / 聯絡人 / 電話" style={{ ...fieldStyle, paddingLeft: 32 }} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>共 {filtered.length} 家</div>

      {error && !showModal && <div style={{ color: 'var(--accent-red)', marginBottom: 10 }}>{error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>
              <th style={{ padding: '10px 12px' }}>廠商名稱</th>
              <th style={{ padding: '10px 12px' }}>聯絡人</th>
              <th style={{ padding: '10px 12px' }}>電話</th>
              <th style={{ padding: '10px 12px' }}>付款條件</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>尚無廠商,點右上「新增廠商」開始建立</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)', fontSize: 14 }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '10px 12px' }}>{r.contact_person || '—'}</td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.phone || '—'}</td>
                <td style={{ padding: '10px 12px' }}>{r.payment_terms || '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEdit(r)} title="編輯" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-blue)', padding: 4 }}><Edit3 size={16} /></button>
                  <button onClick={() => handleDelete(r)} title="刪除" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 20, width: 'min(480px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯廠商' : '新增廠商'}</h3>
              <button onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={labelStyle}>廠商名稱 <span style={{ color: 'var(--accent-red)' }}>*</span></label><input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例:大同酒業" style={fieldStyle} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>聯絡人</label><input value={form.contact_person} onChange={e => set('contact_person', e.target.value)} style={fieldStyle} /></div>
                <div><label style={labelStyle}>電話</label><input value={form.phone} onChange={e => set('phone', e.target.value)} style={fieldStyle} /></div>
              </div>
              <div><label style={labelStyle}>付款條件</label><input value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} placeholder="例:月結30天" style={fieldStyle} /></div>
              <div><label style={labelStyle}>地址</label><input value={form.address} onChange={e => set('address', e.target.value)} style={fieldStyle} /></div>
              {error && <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>{error}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
              <button onClick={handleSubmit} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
