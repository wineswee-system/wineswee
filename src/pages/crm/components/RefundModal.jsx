import { ArrowDownCircle } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import { calculatePointsEarned, TIER_RULES } from '../../../lib/crmEngine'

export default function RefundModal({
  refundMember,
  refundAmount,
  setRefundAmount,
  refundResult,
  handleRefund,
  onClose,
  levelBadge,
}) {
  return (
    <Modal
      title={`退款扣點 — ${refundMember.name}`}
      onClose={onClose}
      onSubmit={refundResult ? onClose : handleRefund}
      submitLabel={refundResult ? '完成' : '確認退款'}
    >
      {!refundResult ? (
        <>
          <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>目前等級</span>
              <span className={`badge ${levelBadge(refundMember.level)}`}>
                <span className="badge-dot"></span>{refundMember.level}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>累計消費</span><span style={{ fontWeight: 600 }}>NT$ {(refundMember.total_spent || 0).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>總點數</span><span style={{ fontWeight: 600 }}>{(refundMember.total_points || 0).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>可用點數</span><span style={{ fontWeight: 600 }}>{(refundMember.available_points || 0).toLocaleString()}</span>
            </div>
          </div>
          <Field label="退款金額 (NT$)">
            <input
              className="form-input" type="number" style={{ width: '100%' }}
              placeholder="輸入退款金額" value={refundAmount}
              onChange={e => setRefundAmount(e.target.value)}
              min="1"
            />
          </Field>
          {refundAmount && Number(refundAmount) > 0 && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, fontSize: 12, border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>預計扣回點數</span>
                <span style={{ fontWeight: 700, color: 'var(--accent-red)' }}>
                  -{calculatePointsEarned(Number(refundAmount), refundMember.level)}
                </span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                計算方式：${Number(refundAmount).toLocaleString()} / 10 x {TIER_RULES.find(t => t.level === refundMember.level)?.earn_rate || 1}x 倍率（與消費累點相同）
              </div>
              {Number(refundAmount) > (refundMember.total_spent || 0) && (
                <div style={{ color: 'var(--accent-orange)', marginTop: 4, fontWeight: 600 }}>
                  注意：退款金額超過累計消費，超出部分將不影響消費總額（最低為 0）
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>↩️</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>退款處理完成</div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>退款金額</span><span style={{ fontWeight: 600 }}>NT$ {Number(refundAmount).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>扣回點數</span><span style={{ fontWeight: 700, color: 'var(--accent-red)' }}>-{refundResult.pointsReversed}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>新累計消費</span><span style={{ fontWeight: 600 }}>NT$ {refundResult.newTotalSpent.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>新總點數</span><span style={{ fontWeight: 600 }}>{refundResult.newTotalPoints.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>新可用點數</span><span style={{ fontWeight: 600 }}>{refundResult.newAvailablePoints.toLocaleString()}</span>
            </div>
          </div>
          {refundResult.tierChanged && (
            <div style={{
              padding: '12px 16px', borderRadius: 8,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid var(--accent-red)',
              textAlign: 'center',
            }}>
              <ArrowDownCircle size={20} style={{ color: 'var(--accent-red)', marginBottom: 4 }} />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent-red)' }}>等級調整</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>
                {refundMember.level} → <span style={{ fontWeight: 700 }}>{refundResult.newTier}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
