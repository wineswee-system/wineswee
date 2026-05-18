import { useState, useEffect, useCallback } from 'react'
import { Plus, X, FileText, Briefcase, UserCheck, Calendar } from 'lucide-react'
import {
  getRecruitmentJobs, createRecruitmentJob, updateRecruitmentJob,
  getCandidates, createCandidate, updateCandidate, deleteCandidate,
  getInterviews, createInterview, updateInterview,
  getOfferLetterTemplates, getOfferLetters, createOfferLetter, updateOfferLetter,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
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
function CandidatePanel({ c, interviews, onClose, onDelete, orgId, employees, onRefreshInterviews, offerTemplates, onCreateOffer }) {
  const [showIntForm, setShowIntForm] = useState(false)
  const [intForm, setIntForm] = useState({ round: '初試', scheduled_at: '', interviewer_id: '', result: '待定', note: '', location: '' })
  const iset = (k, v) => setIntForm(f => ({ ...f, [k]: v }))

  const handleAddInterview = async () => {
    if (!intForm.scheduled_at) { toast('請填寫面試時間'); return }
    const { data } = await createInterview({
      round: intForm.round,
      scheduled_at: intForm.scheduled_at,
      interviewer_id: intForm.interviewer_id || null,
      result: intForm.result,
      note: intForm.note,
      location: intForm.location,
      candidate_id: c.id,
      organization_id: orgId,
    })
    if (data) {
      onRefreshInterviews()
      setShowIntForm(false)
      setIntForm({ round: '初試', scheduled_at: '', interviewer_id: '', result: '待定', note: '', location: '' })
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
              <div style={{ fontWeight: 600, fontSize: 12 }}>{iv.round} · {fmtDate(iv.scheduled_at)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                面試官：{iv.employees?.name || '—'} · 結果：{iv.result}
              </div>
              {iv.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{iv.note}</div>}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {RESULTS.filter(r => r !== iv.result).map(r => (
                  <button key={r} className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }}
                    onClick={() => updateInterview(iv.id, { result: r }).then(onRefreshInterviews)}>
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

  const [jobForm,   setJobForm]   = useState({ title: '', dept: '', location: '', type: '全職' })
  const [candForm,  setCandForm]  = useState({ name: '', email: '', phone: '', source: '主動投遞', job_id: '', notes: '' })
  const [offerForm, setOfferForm] = useState({ template_id: '', position: '', dept: '', salary: '', start_date: '', probation_days: 90 })

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    try {
      const [j, d, l, e, c, iv, ot, ol] = await Promise.all([
        getRecruitmentJobs(orgId),
        supabase.from('departments').select('id,name').eq('organization_id', orgId).order('name'),
        supabase.from('stores').select('id,name').eq('organization_id', orgId).order('name'),
        supabase.from('employees').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name'),
        getCandidates(orgId),
        getInterviews(orgId),
        getOfferLetterTemplates(orgId),
        getOfferLetters(orgId),
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
    const { data } = await createRecruitmentJob({
      ...jobForm, applicants: 0, status: '招募中', organization_id: orgId,
    })
    if (data) { setJobs(prev => [...prev, data]); setShowJobModal(false) }
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
      job_id:          candForm.job_id  ? Number(candForm.job_id) : null,
      organization_id: orgId,
      created_by:      profile?.id      || null,
    })
    if (data) {
      setCandidates(prev => [...prev, data])
      setShowCandModal(false)
      setCandForm({ name: '', email: '', phone: '', source: '主動投遞', job_id: '', notes: '' })
      if (data.job_id) {
        const job = jobs.find(j => j.id === data.job_id)
        if (job) updateRecruitmentJob(job.id, { applicants: (job.applicants || 0) + 1 })
      }
    }
  }

  const handleStageChange = async (id, stage) => {
    const { data } = await updateCandidate(id, { stage })
    if (data) {
      setCandidates(prev => prev.map(c => c.id === id ? { ...c, stage } : c))
      if (selectedCand?.id === id) setSelectedCand(s => ({ ...s, stage }))
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
      await updateCandidate(offerTarget.id, { hire_status: '待審', stage: '錄取決定' })
      setCandidates(prev => prev.map(c =>
        c.id === offerTarget.id ? { ...c, hire_status: '待審', stage: '錄取決定' } : c
      ))
      if (selectedCand?.id === offerTarget.id)
        setSelectedCand(s => ({ ...s, hire_status: '待審', stage: '錄取決定' }))
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

  // ── derived ──
  const filteredJobs  = jobs.filter(j => deptFilter === '' || j.dept === deptFilter)
  const filteredCands = candidates.filter(c =>
    (jobFilter   === '' || String(c.job_id) === jobFilter) &&
    (stageFilter === '' || c.stage === stageFilter)
  )
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
            <button className="btn btn-primary" onClick={() => setShowJobModal(true)}>
              <Plus size={14} /> 新增職缺
            </button>
          )}
          {tab === 'candidates' && (
            <button className="btn btn-primary" onClick={() => setShowCandModal(true)}>
              <Plus size={14} /> 新增候選人
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
                        {j.status === '招募中' && (
                          <button className="btn btn-sm btn-secondary" onClick={() => handleCloseJob(j.id)}>關閉</button>
                        )}
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
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
              <option value="">全部職缺</option>
              {jobs.map(j => <option key={j.id} value={String(j.id)}>{j.title}</option>)}
            </select>
            <select className="form-input" style={{ fontSize: 13, minWidth: 120 }} value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
              <option value="">全部階段</option>
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
              共 {filteredCands.length} 位候選人
            </span>
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
              onClose={() => setSelectedCand(null)}
              onDelete={handleDeleteCandidate}
              orgId={orgId}
              employees={employees}
              onRefreshInterviews={refreshInterviews}
              offerTemplates={offerTemplates}
              onCreateOffer={openOfferModal}
            />
          )}
        </>
      )}

      {/* ─── 面試 ─── */}
      {tab === 'interviews' && (
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
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => handlePrintApproval(ol)}>簽呈</button>
                        {ol.status === '已核准' && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={() => handlePrintOffer(ol)}>通知書</button>
                            <button className="btn btn-sm btn-secondary" onClick={() => handleMarkSent(ol)}>標記已發送</button>
                          </>
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

      {/* ─── Add Job modal ─── */}
      {showJobModal && (
        <Modal title="新增職缺" onClose={() => setShowJobModal(false)} onSubmit={handleAddJob}>
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
          <Field label="類型">
            <select className="form-input" style={{ width: '100%' }} value={jobForm.type}
              onChange={e => setJobForm(f => ({ ...f, type: e.target.value }))}>
              <option>全職</option><option>兼職</option><option>約聘</option>
            </select>
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
