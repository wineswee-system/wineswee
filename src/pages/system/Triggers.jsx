import { useState, useEffect } from 'react'
import { Plus, Play, Pause } from 'lucide-react'
import { getTriggers, updateTrigger } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const TYPES = ['排程', '事件']

export default function Triggers() {
  const [triggers, setTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', type: TYPES[0], schedule: '', action: '' })

  useEffect(() => {
    getTriggers().then(({ data }) => { setTriggers(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleStatus = async (t) => {
    const newStatus = t.status === '啟用' ? '停用' : '啟用'
    const { data } = await updateTrigger(t.id, { status: newStatus })
    if (data) setTriggers(prev => prev.map(x => x.id === t.id ? data : x))
  }

  const handleSubmit = async () => {
    if (!form.name || !form.action) return
    const { data } = await supabase.from('triggers').insert({ ...form, status: '停用' }).select().single()
    if (data) {
      setTriggers(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', type: TYPES[0], schedule: '', action: '' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const formatTime = (ts) => ts ? new Date(ts).toLocaleString('zh-TW') : '-'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⚡</span> 觸發器</h2>
            <p>自動化觸發規則管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增觸發器</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中</div>
          <div className="stat-card-value">{triggers.filter(t => t.status === '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已停用</div>
          <div className="stat-card-value">{triggers.filter(t => t.status === '停用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總計</div>
          <div className="stat-card-value">{triggers.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>名稱</th><th>類型</th><th>排程</th><th>動作</th><th>最後執行</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {triggers.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td><span className={`badge ${t.type === '排程' ? 'badge-info' : 'badge-purple'}`}>{t.type}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.schedule}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.action}</td>
                  <td style={{ fontSize: 12 }}>{formatTime(t.last_run)}</td>
                  <td><span className={`badge ${t.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}><span className="badge-dot"></span>{t.status}</span></td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => toggleStatus(t)}>
                      {t.status === '啟用' ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增觸發器" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="每日打卡提醒" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="排程 (Cron)">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0 9 * * 1-5" value={form.schedule} onChange={e => set('schedule', e.target.value)} />
          </Field>
          <Field label="執行動作 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="發送打卡提醒通知" value={form.action} onChange={e => set('action', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
