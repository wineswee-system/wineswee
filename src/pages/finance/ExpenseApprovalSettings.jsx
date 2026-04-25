import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, Trash2, Edit3, X, ArrowRight, GripVertical } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEmployees, getApprovalChains, createApprovalChain, updateApprovalChain, deleteApprovalChain } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { empLabel } from '../../lib/empLabel'

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '無上限'

const emptyForm = { name: '', description: '', min_amount: '0', max_amount: '', is_active: true, steps: [{ role: '', label: '' }] }

export default function ExpenseApprovalSettings() {
  const [chains, setChains] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    const [chainRes, empRes] = await Promise.all([
      getApprovalChains(),
      getEmployees(),
    ])
    const filtered = (chainRes.data || [])
      .filter(c => c.category === '費用申請')
      .sort((a, b) => (a.min_amount || 0) - (b.min_amount || 0))
    setChains(filtered)
    setEmployees((empRes.data || []).filter(e => e.status === '在職'))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.name || form.steps.filter(s => s.role).length === 0) return
    setSaving(true)
    const payload = {
      name: form.name,
      description: form.description || null,
      category: '費用申請',
      min_amount: Number(form.min_amount) || 0,
      max_amount: form.max_amount !== '' ? Number(form.max_amount) : null,
      is_active: form.is_active,
      steps: form.steps.filter(s => s.role),
    }
    if (editingId) {
      const { error: err } = await updateApprovalChain(editingId, payload)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await createApprovalChain(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (c) => {
    setForm({
      name: c.name,
      description: c.description || '',
      min_amount: c.min_amount ?? '0',
      max_amount: c.max_amount ?? '',
      is_active: c.is_active !== false,
      steps: c.steps?.length ? c.steps : [{ role: '', label: '' }],
    })
    setEditingId(c.id)
    setShowModal(true)
  }

  const handleDelete = async (c) => {
    if (!confirm(`刪除「${c.name}」？`)) return
    await deleteApprovalChain(c.id)
    load()
  }

  const toggleActive = async (c) => {
    await updateApprovalChain(c.id, { is_active: !c.is_active })
    load()
  }

  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, { role: '', label: '' }] }))
  const removeStep = (i) => setForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))
  const updateStep = (i, k, v) => setForm(f => {
    const steps = [...f.steps]
    steps[i] = { ...steps[i], [k]: v }
    return { ...f, steps }
  })

  if (loading) return <LoadingSpinner />

  // Check for gaps/overlaps
  const sortedActive = chains.filter(c => c.is_active).sort((a, b) => (a.min_amount || 0) - (b.min_amount || 0))
  const hasGap = sortedActive.some((c, i) => {
    if (i === 0) return false
    const prevMax = sortedActive[i - 1].max_amount
    return prevMax != null && (c.min_amount || 0) > prevMax
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⚙️</span> 費用簽核設定</h2>
            <p>依金額範圍自動分配簽核流程</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增規則
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {hasGap && (
        <div style={{ background: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          ⚠️ 金額範圍有間隙，部分金額可能無法匹配簽核鏈，會走預設流程（主管→財務）
        </div>
      )}

      {/* Visual flow */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, overflowX: 'auto', paddingBottom: 8 }}>
        {sortedActive.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', flex: 1 }}>
            尚無啟用的簽核規則，所有費用申請將走預設流程（直屬主管 → 財務確認）
          </div>
        ) : sortedActive.map((c, i) => (
          <div key={c.id} className="card" style={{ padding: 16, minWidth: 220, flex: '1 1 220px', borderTop: `3px solid ${['var(--accent-green)', 'var(--accent-blue)', 'var(--accent-purple)'][i % 3]}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{c.name}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: ['var(--accent-green)', 'var(--accent-blue)', 'var(--accent-purple)'][i % 3], marginBottom: 8 }}>
              {fmt(c.min_amount)} ~ {fmt(c.max_amount)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ color: 'var(--accent-cyan)' }}>申請人</span>
              {(c.steps || []).map((s, j) => (
                <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--glass-light)', fontWeight: 600 }}>{s.label || s.role}</span>
                </span>
              ))}
              <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--accent-green)' }}>✓</span>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="data-table">
        <table>
          <thead>
            <tr><th>規則名稱</th><th>金額範圍</th><th>簽核關卡</th><th>流程</th><th>狀態</th><th>操作</th></tr>
          </thead>
          <tbody>
            {chains.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無規則</td></tr>}
            {chains.map(c => (
              <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5 }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  {c.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.description}</div>}
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {fmt(c.min_amount)} ~ {fmt(c.max_amount)}
                </td>
                <td>{c.steps?.length || 0} 關</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {(c.steps || []).map((s, i) => (
                      <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
                        {i > 0 && <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} />}
                        <span style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--glass-light)' }}>{s.label || s.role}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <button onClick={() => toggleActive(c)} style={{
                    padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: c.is_active ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
                    color: c.is_active ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}>{c.is_active ? '啟用' : '停用'}</button>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(c)}><Edit3 size={13} /></button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(c)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯簽核規則' : '新增簽核規則'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>規則名稱 *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：小額費用申請"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
                <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="選填"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>

              {/* Amount range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>最低金額（含）</label>
                  <input type="number" value={form.min_amount} onChange={e => setForm(f => ({ ...f, min_amount: e.target.value }))} placeholder="0"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>最高金額（含）</label>
                  <input type="number" value={form.max_amount} onChange={e => setForm(f => ({ ...f, max_amount: e.target.value }))} placeholder="留空 = 無上限"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>

              {/* Active toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>啟用此規則</span>
              </label>

              {/* Steps */}
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>簽核步驟（申請人 → ...）</label>
                {form.steps.map((s, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <select value={s.role} onChange={e => updateStep(i, 'role', e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                      <option value="">選擇簽核人</option>
                      {employees.filter(e => e.is_manager || e.position?.includes('主管') || e.position?.includes('經理') || e.position?.includes('財務')).map(emp => (
                        <option key={emp.id} value={emp.name}>{empLabel(emp)}{(emp.position || emp.dept) ? ` - ${emp.position || emp.dept}` : ''}</option>
                      ))}
                      <optgroup label="── 全部員工 ──">
                        {employees.map(emp => (
                          <option key={`all-${emp.id}`} value={emp.name}>{empLabel(emp)}{emp.dept ? ` - ${emp.dept}` : ''}</option>
                        ))}
                      </optgroup>
                    </select>
                    <input type="text" placeholder="步驟標籤（例：主管審核）" value={s.label} onChange={e => updateStep(i, 'label', e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                    {form.steps.length > 1 && (
                      <button style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer' }} onClick={() => removeStep(i)}><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
                <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 4 }} onClick={addStep}><Plus size={12} /> 新增步驟</button>
              </div>

              {/* Preview */}
              <div style={{ background: 'var(--glass-light)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>預覽：</div>
                <div>金額 {fmt(Number(form.min_amount) || 0)} ~ {form.max_amount ? fmt(Number(form.max_amount)) : '無上限'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--accent-cyan)' }}>申請人</span>
                  {form.steps.filter(s => s.role).map((s, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} />
                      <span style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)' }}>{s.label || s.role}</span>
                    </span>
                  ))}
                  <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ color: 'var(--accent-green)' }}>✓ 完成</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
