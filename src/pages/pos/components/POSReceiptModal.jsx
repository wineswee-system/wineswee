import { forwardRef } from 'react'
import Modal from '../../../components/Modal'

// 格式對齊真實餐廳結帳單：內用/外帶==結帳單==
const POSReceiptModal = forwardRef(function POSReceiptModal({
  receiptData,
  onClose,
  onPrint,
}, ref) {
  if (!receiptData) return null

  const R = receiptData
  const orderTypeLabel = R.tableNum ? (R.orderType || '內用') : (R.orderType || '外帶')

  const fmt = (n) => Number(n || 0).toLocaleString()

  return (
    <Modal title="結帳單預覽" onClose={onClose} onSubmit={onPrint} submitLabel="列印">
      <div ref={ref} style={{
        fontFamily: "'Courier New', 'Noto Sans TC', monospace",
        background: '#fff',
        color: '#000',
        padding: '16px 14px',
        maxWidth: 300,
        margin: '0 auto',
        fontSize: 12,
        lineHeight: 1.7,
      }}>

        {/* 門市名稱 */}
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 2 }}>
          {R.storeName || ''}
        </div>

        {/* 內用/外帶 + 訂單號 */}
        {R.orderNum && (
          <div style={{ fontSize: 11 }}>{orderTypeLabel}:{R.orderNum}</div>
        )}

        {/* ==結帳單== */}
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
          {orderTypeLabel}==結帳單==
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

        {/* 列印時間 + 機台 */}
        <div>列印時間{R.printTime || R.date} 機{R.terminalId || '01'}</div>

        {/* 手機(MW) 服務員模式才顯 */}
        {R.waiterMode && <div>,手機(MW):</div>}

        {/* 員 序 單 */}
        <div>
          員:{R.staffCode || '-'}&nbsp;&nbsp;序:{R.seqNum || '-'}&nbsp;&nbsp;單:{R.orderNum || R.txnNum || '-'}
        </div>

        {/* 送達時間 */}
        {R.openedAt && <div>送達時間:{R.openedAt}</div>}

        {/* 桌號 */}
        {R.tableNum && <div>桌:{R.tableNum}</div>}

        {/* 開桌時間 */}
        {R.openTime && (
          <div>開:{R.openTime}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;序:{R.seqNum || '-'}</div>
        )}

        <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

        {/* 欄位標題 */}
        <div style={{ display: 'flex' }}>
          <span style={{ flex: 4 }}>品名</span>
          <span style={{ flex: 1, textAlign: 'center' }}>數量</span>
          <span style={{ flex: 2, textAlign: 'right' }}>金額</span>
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

        {/* 品項 */}
        {R.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', marginBottom: 1 }}>
            <span style={{ flex: 4, wordBreak: 'break-all' }}>{item.name}</span>
            <span style={{ flex: 1, textAlign: 'center' }}>{item.qty}</span>
            <span style={{ flex: 2, textAlign: 'right' }}>{fmt(item.amount)}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

        {/* 折扣 */}
        {(R.discount > 0 || R.pointsDiscount > 0) && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>折扣</span>
            <span>-{fmt((R.discount || 0) + (R.pointsDiscount || 0))}</span>
          </div>
        )}

        {/* 合計 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
          <span>合計:</span>
          <span>{fmt(R.total)}</span>
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

        {/* 付款方式 */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>付款方式</span>
          <span style={{ fontWeight: 600 }}>{R.paymentMethod || '-'}</span>
        </div>
        {R.cashTendered > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>收現</span><span>{fmt(R.cashTendered)}</span>
          </div>
        )}
        {R.change > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>找零</span><span>{fmt(R.change)}</span>
          </div>
        )}

        {/* 載具 / 發票 */}
        {R.carrierType && (
          <>
            <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
            <div>載具：{R.carrierType}</div>
            {R.carrierValue && <div>{R.carrierValue}</div>}
          </>
        )}

        {/* 顧客 / 電話 / 備註 */}
        {(R.customerInfo || R.customerPhone || R.note) && (
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
        )}
        {R.customerInfo  && <div>顧客:{R.customerInfo}</div>}
        {R.customerPhone && <div>電話:{R.customerPhone}</div>}
        {R.note          && <div>備註:{R.note}</div>}

        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ textAlign: 'center', fontWeight: 600 }}>謝謝惠顧</div>
      </div>
    </Modal>
  )
})

export default POSReceiptModal
