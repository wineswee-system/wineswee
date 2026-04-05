import { useState, useRef, useEffect } from 'react'
import { Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Printer, RotateCcw, CheckCircle, Loader2, XCircle, Receipt } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { createPOSTransaction, createInvoice } from '../../lib/db'
import { createPaymentRequest, PAYMENT_METHODS, processRefund } from '../../lib/payment'
import { processPayment, confirmPayment, refundPayment, getPaymentMethods } from '../../lib/paymentGateway'
import { calculateInvoiceTax, generateInvoiceNumber } from '../../lib/einvoice'
import { printReceipt } from '../../lib/receiptPrinter'
import Modal, { Field } from '../../components/Modal'

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
        store: '台北總部',
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
      const entryNum = `JE-POS-${String(Date.now()).slice(-4)}`
      const { data: entry } = await supabase.from('journal_entries').insert({
        entry_number: entryNum,
        entry_date: new Date().toISOString().slice(0, 10),
        description: `POS 銷售 ${txnNum}（${currentPaymentLabel}）`,
        source: 'POS', status: '已過帳', created_by: '系統',
      }).select().single()
      if (entry) {
        const debitAccount = selectedPayment === 'cash' ? '1100' : '1200'
        const debitName = selectedPayment === 'cash' ? '現金' : '銀行存款'
        await supabase.from('journal_lines').insert([
          { entry_id: entry.id, account_code: debitAccount, account_name: debitName, debit: total, credit: 0, memo: txnNum },
          { entry_id: entry.id, account_code: '4100', account_name: '營業收入', debit: 0, credit: total, memo: txnNum },
        ])
      }

      // Build receipt data
      const receipt = {
        storeName: '台北總部',
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

  const receiptPrintOptions = {
    companyName: '台北總部',
    companyTaxId: '12345678',
    cashierName: '系統',
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

  const processRefundSubmit = () => {
    const selectedItems = refundItems.filter(i => i.selected)
    if (selectedItems.length === 0) return
    const refundTotal = selectedItems.reduce((sum, i) => sum + i.price * i.qty, 0)
    const result = processRefund(refundTxnId, refundTotal, '顧客退貨')
    setRefundResult(result)
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

      {/* Payment Processing Overlay */}
      {paymentStage === 'paying' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 16, padding: 48, textAlign: 'center', minWidth: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <Loader2 size={48} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-cyan)', marginBottom: 16 }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>付款處理中</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{processingMsg}</div>
            <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 12 }}>請勿關閉此頁面</div>
          </div>
        </div>
      )}

      {/* Payment Success Overlay */}
      {paymentStage === 'success' && (
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
      )}

      {/* Payment Failed Overlay */}
      {paymentStage === 'failed' && (
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
      )}

      <div style={{ display: 'flex', gap: 20, minHeight: 520 }}>
        {/* Left: Product Selection */}
        <div style={{ flex: '1 1 55%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Barcode scanner input */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div style={{ padding: '12px 16px' }}>
              <form onSubmit={handleBarcodeSubmit} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="掃描條碼或輸入商品名稱..."
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px' }}>加入</button>
              </form>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🛒</span> 商品選擇</div>
              <div className="search-bar">
                <Search className="search-icon" />
                <input type="text" placeholder="搜尋商品..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, padding: 16 }}>
              {filtered.map(p => (
                <div
                  key={p.id}
                  onClick={() => addToCart(p)}
                  style={{
                    border: '1px solid var(--border-primary)',
                    borderRadius: 10,
                    padding: 14,
                    cursor: 'pointer',
                    textAlign: 'center',
                    background: 'var(--bg-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.transform = 'none' }}
                >
                  <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--bg-tertiary)', margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                    {p.category === '飲品' ? '☕' : p.category === '甜點' ? '🍰' : '🥗'}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                  <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: 14 }}>NT$ {p.price}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.category}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Cart & Payment */}
        <div style={{ flex: '1 1 40%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ marginBottom: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <div className="card-title"><ShoppingCart size={16} style={{ marginRight: 6 }} /> 購物車 ({cart.reduce((s, c) => s + c.qty, 0)})</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
              {cart.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>購物車是空的</div>
              )}
              {cart.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-primary)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>NT$ {c.price} x {c.qty}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => updateQty(c.id, -1)} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-primary)' }}><Minus size={12} /></button>
                    <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 600 }}>{c.qty}</span>
                    <button onClick={() => updateQty(c.id, 1)} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-primary)' }}><Plus size={12} /></button>
                    <button onClick={() => removeFromCart(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: '2px 4px' }}><Trash2 size={14} /></button>
                  </div>
                  <div style={{ minWidth: 80, textAlign: 'right', fontWeight: 600 }}>NT$ {(c.price * c.qty).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {/* Totals & Payment */}
            <div style={{ padding: 16, borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', borderRadius: '0 0 12px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <span>小計</span><span>NT$ {subtotal.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
                <span>折扣</span>
                <input
                  type="number" min={0} value={discount}
                  onChange={e => setDiscount(Math.max(0, Number(e.target.value)))}
                  style={{ width: 80, textAlign: 'right', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 8px', color: 'var(--text-primary)', fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <span>稅金 (5%)</span><span>NT$ {tax.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, margin: '12px 0', color: 'var(--accent-cyan)' }}>
                <span>合計</span><span>NT$ {total.toLocaleString()}</span>
              </div>

              {/* Payment method selection */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                  <CreditCard size={12} style={{ marginRight: 4, verticalAlign: -1 }} /> 付款方式
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PAYMENT_METHOD_MAP.map(m => (
                    <button
                      key={m.code}
                      onClick={() => setSelectedPayment(m.code)}
                      style={{
                        flex: '1 1 auto',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: selectedPayment === m.code ? '2px solid var(--accent-cyan)' : '1px solid var(--border-primary)',
                        background: selectedPayment === m.code ? 'var(--accent-cyan-dim)' : 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontWeight: selectedPayment === m.code ? 700 : 400,
                        cursor: 'pointer',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                      }}
                    >
                      <span>{m.icon}</span> {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash tendered input */}
              {selectedPayment === 'cash' && (
                <div style={{ marginBottom: 10, background: 'var(--bg-primary)', borderRadius: 8, padding: 10, border: '1px solid var(--border-primary)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>收現金額</div>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="輸入收到的現金金額"
                    value={cashTendered}
                    onChange={e => setCashTendered(e.target.value)}
                    style={{ width: '100%', fontSize: 18, fontWeight: 700, textAlign: 'right', marginBottom: 4 }}
                  />
                  {cashTendered && Number(cashTendered) >= total && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: 'var(--accent-orange)' }}>
                      <span>找零</span><span>NT$ {changeAmount.toLocaleString()}</span>
                    </div>
                  )}
                  {/* Quick cash buttons */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {[100, 500, 1000].map(v => (
                      <button key={v} onClick={() => setCashTendered(String(v))} style={{
                        flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid var(--border-primary)',
                        background: 'var(--bg-tertiary)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                      }}>
                        ${v}
                      </button>
                    ))}
                    <button onClick={() => setCashTendered(String(total))} style={{
                      flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid var(--accent-cyan)',
                      background: 'var(--accent-cyan-dim)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                    }}>
                      剛好
                    </button>
                  </div>
                </div>
              )}

              {/* E-Invoice carrier */}
              <div style={{ marginBottom: 10, background: 'var(--bg-primary)', borderRadius: 8, padding: 10, border: '1px solid var(--border-primary)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>電子發票載具</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: carrierType !== 'none' ? 8 : 0 }}>
                  {[
                    { value: 'none', label: '無' },
                    { value: 'phone_barcode', label: '手機條碼' },
                    { value: 'natural_person', label: '自然人憑證' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setCarrierType(opt.value); setCarrierValue('') }}
                      style={{
                        flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12,
                        border: carrierType === opt.value ? '2px solid var(--accent-cyan)' : '1px solid var(--border-primary)',
                        background: carrierType === opt.value ? 'var(--accent-cyan-dim)' : 'transparent',
                        color: 'var(--text-primary)', cursor: 'pointer', fontWeight: carrierType === opt.value ? 600 : 400,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {carrierType !== 'none' && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder={carrierType === 'phone_barcode' ? '輸入手機條碼 (例: /ABC1234)' : '輸入自然人憑證號碼'}
                    value={carrierValue}
                    onChange={e => setCarrierValue(e.target.value)}
                    style={{ width: '100%', fontSize: 13 }}
                  />
                )}
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', padding: '12px 0', fontSize: 16, fontWeight: 700 }}
                onClick={handleCheckout}
                disabled={cart.length === 0}
              >
                結帳 — NT$ {total.toLocaleString()}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Preview Modal */}
      {showReceipt && receiptData && (
        <Modal title="收據預覽" onClose={() => setShowReceipt(false)} onSubmit={handlePrintReceipt} submitLabel="列印收據">
          <div ref={receiptRef} style={{
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
      )}

      {/* Refund Modal */}
      {showRefund && (
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
