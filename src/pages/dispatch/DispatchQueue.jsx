import { useState, useEffect } from 'react'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from 'sonner'
import { getDispatchJobs, getCarriers, updateDispatchJob } from '../../lib/db/dispatch'
import { printLabel } from '../../lib/dispatch/labelGenerator'

const PRIORITY_LABEL = { urgent: '緊急', high: '高', normal: '一般', low: '低' }
const PRIORITY_BADGE = { urgent: 'badge-danger', high: 'badge-warning', normal: 'badge-cyan', low: 'badge-neutral' }

export default function DispatchQueue() {
  const orgId = useOrgId()
  const [jobs, setJobs] = useState([])
  const [carriers, setCarriers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [showModal, setShowModal] = useState(false)
  const [assignTarget, setAssignTarget] = useState(null)
  const [form, setForm] = useState({ carrier_id: '', priority: 'normal', sla_hours: 24 })

  const load = () => {
    if (!orgId) { setLoading(false); return }
    Promise.all([
      getDispatchJobs(orgId, { status: 'queued' }),
      getCarriers(orgId),
    ]).then(([j, c]) => {
      setJobs(j.data || [])
      setCarriers(c.data || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [orgId])

  if (loading) return <LoadingSpinner />

  const todayStr = new Date().toDateString()
  const todayAssigned = jobs.filter(j => j.assigned_at && new Date(j.assigned_at).toDateString() === todayStr).length
  const urgentCount = jobs.filter(j => j.priority === 'urgent').length

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const allChecked = jobs.length > 0 && selected.size === jobs.length
  const toggleAll = () => allChecked ? setSelected(new Set()) : setSelected(new Set(jobs.map(j => j.id)))
  const toggleOne = id => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const openAssign = (job = null) => {
    setAssignTarget(job)
    setForm({ carrier_id: carriers[0]?.id || '', priority: job?.priority || 'normal', sla_hours: 24 })
    setShowModal(true)
  }

  const handleAssign = async () => {
    const deadline = new Date(Date.now() + form.sla_hours * 3600 * 1000).toISOString()
    const ids = assignTarget ? [assignTarget.id] : [...selected]
    await Promise.all(ids.map(id =>
      updateDispatchJob(id, { status: 'assigned', carrier_id: form.carrier_id, priority: form.priority, sla_deadline: deadline })
    ))
    toast.success(`已指派 ${ids.length} 筆任務`)
    setShowModal(false)
    setAssignTarget(null)
    setSelected(new Set())
    load()
  }

  const handlePrint = job => {
    printLabel(job)
    toast.success(`已送出列印：${job.job_number}`)
  }

  const handleAutoRoute = async () => {
    const carrier = carriers[0]
    if (!carrier) { toast.error('未設定物流商，請先新增物流商'); return }
    const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    await Promise.all(jobs.map(j =>
      updateDispatchJob(j.id, { status: 'assigned', carrier_id: carrier.id, priority: j.priority || 'normal', sla_deadline: deadline })
    ))
    toast.success(`已自動指派 ${jobs.length} 筆任務`)
    load()
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <h2><span className="header-icon">📋</span> 派送佇列</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleAutoRoute}>⚡ 一鍵批次</button>
            {selected.size > 0 && (
              <button className="btn btn-primary" onClick={() => openAssign(null)}>
                批次指派（{selected.size}）
              </button>
            )}
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>管理待指派任務，支援批次作業</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ borderTop: '3px solid var(--accent-orange)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-orange)' }}>{jobs.length}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>待指派</div>
        </div>
        <div className="stat-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-blue)' }}>{todayAssigned}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>今日指派</div>
        </div>
        <div className="stat-card" style={{ borderTop: '3px solid var(--accent-red)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-red)' }}>{urgentCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>緊急任務</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🗂️</span> 待派任務</div>
          <span className="badge badge-neutral">{jobs.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <th>任務編號</th>
                <th>訂單參考</th>
                <th>收件人</th>
                <th>地址</th>
                <th>重量(kg)</th>
                <th>優先級</th>
                <th>SLA截止</th>
                <th>動作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                    佇列目前無待指派任務
                  </td>
                </tr>
              )}
              {jobs.map(j => (
                <tr key={j.id} style={{ background: selected.has(j.id) ? 'var(--accent-cyan-dim)' : undefined }}>
                  <td>
                    <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggleOne(j.id)} />
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{j.job_number}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{j.order_ref || '—'}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.recipient_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{j.recipient_phone}</div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.delivery_address || '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>{j.weight_kg ?? '—'}</td>
                  <td>
                    <span className={`badge ${PRIORITY_BADGE[j.priority] || 'badge-neutral'}`}>
                      {PRIORITY_LABEL[j.priority] || j.priority || '—'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: j.sla_deadline ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                    {j.sla_deadline
                      ? new Date(j.sla_deadline).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => openAssign(j)}>指派</button>
                      <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => handlePrint(j)}>列印標籤</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal
          title={assignTarget ? `指派任務 ${assignTarget.job_number}` : `批次指派（${selected.size} 筆）`}
          onClose={() => { setShowModal(false); setAssignTarget(null) }}
          onSubmit={handleAssign}
          submitLabel="確認指派"
        >
          <Field label="物流商" required>
            <select className="form-input" value={form.carrier_id} onChange={e => set('carrier_id', e.target.value)}>
              <option value="">請選擇物流商</option>
              {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="優先級">
            <select className="form-input" value={form.priority} onChange={e => set('priority', e.target.value)}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="SLA時數">
            <input
              type="number"
              className="form-input"
              min={1}
              max={168}
              value={form.sla_hours}
              onChange={e => set('sla_hours', Number(e.target.value))}
            />
          </Field>
        </Modal>
      )}
    </div>
  )
}
