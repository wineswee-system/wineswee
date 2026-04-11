import { CheckCircle } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'

export default function POSRefundModal({
  refundTxnId,
  setRefundTxnId,
  refundItems,
  refundResult,
  handleRefund,
  toggleRefundItem,
  processRefundSubmit,
  closeRefundModal,
}) {
  return (
    <Modal title="退貨/退款" onClose={closeRefundModal} onSubmit={refundResult ? closeRefundModal : processRefundSubmit} submitLabel={refundResult ? '關閉' : '確認退款'}>
      {refundResult ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <CheckCircle size={48} style={{ color: 'var(--accent-green)', marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--accent-green)' }}>退款申請已送出</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            退款編號：{refundResult.refundId}
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, fontSize: 13, textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>原交易編號</span><span style={{ fontWeight: 600 }}>{refundResult.paymentId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>退款金額</span><span style={{ fontWeight: 700, color: 'var(--accent-red)' }}>NT$ {refundResult.amount.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>狀態</span><span>{refundResult.message}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <Field label="原交易編號">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type="text"
                placeholder="輸入 POS 交易編號"
                value={refundTxnId}
                onChange={e => setRefundTxnId(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={handleRefund} style={{ padding: '8px 16px' }}>查詢</button>
            </div>
          </Field>

          {refundItems.length > 0 && (
            <>
              <Field label="選擇退貨商品">
                <div style={{ border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden' }}>
                  {refundItems.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => toggleRefundItem(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        background: item.selected ? 'var(--accent-red-dim, rgba(239,68,68,0.1))' : 'transparent',
                        borderBottom: idx < refundItems.length - 1 ? '1px solid var(--border-primary)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={item.selected} readOnly />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>x{item.qty}</span>
                      </div>
                      <span style={{ fontWeight: 600 }}>NT$ {(item.price * item.qty).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </Field>
              <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: 'var(--accent-red)', padding: '8px 0' }}>
                退款小計：NT$ {refundItems.filter(i => i.selected).reduce((sum, i) => sum + i.price * i.qty, 0).toLocaleString()}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
