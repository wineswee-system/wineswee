import { useState, useEffect } from 'react'
import { Plus, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function PunchCorrection() {
  const [corrections, setCorrections] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [tab, setTab] = useState('pending')
  const [form, setForm] = useState({ employee: '', date: '', correction_type: 'clock_in', corrected_time: '', reason: '' })

  useEffect(() => {
    Promise.all([
      supabase.from('punch_corrections').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, dept').eq('status', '在職').order('name'),
    ]).then(([c, e]) => {
      setCorrections(c.data || [])
      setEmployees(e.data || [])
    }).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.employee || !form.date || !form.corrected_time || !form.reason) return
    const { data } = await supabase.from('punch_corrections').insert({ ...form, status: '待審核' }).select().single()
    if (data) {
      setCorrections(prev => [data, ...prev])
      setShowModal(false)
      setForm({ employee: '', date: '', correction_type: 'clock_in', corrected_time: '', reason: '' })
    }
  }

  const handleApprove = async (id) => {
    const { data } = await supabase.from('punch_corrections')
      .update({ status: '已核准', approved_by: '管理員', approved_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data) setCorrections(prev => prev.map(c => c.id === id ? data : c))
  }

  const handleReject = async (id) => {
    const reason = prompt('駁回原因：')
    if (!reason) return
    const { data } = await supabase.from('punch_corrections')
      .update({ status: '已駁回', approved_by: '管理員', approved_at: new Date().toISOString(), reject_reason: reason })
      .eq('id', id).select().single()
    if (data) setCorrections(prev => prev.map(c => c.id === id ? data : c))
  }

  if (loading) return <LoadingSpinner />

  const filtered = corrections.filter(c => {
    if (tab === 'pending') return c.status === '待審核'
    if (tab === 'approved') return c.status === '已核准'
    if (tab === 'rejected') return c.status === '已駁回'
    return true
  })

  const pendingCount = corrections.filter(c => c.status === '待審核').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 打卡補登申請</h2>
            <p>員工打卡異常補登審核</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增補登</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'pending', label: `待審核 (${pendingCount})` },
          { key: 'approved', label: '已核准' },
          { key: 'rejected', label: '已駁回' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>員工</th><th>日期</th><th>類型</th><th>補登時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無資料</td></tr>}
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.employee}</td>
                  <td>{c.date}</td>
                  <td><span className="badge badge-cyan">{c.correction_type === 'clock_in' ? '上班' : '下班'}</span></td>
                  <td style={{ fontWeight: 600 }}>{c.corrected_time}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200 }}>{c.reason}</td>
                  <td>
                    <span className={`badge ${c.status === '已核准' ? 'badge-success' : c.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                  <td>
                    {c.status === '待審核' ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleApprove(c.id)}>
                          <Check size={12} /> 核准
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleReject(c.id)}>
                          <X size={12} /> 駁回
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {c.approved_by} · {c.approved_at?.slice(0, 10)}
                        {c.reject_reason && <div style={{ color: 'var(--accent-red)' }}>原因：{c.reject_reason}</div>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增補登申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *">
              <select className="form-input" style={{ width: '100%' }} value={form.employee} onChange={e => set('employee', e.target.value)}>
                <option value="">請選擇</option>
                {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="日期 *">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="補登類型">
              <select className="form-input" style={{ width: '100%' }} value={form.correction_type} onChange={e => set('correction_type', e.target.value)}>
                <option value="clock_in">上班打卡</option>
                <option value="clock_out">下班打卡</option>
              </select>
            </Field>
            <Field label="補登時間 *">
              <input className="form-input" type="time" style={{ width: '100%' }} value={form.corrected_time} onChange={e => set('corrected_time', e.target.value)} />
            </Field>
          </div>
          <Field label="原因 *">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }} placeholder="例：忘記打卡、系統異常..."
              value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
