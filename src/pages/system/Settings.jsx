import { useState, useEffect } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

const ROLES = ['管理員', '經理', '主管', '員工']
const ACCESS_LEVELS = ['完整', '唯讀']

export default function SystemSettings() {
  const [tab, setTab] = useState('modules') // modules | company | attendance | notifications
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [companyForm, setCompanyForm] = useState({
    name: 'Master AI 科技有限公司', taxId: '12345678', phone: '02-2345-6789', address: '台北市信義區信義路五段7號',
  })
  const [attendanceForm, setAttendanceForm] = useState({
    startTime: '09:00', endTime: '18:00', lateThreshold: '5', breakTime: '12:00 - 13:00',
  })
  const [notifications, setNotifications] = useState({
    lateNotify: true, leaveReminder: true, taskOverdue: true, salaryNotify: false,
  })

  useEffect(() => {
    supabase.from('module_access').select('*').order('sort_order')
      .then(({ data }) => { setModules(data || []); setLoading(false) })
  }, [])

  const updateModule = async (id, field, value) => {
    setModules(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
    await supabase.from('module_access').update({ [field]: value }).eq('id', id)
  }

  const enabledCount = modules.filter(m => m.enabled).length
  const disabledCount = modules.filter(m => !m.enabled).length

  const tabStyle = (active) => ({
    padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 13, fontWeight: 600,
  })

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⚙️</span> 系統設定</h2>
            <p>管理模組存取權限與系統參數</p>
          </div>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}><RefreshCw size={14} /> 重新整理</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'modules', label: '模組存取控制' },
          { key: 'company', label: '公司資訊' },
          { key: 'attendance', label: '出勤設定' },
          { key: 'notifications', label: '通知設定' },
        ].map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'modules' && (
        <>
          {/* Stats */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">已啟用模組</div>
              <div className="stat-card-value">{enabledCount}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
              <div className="stat-card-label">已停用模組</div>
              <div className="stat-card-value">{disabledCount}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">總模組數</div>
              <div className="stat-card-value">{modules.length}</div>
            </div>
          </div>

          {/* Module Access Table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🔐</span> 模組存取控制</div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '35%' }}>模組名稱</th>
                    <th>最低權限</th>
                    <th>存取範圍</th>
                    <th style={{ width: 80 }}>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map(m => (
                    <tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 20 }}>{m.icon}</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{m.path}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select className="form-input" style={{ width: 120, fontSize: 13, padding: '6px 10px' }}
                          value={m.min_role} onChange={e => updateModule(m.id, 'min_role', e.target.value)}>
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="form-input" style={{ width: 100, fontSize: 13, padding: '6px 10px' }}
                          value={m.access_level} onChange={e => updateModule(m.id, 'access_level', e.target.value)}>
                          {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </td>
                      <td>
                        <div
                          onClick={() => updateModule(m.id, 'enabled', !m.enabled)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          }}
                        >
                          <div style={{
                            width: 40, height: 22, borderRadius: 11,
                            background: m.enabled ? 'var(--accent-cyan)' : 'var(--border-strong)',
                            position: 'relative', transition: 'background 0.2s',
                          }}>
                            <div style={{
                              width: 16, height: 16, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: m.enabled ? 21 : 3,
                              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                          </div>
                          <span style={{ fontSize: 12, color: m.enabled ? 'var(--accent-cyan)' : 'var(--text-muted)', fontWeight: 600 }}>
                            {m.enabled ? '啟用' : '停用'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'company' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🏢</span> 公司資訊</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: '公司名稱', key: 'name' },
              { label: '統一編號', key: 'taxId' },
              { label: '電話', key: 'phone' },
              { label: '地址', key: 'address' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input className="form-input" value={companyForm[f.key]} onChange={e => setCompanyForm(p => ({ ...p, [f.key]: e.target.value }))} style={{ width: '100%' }} />
              </div>
            ))}
            <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }}><Save size={14} /> 儲存</button>
          </div>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">⏰</span> 出勤設定</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: '標準上班時間', key: 'startTime' },
              { label: '標準下班時間', key: 'endTime' },
              { label: '遲到門檻（分鐘）', key: 'lateThreshold' },
              { label: '休息時間', key: 'breakTime' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input className="form-input" value={attendanceForm[f.key]} onChange={e => setAttendanceForm(p => ({ ...p, [f.key]: e.target.value }))} style={{ width: '100%' }} />
              </div>
            ))}
            <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }}><Save size={14} /> 儲存</button>
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔔</span> 通知設定</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: '遲到自動通知', key: 'lateNotify' },
              { label: '請假待審提醒', key: 'leaveReminder' },
              { label: '任務逾期通知', key: 'taskOverdue' },
              { label: '薪資核發通知', key: 'salaryNotify' },
            ].map(f => (
              <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14 }}>{f.label}</span>
                <div
                  onClick={() => setNotifications(p => ({ ...p, [f.key]: !p[f.key] }))}
                  style={{
                    width: 40, height: 22, borderRadius: 11,
                    background: notifications[f.key] ? 'var(--accent-cyan)' : 'var(--border-strong)',
                    position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3, left: notifications[f.key] ? 21 : 3,
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </div>
              </div>
            ))}
            <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }}><Save size={14} /> 儲存</button>
          </div>
        </div>
      )}
    </div>
  )
}
