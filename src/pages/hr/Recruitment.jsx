import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, X, FileText, Briefcase, UserCheck, Calendar, Edit3, Star, Search, ClipboardList, CheckCircle, XCircle, FileEdit, Trash2, Eye } from 'lucide-react'
import {
  getRecruitmentJobs, createRecruitmentJob, updateRecruitmentJob,
  getCandidates, createCandidate, updateCandidate, deleteCandidate,
  getInterviews, createInterview, updateInterview,
  getOfferLetterTemplates, getOfferLetters, createOfferLetter, updateOfferLetter,
  createOfferLetterTemplate, updateOfferLetterTemplate, deleteOfferLetterTemplate,
  getHeadcountRequests, createHeadcountRequest, updateHeadcountRequest,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { notifyInterviewScheduled } from '../../lib/lineNotify'
import { printHireApprovalSignOff } from '../../lib/signOffAdapters'
import { printOfferLetter } from '../../lib/offerLetterPrinter'

const STAGES = ['投遞', '篩選', '面試', '錄取決定', '已錄取', '淘汰']
const STAGE_COLOR = {
  '投遞':    'var(--accent-blue)',
  '篩選':    'var(--accent-cyan)',
  '面試':    'var(--accent-purple)',
  '錄取決定': 'var(--accent-orange)',
  '已錄取':  'var(--accent-green)',
  '淘汰':    'var(--accent-red)',
}
const SOURCES = ['主動投遞', '獵頭', '員工推薦', '校園', '平台']
const ROUNDS  = ['初試', '複試', '主管面', '最終面']
const RESULTS = ['待定', '通過', '不通過']

const fmtDate = (s) => s ? String(s).slice(0, 10).replace(/-/g, '/') : '—'

function fillTemplate(html, vars) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v ?? ''), html,
  )
}

