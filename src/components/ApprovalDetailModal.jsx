/**
 * 共用簽核明細 modal
 *
 * 左側：表單內容（申請人卡 + 動態欄位 + 附件 + 表單編號 / 申請時間）
 * 右側：垂直簽核時間軸（每關 status 動態渲染：已核 / 等候 / 駁回）
 *
 * 設計參照 104 人資那種「簽核流程：簽核中」面板。
 * 對任何走簽核鏈或單關核可的表單都通用，每個 caller 把自己的 fields/chain mapping 過來即可。
 */

import { useEffect, useMemo, useState } from 'react'
import { X, Printer, FileText, Image as ImageIcon, User } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { supabase } from '../lib/supabase'
import ApprovalActionBar from './ApprovalActionBar'

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1', text: '簽核中' },
  '待審核': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1', text: '簽核中' },
  '已核准': { bg: 'rgba(34,197,94,0.12)', color: '#0a6b2e', text: '已核准' },
  '已核銷': { bg: 'rgba(34,197,94,0.12)', color: '#0a6b2e', text: '已核銷' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)', color: '#9c1f1f', text: '已駁回' },
  '已拒絕': { bg: 'rgba(239,68,68,0.12)', color: '#9c1f1f', text: '已拒絕' },
  '已退回': { bg: 'rgba(239,68,68,0.12)', color: '#9c1f1f', text: '已退回' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: '#6b7280', text: '已取消' },
}

import { fmtDateTimeTW } from '../lib/datetime'
const fmtDateTime = fmtDateTimeTW

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {string} props.docTitle           '加班單' / '請假單' …
 * @param {string|number} [props.docNo]     表單編號
 * @param {string} [props.status]           '申請中' / '已核准' / '已駁回' …
 * @param {Object} props.applicant          { name, name_en?, position?, status?, employee_no?, avatar_url?, dept? }
 * @param {Array} props.fields              [{ label, value, multiline? }]
 * @param {Array} [props.attachments]       [{ url, name, type? }]
 * @param {string} [props.createdAt]        申請時間 (ISO)
 * @param {Array} props.chainSteps          [{ label, name, status, completedAt?, rejectReason? }]
 *                                          status: 'completed' / 'current' / 'pending' / 'rejected'
 * @param {Function} [props.onPrint]        下載簽呈 callback
 */
