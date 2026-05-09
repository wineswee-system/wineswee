import { useState, useEffect } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { getHolidays, createHoliday, deleteHoliday, refreshHolidays } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const MONTHS = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']

export default function Holidays() {
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', date: '', type: '國定', multiplier: 2 })
  const [activeYear, setActiveYear] = useState(new Date().getFullYear())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    getHolidays().then(({ data }) => { setHolidays(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name || !form.date) return
    try {
      const { data, error } = await createHoliday({ ...form, multiplier: Number(form.multiplier) || 2 })
      if (error) throw error
      if (data) {
        setHolidays(prev => [...prev, data])
        setShowModal(false)
        setForm({ name: '', date: '', type: '國定', multiplier: 2 })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定刪除此假日？' }))) return
    try {
      const { error } = await deleteHoliday(id)
      if (error) throw error
      setHolidays(prev => prev.filter(h => h.id !== id))
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const yearHolidays = holidays.filter(h => h.date?.startsWith(String(activeYear)))
  const national = yearHolidays.filter(h => h.type === '國定')
  const company = yearHolidays.filter(h => h.type === '公司')

  // Group by month
  const byMonth = {}
  for (let i = 0; i < 12; i++) byMonth[i] = []
  yearHolidays.forEach(h => {
    const m = parseInt(h.date?.slice(5, 7)) - 1
    if (m >= 0 && m < 12) byMonth[m].push(h)
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📅</span> 假日管理</h2>
            <p>管理國定假日與自訂假日</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true)
                try {
                  await refreshHolidays([activeYear, activeYear + 1])
                  const { data } = await getHolidays()
                  setHolidays(data || [])
                  toast.success(`已刷新 ${activeYear} 及 ${activeYear + 1} 年度國定假日`)
                } catch (err) {
                  console.error('Refresh failed:', err)
                  toast.error('刷新失敗：' + (err.message || '未知錯誤'))
                } finally {
                  setRefreshing(false)
                }
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? '刷新中...' : '刷新國定假日'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增假日</button>
          </div>
        </div>
      </div>

      {/* Year Tabs + Stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden' }}>
          {[activeYear - 1, activeYear, activeYear + 1, activeYear + 2].map(y => (
            <button key={y} onClick={() => setActiveYear(y)} style={{
              padding: '8px 20px', border: 'none', fontSize: 14, fontWeight: y === activeYear ? 700 : 500,
              background: y === activeYear ? 'var(--accent-cyan)' : 'var(--bg-card)',
              color: y === activeYear ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}>{y}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>📊 {yearHolidays.length} 個假日</span>
          <span>·</span>
          <span>🏛️ {national.length} 國定</span>
          <span>·</span>
          <span>🏢 {company.length} 公司</span>
        </div>
      </div>

      {/* Monthly Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {MONTHS.map((monthName, mi) => {
          const monthHolidays = byMonth[mi]
          return (
            <div key={mi} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 14, padding: '16px 20px',
              opacity: monthHolidays.length === 0 ? 0.5 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 14 }}>📅</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{monthName}</span>
              </div>

              {monthHolidays.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>無假日</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {monthHolidays.sort((a, b) => a.date.localeCompare(b.date)).map(h => {
                    const day = parseInt(h.date?.slice(8))
                    return (
                      <div key={h.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-cyan)', minWidth: 28 }}>{day}日</span>
                        <span style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: h.type === '國定' ? 'var(--accent-red-dim)' : 'var(--accent-blue-dim)',
                          color: h.type === '國定' ? 'var(--accent-red)' : 'var(--accent-blue)',
                        }}>🏛️</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{h.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.multiplier || 2}×</span>
                        <button onClick={() => handleDelete(h.id)} style={{
                          background: 'none', border: 'none', color: 'var(--accent-red)',
                          cursor: 'pointer', padding: 2, opacity: 0.6,
                        }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showModal && (
        <Modal title="新增假日" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="假日名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：勞動節" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="日期 *">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                <option>國定</option>
                <option>公司</option>
              </select>
            </Field>
          </div>
          <Field label="出勤倍率">
            <select className="form-input" style={{ width: '100%' }} value={form.multiplier} onChange={e => set('multiplier', e.target.value)}>
              <option value={2}>2× (加倍工資)</option>
              <option value={1}>1× (補休)</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
