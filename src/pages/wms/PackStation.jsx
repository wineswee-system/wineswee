import { useState, useEffect } from 'react'
import { getDispatchJobs } from '../../lib/db/dispatch'
import { completePack } from '../../lib/wms/packStationService'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from 'sonner'

const initPack = { boxCount: 1, totalWeightKg: '', l: '', w: '', h: '', packerId: '' }

export default function PackStation() {
  const orgId = useOrgId()
  const [queue, setQueue] = useState([])
  const [todayRecords, setTodayRecords] = useState([])
  const [pickedUp, setPickedUp] = useState(0)
  const [loading, setLoading] = useState(true)
  const [packTarget, setPackTarget] = useState(null)
  const [form, setForm] = useState(initPack)
  const [submitting, setSubmitting] = useState(false)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const load = async () => {
    setLoading(true)
    const [queueRes, pickedRes, recRes] = await Promise.all([
      getDispatchJobs(orgId, { status: 'label_printed' }),
      getDispatchJobs(orgId, { status: 'picked_up' }),
      supabase.from('wms_pack_records')
        .select('*, employees(name)')
        .gte('packed_at', todayStart.toISOString())
        .order('packed_at', { ascending: false }),
    ])
    setQueue(queueRes.data || [])
    setPickedUp((pickedRes.data || []).length)
    setTodayRecords(recRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handlePack = async () => {
    if (!form.packerId.trim()) { toast.error('請輸入包裝員 ID'); return false }
    if (!form.totalWeightKg) { toast.error('請輸入實際重量'); return false }
    setSubmitting(true)
    try {
      await completePack({
        jobId: packTarget.id,
        packerId: form.packerId.trim(),
        boxCount: Number(form.boxCount) || 1,
        totalWeightKg: Number(form.totalWeightKg),
        dimensions: { l: Number(form.l), w: Number(form.w), h: Number(form.h), unit: 'cm' },
      })
      toast.success('包裝完成')
      setPackTarget(null)
      setForm(initPack)
      load()
    } catch {
      toast.error('包裝記錄失敗')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📦</span> 包裝站</h2>
            <p>包裝核對、尺寸秤重與出貨記錄</p>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待包裝</div>
          <div className="stat-card-value">{queue.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">今日已包裝</div>
          <div className="stat-card-value">{todayRecords.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待出貨</div>
          <div className="stat-card-value">{pickedUp}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">🗂️</span> 待包裝任務佇列</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>任務編號</th>
                <th>收件人</th>
                <th>重量預估 (kg)</th>
                <th>物流商</th>
                <th>動作</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>目前無待包裝任務</td></tr>
              ) : queue.map(job => (
                <tr key={job.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{job.job_number || job.id}</td>
                  <td>{job.recipient_name || '-'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{job.estimated_weight_kg ?? '-'}</td>
                  <td>
                    <span className="badge badge-info"><span className="badge-dot"></span>{job.carrier_configs?.name || '-'}</span>
                  </td>
                  <td>
                    <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => { setPackTarget(job); setForm(initPack) }}>
                      開始包裝
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">✅</span> 今日包裝記錄</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>任務編號</th>
                <th>箱數</th>
                <th>重量 (kg)</th>
                <th>包裝員</th>
                <th>完成時間</th>
              </tr>
            </thead>
            <tbody>
              {todayRecords.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>今日尚無包裝記錄</td></tr>
              ) : todayRecords.map(r => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.job_id}</td>
                  <td>{r.box_count}</td>
                  <td>{r.total_weight_kg}</td>
                  <td>{r.employees?.name || r.packer_id || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.packed_at ? new Date(r.packed_at).toLocaleTimeString('zh-TW') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {packTarget && (
        <Modal
          title={`包裝作業 — ${packTarget.job_number || packTarget.id}`}
          onClose={() => { setPackTarget(null); setForm(initPack) }}
          onSubmit={handlePack}
          submitLabel={submitting ? '處理中…' : '完成包裝'}
          submitDisabled={submitting}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="箱數" required>
              <input className="form-input" type="number" style={{ width: '100%' }} min={1} value={form.boxCount} onChange={e => set('boxCount', e.target.value)} />
            </Field>
            <Field label="實際重量 kg" required>
              <input className="form-input" type="number" style={{ width: '100%' }} step="0.01" placeholder="0.00" value={form.totalWeightKg} onChange={e => set('totalWeightKg', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="長 cm">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.l} onChange={e => set('l', e.target.value)} />
            </Field>
            <Field label="寬 cm">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.w} onChange={e => set('w', e.target.value)} />
            </Field>
            <Field label="高 cm">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.h} onChange={e => set('h', e.target.value)} />
            </Field>
          </div>
          <Field label="包裝員 ID" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="輸入員工 ID" value={form.packerId} onChange={e => set('packerId', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
