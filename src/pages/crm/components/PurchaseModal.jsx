import { ArrowUpCircle } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import { calculatePointsEarned, TIER_RULES } from '../../../lib/crmEngine'

export default function PurchaseModal({
  purchaseMember,
  purchaseAmount,
  setPurchaseAmount,
  purchaseResult,
  handlePurchase,
  onClose,
  levelBadge,
}) {
  return (
    <Modal
      title={`模擬消費 — ${purchaseMember.name}`}
      onClose={onClose}
      onSubmit={purchaseResult ? onClose : handlePurchase}
      submitLabel={purchaseResult ? '完成' : '確認消費'}
    >
      {!purchaseResult ? (
        <>
          <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>目前等級</span>
              <span className={`badge ${levelBadge(purchaseMember.level)}`}>
                <span className="badge-dot"></span>{purchaseMember.level}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>累計消費</span><span style={{ fontWeight: 600 }}>NT$ {(purchaseMember.total_spent || 0).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>可用點數</span><span style={{ fontWeight: 600 }}>{(purchaseMember.available_points || 0).toLocaleString()}</span>
            </div>
          </div>
          <Field label="消費金額 (NT$)">
            <input
              className="form-input" type="number" style={{ width: '100%' }}
              placeholder="輸入消費金額" value={purchaseAmount}
              onChange={e => setPurchaseAmount(e.target.value)}
              min="1"
            />
          </Field>
          {purchaseAmount && Number(purchaseAmount) > 0 && (
            <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>預計獲得點數</span>
                <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>
                  +{calculatePointsEarned(Number(purchaseAmount), purchaseMember.level)}
                </span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                計算方式：${Number(purchaseAmount).toLocaleString()} / 10 × {TIER_RULES.find(t => t.level === purchaseMember.level)?.earn_rate || 1}x 倍率
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>消費處理完成</div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>消費金額</span><span style={{ fontWeight: 600 }}>NT$ {Number(purchaseAmount).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>獲得點數</span><span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>+{purchaseResult.pointsEarned}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>新累計消費</span><span style={{ fontWeight: 600 }}>NT$ {purchaseResult.newTotalSpent.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>新總點數</span><span style={{ fontWeight: 600 }}>{purchaseResult.newTotalPoints.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>新可用點數</span><span style={{ fontWeight: 600 }}>{purchaseResult.newAvailablePoints.toLocaleString()}</span>
            </div>
          </div>
          {purchaseResult.tierChanged && (
            <div style={{
              padding: '12px 16px', borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(236,72,153,0.15))',
              border: '1px solid var(--accent-purple)',
              textAlign: 'center',
            }}>
              <ArrowUpCircle size={20} style={{ color: 'var(--accent-purple)', marginBottom: 4 }} />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent-purple)' }}>升級！</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>
                {purchaseMember.level} → <span style={{ fontWeight: 700 }}>{purchaseResult.newTier}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
