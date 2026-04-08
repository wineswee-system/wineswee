import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function LineIntegration() {
  const [lineUsers, setLineUsers] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('users')
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('line_users').select('*').order('last_active', { ascending: false }),
      supabase.from('employees').select('id, name, dept, position, status, line_user_id').order('name'),
    ]).then(([l, e]) => {
      setLineUsers(l.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleBind = async (lineUserId, employeeName) => {
    setSaving(lineUserId)
    try {
      // Clear old binding if another employee had this line_user_id
      await supabase.from('employees').update({ line_user_id: null }).eq('line_user_id', lineUserId)

      if (employeeName) {
        // Set new binding
        await supabase.from('employees').update({ line_user_id: lineUserId }).eq('name', employeeName)
        // Update line_users table
        await supabase.from('line_users').update({ bound_employee: employeeName }).eq('line_user_id', lineUserId)
      } else {
        await supabase.from('line_users').update({ bound_employee: null }).eq('line_user_id', lineUserId)
      }

      // Refresh
      const [l, e] = await Promise.all([
        supabase.from('line_users').select('*').order('last_active', { ascending: false }),
        supabase.from('employees').select('id, name, dept, position, status, line_user_id').order('name'),
      ])
      setLineUsers(l.data || [])
      setEmployees(e.data || [])
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
    setSaving(null)
  }

  const getBoundEmployee = (lineUserId) => employees.find(e => e.line_user_id === lineUserId)

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const boundCount = lineUsers.filter(u => getBoundEmployee(u.line_user_id)).length
  const unboundCount = lineUsers.length - boundCount

  const tabStyle = (active) => ({
    padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 6,
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💬</span> LINE 管理</h2>
            <p>管理 LINE 使用者、對應員工帳號</p>
          </div>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}><RefreshCw size={14} /> 重新整理</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={tabStyle(tab === 'users')} onClick={() => setTab('users')}>
          👤 LINE 使用者 ({lineUsers.length})
        </button>
        <button style={tabStyle(tab === 'webhook')} onClick={() => setTab('webhook')}>
          🔗 Webhook
        </button>
      </div>

      {tab === 'users' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">已關聯</div>
              <div className="stat-card-value">{boundCount}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">未關聯</div>
              <div className="stat-card-value">{unboundCount}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">LINE 使用者總數</div>
              <div className="stat-card-value">{lineUsers.length}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📋</span> LINE 使用者列表</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>使用者與 Bot 互動後自動出現</span>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>LINE 名稱</th>
                    <th>對應系統使用者</th>
                    <th>狀態</th>
                    <th>最後活動</th>
                  </tr>
                </thead>
                <tbody>
                  {lineUsers.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                      尚無 LINE 使用者<br />
                      <span style={{ fontSize: 12 }}>員工在 LINE 聊天室對 Bot 傳訊後會自動出現在這裡</span>
                    </td></tr>
                  )}
                  {lineUsers.map(u => {
                    const bound = getBoundEmployee(u.line_user_id)
                    const isSaving = saving === u.line_user_id
                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {u.picture_url ? (
                              <img src={u.picture_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border-medium)' }} />
                            ) : (
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-cyan-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                                {u.display_name?.[0] || '?'}
                              </div>
                            )}
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{u.display_name || '未知'}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{u.line_user_id?.slice(0, 12)}...</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            className="form-input"
                            style={{ width: '100%', maxWidth: 220, fontSize: 13, opacity: isSaving ? 0.5 : 1 }}
                            value={bound?.name || ''}
                            disabled={isSaving}
                            onChange={e => handleBind(u.line_user_id, e.target.value)}
                          >
                            <option value="">— 未對應 —</option>
                            {employees.filter(e => e.status === '在職').map(e => (
                              <option key={e.id} value={e.name}>
                                {e.name}（{e.dept} · {e.position}）
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`badge ${bound ? 'badge-success' : 'badge-warning'}`}>
                            <span className="badge-dot"></span>
                            {bound ? '已關聯' : '未關聯'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {u.last_active ? new Date(u.last_active).toLocaleString('zh-TW') : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'webhook' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔗</span> Webhook 設定</div>
          </div>
          <div style={{ padding: '8px 0' }}>
            <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Webhook URL</span>
              <code style={{ fontSize: 12, color: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}
                onClick={() => { navigator.clipboard?.writeText('https://sme-ops-liff.vercel.app/api/webhook'); alert('已複製！') }}>
                https://sme-ops-liff.vercel.app/api/webhook
              </code>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>狀態</span>
              <span className="badge badge-success"><span className="badge-dot"></span>運作中</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>支援指令</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>打卡、薪資、假期、任務、庫存、選單</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>LIFF App</span>
              <a href="https://sme-ops-liff.vercel.app" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>
                sme-ops-liff.vercel.app ↗
              </a>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>LIFF 打卡頁</span>
              <a href="/liff/clock" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>
                /liff/clock（GPS + WiFi IP 驗證）↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
