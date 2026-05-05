import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

export default function FormSubmissions() {
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(isAdmin ? 'review' : 'mine')   // mine | review | all
  const [viewing, setViewing] = useState(null)
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = async () => {
    setLoading(true)
    let q = supabase.from('form_submissions').select(`*,
      template:form_templates(id,name,category,fields),
      applicant:employees!applicant_id(id,name,name_en,position),
      approver:employees!approver_id(id,name)`).order('id', { ascending: false })
    if (tab === 'mine') q = q.eq('applicant_id', profile?.id || 0)
    else if (tab === 'review') q = q.eq('status', '申請中')
    const { data } = await q
    setList(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [tab, profile?.id])

  const handleApprove = async (sub) => {
    if (!confirm(`核准 ${sub.applicant?.name} 的「${sub.template?.name}」？`)) return
    await supabase.from('form_submissions').update({
      status: '已核准',
      approver_id: profile?.id || null,
      approved_at: new Date().toISOString(),
    }).eq('id', sub.id)
    load()
  }

  const handleReject = async () => {
    if (!rejectReason) return alert('請填駁回原因')
    await supabase.from('form_submissions').update({
      status: '已駁回',
      approver_id: profile?.id || null,
      approved_at: new Date().toISOString(),
      reject_reason: rejectReason,
    }).eq('id', reviewModal.id)
    setReviewModal(null); setRejectReason('')
    load()
  }

  const handleCancel = async (sub) => {
    if (!confirm('確定取消此申請？')) return
    await supabase.from('form_submissions').update({ status: '已取消' }).eq('id', sub.id)
    load()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>表單提交記錄</h2>
        <p>共 {list.length} 筆</p>
      </div>

      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden', marginBottom: 16, maxWidth: 480 }}>
        {[
          { key: 'mine',   label: '📝 我的申請' },
          ...(isAdmin ? [{ key: 'review', label: '🔍 待我審核' }] : []),
          ...(isAdmin ? [{ key: 'all',    label: '📋 全部' }] : []),
        ].map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            flex: 1,
          }}>{t.label}</button>
        ))}
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>表單</th>
                <th>申請人</th>
                <th>申請日</th>
                <th>狀態</th>
                <th>核准人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>無資料</td></tr>
              )}
              {list.map(s => {
                const sb = STATUS_BADGE[s.status] || {}
                const canApprove = isAdmin && s.status === '申請中'
                const canCancel = s.status === '申請中' && (s.applicant_id === profile?.id || isAdmin)
                return (
                  <tr key={s.id}>
                    <td><b>{s.template?.name}</b></td>
                    <td>{s.applicant?.name}{s.applicant?.name_en ? ` ${s.applicant.name_en}` : ''}</td>
                    <td style={{ fontSize: 12 }}>{s.created_at?.slice(0, 10)}</td>
                    <td><span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: sb.bg, color: sb.color }}>{s.status}</span></td>
                    <td style={{ fontSize: 12 }}>{s.approver?.name || '—'}{s.reject_reason && <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>{s.reject_reason}</div>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setViewing(s)}>
                          <Eye size={11} /> 查看
                        </button>
                        {canApprove && (
                          <>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-green)' }} onClick={() => handleApprove(s)}>
                              <CheckCircle size={11} /> 核准
                            </button>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => setReviewModal(s)}>
                              <XCircle size={11} /> 駁回
                            </button>
                          </>
                        )}
                        {canCancel && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleCancel(s)}>取消</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {viewing && (
        <Modal title={`查看 — ${viewing.template?.name}`} onClose={() => setViewing(null)} onSubmit={null} maxWidth={700}>
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            申請人：{viewing.applicant?.name} · 申請日：{viewing.created_at?.slice(0, 10)} · 狀態：{viewing.status}
          </div>
          {(viewing.template?.fields || []).map(f => (
            <Field key={f.key} label={f.label}>
              <div style={{ padding: '6px 10px', background: 'var(--glass-light)', borderRadius: 6, fontSize: 13, minHeight: 32, whiteSpace: 'pre-wrap' }}>
                {renderFieldValue(viewing.data?.[f.key], f)}
              </div>
            </Field>
          ))}
        </Modal>
      )}

      {reviewModal && (
        <Modal title={`駁回 — ${reviewModal.template?.name}`} onClose={() => { setReviewModal(null); setRejectReason('') }} onSubmit={handleReject} submitLabel="確認駁回">
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}

function renderFieldValue(v, f) {
  if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--text-muted)' }}>—</span>
  if (f.type === 'checkbox') return v ? '✓ 是' : '✗ 否'
  if (f.type === 'file') return <a href={v} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)' }}>{v.split('/').pop()}</a>
  return String(v)
}
