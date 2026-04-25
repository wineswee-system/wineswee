import { useState, useEffect } from 'react'
import { RefreshCw, Plus, Star, Trash2, Link2, Users, MessageCircle, Terminal, Search, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getLineGroups, getLineMessages } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

export default function LineIntegration() {
  const { profile } = useAuth()
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

  // Backtrack (smart rebind from line_users / line_messages)
  const [showBacktrack, setShowBacktrack] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [scanning, setScanning] = useState(false)
  const [candidateOverrides, setCandidateOverrides] = useState({}) // key → employee_id

  useEffect(() => { loadData() }, [profile?.organization_id])

  async function loadData() {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [ch, acc, emp, grp, msg, cmd] = await Promise.all([
        supabase.from('line_channels').select('*').order('is_default', { ascending: false }).order('name'),
        supabase.from('employee_line_accounts').select('*, employees(name, department_id, position, departments!department_id(name)), line_channels(code, name)').order('linked_at', { ascending: false }),
        supabase.from('employees').select('id, name, dept, department_id, position, status, departments!department_id(name)').eq('status', '在職').eq('organization_id', orgId).order('name'),
        getLineGroups(),
        getLineMessages(),
        supabase.from('line_command_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      const results = [
        ['line_channels', ch],
        ['employee_line_accounts', acc],
        ['employees', emp],
        ['line_groups', grp],
        ['line_messages', msg],
        ['line_command_logs', cmd],
      ]
      const errs = results.filter(([, r]) => r?.error).map(([t, r]) => `${t}: ${r.error.message}`)
      if (errs.length) {
        console.error('[LineIntegration] Supabase errors:', results.filter(([, r]) => r?.error))
        setError(errs.join(' | '))
      }
      setChannels(ch.data || [])
      setAccounts(acc.data || [])
      setEmployees(emp.data || [])
      setLineGroups(grp.data || [])
      setLineMessages(msg.data || [])
      setCommandLogs(cmd.data || [])
    } catch (err) {
      console.error('[LineIntegration] Unexpected load error:', err)
      setError('資料載入失敗：' + (err?.message || 'unknown'))
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

  // ── Backtrack: discover unbound LINE users from line_users + line_messages ──
  const candidateKey = (c) => `${c.channel_id}:${c.line_user_id}`

  async function scanBacktrackCandidates() {
    setScanning(true)
    setShowBacktrack(true)
    try {
      const [boundRes, usersRes, msgsRes, cmdsRes] = await Promise.all([
        supabase.from('employee_line_accounts').select('channel_id, line_user_id'),
        supabase.from('line_users').select('channel_id, line_user_id, display_name, employee_id'),
        supabase.from('line_messages').select('channel_id, line_user_id, display_name, created_at').not('line_user_id', 'is', null),
        supabase.from('line_command_logs').select('channel_id, line_user_id, display_name').not('line_user_id', 'is', null),
      ])
      const bound = new Set((boundRes.data || []).map(b => `${b.channel_id}:${b.line_user_id}`))
      const seen = new Map()
      const ingest = (row, source) => {
        if (!row?.channel_id || !row?.line_user_id) return
        const key = `${row.channel_id}:${row.line_user_id}`
        if (bound.has(key)) return
        const prev = seen.get(key) || { sources: [], last_seen_at: null, message_count: 0 }
        seen.set(key, {
          channel_id: row.channel_id,
          line_user_id: row.line_user_id,
          display_name: row.display_name || prev.display_name,
          existing_employee_id: row.employee_id ?? prev.existing_employee_id,
          sources: prev.sources.includes(source) ? prev.sources : [...prev.sources, source],
          last_seen_at: row.created_at && (!prev.last_seen_at || row.created_at > prev.last_seen_at) ? row.created_at : prev.last_seen_at,
          message_count: prev.message_count + (source === 'line_messages' ? 1 : 0),
        })
      }
      for (const u of usersRes.data || []) ingest(u, 'line_users')
      for (const m of msgsRes.data || []) ingest(m, 'line_messages')
      for (const c of cmdsRes.data || []) ingest(c, 'line_command_logs')

      const empByName = new Map(employees.map(e => [e.name, e]))
      const list = [...seen.values()].map(c => {
        if (c.existing_employee_id) {
          const emp = employees.find(e => e.id === c.existing_employee_id)
          return { ...c, matched_employee_id: c.existing_employee_id, matched_name: emp?.name || `#${c.existing_employee_id}`, confidence: 'exact' }
        }
        if (c.display_name) {
          const exact = empByName.get(c.display_name)
          if (exact) return { ...c, matched_employee_id: exact.id, matched_name: exact.name, confidence: 'exact' }
          const partial = employees.find(e =>
            e.name && (c.display_name.includes(e.name) || e.name.includes(c.display_name))
          )
          if (partial) return { ...c, matched_employee_id: partial.id, matched_name: partial.name, confidence: 'partial' }
        }
        return { ...c, matched_employee_id: null, matched_name: null, confidence: 'none' }
      })
      list.sort((a, b) => {
        const rank = { exact: 0, partial: 1, none: 2 }
        if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] - rank[b.confidence]
        return (b.message_count || 0) - (a.message_count || 0)
      })
      setCandidates(list)
      setCandidateOverrides({})
    } catch (err) {
      console.error('[LineIntegration] scan error:', err)
      alert('掃描失敗：' + (err?.message || 'unknown'))
    }
    setScanning(false)
  }

  async function bindCandidate(c) {
    const empId = candidateOverrides[candidateKey(c)] ?? c.matched_employee_id
    if (!empId) { alert('請先選擇員工'); return }
    const { error: err } = await supabase.from('employee_line_accounts').upsert({
      employee_id: Number(empId),
      channel_id: c.channel_id,
      line_user_id: c.line_user_id,
      display_name: c.display_name || null,
      is_primary: true,
      is_verified: false,
    }, { onConflict: 'channel_id,line_user_id' })
    if (err) { alert('綁定失敗：' + err.message); return }
    // Also set employee_id on line_users so the webhook recognises this user going forward
    await supabase.from('line_users').update({ employee_id: Number(empId) })
      .eq('channel_id', c.channel_id).eq('line_user_id', c.line_user_id)
    setCandidates(prev => prev.filter(x => candidateKey(x) !== candidateKey(c)))
    await loadData()
  }

  async function bindAllExact() {
    const exacts = candidates.filter(c => c.confidence === 'exact' && (candidateOverrides[candidateKey(c)] ?? c.matched_employee_id))
    if (!exacts.length) { alert('沒有完全對應的候選'); return }
    if (!confirm(`將 ${exacts.length} 筆完全對應的候選一次綁定？`)) return
    setScanning(true)
    const rows = exacts.map(c => ({
      employee_id: Number(candidateOverrides[candidateKey(c)] ?? c.matched_employee_id),
      channel_id: c.channel_id,
      line_user_id: c.line_user_id,
      display_name: c.display_name || null,
      is_primary: true,
      is_verified: false,
    }))
    const { error: err } = await supabase.from('employee_line_accounts')
      .upsert(rows, { onConflict: 'channel_id,line_user_id' })
    if (err) {
      alert('批次綁定失敗：' + err.message)
    } else {
      for (const r of rows) {
        await supabase.from('line_users').update({ employee_id: r.employee_id })
          .eq('channel_id', r.channel_id).eq('line_user_id', r.line_user_id)
      }
      const boundKeys = new Set(rows.map(r => `${r.channel_id}:${r.line_user_id}`))
      setCandidates(prev => prev.filter(c => !boundKeys.has(candidateKey(c))))
      await loadData()
    }
    setScanning(false)
  }

  if (loading) return <LoadingSpinner />

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

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 8,
          background: 'var(--accent-red-dim, #fee)', color: 'var(--accent-red, #c00)',
          border: '1px solid var(--accent-red, #c00)', fontSize: 13,
        }}>
          <strong>⚠ 部分資料載入失敗：</strong> {error}
        </div>
      )}

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
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setShowLinkModal(true)}>
              <Link2 size={14} /> 新增綁定
            </button>
            <button className="btn btn-secondary" onClick={scanBacktrackCandidates} disabled={scanning}>
              <Search size={14} /> {scanning ? '掃描中…' : '掃描未綁定使用者'}
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
                  <span style={{ color: 'var(--text-muted)' }}>Webhook 建議 URL 後綴</span>
                  <code style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>
                    ?channel={ch.code}
                  </code>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>必要環境變數</span>
                  <code style={{ fontSize: 11, color: 'var(--accent-orange)', textAlign: 'right' }}>
                    LINE_CHANNEL_SECRET_{ch.code.toUpperCase().replace(/-/g, '_')}<br />
                    LINE_CHANNEL_ACCESS_TOKEN_{ch.code.toUpperCase().replace(/-/g, '_')}
                  </code>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--accent-cyan-dim)', borderRadius: 10, fontSize: 12 }}>
              <strong>Edge Function 環境變數清單（supabase secrets set ...）：</strong>
              <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
{[
  ...channels.flatMap(ch => {
    const s = ch.code.toUpperCase().replace(/-/g, '_')
    return [
      `LINE_CHANNEL_SECRET_${s}=...`,
      `LINE_CHANNEL_ACCESS_TOKEN_${s}=...`,
    ]
  }),
  '# LINE Login（單一 OA）',
  'LINE_LOGIN_CHANNEL_ID=...',
  'LINE_LOGIN_CHANNEL_SECRET=...',
].join('\n')}
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

      {/* ══ Backtrack Scan Modal ══ */}
      {showBacktrack && (
        <div className="modal-backdrop" onClick={() => setShowBacktrack(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" onClick={e => e.stopPropagation()}
            style={{ width: 'min(960px, 92vw)', maxHeight: '88vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}><Wand2 size={18} style={{ verticalAlign: -3 }} /> 回填員工綁定</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  從 <code>line_users</code>、<code>line_messages</code>、<code>line_command_logs</code> 偵測尚未綁定的 LINE 使用者，並以顯示名稱對應到員工。
                </p>
              </div>
              <button className="btn btn-sm" onClick={() => setShowBacktrack(false)}>關閉</button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-secondary" onClick={scanBacktrackCandidates} disabled={scanning}>
                <RefreshCw size={12} /> 重新掃描
              </button>
              <button className="btn btn-sm btn-primary" onClick={bindAllExact} disabled={scanning || !candidates.some(c => c.confidence === 'exact')}>
                一鍵綁定所有完全對應 ({candidates.filter(c => c.confidence === 'exact').length})
              </button>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                共 {candidates.length} 筆候選
              </div>
            </div>

            {scanning && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>掃描中…</div>}

            {!scanning && candidates.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                沒有可回填的候選 — 所有在 LINE 側有紀錄的使用者都已完成綁定。
              </div>
            )}

            {!scanning && candidates.length > 0 && (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>LINE 顯示名稱</th>
                      <th>User ID</th>
                      <th>OA</th>
                      <th>訊息 / 來源</th>
                      <th>最後活動</th>
                      <th>對應員工</th>
                      <th>綁定</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map(c => {
                      const key = candidateKey(c)
                      const override = candidateOverrides[key]
                      const selected = override ?? c.matched_employee_id ?? ''
                      const badge = c.confidence === 'exact' ? 'badge-success' : c.confidence === 'partial' ? 'badge-warning' : 'badge-neutral'
                      const badgeLabel = c.confidence === 'exact' ? '完全對應' : c.confidence === 'partial' ? '部分對應' : '未對應'
                      const channelName = channels.find(ch => ch.id === c.channel_id)?.name || `#${c.channel_id}`
                      return (
                        <tr key={key}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{c.display_name || '—'}</div>
                            <div><span className={`badge ${badge}`} style={{ fontSize: 10 }}>{badgeLabel}</span></div>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                            {c.line_user_id?.slice(0, 14)}…
                          </td>
                          <td style={{ fontSize: 12 }}>{channelName}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {c.message_count > 0 && <>{c.message_count} 則訊息 · </>}
                            {c.sources.join(', ')}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {c.last_seen_at ? new Date(c.last_seen_at).toLocaleDateString('zh-TW') : '—'}
                          </td>
                          <td>
                            <select className="form-input" style={{ fontSize: 12, minWidth: 160 }}
                              value={selected}
                              onChange={e => setCandidateOverrides(prev => ({ ...prev, [key]: e.target.value ? Number(e.target.value) : null }))}>
                              <option value="">— 請選擇 —</option>
                              {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.name}{emp.id === c.matched_employee_id ? ' ★' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button className="btn btn-sm btn-primary" onClick={() => bindCandidate(c)}
                              disabled={!selected}>
                              <Link2 size={11} /> 綁定
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Link Employee Modal ══ */}
      {showLinkModal && (
        <Modal title="綁定員工到 LINE 官方帳號" onClose={() => setShowLinkModal(false)} onSubmit={handleLinkEmployee}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={linkForm.employee_id}
              onChange={e => setLinkForm(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">請選擇員工</option>
              {employees.map(e => <option key={e.id} value={e.id}>{empLabel(e)} ({e.dept} · {e.position})</option>)}
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