export default function ApprovalDetailModal({
  open, onClose,
  docTitle, docNo, status,
  applicant = {},
  fields = [],
  attachments = [],
  createdAt,
  chainSteps = [],
  onPrint,
  // 廠商 #7：簽核時間軸 — 傳 requestType + requestId 自動 fetch get_approval_timeline
  //   requestType: 'leave' | 'overtime' | 'trip' | 'correction' | 'expense' | 'expense_request'
  requestType,
  requestId,
  // 簽核動作（modal 底部 ApprovalActionBar 用）— 可選；只有當前是 pending 且 caller 可簽時傳
  //   sourceTable: 'leave_requests' / 'expense_requests' / ... 對應 approval_extra_steps.source_table
  //   row:         { id, current_step, employee_id } — 給加簽用
  //   onApprove:   async (row) => void
  //   onReject:    async (row, reason) => void
  //   onChanged:   () => void — action 完後 reload
  actions,
}) {
  const [timeline, setTimeline] = useState([])

  // 拉 chain step 進站/出站時間（每關停留多久）
  useEffect(() => {
    if (!open || !requestType || !requestId) { setTimeline([]); return }
    let cancelled = false
    supabase.rpc('get_approval_timeline', {
      p_request_type: requestType,
      p_request_id: Number(requestId),
    }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { console.warn('get_approval_timeline failed:', error); return }
      setTimeline(Array.isArray(data) ? data : [])
    })
    return () => { cancelled = true }
  }, [open, requestType, requestId])

  // 把 timeline 的 duration_text 合併進 chainSteps（按 step_order 對應）
  const mergedChainSteps = useMemo(() => {
    if (!timeline.length) return chainSteps
    return chainSteps.map((s, idx) => {
      const t = timeline.find(x => x.step_order === idx) || timeline[idx]
      if (!t) return s
      return { ...s, durationText: t.duration_text }
    })
  }, [chainSteps, timeline])

  if (!open) return null

  const overallBadge = STATUS_BADGE[status] || STATUS_BADGE['申請中']

  return (
    <ModalOverlay onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 12,
        width: 'min(960px, 96vw)', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid var(--border-medium)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{docTitle}</h3>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {onPrint && (
              <button className="btn btn-secondary" style={{ fontSize: 14, padding: '8px 14px' }} onClick={onPrint}>
                <Printer size={14} /> 下載簽呈
              </button>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, display: 'flex',
            }}>
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Body: split layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* LEFT: form details */}
          <div style={{ flex: 1, padding: 24, overflowY: 'auto', minWidth: 0 }}>
            {/* Applicant card */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: 14, marginBottom: 20,
              background: 'var(--bg-secondary)',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'var(--bg-card)',
                border: '2px solid var(--border-medium)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                {applicant.avatar_url ? (
                  <img src={applicant.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <User size={32} color="var(--text-muted)" />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>
                  {applicant.name || '—'}
                  {applicant.name_en && <span style={{ color: 'var(--text-muted)', fontWeight: 500, marginLeft: 6, fontSize: 15 }}>{applicant.name_en}</span>}
                </div>
                {applicant.position && (
                  <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 3 }}>
                    {applicant.position}{applicant.dept ? `　·　${applicant.dept}` : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {applicant.status && (
                    <span style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700,
                      background: applicant.status === '在職' ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.15)',
                      color: applicant.status === '在職' ? '#0a6b2e' : '#6b7280',
                    }}>{applicant.status}</span>
                  )}
                  {applicant.employee_no && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {applicant.employee_no}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Dynamic fields */}
            {fields.map((f, i) => (
              <div key={i} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>
                  {f.label}
                </div>
                <div style={{
                  fontSize: 16, color: 'var(--text-primary)',
                  whiteSpace: f.multiline ? 'pre-wrap' : 'normal',
                  lineHeight: 1.6,
                }}>
                  {(f.value == null || f.value === '') ? <span style={{ color: 'var(--text-muted)' }}>—</span> : f.value}
                </div>
              </div>
            ))}

            {/* Attachments */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                附件
              </div>
              {attachments.length === 0 ? (
                <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>無附件</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {attachments.map((a, i) => {
                    const isImage = a.type?.startsWith('image') || /\.(jpe?g|png|gif|webp|svg)/i.test(a.name || a.url || '')
                    return (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px',
                          background: 'var(--bg-secondary)', borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          fontSize: 14, color: 'var(--accent-cyan)',
                          textDecoration: 'none',
                        }}>
                        {isImage ? <ImageIcon size={16} /> : <FileText size={16} />}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.name || '附件'}
                        </span>
                      </a>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer meta */}
            <div style={{
              marginTop: 20, paddingTop: 14,
              borderTop: '1px dashed var(--border-subtle)',
              fontSize: 13, color: 'var(--text-muted)',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {docNo && <div>表單編號：<span style={{ fontFamily: 'monospace' }}>{docNo}</span></div>}
              {createdAt && <div>申請時間：{fmtDateTime(createdAt)}</div>}
            </div>
          </div>

          {/* RIGHT: chain timeline */}
          <div style={{
            width: 320, flexShrink: 0,
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border-subtle)',
            padding: 24, overflowY: 'auto',
          }}>
            <div style={{
              fontSize: 17, fontWeight: 700, marginBottom: 22,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              簽核流程：
              <span style={{
                padding: '4px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700,
                background: overallBadge.bg, color: overallBadge.color,
              }}>{overallBadge.text}</span>
            </div>

            <ChainTimeline steps={mergedChainSteps} />
          </div>
        </div>

        {/* Footer: 簽核操作列（僅 pending 且 caller 可簽核時顯示） */}
        {actions && actions.sourceTable && actions.row && (
          <ApprovalActionBar
            sourceTable={actions.sourceTable}
            row={actions.row}
            onApprove={actions.onApprove}
            onReject={actions.onReject}
            onChanged={actions.onChanged}
            approveLabel={actions.approveLabel}
            rejectLabel={actions.rejectLabel}
          />
        )}
      </div>
    </ModalOverlay>
  )
}

// ─── 內部：垂直時間軸 ───
function ChainTimeline({ steps }) {
  if (!steps || steps.length === 0) {
    return <div style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
      尚未設定簽核鏈
    </div>
  }

  // 終點 dot：依整體狀態決定
  //   任一 rejected → 失敗紅
  //   有非 archival 的 pending/current → 等待中（灰）
  //   其他（全 completed，或剩下都是 archival 存檔關卡）→ 簽核完成（綠）
  const hasRejected = steps.some(s => s.status === 'rejected')
  const hasRealPending = steps.some(s => (s.status === 'pending' || s.status === 'current') && !s.archival)
  let closeStateText, closeStateColor, closeStateBg
  if (hasRejected) {
    closeStateText = '簽核失敗'; closeStateColor = '#ef4444'; closeStateBg = '#ef4444'
  } else if (hasRealPending) {
    closeStateText = '等待簽核'; closeStateColor = 'var(--text-muted)'; closeStateBg = 'var(--border-medium)'
  } else {
    closeStateText = '簽核完成'; closeStateColor = '#0a6b2e'; closeStateBg = '#22c55e'
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 34 }}>
      {/* Vertical line */}
      <div style={{
        position: 'absolute', left: 10, top: 8, bottom: 8,
        width: 3, background: 'var(--border-medium)',
      }} />

      {steps.map((step, i) => (
        <TimelineDot key={i} step={step} index={i} isLast={i === steps.length - 1} />
      ))}

      {/* 終點 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: -25,
          width: 22, height: 22, borderRadius: '50%',
          background: closeStateBg,
          border: '4px solid var(--bg-secondary)',
        }} />
        <div style={{ fontSize: 16, color: closeStateColor, fontWeight: 600 }}>{closeStateText}</div>
      </div>
    </div>
  )
}

function TimelineDot({ step, index, isLast }) {
  // current 改成「藍色空心圈」跟 completed 的「藍色實心」做區分，讓現在輪到誰簽一目了然
  const dotStyle = {
    completed: { fill: '#0ea5e9', border: '#0ea5e9' },         // 實心 cyan
    current:   { fill: 'transparent', border: '#0ea5e9' },     // ★ 空心 cyan（藍）
    pending:   { fill: 'transparent', border: 'var(--border-medium)' },
    rejected:  { fill: '#ef4444', border: '#ef4444' },
  }[step.status] || { fill: 'transparent', border: 'var(--border-medium)' }
  const labelColors = {
    completed: '#0ea5e9',
    current: '#0ea5e9',
    pending: 'var(--text-muted)',
    rejected: '#ef4444',
  }

  return (
    <div style={{ position: 'relative', marginBottom: 22 }}>
      <div style={{
        position: 'absolute', left: -25, top: 4,
        width: 22, height: 22, borderRadius: '50%',
        background: dotStyle.fill,
        border: `3px solid ${dotStyle.border}`,
        boxShadow: '0 0 0 4px var(--bg-secondary)',
      }} />
      <div style={{
        fontSize: 16, fontWeight: 700,
        color: labelColors[step.status] || 'var(--text-muted)',
        lineHeight: 1.3,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {step.label}
        {step.archival && (
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            存檔
          </span>
        )}
      </div>
      {step.name && (
        <div style={{ fontSize: 15, color: 'var(--text-primary)', marginTop: 4 }}>
          {step.name}
        </div>
      )}
      {step.completedAt && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          {fmtDateTime(step.completedAt)}
        </div>
      )}
      {step.durationText && (
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)', marginTop: 4,
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 4,
          background: step.status === 'current' ? 'rgba(99,102,241,0.08)' : 'transparent',
        }}>
          ⏱ 停留 {step.durationText}
        </div>
      )}
      {step.status === 'rejected' && step.rejectReason && (
        <div style={{
          fontSize: 13, color: '#9c1f1f', marginTop: 6,
          padding: '6px 10px', borderRadius: 5,
          background: 'rgba(239,68,68,0.08)',
        }}>
          {step.rejectReason}
        </div>
      )}
    </div>
  )
}
