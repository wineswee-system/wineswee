import { History, Sparkles, Loader, Copy } from 'lucide-react'
import LoadingSpinner from '../../../components/LoadingSpinner'
import NotesPanel from './NotesPanel'

/**
 * TicketDetailExpansionRows — inline expansion rows for ticket history and AI reply.
 * Renders as <tr> fragments meant to be placed directly inside a <tbody>.
 *
 * Props:
 *   ticket           object        the ticket row
 *   historyTicketId  number|null   which ticket's history is expanded
 *   historyLoading   boolean
 *   ticketHistory    array         history entries for the expanded ticket
 *   aiReplyTicketId  number|null   which ticket's AI reply is expanded
 *   aiReplyLoading   boolean
 *   aiReplyResult    object|null   { reply, sentiment, suggestedActions, relevantKB }
 *   aiReplyError     string|null
 *   onCopyAiReply    () => void
 */
export default function TicketDetailExpansionRows({
  ticket,
  historyTicketId,
  historyLoading,
  ticketHistory,
  aiReplyTicketId,
  aiReplyLoading,
  aiReplyResult,
  aiReplyError,
  onCopyAiReply,
}) {
  const t = ticket

  return (
    <>
      {/* AI Reply expansion row */}
      {aiReplyTicketId === t.id && (
        <tr key={`${t.id}-ai-reply`}>
          <td colSpan={14} style={{ padding: 0, background: 'linear-gradient(135deg, rgba(139,92,246,0.04), rgba(99,102,241,0.04))' }}>
            <div style={{ padding: '14px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} /> AI 智慧回覆 — 工單 #{String(t.id).padStart(4, '0')}
              </div>
              {aiReplyLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
                  <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> AI 正在分析工單並產生回覆...
                </div>
              ) : aiReplyError ? (
                <div style={{ fontSize: 12, color: 'var(--accent-red)', padding: '8px 12px', background: 'var(--accent-red-dim)', borderRadius: 8 }}>{aiReplyError}</div>
              ) : aiReplyResult ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Reply content */}
                  <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)', position: 'relative' }}>
                    <button onClick={onCopyAiReply} title="複製回覆" style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      <Copy size={14} />
                    </button>
                    <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', paddingRight: 24 }}>{aiReplyResult.reply}</div>
                  </div>
                  {/* Sentiment + Actions */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {aiReplyResult.sentiment && (
                      <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>客戶情緒：</span>
                        <span className={`badge ${aiReplyResult.sentiment === 'positive' ? 'badge-success' : aiReplyResult.sentiment === 'negative' ? 'badge-danger' : 'badge-neutral'}`}>
                          <span className="badge-dot"></span>
                          {aiReplyResult.sentiment === 'positive' ? '正面' : aiReplyResult.sentiment === 'negative' ? '負面' : '中性'}
                        </span>
                      </div>
                    )}
                    {aiReplyResult.suggestedActions?.length > 0 && (
                      <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-muted)' }}>建議動作：</span>
                        {aiReplyResult.suggestedActions.map((a, i) => (
                          <span key={i} style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-purple-dim, rgba(139,92,246,0.1))', color: 'var(--accent-purple)', fontSize: 11, fontWeight: 600 }}>{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {aiReplyResult.relevantKB?.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      參考知識庫：{aiReplyResult.relevantKB.join('、')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}

      {/* History expansion row */}
      {historyTicketId === t.id && (
        <tr key={`${t.id}-history`}>
          <td colSpan={14} style={{ padding: 0, background: 'var(--glass-light)' }}>
            <div style={{ padding: '12px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>
                <History size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> 異動紀錄 — 工單 #{String(t.id).padStart(4, '0')}
              </div>
              {historyLoading ? <LoadingSpinner /> : ticketHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>尚無異動紀錄</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ticketHistory.map(h => (
                    <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 130 }}>
                        {new Date(h.created_at).toLocaleString('zh-TW')}
                      </span>
                      <span style={{ fontWeight: 600, minWidth: 70 }}>
                        {h.action === 'status_changed' ? '狀態變更'
                          : h.action === 'assigned' ? '指派變更'
                          : h.action === 'created' ? '建立工單'
                          : h.action === 'merged' ? '合併工單'
                          : h.action}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {h.old_value && h.new_value ? `${h.old_value} → ${h.new_value}` : h.new_value || h.comment || ''}
                      </span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{h.actor}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Notes panel inline */}
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                <NotesPanel entityType="service_ticket" entityId={t.id} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
