import { useState, useEffect } from 'react'
import { RefreshCw, Plus, Star, Trash2, Link2, Users, MessageCircle, Terminal } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getLineGroups, getLineMessages } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function LineIntegration() {
  const [channels, setChannels] = useState([])
  const [accounts, setAccounts] = useState([])
  const [employees, setEmployees] = useState([])
  const [lineGroups, setLineGroups] = useState([])
  const [lineMessages, setLineMessages] = useState([])
  const [commandLogs, setCommandLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('channels')
  const [saving, setSaving] = useState(null)

  // Modals
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [channelForm, setChannelForm] = useState({ code: '', name: '', channel_id: '', liff_id: '', webhook_url: '' })
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkForm, setLinkForm] = useState({ employee_id: '', channel_id: '', line_user_id: '', is_primary: true })
  const [filterChannel, setFilterChannel] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [ch, acc, emp, grp, msg, cmd] = await Promise.all([
        supabase.from('line_channels').select('*').order('is_default', { ascending: false }).order('name'),
        supabase.from('employee_line_accounts').select('*, employees(name, dept, position), line_channels(code, name)').order('linked_at', { ascending: false }),
        supabase.from('employees').select('id, name, dept, position, status, line_user_id').eq('status', '在職').order('name'),
        getLineGroups(),
        getLineMessages(),
        supabase.from('line_command_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      setChannels(ch.data || [])
      setAccounts(acc.data || [])
      setEmployees(emp.data || [])
      setLineGroups(grp.data || [])
      setLineMessages(msg.data || [])
      setCommandLogs(cmd.data || [])
    } catch (err) {
      setError('資料載入失敗')
    }
    setLoading(false)
  }

  // ── Channel CRUD ──
  const handleAddChannel = async () => {
    if (!channelForm.code || !channelForm.name) return
    const { data } = await supabase.from('line_channels').insert({
      ...channelForm,
      is_default: channels.length === 0,
    }).select().single()
    if (data) {
      setChannels(prev => [...prev, data])
      setShowAddChannel(false)
      setChannelForm({ code: '', name: '', channel_id: '', liff_id: '', webhook_url: '' })
    }
  }

  const handleSetDefault = async (id) => {
    // Clear all defaults, then set this one
    await supabase.from('line_channels').update({ is_default: false }).neq('id', 0)
    const { data } = await supabase.from('line_channels').update({ is_default: true }).eq('id', id).select().single()
    if (data) setChannels(prev => prev.map(c => ({ ...c, is_default: c.id === id })))
  }

  const handleDeleteChannel = async (id) => {
    if (!confirm('確定刪除此 LINE 官方帳號？關聯的員工綁定也會被刪除。')) return
    await supabase.from('line_channels').delete().eq('id', id)
    setChannels(prev => prev.filter(c => c.id !== id))
    setAccounts(prev => prev.filter(a => a.channel_id !== id))
  }

  // ── Link employee to OA ──
  const handleLinkEmployee = async () => {
    if (!linkForm.employee_id || !linkForm.channel_id || !linkForm.line_user_id) return
    setSaving('link')
    const { data, error: err } = await supabase.from('employee_line_accounts').insert({
      employee_id: Number(linkForm.employee_id),
      channel_id: Number(linkForm.channel_id),
      line_user_id: linkForm.line_user_id,
      is_primary: linkForm.is_primary,
    }).select('*, employees(name, dept, position), line_channels(code, name)').single()
    if (err) {
      alert(err.message.includes('unique') ? '此員工已綁定到此 OA，或此 LINE ID 已被使用' : err.message)
    } else if (data) {
      setAccounts(prev => [...prev, data])
      setShowLinkModal(false)
      setLinkForm({ employee_id: '', channel_id: '', line_user_id: '', is_primary: true })
    }
    setSaving(null)
  }

  const handleUnlink = async (id) => {
    if (!confirm('確定解除此綁定？')) return
    await supabase.from('employee_line_accounts').delete().eq('id', id)
    setAccounts(prev => prev.filter(a => a.id !== id))
  }

  const handleTogglePrimary = async (id, currentPrimary, employeeId) => {
    if (currentPrimary) return // already primary
    // Clear primary on all accounts for this employee, then set this one
    const empAccounts = accounts.filter(a => a.employee_id === employeeId)
    for (const a of empAccounts) {
      if (a.is_primary) await supabase.from('employee_line_accounts').update({ is_primary: false }).eq('id', a.id)
    }
    const { data } = await supabase.from('employee_line_accounts').update({ is_primary: true }).eq('id', id).select('*, employees(name, dept, position), line_channels(code, name)').single()
    if (data) {
      setAccounts(prev => prev.map(a => {
        if (a.employee_id === employeeId) return a.id === id ? data : { ...a, is_primary: false }
        return a
      }))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  const filteredAccounts = filterChannel
    ? accounts.filter(a => a.channel_id === Number(filterChannel))
    : accounts

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
            <p>管理多個 LINE 官方帳號、員工綁定</p>
          </div>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={14} /> 重新整理</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={tabStyle(tab === 'channels')} onClick={() => setTab('channels')}>
          📡 官方帳號 ({channels.length})
        </button>
        <button style={tabStyle(tab === 'accounts')} onClick={() => setTab('accounts')}>
          👤 員工綁定 ({accounts.length})
        </button>
        <button style={tabStyle(tab === 'groups')} onClick={() => setTab('groups')}>
          <Users size={14} /> 群組 ({lineGroups.length})
        </button>
        <button style={tabStyle(tab === 'messages')} onClick={() => setTab('messages')}>
          <MessageCircle size={14} /> 訊息 ({lineMessages.length})
        </button>
        <button style={tabStyle(tab === 'commands')} onClick={() => setTab('commands')}>
          <Terminal size={14} /> 指令 ({commandLogs.length})
        </button>
        <button style={tabStyle(tab === 'webhook')} onClick={() => setTab('webhook')}>
          🔗 Webhook 設定
        </button>
      </div>

      {/* ══ Channels Tab ══ */}
      {tab === 'channels' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => setShowAddChannel(true)}>
              <Plus size={14} /> 新增官方帳號
            </button>
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {channels.map(ch => (
              <div key={ch.id} className="card" style={{ padding: 20, position: 'relative' }}>
                {ch.is_default && (
                  <span style={{
                    position: 'absolute', top: 12, right: 12,
                    background: 'var(--accent-green-dim)', color: 'var(--accent-green)',
                    padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  }}>預設</span>
                )}
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>{ch.name}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'monospace' }}>{ch.code}</div>

                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  {ch.channel_id && <div>Channel ID: <code style={{ color: 'var(--accent-cyan)' }}>{ch.channel_id}</code></div>}
                  {ch.liff_id && <div>LIFF ID: <code style={{ color: 'var(--accent-cyan)' }}>{ch.liff_id}</code></div>}
                  {ch.webhook_url && <div>Webhook: <code style={{ color: 'var(--accent-cyan)', wordBreak: 'break-all' }}>{ch.webhook_url}</code></div>}
                  <div>員工綁定: <strong>{accounts.filter(a => a.channel_id === ch.id).length}</strong> 人</div>
                  <div>狀態: <span className={`badge ${ch.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{ch.status}</span></div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {!ch.is_default && (
                    <button className="btn btn-sm btn-secondary" onClick={() => handleSetDefault(ch.id)} style={{ fontSize: 11 }}>
                      <Star size={11} /> 設為預設
                    </button>
                  )}
                  <button className="btn btn-sm btn-secondary" onClick={() => handleDeleteChannel(ch.id)}
                    style={{ fontSize: 11, color: 'var(--accent-red)' }}>
                    <Trash2 size={11} /> 刪除
                  </button>
                </div>
              </div>
            ))}
            {channels.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                尚無官方帳號，請點擊「新增官方帳號」開始設定
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ Employee Accounts Tab ══ */}
      {tab === 'accounts' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={() => setShowLinkModal(true)}>
              <Link2 size={14} /> 新增綁定
            </button>
            <select className="form-input" style={{ fontSize: 13, minWidth: 180 }}
              value={filterChannel} onChange={e => setFilterChannel(e.target.value)}>
              <option value="">全部官方帳號</option>
              {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name} ({ch.code})</option>)}
            </select>
          </div>

          <div className="card">
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>官方帳號</th>
                    <th>LINE 使用者 ID</th>
                    <th>LINE 名稱</th>
                    <th>主要</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                      尚無綁定資料
                    </td></tr>
                  )}
                  {filteredAccounts.map(a => (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.employees?.name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.employees?.dept} · {a.employees?.position}</div>
                      </td>
                      <td>
                        <span className="badge badge-neutral">{a.line_channels?.name || '—'}</span>
                      </td>
                      <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {a.line_user_id?.slice(0, 16)}...
                      </td>
                      <td style={{ fontSize: 13 }}>{a.display_name || '—'}</td>
                      <td>
                        <button
                          onClick={() => handleTogglePrimary(a.id, a.is_primary, a.employee_id)}
                          style={{
                            background: 'none', border: 'none', cursor: a.is_primary ? 'default' : 'pointer',
                            color: a.is_primary ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: 16,
                          }}
                          title={a.is_primary ? '主要帳號' : '設為主要'}>
                          {a.is_primary ? '⭐' : '☆'}
                        </button>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleUnlink(a.id)}
                          style={{ fontSize: 11, color: 'var(--accent-red)' }}>
                          解除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══ Groups Tab ══ */}
      {tab === 'groups' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Users size={16} /></span> LINE 群組</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>群組名稱</th><th>LINE Group ID</th><th>類型</th><th>狀態</th><th>加入時間</th></tr>
              </thead>
              <tbody>
                {lineGroups.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無群組資料（群組由 LINE Webhook 自動建立）</td></tr>}
                {lineGroups.map(g => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}>{g.group_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{g.line_group_id}</td>
                    <td><span className={`badge ${g.group_type === 'store' ? 'badge-green' : g.group_type === 'department' ? 'badge-purple' : 'badge-cyan'}`}>{g.group_type}</span></td>
                    <td><span className={`badge ${g.is_active ? 'badge-success' : 'badge-danger'}`}><span className="badge-dot"></span>{g.is_active ? '使用中' : '已離開'}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{g.joined_at ? new Date(g.joined_at).toLocaleDateString('zh-TW') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Messages Tab ══ */}
      {tab === 'messages' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><MessageCircle size={16} /></span> 訊息紀錄（最近 100 則）</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>時間</th><th>方向</th><th>使用者</th><th>訊息</th><th>群組</th></tr>
              </thead>
              <tbody>
                {lineMessages.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無訊息紀錄</td></tr>}
                {lineMessages.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{m.created_at ? new Date(m.created_at).toLocaleString('zh-TW') : '-'}</td>
                    <td><span className={`badge ${m.direction === 'incoming' ? 'badge-cyan' : 'badge-green'}`}>{m.direction === 'incoming' ? '收' : '發'}</span></td>
                    <td style={{ fontSize: 13 }}>{m.display_name || m.line_user_id?.slice(0, 8)}</td>
                    <td style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.message_text}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.group_id || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Commands Tab ══ */}
      {tab === 'commands' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Terminal size={16} /></span> 指令紀錄（最近 100 則）</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>時間</th><th>使用者</th><th>指令</th><th>原始輸入</th><th>成功</th><th>耗時</th></tr>
              </thead>
              <tbody>
                {commandLogs.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無指令紀錄</td></tr>}
                {commandLogs.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.created_at ? new Date(c.created_at).toLocaleString('zh-TW') : '-'}</td>
                    <td style={{ fontSize: 13 }}>{c.display_name || c.line_user_id?.slice(0, 8)}</td>
                    <td><span className="badge badge-purple">{c.command_matched}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.raw_input}</td>
                    <td><span className={`badge ${c.success ? 'badge-success' : 'badge-danger'}`}>{c.success ? 'OK' : 'FAIL'}</span></td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.execution_ms ? `${c.execution_ms}ms` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Webhook Tab ══ */}
      {tab === 'webhook' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔗</span> Webhook 設定指南</div>
          </div>
          <div style={{ padding: '12px 0', fontSize: 13 }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              每個官方帳號需在 LINE Developer Console 設定獨立的 Webhook URL。
            </p>

            {channels.map(ch => (
              <div key={ch.id} style={{
                padding: '14px 16px', marginBottom: 10, borderRadius: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{ch.name} ({ch.code})</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Webhook URL</span>
                  {ch.webhook_url ? (
                    <code style={{ fontSize: 12, color: 'var(--accent-cyan)', cursor: 'pointer' }}
                      onClick={() => { navigator.clipboard?.writeText(ch.webhook_url); alert('已複製！') }}>
                      {ch.webhook_url}
                    </code>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未設定</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Edge Function Token 環境變數</span>
                  <code style={{ fontSize: 12, color: 'var(--accent-orange)' }}>
                    LINE_CHANNEL_TOKEN_{ch.code.toUpperCase().replace(/-/g, '_')}
                  </code>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--accent-cyan-dim)', borderRadius: 10, fontSize: 12 }}>
              <strong>Edge Function 環境變數設定：</strong>
              <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
{channels.map(ch => `LINE_CHANNEL_TOKEN_${ch.code.toUpperCase().replace(/-/g, '_')}=your_token_here`).join('\n')}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ══ Add Channel Modal ══ */}
      {showAddChannel && (
        <Modal title="新增 LINE 官方帳號" onClose={() => setShowAddChannel(false)} onSubmit={handleAddChannel}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="帳號代碼 *">
              <input className="form-input" style={{ width: '100%' }} placeholder="e.g. sme-ops"
                value={channelForm.code} onChange={e => setChannelForm(f => ({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
            </Field>
            <Field label="帳號名稱 *">
              <input className="form-input" style={{ width: '100%' }} placeholder="e.g. SME Ops 官方帳號"
                value={channelForm.name} onChange={e => setChannelForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
          </div>
          <Field label="LINE Channel ID">
            <input className="form-input" style={{ width: '100%' }} placeholder="從 LINE Developer Console 取得"
              value={channelForm.channel_id} onChange={e => setChannelForm(f => ({ ...f, channel_id: e.target.value }))} />
          </Field>
          <Field label="LIFF ID">
            <input className="form-input" style={{ width: '100%' }} placeholder="LIFF App ID"
              value={channelForm.liff_id} onChange={e => setChannelForm(f => ({ ...f, liff_id: e.target.value }))} />
          </Field>
          <Field label="Webhook URL">
            <input className="form-input" style={{ width: '100%' }} placeholder="https://..."
              value={channelForm.webhook_url} onChange={e => setChannelForm(f => ({ ...f, webhook_url: e.target.value }))} />
          </Field>
        </Modal>
      )}

      {/* ══ Link Employee Modal ══ */}
      {showLinkModal && (
        <Modal title="綁定員工到 LINE 官方帳號" onClose={() => setShowLinkModal(false)} onSubmit={handleLinkEmployee}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={linkForm.employee_id}
              onChange={e => setLinkForm(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">請選擇員工</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.dept} · {e.position})</option>)}
            </select>
          </Field>
          <Field label="官方帳號 *">
            <select className="form-input" style={{ width: '100%' }} value={linkForm.channel_id}
              onChange={e => setLinkForm(f => ({ ...f, channel_id: e.target.value }))}>
              <option value="">請選擇官方帳號</option>
              {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name} ({ch.code})</option>)}
            </select>
          </Field>
          <Field label="LINE User ID *">
            <input className="form-input" style={{ width: '100%' }} placeholder="U1234567890abcdef..."
              value={linkForm.line_user_id} onChange={e => setLinkForm(f => ({ ...f, line_user_id: e.target.value }))} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              員工在 LINE 聊天室傳訊後，Webhook 會自動帶入 User ID。也可手動輸入。
            </div>
          </Field>
          <Field label="">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={linkForm.is_primary}
                onChange={e => setLinkForm(f => ({ ...f, is_primary: e.target.checked }))} />
              設為此員工的主要 LINE 帳號（通知優先使用）
            </label>
          </Field>
        </Modal>
      )}
    </div>
  )
}
