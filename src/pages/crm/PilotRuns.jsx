import { useState, useEffect, useCallback } from 'react'
import { Plus, PlayCircle, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { getPilotRuns, getSurveys, getMemberGroups, createPilotRun, deletePilotRun, launchPilotRun, approvePilotRun, rejectPilotRun } from '../../lib/db'
import { dispatchDueLineSurveyInvitations } from '../../lib/comms/lineSender'
import { logger } from '../../lib/logger'

const STATUS_META = {
  draft:     { label: '草稿',   color: 'var(--text-muted)',    bg: 'var(--bg-tertiary)' },
  running:   { label: '執行中', color: 'var(--accent-blue)',   bg: 'var(--accent-blue-dim)' },
  completed: { label: '完成',   color: 'var(--accent-cyan)',   bg: 'var(--accent-cyan-dim)' },
  approved:  { label: '已核准', color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)' },
  rejected:  { label: '已拒絕', color: 'var(--accent-red)',    bg: 'var(--accent-red-dim)' },
}

export default function PilotRuns() {
  const { currentOrg } = useTenant()
  const { user }       = useAuth()
  const [pilots, setPilots]   = useState([])
  const [surveys, setSurveys] = useState([])
  const [groups, setGroups]   = useState([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [decideId, setDecideId]     = useState(null)
  const [decideAction, setAction]   = useState(null)
  const [decideNotes, setNotes]     = useState('')
  const [deciding, setDeciding]     = useState(false)
  const [launching, setLaunching]   = useState(null)

  const load = useCallback(async () => {
    if (!currentOrg?.id) return
    setLoading(true)
    const [{ data: p }, { data: s }, { data: g }] = await Promise.all([
      getPilotRuns(currentOrg.id),
      getSurveys(currentOrg.id),
      getMemberGroups(currentOrg.id),
    ])
    setPilots(p || [])
    setSurveys(s || [])
    setGroups(g || [])
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { load() }, [load])

  const [newSurveyId] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('survey') || ''
  })

  async function handleLaunch(pilot) {
    if (!confirm(`確定發送 Pilot「${pilot.name}」？將對目標群組建立問卷邀請。`)) return
    setLaunching(pilot.id)
    const { data, error } = await launchPilotRun(pilot.id)
    if (error) { setLaunching(null); alert(`發送失敗：${error.message}`); return }

    // LINE 通道問卷：立即發送「已到期」邀請（send_after 已到者）；
    // 有延遲設定的邀請維持 pending，由排程屆時發送
    const survey = surveys.find(s => s.id === pilot.survey_id)
    let lineNote = ''
    if (survey?.send_channel === 'line') {
      try {
        const r = await dispatchDueLineSurveyInvitations(pilot.survey_id)
        lineNote = r.due > 0
          ? `\nLINE 已發送 ${r.sent} 筆` +
            (r.skipped > 0 ? `，${r.skipped} 筆未綁定略過` : '') +
            (r.failed > 0 ? `，${r.failed} 筆失敗` : '')
          : '\n邀請尚未到發送時間，屆時將自動發送'
      } catch (err) {
        logger.error('[PilotRuns] LINE 邀請發送失敗', { pilotId: pilot.id, error: err.message })
        lineNote = `\nLINE 發送失敗：${err.message}`
      }
    }
    setLaunching(null)
    alert(`已建立 ${data || 0} 筆邀請${lineNote}`)
    load()
  }

  async function handleDecide() {
    if (!decideId) return
    setDeciding(true)
    const fn = decideAction === 'approve' ? approvePilotRun : rejectPilotRun
    const { error } = await fn(decideId, decideNotes, user?.email || user?.id || '')
    setDeciding(false)
    if (error) { alert(error.message); return }
    setDecideId(null); setNotes('')
    load()
  }

  async function handleDelete(pilot) {
    if (!confirm(`確定刪除 Pilot「${pilot.name}」？相關邀請也會刪除。`)) return
    await deletePilotRun(pilot.id)
    load()
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.25rem', margin: 0 }}>Pilot 試跑</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.25rem 0 0' }}>對小群體測試問卷後決定是否全面推送</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--accent-cyan)', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
        >
          <Plus size={16} /> 新增試跑
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>載入中…</div>
      ) : pilots.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem', fontSize: '0.9rem' }}>尚無試跑記錄</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {pilots.map(p => {
            const sm = STATUS_META[p.status] || STATUS_META.draft
            return (
              <div key={p.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.95rem' }}>{p.name}</span>
                      <span style={{ background: sm.bg, color: sm.color, borderRadius: '4px', padding: '0.1rem 0.45rem', fontSize: '0.72rem', fontWeight: 600 }}>{sm.label}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      問卷：{p.surveys?.name || '—'} · 群組：{p.member_groups?.name || '所有會員'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                    {[['目標', p.target_count], ['已發', p.sent_count], ['回覆', p.response_count], ['回覆率', `${p.response_rate ?? 0}%`]].map(([l, v]) => (
                      <div key={l} style={{ textAlign: 'center' }}>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem' }}>{v}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{l}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {p.status === 'draft' && (
                      <ActionBtn
                        icon={launching === p.id ? <RefreshCw size={14} /> : <PlayCircle size={14} />}
                        title="發送試跑"
                        onClick={() => handleLaunch(p)}
                        color="var(--accent-blue)"
                        disabled={launching === p.id}
                      />
                    )}
                    {(p.status === 'running' || p.status === 'completed') && (
                      <>
                        <ActionBtn icon={<CheckCircle size={14} />} title="核准全面推送" onClick={() => { setDecideId(p.id); setAction('approve'); setNotes('') }} color="var(--accent-green)" />
                        <ActionBtn icon={<XCircle size={14} />}     title="拒絕"        onClick={() => { setDecideId(p.id); setAction('reject');  setNotes('') }} color="var(--accent-red)" />
                      </>
                    )}
                    {p.status === 'draft' && (
                      <ActionBtn icon={<Trash2 size={14} />} title="刪除" onClick={() => handleDelete(p)} color="var(--accent-red)" />
                    )}
                  </div>
                </div>

                {(p.decision || p.decision_notes) && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-primary)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    決策：<span style={{ color: p.decision === 'approve' ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                      {p.decision === 'approve' ? '核准' : '拒絕'}
                    </span>
                    {p.decision_notes && <span style={{ marginLeft: '0.75rem' }}>備註：{p.decision_notes}</span>}
                    {p.decided_at && <span style={{ marginLeft: '0.75rem' }}>{p.decided_at.slice(0, 10)}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {createOpen && (
        <CreatePilotModal
          surveys={surveys}
          groups={groups}
          orgId={currentOrg?.id}
          defaultSurveyId={newSurveyId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load() }}
        />
      )}

      {decideId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', width: '100%', maxWidth: '420px', padding: '1.25rem' }}>
            <h4 style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.875rem' }}>
              {decideAction === 'approve' ? '核准全面推送' : '拒絕此試跑'}
            </h4>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.35rem' }}>決策備註（選填）</label>
            <textarea
              value={decideNotes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="說明決策理由…"
              style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.875rem' }}>
              <button onClick={() => setDecideId(null)} style={{ padding: '0.45rem 1rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>取消</button>
              <button
                onClick={handleDecide}
                disabled={deciding}
                style={{ padding: '0.45rem 1.25rem', background: deciding ? 'var(--bg-tertiary)' : decideAction === 'approve' ? 'var(--accent-green)' : 'var(--accent-red)', color: deciding ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: '6px', cursor: deciding ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
              >
                {deciding ? '處理中…' : decideAction === 'approve' ? '確認核准' : '確認拒絕'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreatePilotModal({ surveys, groups, orgId, defaultSurveyId, onClose, onSaved }) {
  const [name, setName]       = useState('')
  const [surveyId, setSurvey] = useState(defaultSurveyId || '')
  const [groupId, setGroup]   = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('名稱不可空白'); return }
    if (!surveyId)    { setError('請選擇問卷');    return }
    setSaving(true); setError('')
    const { error: err } = await createPilotRun({
      name: name.trim(),
      survey_id: Number(surveyId),
      group_id: groupId ? Number(groupId) : null,
      organization_id: orgId,
      status: 'draft',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', width: '100%', maxWidth: '440px', padding: '1.25rem' }}>
        <h4 style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.875rem' }}>新增試跑</h4>

        {[
          ['試跑名稱 *', <input key="n" value={name} onChange={e => setName(e.target.value)} placeholder="例：金卡購後問卷 Pilot" style={inp} />],
          ['選擇問卷 *', (
            <select key="s" value={surveyId} onChange={e => setSurvey(e.target.value)} style={inp}>
              <option value="">— 選擇問卷 —</option>
              {surveys.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )],
          ['目標群組（選填）', (
            <select key="g" value={groupId} onChange={e => setGroup(e.target.value)} style={inp}>
              <option value="">所有會員</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )],
        ].map(([label, field]) => (
          <div key={label} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>{label}</label>
            {field}
          </div>
        ))}

        {error && (
          <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', borderRadius: '6px', padding: '0.4rem 0.7rem', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.45rem 1rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>取消</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '0.45rem 1.25rem', background: saving ? 'var(--bg-tertiary)' : 'var(--accent-cyan)', color: saving ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
            {saving ? '建立中…' : '建立試跑'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ icon, title, onClick, color, disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.3rem', cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? 'var(--text-muted)' : color }}
    >
      {icon}
    </button>
  )
}

const inp = { width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box' }
