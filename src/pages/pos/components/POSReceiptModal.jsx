import { forwardRef } from 'react'
import Modal from '../../../components/Modal'

const POSReceiptModal = forwardRef(function POSReceiptModal({
  receiptData,
  onClose,
  onPrint,
}, ref) {
  if (!receiptData) return null

  return (
    <Modal title="收據預覽" onClose={onClose} onSubmit={onPrint} submitLabel="列印收據">
      <div ref={ref} style={{
        fontFamily: "'Courier New', monospace",
        background: '#fff',
        color: '#000',
        padding: 20,
        maxWidth: 300,
        margin: '0 auto',
        fontSize: 12,
        lineHeight: 1.6,
      }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{receiptData.storeName}</div>
        <div style={{ textAlign: 'center', fontSize: 11, marginBottom: 4 }}>統一編號：12345678</div>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ textAlign: 'center', marginBottom: 2 }}>電子發票證明聯</div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{receiptData.invoiceNum}</div>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>{receiptData.date}</div>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

        {receiptData.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.name} x{item.qty}</span>
            <span>${item.amount}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>小計</span><span>${receiptData.subtotal}</span></div>
        {receiptData.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>折扣</span><span>-${receiptData.discount}</span></div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>稅金 (5%)</span><span>${receiptData.tax}</span></div>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}><span>合計</span><span>${receiptData.total}</span></div>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>付款方式</span><span>{receiptData.paymentMethod}</span></div>
        {receiptData.cashTendered && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>收現</span><span>${receiptData.cashTendered}</span></div>
        )}
        {receiptData.change !== null && receiptData.change > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>找零</span><span>${receiptData.change}</span></div>
        )}
        {receiptData.carrierType && (
          <>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ textAlign: 'center' }}>載具：{receiptData.carrierType}</div>
            <div style={{ textAlign: 'center' }}>{receiptData.carrierValue}</div>
          </>
        )}
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ textAlign: 'center', fontSize: 10, color: '#666' }}>交易編號：{receiptData.txnNum}</div>
        <div style={{ textAlign: 'center', fontSize: 10, color: '#666' }}>付款編號：{receiptData.paymentId}</div>
        <div style={{ textAlign: 'center', marginTop: 10, fontWeight: 600 }}>謝謝惠顧</div>
      </div>
    </Modal>
  )
})

export default POSReceiptModal
