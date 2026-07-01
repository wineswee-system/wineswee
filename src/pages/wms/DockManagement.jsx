import { useState, useEffect } from 'react'
import {
  getDockHandoffs, createDockHandoff, updateDockHandoff,
  getDispatchJobs, getCarriers, getDispatchSchedules, createDispatchSchedule,
} from '../../lib/db/dispatch'
import { executeHandoff, signOffHandoff } from '../../lib/wms/dockService'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from 'sonner'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function DockManagement() {
  const orgId = useOrgId()
  const [date, setDate] = useState(todayStr())
  const [schedules, setSchedules] = useState([])
  const [handoffs, setHandoffs] = useState([])
  const [pendingJobs, setPendingJobs] = useState([])
  const [carriers, setCarriers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([])

  const [showHandoff, setShowHandoff] = useState(false)
  const [signee, setSignee] = useState('')

  const [showSchedule, setShowSchedule] = useState(false)
  const [schedForm, setSchedForm] = useState({ carrier_id: '', pickup_time_from: '', pickup_time_until: '', dock_door: '', expected_parcel_count: '' })

  const load = async () => {
    setLoading(true)
    const [sRes, hRes, jRes, cRes] = await Promise.all([
      getDispatchSchedules(orgId, date),
      getDockHandoffs(date),
      getDispatchJobs(orgId, { status: 'label_printed' }),
      getCarriers(orgId),
    ])
    setSchedules(sRes.data || [])
    setHandoffs(hRes.data || [])
    setPendingJobs(jRes.data || [])
    setCarriers(cRes.data || [])
    setSelected([])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId, date])

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const handleHandoff = async () => {
    if (!signee.trim()) { toast.error('請輸入物流商簽收人員姓名'); return false }
    if (selected.length === 0) { toast.error('請至少勾選一筆任務'); return false }
    const job = pendingJobs.find(j => selected.includes(j.id))
    const carrierId = job?.carrier_configs?.id || job?.carrier_id || null
    try {
      await executeHandoff({ orgId, jobIds: selected, carrierId, carrierSignee: signee.trim() })
      toast.success(`已移交 ${selected.length} 件`)
      setShowHandoff(false)
      setSignee('')
      load()
    } catch {
      toast.error('移交失敗')
      return false
    }
  }

  const handleSignOff = async (id) => {
    try {
      await signOffHandoff(id)
      toast.success('已確認簽收')
      load()
    } catch {
      toast.error('簽收確認失敗')
    }
  }

  const sset = (k, v) => setSchedForm(f => ({ ...f, [k]: v }))

  const handleCreateSchedule = async () => {
    if (!schedForm.carrier_id || !schedForm.pickup_time_from) { toast.error('請填寫必要欄位'); return false }
    const { error } = await createDispatchSchedule({
      org_id: orgId,
      date,
      carrier_id: schedForm.carrier_id,
      pickup_time_from: schedForm.pickup_time_from,
      pickup_time_until: schedForm.pickup_time_until || null,
      dock_door: schedForm.dock_door || null,
      expected_parcel_count: schedForm.expected_parcel_count ? Number(schedForm.expected_parcel_count) : null,
    })
    if (error) { toast.error('建立失敗'); return false }
    toast.success('已新增排程')
    setShowSchedule(false)
    setSchedForm({ carrier_id: '', pickup_time_from: '', pickup_time_until: '', dock_door: '', expected_parcel_count: '' })
    load()
  }

  const selectedCarrierName = selected.length > 0
    ? (pendingJobs.find(j => selected.includes(j.id))?.carrier_configs?.name || '-')
    : '-'

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🚪</span> 碼頭管理</h2>
            <p>出貨排程、批次移交與物流商簽收</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '6px 12px' }} />
            <button className="btn btn-secondary" onClick={() => setShowSchedule(true)}>新增排程</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">今日預排</div>
          <div className="stat-card-value">{schedules.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待移交</div>
          <div className="stat-card-value">{pendingJobs.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已移交</div>
          <div className="stat-card-value">{handoffs.length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">📅</span> 出貨排程</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>物流商</th><th>取件時間</th><th>碼頭號</th><th>預計件數</th><th>實際件數</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {schedules.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>此日無排程</td></tr>
              ) : schedules.map(s => (
                <tr key={s.id}>
                  <td>{s.carrier_configs?.name || '-'}</td>
                  <td style={{ fontSize: 12 }}>{s.pickup_time_from || '-'}{s.pickup_time_until ? ` – ${s.pickup_time_until}` : ''}</td>
                  <td>{s.dock_door || '-'}</td>
                  <td>{s.expected_parcel_count ?? '-'}</td>
                  <td>{s.actual_parcel_count ?? '-'}</td>
                  <td>
                    <span className={`badge ${s.status === 'completed' ? 'badge-success' : s.status === 'cancelled' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{s.status || '待確認'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title"><span className="card-title-icon">📤</span> 批次移交</span>
          {selected.length > 0 && (
            <button className="btn btn-primary" style={{ padding: '4px 14px', fontSize: 13 }} onClick={() => setShowHandoff(true)}>
              移交 ({selected.length} 件)
            </button>
          )}
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 36 }}></th><th>任務編號</th><th>物流商</th></tr>
            </thead>
            <tbody>
              {pendingJobs.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>無待移交任務</td></tr>
              ) : pendingJobs.map(job => (
                <tr key={job.id} style={{ cursor: 'pointer' }} onClick={() => toggleSelect(job.id)}>
                  <td>
                    <input type="checkbox" checked={selected.includes(job.id)} onChange={() => toggleSelect(job.id)} onClick={e => e.stopPropagation()} />
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{job.job_number || job.id}</td>
                  <td>
                    <span className="badge badge-cyan"><span className="badge-dot"></span>{job.carrier_configs?.name || '-'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">🤝</span> 移交記錄</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>物流商</th><th>件數</th><th>簽收人員</th><th>移交時間</th><th>簽收確認</th><th>動作</th></tr>
            </thead>
            <tbody>
              {handoffs.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>此日尚無移交記錄</td></tr>
              ) : handoffs.map(h => (
                <tr key={h.id}>
                  <td>{h.carrier_configs?.name || '-'}</td>
                  <td>{h.parcel_count}</td>
                  <td>{h.carrier_signee || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{h.handoff_at ? new Date(h.handoff_at).toLocaleTimeString('zh-TW') : '-'}</td>
                  <td>
                    {h.signed_off_at
                      ? <span className="badge badge-success"><span className="badge-dot"></span>已簽收</span>
                      : <span className="badge badge-warning"><span className="badge-dot"></span>待確認</span>
                    }
                  </td>
                  <td>
                    {!h.signed_off_at && (
                      <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleSignOff(h.id)}>確認簽收</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showHandoff && (
        <Modal title="移交確認" onClose={() => setShowHandoff(false)} onSubmit={handleHandoff} submitLabel="確認移交">
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="物流商">
              <div className="form-input" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{selectedCarrierName}</div>
            </Field>
            <Field label="移交件數">
              <div className="form-input" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{selected.length} 件</div>
            </Field>
            <Field label="物流商簽收人員姓名" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="輸入簽收人員姓名" value={signee} onChange={e => setSignee(e.target.value)} autoFocus />
            </Field>
          </div>
        </Modal>
      )}

      {showSchedule && (
        <Modal title="新增出貨排程" onClose={() => setShowSchedule(false)} onSubmit={handleCreateSchedule} submitLabel="新增">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="物流商" required>
              <select className="form-input" style={{ width: '100%' }} value={schedForm.carrier_id} onChange={e => sset('carrier_id', e.target.value)}>
                <option value="">請選擇</option>
                {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="碼頭號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：A1" value={schedForm.dock_door} onChange={e => sset('dock_door', e.target.value)} />
            </Field>
            <Field label="取件時間（起）" required>
              <input className="form-input" type="time" style={{ width: '100%' }} value={schedForm.pickup_time_from} onChange={e => sset('pickup_time_from', e.target.value)} />
            </Field>
            <Field label="取件時間（迄）">
              <input className="form-input" type="time" style={{ width: '100%' }} value={schedForm.pickup_time_until} onChange={e => sset('pickup_time_until', e.target.value)} />
            </Field>
            <Field label="預計件數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={schedForm.expected_parcel_count} onChange={e => sset('expected_parcel_count', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