// ─── Tab bar ───
function Tabs({ active, onChange }) {
  const tabs = [
    { key: 'jobs',       label: '職缺',     icon: Briefcase },
    { key: 'candidates', label: '候選人',   icon: UserCheck },
    { key: 'interviews', label: '面試',     icon: Calendar },
    { key: 'offers',     label: '錄取簽呈', icon: FileText },
    { key: 'headcount',  label: '人力需求單',   icon: ClipboardList },
    { key: 'templates',  label: '通知書範本',   icon: FileEdit },
  ]
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-primary)' }}>
      {tabs.map(t => {
        const Icon = t.icon
        const isActive = active === t.key
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            background: 'none', border: 'none', cursor: 'pointer', marginBottom: -1,
            borderBottom: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
            fontWeight: isActive ? 600 : 400, fontSize: 14,
          }}>
            <Icon size={15} />{t.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Kanban card ───
function CandidateCard({ c, onSelect, onStageChange }) {
  return (
    <div onClick={() => onSelect(c)} style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
      borderRadius: 8, padding: '10px 12px', cursor: 'pointer', marginBottom: 8,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{c.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
        {c.recruitment_jobs?.title || '—'} · {c.source}
      </div>
      {c.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.email}</div>}
      {Array.isArray(c.tags) && c.tags.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {c.tags.slice(0, 4).map(t => (
            <span key={t} style={{
              padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
              background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
            }}>{t}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {STAGES.filter(s => s !== c.stage).slice(0, 2).map(s => (
          <button key={s} className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={e => { e.stopPropagation(); onStageChange(c.id, s) }}>
            → {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Candidate detail side panel ───
function CandidatePanel({ c, interviews, allInterviews, jobs = [], evalTemplates = [], onClose, onDelete, orgId, employees, onRefreshInterviews, offerTemplates, onCreateOffer, onStageChange }) {
  const [showIntForm, setShowIntForm] = useState(false)
  const [intForm, setIntForm] = useState({ round: '初試', scheduled_at: '', interviewer_id: '', result: '待定', note: '', location: '', score: 0, scores: {} })
  const iset = (k, v) => setIntForm(f => ({ ...f, [k]: v }))

  // 撈該候選人 job 的評核範本
  const evalTemplate = useMemo(() => {
    const job = jobs.find(j => j.id === c.job_id)
    if (!job?.evaluation_template_id) return null
    return evalTemplates.find(t => t.id === job.evaluation_template_id) || null
  }, [jobs, c.job_id, evalTemplates])

  // 多維度評分總分（依 weight 加權平均，最多 5 分）
  const weightedScore = useMemo(() => {
    if (!evalTemplate?.dimensions?.length) return null
    let sum = 0, w = 0
    for (const d of evalTemplate.dimensions) {
      const v = Number(intForm.scores?.[d.key] || 0)
      const weight = Number(d.weight || 1)
      if (v > 0) { sum += v * weight; w += weight }
    }
    return w > 0 ? Math.round((sum / w) * 10) / 10 : 0
  }, [evalTemplate, intForm.scores])

  // ── 面試官時段衝突檢查（同面試官 ±60 分內已有面試）──
  const scheduleConflict = useMemo(() => {
    if (!intForm.interviewer_id || !intForm.scheduled_at) return null
    const target = new Date(intForm.scheduled_at).getTime()
    if (isNaN(target)) return null
    const HOUR = 60 * 60 * 1000
    const list = (allInterviews || []).filter(iv =>
      String(iv.interviewer_id) === String(intForm.interviewer_id)
      && iv.scheduled_at
      && Math.abs(new Date(iv.scheduled_at).getTime() - target) < HOUR
    )
    if (list.length === 0) return null
    const empName = employees.find(e => String(e.id) === String(intForm.interviewer_id))?.name || '面試官'
    return { count: list.length, empName, list }
  }, [intForm.interviewer_id, intForm.scheduled_at, allInterviews, employees])

  const handleAddInterview = async () => {
    if (!intForm.scheduled_at) { toast('請填寫面試時間'); return }
    // 多維評核 → 用加權平均當總分；否則用單 1-5 星
    const finalScore = evalTemplate ? (weightedScore || null) : (intForm.score || null)
    const { data } = await createInterview({
      round: intForm.round,
      scheduled_at: intForm.scheduled_at,
      interviewer_id: intForm.interviewer_id || null,
      result: intForm.result,
      note: intForm.note,
      location: intForm.location,
      score: finalScore,
      scores: evalTemplate ? intForm.scores : null,
      candidate_id: c.id,
      organization_id: orgId,
    })
    if (data) {
      onRefreshInterviews()
      setShowIntForm(false)
      setIntForm({ round: '初試', scheduled_at: '', interviewer_id: '', result: '待定', note: '', location: '', score: 0, scores: {} })
      if (intForm.interviewer_id) {
        // 算這位候選人到目前為止已有幾次面試（含本次）+ 取上一次有分數的成績
        const prior = (interviews || []).filter(iv => iv.candidate_id === c.id)
        const interviewSeq = prior.length + 1
        const previousScore = (() => {
          const scored = prior
            .filter(iv => iv.score != null && iv.score !== '')
            .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))
          return scored[0]?.score ?? null
        })()
        const job = c.recruitment_jobs || {}
        notifyInterviewScheduled(Number(intForm.interviewer_id), {
          candidateName: c.name,
          round: intForm.round,
          scheduledAt: intForm.scheduled_at,
          location: intForm.location,
          candidateId: c.id,
          // 擴充資訊
          jobTitle: job.title || null,
          jobDept: job.dept || null,
          source: c.source || null,
          phone: c.phone || null,
          email: c.email || null,
          resumeUrl: c.resume_url || null,
          candidateStage: c.stage || null,
          note: intForm.note || null,
          interviewSeq,
          previousScore,
        }).catch(() => {})
      }
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
      background: 'var(--bg-card)', borderLeft: '1px solid var(--border-primary)',
      zIndex: 200, display: 'flex', flexDirection: 'column', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{c.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.recruitment_jobs?.title || '未指定職缺'}</div>
        </div>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}><X size={18} /></button>
      </div>

      <div style={{ padding: '16px 20px', flex: 1 }}>
        <div style={{ marginBottom: 16 }}>
          <span style={{
            padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
            background: STAGE_COLOR[c.stage] + '22', color: STAGE_COLOR[c.stage],
          }}>{c.stage}</span>
          {c.hire_status && (
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>審核：{c.hire_status}</span>
          )}
        </div>

        <div style={{ display: 'grid', gap: 6, marginBottom: 20, fontSize: 13 }}>
          {c.email     && <div><span style={{ color: 'var(--text-muted)' }}>Email：</span>{c.email}</div>}
          {c.phone     && <div><span style={{ color: 'var(--text-muted)' }}>電話：</span>{c.phone}</div>}
          {c.source    && <div><span style={{ color: 'var(--text-muted)' }}>來源：</span>{c.source}</div>}
          {c.notes     && <div><span style={{ color: 'var(--text-muted)' }}>備註：</span>{c.notes}</div>}
          {c.resume_url && <a href={c.resume_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', fontSize: 13 }}>查看履歷</a>}
        </div>

        {/* Interviews */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>面試紀錄</span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }}
              onClick={() => setShowIntForm(v => !v)}>
              <Plus size={12} /> 新增面試
            </button>
          </div>

          {showIntForm && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>輪次</div>
                  <select className="input" style={{ fontSize: 12, width: '100%' }} value={intForm.round} onChange={e => iset('round', e.target.value)}>
                    {ROUNDS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>面試時間</div>
                  <input className="input" type="datetime-local" style={{ fontSize: 12, width: '100%' }}
                    value={intForm.scheduled_at} onChange={e => iset('scheduled_at', e.target.value)} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>面試官</div>
                <select className="input" style={{ fontSize: 12, width: '100%' }} value={intForm.interviewer_id} onChange={e => iset('interviewer_id', e.target.value)}>
                  <option value="">請選擇</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                {scheduleConflict && (
                  <div style={{
                    marginTop: 6, padding: '6px 8px', borderRadius: 4,
                    background: 'rgba(245,158,11,0.12)', border: '1px solid var(--accent-orange)',
                    fontSize: 11, color: 'var(--accent-orange)', lineHeight: 1.5,
                  }}>
                    ⚠️ {scheduleConflict.empName} 在此時段 ±1 小時內已有 {scheduleConflict.count} 場面試
                    <div style={{ marginTop: 2, color: 'var(--text-muted)' }}>
                      {scheduleConflict.list.slice(0, 3).map(iv => (
                        <div key={iv.id}>
                          · {new Date(iv.scheduled_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} {iv.round}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>地點</div>
                <input className="input" style={{ fontSize: 12, width: '100%' }}
                  value={intForm.location} onChange={e => iset('location', e.target.value)} placeholder="面試地點" />
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>備註</div>
                <input className="input" style={{ fontSize: 12, width: '100%' }}
                  value={intForm.note} onChange={e => iset('note', e.target.value)} placeholder="注意事項等" />
              </div>
              {evalTemplate ? (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    多維度評核 — <b style={{ color: 'var(--accent-cyan)' }}>{evalTemplate.name}</b>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {(evalTemplate.dimensions || []).map(d => (
                      <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 90, fontSize: 12, color: 'var(--text-secondary)' }}>
                          {d.label}
                          {d.weight && d.weight !== 1 && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>×{d.weight}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {Array.from({ length: d.max || 5 }, (_, i) => i + 1).map(n => {
                            const v = Number(intForm.scores?.[d.key] || 0)
                            return (
                              <button key={n}
                                onClick={() => iset('scores', { ...intForm.scores, [d.key]: v === n ? 0 : n })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}>
                                <Star size={14} fill={n <= v ? 'var(--accent-orange)' : 'none'}
                                  style={{ color: n <= v ? 'var(--accent-orange)' : 'var(--text-muted)' }} />
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {weightedScore > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700, textAlign: 'right' }}>
                      加權平均：{weightedScore} / 5
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>評分（1-5）</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[1,2,3,4,5].map(n => (
                      <button key={n} onClick={() => iset('score', intForm.score === n ? 0 : n)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                        <Star size={18} fill={n <= intForm.score ? 'var(--accent-orange)' : 'none'}
                          style={{ color: n <= intForm.score ? 'var(--accent-orange)' : 'var(--text-muted)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleAddInterview}>確認</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowIntForm(false)}>取消</button>
              </div>
            </div>
          )}

          {interviews.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無面試紀錄</div>
          )}
          {interviews.map(iv => (
            <div key={iv.id} style={{
              background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px', marginBottom: 6,
              borderLeft: `3px solid ${iv.result === '通過' ? 'var(--accent-green)' : iv.result === '不通過' ? 'var(--accent-red)' : 'var(--border-primary)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{iv.round} · {fmtDate(iv.scheduled_at)}</div>
                {iv.score > 0 && (
                  <div style={{ display: 'flex', gap: 1 }}>
                    {[1,2,3,4,5].map(n => (
                      <Star key={n} size={11} fill={n <= iv.score ? 'var(--accent-orange)' : 'none'}
                        style={{ color: n <= iv.score ? 'var(--accent-orange)' : 'var(--border-primary)' }} />
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                面試官：{iv.employees?.name || '—'} · 結果：{iv.result}
              </div>
              {iv.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{iv.note}</div>}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {RESULTS.filter(r => r !== iv.result).map(r => (
                  <button key={r} className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }}
                    onClick={async () => {
                      await updateInterview(iv.id, { result: r })
                      onRefreshInterviews()
                      if (r === '通過' && c.stage === '面試') {
                        onStageChange(c.id, '錄取決定')
                      }
                    }}>
                    → {r}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {(c.stage === '錄取決定' || c.stage === '已錄取') && !c.hire_status && (
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => onCreateOffer(c)}>
            <FileText size={14} style={{ marginRight: 6 }} /> 建立錄取簽呈 &amp; 通知書
          </button>
        )}

        {/* Stage history timeline */}
        {c.stage_history?.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-primary)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>階段歷程</div>
            <div style={{ position: 'relative', paddingLeft: 16 }}>
              <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 1, background: 'var(--border-primary)' }} />
              {c.stage_history.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: -12, top: 4,
                    width: 7, height: 7, borderRadius: '50%',
                    background: STAGE_COLOR[h.stage] || 'var(--accent-cyan)',
                    border: '2px solid var(--bg-card)',
                  }} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: STAGE_COLOR[h.stage] || 'var(--text-primary)' }}>
                      {h.stage}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                      {new Date(h.changed_at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8, color: 'var(--accent-red)', fontSize: 12 }}
          onClick={() => onDelete(c.id)}>
          刪除候選人
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
export default function Recruitment() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [tab, setTab] = useState('jobs')

  const [jobs,          setJobs]          = useState([])
  const [departments,   setDepts]         = useState([])
  const [locations,     setLocs]          = useState([])
  const [employees,     setEmployees]     = useState([])
  const [candidates,    setCandidates]    = useState([])
  const [interviews,    setInterviews]    = useState([])
  const [offerTemplates, setOfferTemplates] = useState([])
  const [offerLetters,   setOfferLetters]   = useState([])
  const [evalTemplates,  setEvalTemplates]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const [deptFilter,  setDeptFilter]  = useState('')
  const [jobFilter,   setJobFilter]   = useState('')
  const [stageFilter, setStageFilter] = useState('')

  const [selectedCand,    setSelectedCand]    = useState(null)
  const [showJobModal,    setShowJobModal]    = useState(false)
  const [showCandModal,   setShowCandModal]   = useState(false)
  const [showOfferModal,  setShowOfferModal]  = useState(false)
  const [offerTarget,     setOfferTarget]     = useState(null)

  const [jobForm,     setJobForm]     = useState({ title: '', dept: '', location: '', type: '全職', headcount: 1, description: '', evaluation_template_id: '' })
  const [editingJob,  setEditingJob]  = useState(null)
  const [candForm,    setCandForm]    = useState({ name: '', email: '', phone: '', source: '主動投遞', job_id: '', notes: '', resume_url: '', tags: [] })
  const [tagInput,    setTagInput]    = useState('')
  const [resumeUploading, setResumeUploading] = useState(false)

  // 面試 tab 直接新增（不用點進候選人）
  const [showQuickIntModal, setShowQuickIntModal] = useState(false)
  const [quickIntForm, setQuickIntForm] = useState({
    candidate_id: '', round: '初試', scheduled_at: '',
    interviewer_id: '', location: '', note: '',
  })

  // ── 重複偵測 + 黑名單（email/phone 任一相符）──
  const candDupCheck = useMemo(() => {
    const e = (candForm.email || '').trim().toLowerCase()
    const p = (candForm.phone || '').trim().replace(/[^\d]/g, '')
    if (!e && !p) return null
    const matches = candidates.filter(c => {
      const ce = (c.email || '').trim().toLowerCase()
      const cp = (c.phone || '').trim().replace(/[^\d]/g, '')
      return (e && ce && ce === e) || (p && cp && cp === p)
    })
    if (matches.length === 0) return null
    const blacklisted = matches.some(c => c.stage === '淘汰')
    return { matches, blacklisted }
  }, [candForm.email, candForm.phone, candidates])
  const [offerForm,   setOfferForm]   = useState({ template_id: '', position: '', dept: '', salary: '', start_date: '', probation_days: 90 })
  const [searchQuery, setSearchQuery] = useState('')

  const [editingTpl, setEditingTpl] = useState(null)  // null=list, 'new'=new, obj=editing

  const [headcountReqs, setHeadcountReqs] = useState([])
  const [showHcModal,   setShowHcModal]   = useState(false)
  const [hcForm, setHcForm] = useState({ dept: '', position_title: '', headcount: 1, expected_start_date: '', reason: '' })
  const hset = (k, v) => setHcForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    try {
      const [j, d, l, e, c, iv, ot, ol, hc, et] = await Promise.all([
        getRecruitmentJobs(orgId),
        supabase.from('departments').select('id,name').eq('organization_id', orgId).order('name'),
        supabase.from('stores').select('id,name').eq('organization_id', orgId).order('name'),
        supabase.from('employees').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name'),
        getCandidates(orgId),
        getInterviews(orgId),
        getOfferLetterTemplates(orgId),
        getOfferLetters(orgId),
        getHeadcountRequests(orgId),
        supabase.from('interview_evaluation_templates').select('*')
          .eq('organization_id', orgId).order('is_default', { ascending: false }).order('name'),
      ])
      const depts = d.data || []
      const locs  = l.data || []
      setJobs(j.data || [])
      setDepts(depts)
      setLocs(locs)
      setEmployees(e.data || [])
      setCandidates(c.data || [])
      setInterviews(iv.data || [])
      setOfferTemplates(ot.data || [])
      setOfferLetters(ol.data || [])
      setHeadcountReqs(hc.data || [])
      setEvalTemplates(et.data || [])
      setJobForm(f => ({ ...f, dept: depts[0]?.name || '', location: locs[0]?.name || '' }))
    } catch (err) {
      console.error('Recruitment load error:', err)
      setError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const refreshInterviews = () =>
    getInterviews(orgId).then(({ data }) => setInterviews(data || []))

  // ── Job handlers ──
  const handleAddJob = async () => {
    if (!jobForm.title) return
    // 處理空字串 FK：evaluation_template_id 空字串會被 PG 當 invalid，要轉 null
    const payload = {
      ...jobForm,
      evaluation_template_id: jobForm.evaluation_template_id ? Number(jobForm.evaluation_template_id) : null,
    }
    if (editingJob) {
      const { data } = await updateRecruitmentJob(editingJob.id, payload)
      if (data) { setJobs(prev => prev.map(j => j.id === editingJob.id ? data : j)); setShowJobModal(false); setEditingJob(null) }
    } else {
      const { data } = await createRecruitmentJob({
        ...payload, applicants: 0, status: '招募中', organization_id: orgId,
      })
      if (data) { setJobs(prev => [...prev, data]); setShowJobModal(false) }
    }
  }

  const openEditJob = (j) => {
    setEditingJob(j)
    setJobForm({
      title: j.title, dept: j.dept || '', location: j.location || '', type: j.type || '全職',
      headcount: j.headcount || 1, description: j.description || '',
      evaluation_template_id: j.evaluation_template_id || '',
    })
    setShowJobModal(true)
  }

  const handleCloseJob = async (id) => {
    const { data } = await updateRecruitmentJob(id, { status: '已關閉' })
    if (data) setJobs(prev => prev.map(j => j.id === id ? data : j))
  }

  // ── Candidate handlers ──
  const handleAddCandidate = async () => {
    if (!candForm.name.trim()) { toast('請填寫姓名'); return }
    const { data } = await createCandidate({
      name:            candForm.name,
      email:           candForm.email   || null,
      phone:           candForm.phone   || null,
      source:          candForm.source,
      notes:           candForm.notes   || null,
      resume_url:      candForm.resume_url || null,
      tags:            candForm.tags?.length ? candForm.tags : null,
      job_id:          candForm.job_id  ? Number(candForm.job_id) : null,
      organization_id: orgId,
      created_by:      profile?.id      || null,
      stage_history:   [{ stage: '投遞', changed_at: new Date().toISOString() }],
    })
    if (data) {
      setCandidates(prev => [...prev, data])
      setShowCandModal(false)
      setCandForm({ name: '', email: '', phone: '', source: '主動投遞', job_id: '', notes: '', resume_url: '', tags: [] })
      setTagInput('')
      if (data.job_id) {
        const job = jobs.find(j => j.id === data.job_id)
        if (job) updateRecruitmentJob(job.id, { applicants: (job.applicants || 0) + 1 })
      }
    }
  }

  const handleStageChange = async (id, stage) => {
    const cand = candidates.find(c => c.id === id)
    const stage_history = [...(cand?.stage_history || []), { stage, changed_at: new Date().toISOString() }]
    const { data } = await updateCandidate(id, { stage, stage_history })
    if (data) {
      setCandidates(prev => prev.map(c => c.id === id ? { ...c, stage, stage_history } : c))
      if (selectedCand?.id === id) setSelectedCand(s => ({ ...s, stage, stage_history }))
    }
  }

  const handleDeleteCandidate = async (id) => {
    const ok = await confirm('確定刪除此候選人？')
    if (!ok) return
    await deleteCandidate(id)
    setCandidates(prev => prev.filter(c => c.id !== id))
    setSelectedCand(null)
  }

  // ── Offer handlers ──
  const openOfferModal = (c) => {
    setOfferTarget(c)
    const defaultTpl = offerTemplates.find(t => t.is_default) || offerTemplates[0]
    setOfferForm({
      template_id:    defaultTpl?.id || '',
      position:       c.recruitment_jobs?.title || '',
      dept:           '',
      salary:         '',
      start_date:     '',
      probation_days: 90,
    })
    setShowOfferModal(true)
  }

  const handleCreateOffer = async () => {
    if (!offerTarget) return
    if (!offerForm.position) { toast('請填寫職位'); return }
    const tpl = offerTemplates.find(t => t.id === Number(offerForm.template_id))
    const filled = tpl ? fillTemplate(tpl.body_html, {
      candidate_name: offerTarget.name,
      position:       offerForm.position,
      dept:           offerForm.dept,
      salary:         offerForm.salary,
      start_date:     offerForm.start_date,
      probation_days: offerForm.probation_days,
      company_name:   profile?.company_name || '',
      signed_date:    new Date().toISOString().slice(0, 10),
    }) : ''

    const { data: ol } = await createOfferLetter({
      candidate_id:    offerTarget.id,
      template_id:     offerForm.template_id ? Number(offerForm.template_id) : null,
      filled_html:     filled,
      position:        offerForm.position,
      dept:            offerForm.dept   || null,
      salary:          offerForm.salary ? Number(offerForm.salary) : null,
      start_date:      offerForm.start_date || null,
      probation_days:  Number(offerForm.probation_days),
      status:          '待審',
      organization_id: orgId,
      created_by:      profile?.id || null,
    })
    if (ol) {
      const offerCand = candidates.find(c => c.id === offerTarget.id)
      const stage_history = [...(offerCand?.stage_history || []), { stage: '錄取決定', changed_at: new Date().toISOString() }]
      await updateCandidate(offerTarget.id, { hire_status: '待審', stage: '錄取決定', stage_history })
      setCandidates(prev => prev.map(c =>
        c.id === offerTarget.id ? { ...c, hire_status: '待審', stage: '錄取決定', stage_history } : c
      ))
      if (selectedCand?.id === offerTarget.id)
        setSelectedCand(s => ({ ...s, hire_status: '待審', stage: '錄取決定', stage_history }))
      setOfferLetters(prev => [...prev, ol])
      setShowOfferModal(false)
      toast('錄取簽呈已建立，請至簽核中心審核')
    }
  }

  const handlePrintOffer = (ol) =>
    printOfferLetter(ol, { companyName: profile?.company_name || '' })

  const handlePrintApproval = (ol) => {
    const cand = candidates.find(c => c.id === ol.candidate_id)
    printHireApprovalSignOff(ol, {
      companyName:   profile?.company_name || '',
      candidateName: cand?.name || '',
    })
  }

  const handleMarkSent = async (ol) => {
    const { data } = await updateOfferLetter(ol.id, {
      status: '已發送', sent_at: new Date().toISOString(),
    })
    if (data) setOfferLetters(prev => prev.map(x => x.id === ol.id ? data : x))
  }

  const handleDeclineOffer = async (ol) => {
    const ok = await confirm('確定標記此 Offer 為已婉拒？候選人將移至「淘汰」')
    if (!ok) return
    const { data } = await updateOfferLetter(ol.id, { status: '已婉拒' })
    if (data) {
      setOfferLetters(prev => prev.map(x => x.id === ol.id ? data : x))
      const declineCand = candidates.find(c => c.id === ol.candidate_id)
      const declineHist = [...(declineCand?.stage_history || []), { stage: '淘汰', changed_at: new Date().toISOString() }]
      await updateCandidate(ol.candidate_id, { stage: '淘汰', hire_status: null, stage_history: declineHist })
      setCandidates(prev => prev.map(c => c.id === ol.candidate_id ? { ...c, stage: '淘汰', hire_status: null, stage_history: declineHist } : c))
    }
  }

  // ── Export ──
  const exportJobsCsv = () => {
    const headers = ['職位名稱', '部門', '工作地點', '類型', '需求人數', '刊登日', '狀態']
    const rows = jobs.filter(j => deptFilter === '' || j.dept === deptFilter).map(j => [
      j.title, j.dept || '', j.location || '', j.type || '全職',
      j.headcount || 1, j.posted || '', j.status || '',
    ])
    const bom = '﻿'
    const escape = c => { const s = String(c ?? ''); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s }
    const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\r\n')
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `職缺清單_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Template handlers ──
  const handleSaveTpl = async (tplData) => {
    if (editingTpl && editingTpl !== 'new') {
      const { data } = await updateOfferLetterTemplate(editingTpl.id, tplData)
      if (data) {
        setOfferTemplates(prev => prev.map(t => t.id === data.id ? data : t))
        toast.success('範本已更新')
        setEditingTpl(null)
      }
    } else {
      const { data } = await createOfferLetterTemplate({ ...tplData, organization_id: orgId })
      if (data) {
        setOfferTemplates(prev => [...prev, data])
        toast.success('範本已建立')
        setEditingTpl(null)
      }
    }
  }

  const handleDeleteTpl = async (tpl) => {
    const ok = await confirm(`確定刪除範本「${tpl.name}」？`)
    if (!ok) return
    await deleteOfferLetterTemplate(tpl.id)
    setOfferTemplates(prev => prev.filter(t => t.id !== tpl.id))
  }

  const handleSetDefaultTpl = async (tpl) => {
    await Promise.all(offerTemplates.map(t =>
      updateOfferLetterTemplate(t.id, { is_default: t.id === tpl.id })
    ))
    setOfferTemplates(prev => prev.map(t => ({ ...t, is_default: t.id === tpl.id })))
    toast.success(`「${tpl.name}」已設為預設`)
  }

  // ── Headcount handlers ──
  const handleAddHcRequest = async () => {
    if (!hcForm.dept || !hcForm.position_title) { toast('請填寫部門與職位'); return }
    const { data, error } = await createHeadcountRequest({
      ...hcForm,
      headcount: Number(hcForm.headcount) || 1,
      expected_start_date: hcForm.expected_start_date || null,
      organization_id: orgId,
      created_by: profile?.id || null,
      status: 'pending',
    })
    if (error) { toast.error('建立失敗：' + error.message); return }
    setHeadcountReqs(prev => [data, ...prev])
    setShowHcModal(false)
    setHcForm({ dept: '', position_title: '', headcount: 1, expected_start_date: '', reason: '' })
    toast.success('人力需求單已送出')
  }

  const handleApproveHcRequest = async (req) => {
    const { data: job, error: jobErr } = await createRecruitmentJob({
      title: req.position_title,
      dept: req.dept,
      type: '全職',
      applicants: 0,
      status: '招募中',
      organization_id: orgId,
      headcount: req.headcount,
      headcount_request_id: req.id,
      posted: new Date().toISOString().slice(0, 10),
    })
    if (jobErr) { toast.error('開職缺失敗：' + jobErr.message); return }
    const { data } = await updateHeadcountRequest(req.id, {
      status: 'approved',
      reviewed_by: profile?.id || null,
      reviewed_at: new Date().toISOString(),
      job_id: job.id,
    })
    if (data) {
      setHeadcountReqs(prev => prev.map(r => r.id === req.id ? data : r))
      setJobs(prev => [...prev, job])
      toast.success(`已核准，職缺「${req.position_title}」已建立`)
    }
  }

  const handleRejectHcRequest = async (req) => {
    const ok = await confirm('確定駁回此需求單？')
    if (!ok) return
    const { data } = await updateHeadcountRequest(req.id, {
      status: 'rejected',
      reviewed_by: profile?.id || null,
      reviewed_at: new Date().toISOString(),
    })
    if (data) setHeadcountReqs(prev => prev.map(r => r.id === req.id ? data : r))
  }

  // ── derived ──
  const filteredJobs  = jobs.filter(j => deptFilter === '' || j.dept === deptFilter)
  const filteredCands = candidates.filter(c => {
    const q = searchQuery.toLowerCase()
    const matchSearch = !q || c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
    return matchSearch &&
      (jobFilter   === '' || String(c.job_id) === jobFilter) &&
      (stageFilter === '' || c.stage === stageFilter)
  })
  const candInterviews = selectedCand
    ? interviews.filter(iv => iv.candidate_id === selectedCand.id)
    : []

  if (loading) return <LoadingSpinner />
  if (error)   return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔍</span> 招募管理</h2>
            <p>職缺管理、候選人追蹤與錄取流程</p>
          </div>
          {tab === 'jobs' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={exportJobsCsv}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                ↓ 匯出 CSV（104）
              </button>
              <button className="btn btn-primary" onClick={() => setShowJobModal(true)}>
                <Plus size={14} /> 新增職缺
              </button>
            </div>
          )}
          {tab === 'candidates' && (
            <button className="btn btn-primary" onClick={() => setShowCandModal(true)}>
              <Plus size={14} /> 新增候選人
            </button>
          )}
          {tab === 'headcount' && (
            <button className="btn btn-primary" onClick={() => setShowHcModal(true)}>
              <Plus size={14} /> 新增需求單
            </button>
          )}
          {tab === 'templates' && !editingTpl && (
            <button className="btn btn-primary" onClick={() => setEditingTpl('new')}>
              <Plus size={14} /> 新增範本
            </button>
          )}
          {tab === 'templates' && editingTpl && (
            <button className="btn btn-secondary" onClick={() => setEditingTpl(null)}>
              ← 返回列表
            </button>
          )}
        </div>
      </div>

      <Tabs active={tab} onChange={setTab} />

      {/* ─── 職缺 ─── */}
      {tab === 'jobs' && (
        <>
          <div style={{
            display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10, alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
            <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="">全部部門</option>
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>

          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">招募中</div>
              <div className="stat-card-value">{filteredJobs.filter(j => j.status === '招募中').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">總應徵者</div>
              <div className="stat-card-value">{filteredJobs.reduce((s, j) => s + (j.applicants || 0), 0)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">已關閉</div>
              <div className="stat-card-value">{filteredJobs.filter(j => j.status === '已關閉').length}</div>
            </div>
          </div>

          {candidates.length > 0 && (() => {
            const total = candidates.length
            const counts = STAGES.map(s => ({ stage: s, n: candidates.filter(c => c.stage === s).length }))
            const maxN = Math.max(...counts.map(x => x.n), 1)
            return (
              <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>招募漏斗</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {counts.map(({ stage, n }, i) => {
                    const pct = total ? Math.round((n / total) * 100) : 0
                    const barW = maxN ? Math.round((n / maxN) * 100) : 0
                    const fromPrev = i > 0 && counts[i-1].n > 0 ? Math.round((n / counts[i-1].n) * 100) : null
                    return (
                      <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 72, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{stage}</div>
                        <div style={{ flex: 1, height: 20, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 4, width: `${barW}%`,
                            background: STAGE_COLOR[stage], opacity: 0.75,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                        <div style={{ width: 28, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0 }}>{n}</div>
                        <div style={{ width: 52, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {fromPrev !== null ? `↓${fromPrev}%` : `${pct}%`}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                  共 {total} 位候選人　已錄取率：{total ? Math.round((counts.find(x=>x.stage==='已錄取')?.n||0)/total*100) : 0}%
                </div>
              </div>
            )
          })()}

          {/* ── 來源效益分析 ── */}
          {candidates.length > 0 && (() => {
            const bySrc = {}
            candidates.forEach(c => {
              const k = c.source || '未指定'
              if (!bySrc[k]) bySrc[k] = { total: 0, hired: 0, dropped: 0 }
              bySrc[k].total += 1
              if (c.stage === '已錄取') bySrc[k].hired += 1
              if (c.stage === '淘汰')   bySrc[k].dropped += 1
            })
            const arr = Object.entries(bySrc)
              .map(([source, v]) => ({
                source, ...v,
                hireRate: v.total ? Math.round((v.hired / v.total) * 100) : 0,
              }))
              .sort((a, b) => b.total - a.total)
            const maxTotal = Math.max(...arr.map(x => x.total), 1)
            return (
              <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>
                  來源效益（依錄取率排序）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {arr.map(s => (
                    <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 90, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
                        {s.source}
                      </div>
                      <div style={{ flex: 1, height: 20, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                        <div style={{
                          height: '100%', width: `${(s.total / maxTotal) * 100}%`,
                          background: 'var(--accent-cyan)', opacity: 0.4,
                        }} />
                      </div>
                      <div style={{ width: 48, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {s.total} 人
                      </div>
                      <div style={{
                        width: 60, fontSize: 12, fontWeight: 700, flexShrink: 0, textAlign: 'right',
                        color: s.hireRate >= 20 ? 'var(--accent-green)' : s.hireRate >= 10 ? 'var(--accent-orange)' : 'var(--text-muted)',
                      }}>
                        錄取 {s.hireRate}%
                      </div>
                      <div style={{ width: 60, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>
                        淘汰 {s.dropped}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                  💡 錄取率 ≥ 20% 標綠（高效管道）；&lt; 10% 灰（建議檢討）
                </div>
              </div>
            )
          })()}

          <div className="card">
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>職稱</th><th>部門</th><th>地點</th><th>類型</th><th>應徵人數</th><th>刊登日</th><th>狀態</th><th>操作</th></tr></thead>
                <tbody>
                  {filteredJobs.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無職缺</td></tr>
                  )}
                  {filteredJobs.map(j => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 600 }}>{j.title}</td>
                      <td>{j.dept}</td>
                      <td>{j.location}</td>
                      <td><span className={`badge ${j.type === '全職' ? 'badge-info' : 'badge-purple'}`}>{j.type}</span></td>
                      <td style={{ fontWeight: 600 }}>{j.applicants}</td>
                      <td>{j.posted}</td>
                      <td>
                        <span className={`badge ${j.status === '招募中' ? 'badge-success' : 'badge-neutral'}`}>
                          <span className="badge-dot" />{j.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openEditJob(j)}>
                            <Edit3 size={12} />
                          </button>
                          {j.status === '招募中' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleCloseJob(j.id)}>關閉</button>
                          )}
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

      {/* ─── 候選人 kanban ─── */}
      {tab === 'candidates' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 240 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" style={{ fontSize: 13, paddingLeft: 28 }} placeholder="搜尋姓名 / Email"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
              <option value="">全部職缺</option>
              {jobs.map(j => <option key={j.id} value={String(j.id)}>{j.title}</option>)}
            </select>
            <select className="form-input" style={{ fontSize: 13, minWidth: 120 }} value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
              <option value="">全部階段</option>
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {filteredCands.length} 位</span>
          </div>

          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, minHeight: 300 }}>
            {STAGES.map(stage => {
              const cols = filteredCands.filter(c => c.stage === stage)
              return (
                <div key={stage} style={{ minWidth: 200, flex: '0 0 200px' }}>
                  <div style={{
                    padding: '6px 10px', borderRadius: '6px 6px 0 0', marginBottom: 6,
                    background: STAGE_COLOR[stage] + '22',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: STAGE_COLOR[stage] }}>{stage}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cols.length}</span>
                  </div>
                  {cols.map(c => (
                    <CandidateCard key={c.id} c={c}
                      onSelect={setSelectedCand}
                      onStageChange={handleStageChange}
                    />
                  ))}
                  {cols.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>—</div>
                  )}
                </div>
              )
            })}
          </div>

          {selectedCand && (
            <CandidatePanel
              c={selectedCand}
              interviews={candInterviews}
              allInterviews={interviews}
              jobs={jobs}
              evalTemplates={evalTemplates}
              onClose={() => setSelectedCand(null)}
              onDelete={handleDeleteCandidate}
              orgId={orgId}
              employees={employees}
              onRefreshInterviews={refreshInterviews}
              offerTemplates={offerTemplates}
              onCreateOffer={openOfferModal}
              onStageChange={handleStageChange}
            />
          )}
        </>
      )}

      {/* ─── 面試 ─── */}
      {tab === 'interviews' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => {
              setQuickIntForm({ candidate_id: '', round: '初試', scheduled_at: '', interviewer_id: '', location: '', note: '' })
              setShowQuickIntModal(true)
            }}>
              <Plus size={14} /> 新增面試
            </button>
          </div>
          <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>候選人</th><th>職缺</th><th>輪次</th><th>時間</th><th>地點</th><th>面試官</th><th>結果</th><th>操作</th></tr>
              </thead>
              <tbody>
                {interviews.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無面試排程</td></tr>
                )}
                {interviews.map(iv => {
                  const cand = candidates.find(c => c.id === iv.candidate_id)
                  return (
                    <tr key={iv.id}>
                      <td style={{ fontWeight: 600 }}>{cand?.name || '—'}</td>
                      <td>{cand?.recruitment_jobs?.title || '—'}</td>
                      <td><span className="badge badge-info">{iv.round}</span></td>
                      <td>{fmtDate(iv.scheduled_at)}</td>
                      <td>{iv.location || '—'}</td>
                      <td>{iv.employees?.name || '—'}</td>
                      <td>
                        <span className={`badge ${iv.result === '通過' ? 'badge-success' : iv.result === '不通過' ? 'badge-error' : 'badge-neutral'}`}>
                          {iv.result}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {RESULTS.filter(r => r !== iv.result).map(r => (
                            <button key={r} className="btn btn-sm btn-secondary"
                              onClick={() => updateInterview(iv.id, { result: r }).then(refreshInterviews)}>
                              {r}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>

          {/* ─── 新增面試 modal（從面試 tab 直接開）─── */}
          {showQuickIntModal && (
            <Modal title="新增面試" onClose={() => setShowQuickIntModal(false)} onSubmit={async () => {
              if (!quickIntForm.candidate_id) { toast('請選候選人'); return }
              if (!quickIntForm.scheduled_at) { toast('請填面試時間'); return }
              const { data } = await createInterview({
                candidate_id: Number(quickIntForm.candidate_id),
                round: quickIntForm.round,
                scheduled_at: quickIntForm.scheduled_at,
                interviewer_id: quickIntForm.interviewer_id || null,
                location: quickIntForm.location || null,
                note: quickIntForm.note || null,
                result: '待定',
                organization_id: orgId,
              })
              if (data) {
                setShowQuickIntModal(false)
                refreshInterviews()
                // 同步 LINE 通知 + 階段推進的 trigger 已在 DB 跑（20260524010000）
                if (quickIntForm.interviewer_id) {
                  const cand = candidates.find(c => c.id === Number(quickIntForm.candidate_id))
                  if (cand) {
                    const prior = interviews.filter(iv => iv.candidate_id === cand.id)
                    const interviewSeq = prior.length + 1
                    const job = cand.recruitment_jobs || {}
                    notifyInterviewScheduled(Number(quickIntForm.interviewer_id), {
                      candidateName: cand.name, round: quickIntForm.round,
                      scheduledAt: quickIntForm.scheduled_at, location: quickIntForm.location,
                      candidateId: cand.id, jobTitle: job.title, jobDept: job.dept,
                      source: cand.source, phone: cand.phone, email: cand.email,
                      resumeUrl: cand.resume_url, candidateStage: cand.stage,
                      note: quickIntForm.note, interviewSeq,
                    }).catch(() => {})
                  }
                }
              }
            }} submitLabel="新增">
              <Field label="候選人" required>
                <select className="form-input" style={{ width: '100%' }} value={quickIntForm.candidate_id}
                  onChange={e => setQuickIntForm(f => ({ ...f, candidate_id: e.target.value }))}>
                  <option value="">請選擇候選人</option>
                  {candidates
                    .filter(c => !['已錄取', '淘汰'].includes(c.stage))
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.recruitment_jobs?.title ? ` — ${c.recruitment_jobs.title}` : ''}（{c.stage}）
                      </option>
                    ))}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="輪次">
                  <select className="form-input" style={{ width: '100%' }} value={quickIntForm.round}
                    onChange={e => setQuickIntForm(f => ({ ...f, round: e.target.value }))}>
                    {ROUNDS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="時間" required>
                  <input className="form-input" type="datetime-local" style={{ width: '100%' }}
                    value={quickIntForm.scheduled_at}
                    onChange={e => setQuickIntForm(f => ({ ...f, scheduled_at: e.target.value }))} />
                </Field>
              </div>
              <Field label="面試官">
                <select className="form-input" style={{ width: '100%' }} value={quickIntForm.interviewer_id}
                  onChange={e => setQuickIntForm(f => ({ ...f, interviewer_id: e.target.value }))}>
                  <option value="">請選擇</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                {(() => {
                  if (!quickIntForm.interviewer_id || !quickIntForm.scheduled_at) return null
                  const target = new Date(quickIntForm.scheduled_at).getTime()
                  if (isNaN(target)) return null
                  const HOUR = 60 * 60 * 1000
                  const list = interviews.filter(iv =>
                    String(iv.interviewer_id) === String(quickIntForm.interviewer_id)
                    && iv.scheduled_at
                    && Math.abs(new Date(iv.scheduled_at).getTime() - target) < HOUR
                  )
                  if (list.length === 0) return null
                  const empName = employees.find(e => String(e.id) === String(quickIntForm.interviewer_id))?.name || '面試官'
                  return (
                    <div style={{
                      marginTop: 6, padding: '6px 8px', borderRadius: 4,
                      background: 'rgba(245,158,11,0.12)', border: '1px solid var(--accent-orange)',
                      fontSize: 11, color: 'var(--accent-orange)',
                    }}>
                      ⚠️ {empName} 在此時段 ±1 小時內已有 {list.length} 場面試
                    </div>
                  )
                })()}
              </Field>
              <Field label="地點">
                <input className="form-input" style={{ width: '100%' }}
                  value={quickIntForm.location}
                  onChange={e => setQuickIntForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="例：會議室 A / 視訊連結" />
              </Field>
              <Field label="備註">
                <textarea className="form-input" style={{ width: '100%' }} rows={2}
                  value={quickIntForm.note}
                  onChange={e => setQuickIntForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="注意事項、特別交代等" />
              </Field>
            </Modal>
          )}
        </>
      )}

      {/* ─── 錄取簽呈 ─── */}
      {tab === 'offers' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>候選人</th><th>職位</th><th>部門</th><th>月薪</th><th>到職日</th><th>狀態</th><th>操作</th></tr>
              </thead>
              <tbody>
                {offerLetters.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無錄取通知</td></tr>
                )}
                {offerLetters.map(ol => (
                  <tr key={ol.id}>
                    <td style={{ fontWeight: 600 }}>{ol.candidates?.name || '—'}</td>
                    <td>{ol.position}</td>
                    <td>{ol.dept || '—'}</td>
                    <td>{ol.salary ? `NT$ ${Number(ol.salary).toLocaleString()}` : '—'}</td>
                    <td>{fmtDate(ol.start_date)}</td>
                    <td>
                      <span className={`badge ${
                        ol.status === '已核准' ? 'badge-success' :
                        ol.status === '待審'   ? 'badge-warning' :
                        ol.status === '已發送' ? 'badge-info'    :
                        ol.status === '已婉拒' ? 'badge-error'   : 'badge-neutral'
                      }`}>{ol.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => handlePrintApproval(ol)}>簽呈</button>
                        {ol.status === '已核准' && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={() => handlePrintOffer(ol)}>通知書</button>
                            <button className="btn btn-sm btn-secondary" onClick={() => handleMarkSent(ol)}>標記已發送</button>
                          </>
                        )}
                        {['待審', '已核准', '已發送'].includes(ol.status) && (
                          <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }}
                            onClick={() => handleDeclineOffer(ol)}>婉拒</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 通知書範本 ─── */}
      {tab === 'templates' && !editingTpl && (
        <div className="card">
          {offerTemplates.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <FileEdit size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ marginBottom: 16 }}>尚未建立任何範本</p>
              <button className="btn btn-primary" onClick={() => setEditingTpl('new')}>
                <Plus size={14} /> 建立第一個範本
              </button>
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>範本名稱</th><th>預設</th><th>操作</th></tr></thead>
                <tbody>
                  {offerTemplates.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.name}</td>
                      <td>
                        {t.is_default
                          ? <span className="badge badge-success">預設</span>
                          : <button className="btn btn-sm btn-secondary" onClick={() => handleSetDefaultTpl(t)}>設為預設</button>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => setEditingTpl(t)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Edit3 size={11} /> 編輯
                          </button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleDeleteTpl(t)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-red)' }}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === 'templates' && editingTpl && (
        <OfferTemplateEditor
          initial={editingTpl === 'new' ? null : editingTpl}
          onSave={handleSaveTpl}
          onCancel={() => setEditingTpl(null)}
        />
      )}

      {/* ─── 人力需求單 ─── */}
      {tab === 'headcount' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>部門</th><th>職位</th><th>人數</th><th>預計到職</th><th>原因</th><th>建立者</th><th>狀態</th><th>操作</th></tr>
              </thead>
              <tbody>
                {headcountReqs.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無人力需求單</td></tr>
                )}
                {headcountReqs.map(req => (
                  <tr key={req.id}>
                    <td>{req.dept}</td>
                    <td style={{ fontWeight: 600 }}>{req.position_title}</td>
                    <td>{req.headcount}</td>
                    <td>{req.expected_start_date ? fmtDate(req.expected_start_date) : '—'}</td>
                    <td style={{ maxWidth: 200, color: 'var(--text-secondary)', fontSize: 12 }}>{req.reason || '—'}</td>
                    <td>{req.creator?.name || '—'}</td>
                    <td>
                      <span className={`badge ${
                        req.status === 'approved' ? 'badge-success' :
                        req.status === 'rejected' ? 'badge-error' : 'badge-warning'
                      }`}>
                        {req.status === 'approved' ? '已核准' : req.status === 'rejected' ? '已駁回' : '待審'}
                      </span>
                      {req.status === 'approved' && req.job_id && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent-cyan)' }}>
                          → 職缺 #{req.job_id}
                        </span>
                      )}
                    </td>
                    <td>
                      {req.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-primary"
                            onClick={() => handleApproveHcRequest(req)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={11} /> 核准
                          </button>
                          <button className="btn btn-sm btn-secondary"
                            onClick={() => handleRejectHcRequest(req)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-red)' }}>
                            <XCircle size={11} /> 駁回
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Add Headcount modal ─── */}
      {showHcModal && (
        <Modal title="新增人力需求單" onClose={() => setShowHcModal(false)} onSubmit={handleAddHcRequest} submitLabel="送出">
          <Field label="部門" required>
            <select className="form-input" style={{ width: '100%' }} value={hcForm.dept} onChange={e => hset('dept', e.target.value)}>
              <option value="">請選擇</option>
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="職位名稱" required>
            <input className="form-input" style={{ width: '100%' }} placeholder="例：資深工程師"
              value={hcForm.position_title} onChange={e => hset('position_title', e.target.value)} />
          </Field>
          <Field label="需求人數">
            <input className="form-input" type="number" min={1} style={{ width: '100%' }}
              value={hcForm.headcount} onChange={e => hset('headcount', e.target.value)} />
          </Field>
          <Field label="預計到職日">
            <input className="form-input" type="date" style={{ width: '100%' }}
              value={hcForm.expected_start_date} onChange={e => hset('expected_start_date', e.target.value)} />
          </Field>
          <Field label="需求原因">
            <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }}
              placeholder="說明人力需求背景、原因..."
              value={hcForm.reason} onChange={e => hset('reason', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* ─── Add Job modal ─── */}
      {showJobModal && (
        <Modal title={editingJob ? '編輯職缺' : '新增職缺'} onClose={() => { setShowJobModal(false); setEditingJob(null) }} onSubmit={handleAddJob} submitLabel={editingJob ? '儲存' : '新增'}>
          <Field label="職稱" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：資深前端工程師"
              value={jobForm.title} onChange={e => setJobForm(f => ({ ...f, title: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={jobForm.dept}
                onChange={e => setJobForm(f => ({ ...f, dept: e.target.value }))}>
                <option value="">請選擇部門</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="地點">
              <select className="form-input" style={{ width: '100%' }} value={jobForm.location}
                onChange={e => setJobForm(f => ({ ...f, location: e.target.value }))}>
                <option value="">請選擇地點</option>
                {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={jobForm.type}
                onChange={e => setJobForm(f => ({ ...f, type: e.target.value }))}>
                <option>全職</option><option>兼職</option><option>約聘</option><option>工讀</option>
              </select>
            </Field>
            <Field label="需求人數">
              <input className="form-input" type="number" min="1" style={{ width: '100%' }}
                value={jobForm.headcount}
                onChange={e => setJobForm(f => ({ ...f, headcount: Math.max(1, Number(e.target.value) || 1) }))} />
            </Field>
          </div>
          <Field label="職務說明">
            <textarea className="form-input" style={{ width: '100%' }} rows={4}
              placeholder="工作內容、必備條件、加分項目..."
              value={jobForm.description}
              onChange={e => setJobForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="面試評核範本">
            <select className="form-input" style={{ width: '100%' }} value={jobForm.evaluation_template_id}
              onChange={e => setJobForm(f => ({ ...f, evaluation_template_id: e.target.value }))}>
              <option value="">預設（單一 1-5 分）</option>
              {evalTemplates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_default ? '（預設）' : ''} · {(t.dimensions || []).length} 維度
                </option>
              ))}
            </select>
            {jobForm.evaluation_template_id && (() => {
              const t = evalTemplates.find(x => String(x.id) === String(jobForm.evaluation_template_id))
              if (!t) return null
              return (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  {(t.dimensions || []).map(d => d.label || d.key).join(' · ')}
                </div>
              )
            })()}
          </Field>
        </Modal>
      )}

      {/* ─── Add Candidate modal ─── */}
      {showCandModal && (
        <Modal title="新增候選人" onClose={() => setShowCandModal(false)} onSubmit={handleAddCandidate} submitLabel="新增">
          <Field label="姓名" required>
            <input className="form-input" style={{ width: '100%' }} value={candForm.name}
              onChange={e => setCandForm(f => ({ ...f, name: e.target.value }))} placeholder="候選人姓名" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Email">
              <input className="form-input" style={{ width: '100%' }} type="email" value={candForm.email}
                onChange={e => setCandForm(f => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="電話">
              <input className="form-input" style={{ width: '100%' }} value={candForm.phone}
                onChange={e => setCandForm(f => ({ ...f, phone: e.target.value }))} />
            </Field>
          </div>
          {candDupCheck && (
            <div style={{
              marginBottom: 12, padding: '8px 10px', borderRadius: 6,
              background: candDupCheck.blacklisted
                ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
              border: `1px solid ${candDupCheck.blacklisted ? 'var(--accent-red)' : 'var(--accent-orange)'}`,
              fontSize: 12, color: candDupCheck.blacklisted ? 'var(--accent-red)' : 'var(--accent-orange)',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {candDupCheck.blacklisted ? '🚫 黑名單警告' : '⚠️ 候選人已存在'}
              </div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {candDupCheck.matches.slice(0, 3).map(m => (
                  <div key={m.id}>
                    · <b>{m.name}</b>（{m.email || m.phone}）
                    · 階段：<b>{m.stage}</b>
                    {m.created_at && ` · ${m.created_at.slice(0, 10)}`}
                  </div>
                ))}
              </div>
              {candDupCheck.blacklisted && (
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  此 email/電話曾被淘汰，請確認是否要重新評估再建檔
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="應徵職缺">
              <select className="form-input" style={{ width: '100%' }} value={candForm.job_id}
                onChange={e => setCandForm(f => ({ ...f, job_id: e.target.value }))}>
                <option value="">請選擇</option>
                {jobs.filter(j => j.status === '招募中').map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </Field>
            <Field label="來源">
              <select className="form-input" style={{ width: '100%' }} value={candForm.source}
                onChange={e => setCandForm(f => ({ ...f, source: e.target.value }))}>
                {SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="履歷">
            {candForm.resume_url ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
                background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                <a href={candForm.resume_url} target="_blank" rel="noreferrer"
                   style={{ color: 'var(--accent-cyan)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📄 已上傳：{candForm.resume_url.split('/').pop()}
                </a>
                <button type="button" onClick={() => setCandForm(f => ({ ...f, resume_url: '' }))}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 0, fontSize: 13 }}>
                  ✕ 移除
                </button>
              </div>
            ) : (
              <input className="form-input" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                disabled={resumeUploading}
                style={{ width: '100%' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 10 * 1024 * 1024) { toast('檔案請小於 10MB'); return }
                  setResumeUploading(true)
                  try {
                    const safe = file.name.replace(/[^\w.\-]/g, '_')
                    const path = `resumes/${orgId || 'org'}/${Date.now()}_${safe}`
                    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file, { upsert: false })
                    if (upErr) { toast('上傳失敗：' + upErr.message); return }
                    const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(path)
                    setCandForm(f => ({ ...f, resume_url: publicUrl }))
                    toast.success('履歷已上傳')
                  } finally {
                    setResumeUploading(false)
                    e.target.value = ''  // reset 才能再次上傳同檔名
                  }
                }} />
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              支援 PDF / Word / 圖片，10MB 內。儲存後面試官會看到 📄 看履歷 按鈕
            </div>
          </Field>
          <Field label="標籤">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {(candForm.tags || []).map(t => (
                <span key={t} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 12, fontSize: 12,
                  background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                  border: '1px solid var(--accent-cyan)',
                }}>
                  {t}
                  <button type="button"
                    onClick={() => setCandForm(f => ({ ...f, tags: f.tags.filter(x => x !== t) }))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <input className="form-input" style={{ width: '100%' }}
              placeholder="輸入標籤後按 Enter（例：積極、有興趣加薪）"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault()
                  const tag = tagInput.trim()
                  if (!(candForm.tags || []).includes(tag)) {
                    setCandForm(f => ({ ...f, tags: [...(f.tags || []), tag] }))
                  }
                  setTagInput('')
                }
              }} />
          </Field>
          <Field label="備註">
            <textarea className="form-input" style={{ width: '100%' }} rows={2} value={candForm.notes}
              onChange={e => setCandForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
        </Modal>
      )}

      {/* ─── Create Offer modal ─── */}
      {showOfferModal && offerTarget && (
        <Modal
          title={`建立錄取通知書 — ${offerTarget.name}`}
          onClose={() => setShowOfferModal(false)}
          onSubmit={handleCreateOffer}
          submitLabel="建立並送簽"
        >
          <Field label="範本">
            <select className="form-input" style={{ width: '100%' }} value={offerForm.template_id}
              onChange={e => setOfferForm(f => ({ ...f, template_id: e.target.value }))}>
              <option value="">不使用範本</option>
              {offerTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.is_default ? '（預設）' : ''}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="職位" required>
              <input className="form-input" style={{ width: '100%' }} value={offerForm.position}
                onChange={e => setOfferForm(f => ({ ...f, position: e.target.value }))} />
            </Field>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={offerForm.dept}
                onChange={e => setOfferForm(f => ({ ...f, dept: e.target.value }))}>
                <option value="">請選擇</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="月薪 (NT$)">
              <input className="form-input" style={{ width: '100%' }} type="number" value={offerForm.salary}
                onChange={e => setOfferForm(f => ({ ...f, salary: e.target.value }))} placeholder="45000" />
            </Field>
            <Field label="到職日">
              <input className="form-input" style={{ width: '100%' }} type="date" value={offerForm.start_date}
                onChange={e => setOfferForm(f => ({ ...f, start_date: e.target.value }))} />
            </Field>
          </div>
          <Field label="試用期（天）">
            <input className="form-input" style={{ width: '100%' }} type="number" value={offerForm.probation_days}
              onChange={e => setOfferForm(f => ({ ...f, probation_days: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </div>
  )
}

// ─── 變數列表 ───
const TPL_VARS = [
  { label: '應聘人姓名', key: 'candidate_name' },
  { label: '職位',       key: 'position' },
  { label: '部門',       key: 'dept' },
  { label: '月薪',       key: 'salary' },
  { label: '到職日',     key: 'start_date' },
  { label: '試用期天數', key: 'probation_days' },
  { label: '公司名稱',   key: 'company_name' },
  { label: '簽署日期',   key: 'signed_date' },
]

const SAMPLE_DATA = {
  candidate_name: '王小明',
  position:       '資深前端工程師',
  dept:           '技術部',
  salary:         'NT$ 60,000',
  start_date:     '2026/06/01',
  probation_days: '90 天',
  company_name:   '貴公司名稱',
  signed_date:    new Date().toISOString().slice(0, 10).replace(/-/g, '/'),
}

const DEFAULT_BODY = `親愛的 {{candidate_name}} 您好，

感謝您應徵本公司 {{position}} 一職。

經過審慎評選，我們誠摯地邀請您加入我們的團隊，以下為錄取條件：

• 職位：{{position}}
• 部門：{{dept}}
• 月薪：{{salary}}
• 到職日：{{start_date}}
• 試用期：{{probation_days}}

請於收到本通知後 5 個工作日內回覆確認意願，逾期視同婉拒。
如有任何問題，歡迎聯繫人資部門。

期待您的加入，祝商祺。

{{company_name}}
{{signed_date}}`

function bodyToHtml(text) {
  return text
    .split(/\n\n+/)
    .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

function fillPreview(text, data) {
  return Object.entries(data).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, `<strong style="color:var(--accent-cyan)">${v}</strong>`), text
  )
}

function OfferTemplateEditor({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '')
  const [body, setBody] = useState(() => {
    if (!initial?.body_html) return DEFAULT_BODY
    // convert HTML back to plain text for editing
    return initial.body_html
      .replace(/<p>/g, '').replace(/<\/p>/g, '\n\n').replace(/<br>/g, '\n').trim()
  })
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const textareaRef = import.meta.env ? { current: null } : null
  const taRef = { current: null }

  const insertVar = (key) => {
    const el = taRef.current
    if (!el) return
    const start = el.selectionStart
    const end   = el.selectionEnd
    const tag   = `{{${key}}}`
    const next  = body.slice(0, start) + tag + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + tag.length
      el.focus()
    })
  }

  const handleSave = async () => {
    if (!name.trim()) { toast('請填寫範本名稱'); return }
    setSaving(true)
    await onSave({ name: name.trim(), body_html: bodyToHtml(body) })
    setSaving(false)
  }

  const previewHtml = fillPreview(
    body.replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>'),
    SAMPLE_DATA
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      {/* Left: editor */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 16 }}>
          {initial ? '編輯範本' : '新增範本'}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>範本名稱</div>
          <input className="form-input" style={{ width: '100%' }} placeholder="例：標準錄取通知書"
            value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>插入變數（點擊即可插入游標位置）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TPL_VARS.map(v => (
              <button key={v.key} onClick={() => insertVar(v.key)}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', border: 'none',
                  background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 500 }}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>信件內容</div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>直接打字，換行用 Enter</span>
          </div>
          <textarea ref={taRef} className="form-input"
            style={{ width: '100%', minHeight: 320, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7, resize: 'vertical' }}
            value={body} onChange={e => setBody(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button className="btn btn-secondary" onClick={() => setBody(DEFAULT_BODY)}>套用預設範本</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存範本'}
          </button>
        </div>
      </div>

      {/* Right: preview */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>
          預覽效果
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          青色字為變數，實際發出時會替換成真實資料
        </div>
        <div style={{
          background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
          borderRadius: 8, padding: '20px 24px', fontSize: 14, lineHeight: 2,
          color: 'var(--text-secondary)', minHeight: 320,
        }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
    </div>
  )
}
