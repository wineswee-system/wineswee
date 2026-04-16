import { useState, useRef, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { createPOSTransaction, createInvoice } from '../../lib/db'
import { getEventBus } from '../../lib/events/index.js'
import { createPaymentRequest, processRefund } from '../../lib/payment'
import { processPayment, confirmPayment, refundPayment, getPaymentMethods } from '../../lib/paymentGateway'
import { calculateInvoiceTax, generateInvoiceNumber } from '../../lib/einvoice'
import { printReceipt } from '../../lib/receiptPrinter'
import POSPaymentOverlay from './components/POSPaymentOverlay'
import POSProductGrid from './components/POSProductGrid'
import POSCartPanel from './components/POSCartPanel'
import POSReceiptModal from './components/POSReceiptModal'
import POSRefundModal from './components/POSRefundModal'

const MOCK_PRODUCTS = [
  { id: 1, name: '美式咖啡', price: 60, category: '飲品', barcode: '4710001001' },
  { id: 2, name: '拿鐵咖啡', price: 80, category: '飲品', barcode: '4710001002' },
  { id: 3, name: '巧克力蛋糕', price: 120, category: '甜點', barcode: '4710001003' },
  { id: 4, name: '起司三明治', price: 90, category: '輕食', barcode: '4710001004' },
  { id: 5, name: '鮮果汁', price: 75, category: '飲品', barcode: '4710001005' },
  { id: 6, name: '提拉米蘇', price: 150, category: '甜點', barcode: '4710001006' },
  { id: 7, name: '總匯沙拉', price: 130, category: '輕食', barcode: '4710001007' },
  { id: 8, name: '紅茶', price: 40, category: '飲品', barcode: '4710001008' },
]

// Get payment methods from both old payment lib and new gateway abstraction
const GATEWAY_METHODS = getPaymentMethods()

// Map payment lib codes to display labels (use gateway methods as primary source)
const PAYMENT_METHOD_MAP = GATEWAY_METHODS.map(m => ({
  code: m.key,
  label: m.name,
  icon: m.icon,
}))

// Invoice sequence counter (in production this comes from DB)
let invoiceSeq = Math.floor(Math.random() * 90000000) + 10000000

export default function POSTerminal() {
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [discount, setDiscount] = useState(0)
  const [selectedPayment, setSelectedPayment] = useState('cash')
  const [barcodeInput, setBarcodeInput] = useState('')

  // Payment flow states
  const [paymentStage, setPaymentStage] = useState('cart') // cart | paying | success | failed
  const [cashTendered, setCashTendered] = useState('')
  const [paymentResult, setPaymentResult] = useState(null)
  const [processingMsg, setProcessingMsg] = useState('')

  // Receipt
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptData, setReceiptData] = useState(null)

  // E-Invoice
  const [carrierType, setCarrierType] = useState('none') // none | phone_barcode | natural_person
  const [carrierValue, setCarrierValue] = useState('')

  // Gateway confirmation
  const [gatewayPending, setGatewayPending] = useState(false)
  const [gatewayConfirmed, setGatewayConfirmed] = useState(false)
  const [confirmingPayment, setConfirmingPayment] = useState(false)

  // Refund
  const [showRefund, setShowRefund] = useState(false)
  const [refundTxnId, setRefundTxnId] = useState('')
  const [refundItems, setRefundItems] = useState([])
  const [refundResult, setRefundResult] = useState(null)

  // Auto-print preference (persisted in localStorage)
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem('pos_auto_print') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('pos_auto_print', String(autoPrint)) } catch {}
  }, [autoPrint])

  const receiptRef = useRef(null)

  const filtered = MOCK_PRODUCTS.filter(p =>
    search === '' || p.name.includes(search) || p.category.includes(search) || p.barcode?.includes(search)
  )

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id)
      if (existing) return prev.map(c => c.id === product.id ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { ...product, qty: 1 }]
    })
  }

  const handleBarcodeSubmit = (e) => {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    const product = MOCK_PRODUCTS.find(p => p.barcode === barcodeInput.trim() || p.name.includes(barcodeInput.trim()))
    if (product) {
      addToCart(product)
      setBarcodeInput('')
    }
  }

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty: Math.max(1, c.qty + delta) } : c))
  }

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(c => c.id !== id))
  }

  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0)

  // Use einvoice tax calculation
  const taxCalc = calculateInvoiceTax(
    cart.map(c => ({ description: c.name, qty: c.qty, unitPrice: c.price })),
    '應稅'
  )
  const tax = taxCalc.taxAmount
  const total = subtotal - discount + tax

  const changeAmount = selectedPayment === 'cash' && cashTendered ? Math.max(0, Number(cashTendered) - total) : 0

  // Get display label for current payment method
  const currentPaymentLabel = PAYMENT_METHOD_MAP.find(m => m.code === selectedPayment)?.label || selectedPayment

  const receiptPrintOptions = {
    companyName: '威士威企業總部',
    companyTaxId: '12345678',
    cashierName: '系統',
  }

  const handleCheckout = async () => {
    if (cart.length === 0) return

    // For cash: validate tendered amount
    if (selectedPayment === 'cash') {
      const tendered = Number(cashTendered)
      if (!tendered || tendered < total) {
        alert('現金金額不足')
        return
      }
    }

    setPaymentStage('paying')
    setProcessingMsg('處理付款中...')

    try {
      // 1. Process payment via gateway abstraction layer
      const orderId = `POS-${Date.now()}`
      const gatewayResult = await processPayment(selectedPayment, total, orderId, {
        cashTendered: selectedPayment === 'cash' ? Number(cashTendered) : undefined,
      })

      // Also create payment request via legacy payment lib for compatibility
      const payResult = createPaymentRequest(
        { orderId, amount: total, currency: 'TWD', description: 'POS 銷售' },
        selectedPayment
      )

      // Track gateway pending status
      const isPending = gatewayResult.status === 'pending_confirmation'

      // Simulate processing delay for card/digital payments
      if (selectedPayment !== 'cash' && selectedPayment !== 'bank_transfer') {
        setProcessingMsg(`正在連接 ${currentPaymentLabel} 付款閘道...`)
        await new Promise(r => setTimeout(r, 1500))
        setProcessingMsg('驗證付款資訊...')
        await new Promise(r => setTimeout(r, 1000))
      }

      // 2. Generate e-invoice number
      invoiceSeq++
      const invoiceNum = generateInvoiceNumber('AB', invoiceSeq)

      const txnNum = `POS-${String(Date.now()).slice(-6)}`

      // 3. Create POS transaction record
      await createPOSTransaction({
        transaction_number: txnNum,
        store: '威士威企業總部',
        cashier: '系統',
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price })),
        subtotal, discount, tax, total,
        payment_method: currentPaymentLabel,
        payment_id: payResult.paymentId,
        points_earned: Math.floor(total / 10),
        status: '完成',
      })

      // 4. Create e-invoice
      await createInvoice({
        invoice_number: invoiceNum,
        invoice_date: new Date().toISOString().slice(0, 10),
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price })),
        subtotal, tax, total,
        carrier_type: carrierType !== 'none' ? carrierType : null,
        carrier_value: carrierType !== 'none' ? carrierValue : null,
        status: '已開立',
      })

      // 5. Create journal entry (debit: cash/bank, credit: revenue)
      const debitAccount = selectedPayment === 'cash' ? '1100' : '1200'
      const debitName = selectedPayment === 'cash' ? '現金' : '銀行存款'
      await supabase.rpc('secure_create_journal_entry', {
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: `POS 銷售 ${txnNum}（${currentPaymentLabel}）`,
        p_lines: [
          { account_code: debitAccount, account_name: debitName, debit: total, credit: 0, memo: txnNum },
          { account_code: '4100', account_name: '營業收入', debit: 0, credit: total, memo: txnNum },
        ],
        p_source: 'POS',
        p_source_id: null,
        p_created_by: '系統',
      })

      // Build receipt data
      const receipt = {
        storeName: '威士威企業總部',
        txnNum,
        invoiceNum,
        paymentId: payResult.paymentId,
        date: new Date().toLocaleString('zh-TW'),
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, amount: c.price * c.qty })),
        subtotal,
        discount,
        tax,
        total,
        paymentMethod: currentPaymentLabel,
        cashTendered: selectedPayment === 'cash' ? Number(cashTendered) : null,
        change: selectedPayment === 'cash' ? changeAmount : null,
        carrierType: carrierType !== 'none' ? (carrierType === 'phone_barcode' ? '手機條碼' : '自然人憑證') : null,
        carrierValue: carrierType !== 'none' ? carrierValue : null,
      }

      setReceiptData(receipt)
      setPaymentResult({ ...payResult, gatewayTransactionId: gatewayResult.transactionId })
      setGatewayPending(isPending)
      setGatewayConfirmed(!isPending)
      setPaymentStage('success')
      setProcessingMsg('')

      // Auto-print receipt if enabled
      if (autoPrint) {
        const txn = {
          transactionNumber: txnNum,
          date: new Date().toLocaleString('zh-TW'),
          items: cart.map(c => ({ name: c.name, quantity: c.qty, price: c.price })),
          totalAmount: total,
          paymentMethod: currentPaymentLabel,
          cashReceived: selectedPayment === 'cash' ? Number(cashTendered) : null,
          invoiceNumber: invoiceNum,
        }
        // Delay slightly so the success overlay renders first
        setTimeout(() => printReceipt(txn, receiptPrintOptions), 500)
      }

    } catch (err) {
      console.error('Checkout failed:', err)
      setPaymentStage('failed')
      setProcessingMsg(err.message || '付款失敗')
    }
  }

  const resetTerminal = () => {
    setCart([])
    setDiscount(0)
    setCashTendered('')
    setPaymentStage('cart')
    setPaymentResult(null)
    setReceiptData(null)
    setProcessingMsg('')
    setCarrierType('none')
    setCarrierValue('')
    setGatewayPending(false)
    setGatewayConfirmed(false)
    setConfirmingPayment(false)
  }

  // Gateway confirm handler (simulates callback from payment gateway)
  const handleConfirmGateway = async () => {
    if (!paymentResult?.gatewayTransactionId) return
    setConfirmingPayment(true)
    try {
      const result = await confirmPayment(paymentResult.gatewayTransactionId)
      if (result.success) {
        setGatewayPending(false)
        setGatewayConfirmed(true)
      }
    } catch (err) {
      console.error('Gateway confirm failed:', err)
    } finally {
      setConfirmingPayment(false)
    }
  }

  // Quick refund from success overlay
  const handleQuickRefund = async () => {
    if (!paymentResult?.gatewayTransactionId || !receiptData?.total) return
    try {
      const result = await refundPayment(paymentResult.gatewayTransactionId, receiptData.total, '櫃台退款')
      if (result.success) {
        setRefundResult(result)
        setShowRefund(true)

        // Publish refund event so loyalty points get reversed
        try {
          const bus = getEventBus()
          await bus.publish('pos.transaction.refunded', {
            refund_id: result.refundId || `QREF-${Date.now()}`,
            original_transaction_id: paymentResult.gatewayTransactionId,
            store: '門市',
            refund_amount: receiptData.total,
            reason: '櫃台退款',
          })
        } catch (evtErr) {
          console.error('Failed to publish refund event:', evtErr)
        }
      }
    } catch (err) {
      console.error('Refund failed:', err)
      alert('退款失敗: ' + (err.message || '未知錯誤'))
    }
  }

  // Build transaction object for receipt printer from receiptData
  const buildPrintTransaction = (data) => {
    if (!data) return null
    return {
      transactionNumber: data.txnNum,
      date: data.date,
      items: data.items.map(i => ({ name: i.name, quantity: i.qty, price: i.price })),
      totalAmount: data.total,
      paymentMethod: data.paymentMethod,
      cashReceived: data.cashTendered || null,
      invoiceNumber: data.invoiceNum,
    }
  }

  const handlePrintReceipt = () => {
    if (!receiptData) return
    const txn = buildPrintTransaction(receiptData)
    if (txn) printReceipt(txn, receiptPrintOptions)
  }

  // Refund handler
  const handleRefund = () => {
    if (!refundTxnId.trim()) return
    // Simulate finding original transaction items
    const mockOriginalItems = [
      { name: '美式咖啡', qty: 2, price: 60, selected: false },
      { name: '巧克力蛋糕', qty: 1, price: 120, selected: false },
    ]
    setRefundItems(mockOriginalItems)
  }

  const toggleRefundItem = (idx) => {
    setRefundItems(prev => prev.map((item, i) => i === idx ? { ...item, selected: !item.selected } : item))
  }

  const processRefundSubmit = async () => {
    const selectedItems = refundItems.filter(i => i.selected)
    if (selectedItems.length === 0) return
    const refundTotal = selectedItems.reduce((sum, i) => sum + i.price * i.qty, 0)
    const result = processRefund(refundTxnId, refundTotal, '顧客退貨')
    setRefundResult(result)

    // Publish refund event so loyalty points get reversed
    if (result.success) {
      try {
        const bus = getEventBus()
        await bus.publish('pos.transaction.refunded', {
          refund_id: result.refundId,
          original_transaction_id: refundTxnId,
          store: '門市',
          refund_amount: refundTotal,
          reason: result.reason || '顧客退貨',
          items: selectedItems,
        })
      } catch (err) {
        console.error('Failed to publish refund event:', err)
      }
    }
  }

  const closeRefundModal = () => {
    setShowRefund(false)
    setRefundTxnId('')
    setRefundItems([])
    setRefundResult(null)
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🖥️</span> POS 收銀台</h2>
            <p>銷售結帳作業 — 支援多元支付與電子發票</p>
          </div>
          <button className="btn" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }} onClick={() => setShowRefund(true)}>
            <RotateCcw size={14} /> 退貨/退款
          </button>
        </div>
      </div>

      <POSPaymentOverlay
        paymentStage={paymentStage}
        processingMsg={processingMsg}
        receiptData={receiptData}
        paymentResult={paymentResult}
        gatewayPending={gatewayPending}
        gatewayConfirmed={gatewayConfirmed}
        confirmingPayment={confirmingPayment}
        autoPrint={autoPrint}
        setAutoPrint={setAutoPrint}
        setShowReceipt={setShowReceipt}
        handlePrintReceipt={handlePrintReceipt}
        handleConfirmGateway={handleConfirmGateway}
        handleQuickRefund={handleQuickRefund}
        resetTerminal={resetTerminal}
        setPaymentStage={setPaymentStage}
      />

      <div style={{ display: 'flex', gap: 20, minHeight: 520 }}>
        <POSProductGrid
          search={search}
          setSearch={setSearch}
          barcodeInput={barcodeInput}
          setBarcodeInput={setBarcodeInput}
          handleBarcodeSubmit={handleBarcodeSubmit}
          filtered={filtered}
          addToCart={addToCart}
        />

        <POSCartPanel
          cart={cart}
          updateQty={updateQty}
          removeFromCart={removeFromCart}
          subtotal={subtotal}
          discount={discount}
          setDiscount={setDiscount}
          tax={tax}
          total={total}
          selectedPayment={selectedPayment}
          setSelectedPayment={setSelectedPayment}
          cashTendered={cashTendered}
          setCashTendered={setCashTendered}
          changeAmount={changeAmount}
          carrierType={carrierType}
          setCarrierType={setCarrierType}
          carrierValue={carrierValue}
          setCarrierValue={setCarrierValue}
          handleCheckout={handleCheckout}
          paymentMethodMap={PAYMENT_METHOD_MAP}
        />
      </div>

      {showReceipt && receiptData && (
        <POSReceiptModal
          ref={receiptRef}
          receiptData={receiptData}
          onClose={() => setShowReceipt(false)}
          onPrint={handlePrintReceipt}
        />
      )}

      {showRefund && (
        <POSRefundModal
          refundTxnId={refundTxnId}
          setRefundTxnId={setRefundTxnId}
          refundItems={refundItems}
          refundResult={refundResult}
          handleRefund={handleRefund}
          toggleRefundItem={toggleRefundItem}
          processRefundSubmit={processRefundSubmit}
          closeRefundModal={closeRefundModal}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
