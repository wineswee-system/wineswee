import { Loader2, CheckCircle, XCircle, Receipt, Printer, RotateCcw } from 'lucide-react'

export default function POSPaymentOverlay({
  paymentStage,
  processingMsg,
  receiptData,
  paymentResult,
  gatewayPending,
  gatewayConfirmed,
  confirmingPayment,
  autoPrint,
  setAutoPrint,
  setShowReceipt,
  handlePrintReceipt,
  handleConfirmGateway,
  handleQuickRefund,
  resetTerminal,
  setPaymentStage,
}) {
  if (paymentStage === 'paying') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'var(--bg-primary)', borderRadius: 16, padding: 48, textAlign: 'center', minWidth: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <Loader2 size={48} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-cyan)', marginBottom: 16 }} />
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>付款處理中</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{processingMsg}</div>
          <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 12 }}>請勿關閉此頁面</div>
        </div>
      </div>
    )
  }

  if (paymentStage === 'success') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'var(--bg-primary)', borderRadius: 16, padding: 40, textAlign: 'center', minWidth: 380, maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <CheckCircle size={56} style={{ color: 'var(--accent-green)', marginBottom: 12 }} />
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--accent-green)' }}>
            {gatewayPending ? '付款待確認' : '付款成功'}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
            交易編號：{receiptData?.txnNum}
          </div>

          {/* Gateway pending notice */}
          {gatewayPending && (
            <div style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 12,
              fontSize: 13,
              color: 'var(--accent-orange, #f59e0b)',
              textAlign: 'left',
            }}>
              此筆為線上金流付款，需確認 gateway 回呼後才算完成。
              <br />在正式環境中，付款確認由 ECPay / LINE Pay 自動回呼。
            </div>
          )}

          <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, marginBottom: 16, textAlign: 'left', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>付款方式</span><span style={{ fontWeight: 600 }}>{receiptData?.paymentMethod}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>付款編號</span><span style={{ fontWeight: 600, fontSize: 11 }}>{paymentResult?.paymentId}</span>
            </div>
            {paymentResult?.gatewayTransactionId && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Gateway ID</span><span style={{ fontWeight: 600, fontSize: 11 }}>{paymentResult.gatewayTransactionId}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>發票號碼</span><span style={{ fontWeight: 600 }}>{receiptData?.invoiceNum}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>狀態</span>
              <span style={{
                fontWeight: 600,
                color: gatewayConfirmed ? 'var(--accent-green)' : 'var(--accent-orange, #f59e0b)',
              }}>
                {gatewayConfirmed ? '已完成' : '待確認'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, color: 'var(--accent-cyan)' }}>
              <span>合計</span><span>NT$ {receiptData?.total?.toLocaleString()}</span>
            </div>
            {receiptData?.change !== null && receiptData?.change > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: 'var(--accent-orange)', fontWeight: 600 }}>
                <span>找零</span><span>NT$ {receiptData.change.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Confirm gateway payment button (for pending gateway payments) */}
          {gatewayPending && (
            <button
              className="btn"
              style={{
                width: '100%',
                marginBottom: 10,
                padding: '10px 0',
                background: 'var(--accent-orange, #f59e0b)',
                color: '#000',
                fontWeight: 700,
                border: 'none',
                borderRadius: 8,
                cursor: confirmingPayment ? 'wait' : 'pointer',
              }}
              onClick={handleConfirmGateway}
              disabled={confirmingPayment}
            >
              {confirmingPayment ? '確認中...' : '確認付款（模擬 Gateway 回呼）'}
            </button>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={{ flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }} onClick={() => setShowReceipt(true)}>
              <Receipt size={14} /> 預覽收據
            </button>
            <button className="btn" style={{ flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }} onClick={handlePrintReceipt}>
              <Printer size={14} /> 列印收據
            </button>
          </div>

          {/* Auto-print toggle */}
          <label style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 10, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer',
            padding: '6px 0', borderRadius: 8, background: 'var(--bg-secondary)',
          }}>
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={e => setAutoPrint(e.target.checked)}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
            <Printer size={13} />
            自動列印收據
          </label>

          {/* Refund button */}
          <button
            className="btn"
            style={{
              width: '100%',
              marginTop: 10,
              padding: '8px 0',
              background: 'transparent',
              border: '1px solid var(--accent-red)',
              color: 'var(--accent-red)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
            }}
            onClick={handleQuickRefund}
          >
            <RotateCcw size={13} style={{ marginRight: 4 }} /> 退款此筆交易
          </button>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, padding: '10px 0' }} onClick={resetTerminal}>
            下一筆交易
          </button>
        </div>
      </div>
    )
  }

  if (paymentStage === 'failed') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'var(--bg-primary)', borderRadius: 16, padding: 40, textAlign: 'center', minWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <XCircle size={56} style={{ color: 'var(--accent-red)', marginBottom: 12 }} />
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--accent-red)' }}>付款失敗</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>{processingMsg}</div>
          <button className="btn btn-primary" style={{ width: '100%', padding: '10px 0' }} onClick={() => setPaymentStage('cart')}>
            返回重試
          </button>
        </div>
      </div>
    )
  }

  return null
}
