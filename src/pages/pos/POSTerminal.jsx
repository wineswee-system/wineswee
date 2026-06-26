import { useState, useRef, useEffect } from 'react'
import { RotateCcw, Usb } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { createPOSTransaction, updatePOSTransaction, createInvoice, searchMemberByQuery, getPOSTransactionByNumber } from '../../lib/db'
import { useTenant } from '../../contexts/TenantContext'
import { getEventBus } from '../../lib/events/index.js'
import { createPaymentRequest, processRefund } from '../../lib/payment'
import { processPayment, confirmPayment, refundPayment, getPaymentMethods } from '../../lib/paymentGateway'
import { calculateInvoiceTax, generateInvoiceNumber } from '../../lib/einvoice'
import { printReceipt, connectThermalPrinter, kickCashDrawer } from '../../lib/receiptPrinter'
import POSPaymentOverlay from './components/POSPaymentOverlay'
import POSProductGrid from './components/POSProductGrid'
import POSCartPanel from './components/POSCartPanel'
import POSReceiptModal from './components/POSReceiptModal'
import POSRefundModal from './components/POSRefundModal'
import POSQROrderQueue from './components/POSQROrderQueue'

import { toast } from '../../lib/toast'

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
  const { tenant } = useTenant()
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [discount, setDiscount] = useState(0)
  const [pointsUsed, setPointsUsed] = useState(0)
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
  const [refundLoading, setRefundLoading] = useState(false)

  const [orderNote, setOrderNote] = useState('')

  // Auto-print preference (persisted in localStorage)
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem('pos_auto_print') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('pos_auto_print', String(autoPrint)) } catch {}
  }, [autoPrint])

  useEffect(() => {
    const orgId = tenant?.organization_id
    if (!orgId) { setProductsLoading(false); return }
    setProductsLoading(true)
    supabase
      .from('pos_products')
      .select('id, name, barcode, retail_price, category, sku_id')
      .eq('organization_id', orgId)
      .eq('is_available', true)
      .order('category')
      .then(({ data, error }) => {
        if (error) { toast.error('商品載入失敗'); return }
        setProducts((data || []).map(p => ({
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          price: Number(p.retail_price),
          category: p.category || '其他',
          sku_id: p.sku_id,
        })))
      })
      .finally(() => setProductsLoading(false))
  }, [tenant?.organization_id])

  // Member lookup — identifies customer for loyalty/CRM downstream handlers
  const [selectedMember, setSelectedMember] = useState(null)

  const handleMemberSearch = async (query) => {
    const found = await searchMemberByQuery(query)
    if (found) { setSelectedMember(found); setPointsUsed(0) }
    return found
  }

  // Web Serial thermal printer port (cash drawer kick)
  const [thermalPort, setThermalPort] = useState(null)

  const connectDrawer = async () => {
    if (thermalPort) {
      try { await thermalPort.close() } catch {}
      setThermalPort(null)
      return
    }
    const result = await connectThermalPrinter()
    if (result.connected) {
      setThermalPort(result.port)
      toast.success('已連接收據機 / 錢箱')
    } else {
      toast.error(result.error || '連接失敗')
    }
  }

  const receiptRef = useRef(null)

  const filtered = products.filter(p =>
    search === '' || p.name.includes(search) || p.category.includes(search) || p.barcode?.includes(search)
  )

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id)
      if (existing) return prev.map(c => c.id === product.id ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { ...product, qty: 1, order_type: 'dine_in' }]
    })
  }

  const updateItemType = (id, type) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, order_type: type } : c))
  }

  const handleBarcodeSubmit = (e) => {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    const q = barcodeInput.trim()
    const product = products.find(p => p.barcode === q || p.name.includes(q))
    if (product) {
      addToCart(product)
      setBarcodeInput('')
    } else {
      toast.error('找不到商品')
    }
  }

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty: Math.max(1, c.qty + delta) } : c))
  }

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(c => c.id !== id))
  }

  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0)
  const pointsDiscount = Math.floor((Number(pointsUsed) || 0) * 0.5)

  // ★ 折扣先攤掉，tax 才算在實付金額上（之前 tax 用原價算 → 客戶付了沒享受到折扣的稅）
  const safeDiscount = Math.max(0, Math.min(subtotal, (Number(discount) || 0) + pointsDiscount))
  const taxableAmount = Math.max(0, subtotal - safeDiscount)
  const taxCalc = calculateInvoiceTax(
    [{ description: '小計（折扣後）', qty: 1, unitPrice: taxableAmount }],
    '應稅'
  )
  const tax = taxCalc.taxAmount
  const total = taxableAmount + tax

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

    // ★ 防呆：手動折扣不可為負，也不可超過 subtotal
    const safeManualDiscount = Math.max(0, Math.min(subtotal, Number(discount) || 0))
    if (safeManualDiscount !== (Number(discount) || 0)) {
      setDiscount(safeManualDiscount)
      toast.error('折扣金額已自動修正為合法範圍（0 ~ 小計）')
      return
    }
    if (pointsUsed > 0 && selectedMember && pointsUsed > (selectedMember.available_points || 0)) {
      toast.error('會員點數不足，請減少折抵點數')
      return
    }
    if (total < 0) {
      toast.error('總額不可為負，請檢查折扣與品項')
      return
    }

    // For cash: validate tendered amount
    if (selectedPayment === 'cash') {
      const tendered = Number(cashTendered)
      if (!tendered || tendered < total) {
        toast.error('現金金額不足')
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
      const { data: txnRecord } = await createPOSTransaction({
        transaction_number: txnNum,
        store: '威士威企業總部',
        cashier: '系統',
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, order_type: c.order_type })),
        subtotal, discount: safeDiscount, tax, total,
        payment_method: currentPaymentLabel,
        payment_id: payResult.paymentId,
        member_id: selectedMember?.id ?? null,
        points_earned: selectedMember ? Math.floor(total / 10) : 0,
        points_used: pointsUsed,
        status: '完成',
      })

      // Patch note onto transaction record (RPC doesn't accept it directly)
      if (orderNote.trim() && txnRecord) {
        updatePOSTransaction(txnRecord, { note: orderNote.trim() }).catch(() => {})
      }

      // Publish event → Finance AR, WMS stock deduction, CRM loyalty/purchase/survey
      try {
        const bus = getEventBus()
        await bus.publish('pos.transaction.completed', {
          transaction_id: String(txnRecord ?? txnNum),
          transaction_number: txnNum,
          store: '威士威企業總部',
          cashier: '系統',
          total,
          payment_method: currentPaymentLabel,
          items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, order_type: c.order_type })),
          customer_id: selectedMember?.id ?? null,
          points_used: pointsUsed,
          store_id: null,
          note: orderNote.trim() || null,
        })
      } catch (e) {
        console.warn('[POS] event publish failed:', e.message)
      }

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
        discount: safeDiscount,
        pointsUsed,
        pointsDiscount,
        tax,
        total,
        paymentMethod: currentPaymentLabel,
        cashTendered: selectedPayment === 'cash' ? Number(cashTendered) : null,
        change: selectedPayment === 'cash' ? changeAmount : null,
        carrierType: carrierType !== 'none' ? (carrierType === 'phone_barcode' ? '手機條碼' : '自然人憑證') : null,
        carrierValue: carrierType !== 'none' ? carrierValue : null,
        note: orderNote.trim() || null,
      }

      setReceiptData(receipt)
      setPaymentResult({ ...payResult, gatewayTransactionId: gatewayResult.transactionId })
      setGatewayPending(isPending)
      setGatewayConfirmed(!isPending)
      setPaymentStage('success')
      setProcessingMsg('')

      // Kick cash drawer on cash payments
      if (selectedPayment === 'cash' && thermalPort) {
        kickCashDrawer(thermalPort).catch(() => {})
      }

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
    setPointsUsed(0)
    setCashTendered('')
    setOrderNote('')
    setPaymentStage('cart')
    setPaymentResult(null)
    setReceiptData(null)
    setProcessingMsg('')
    setCarrierType('none')
    setCarrierValue('')
    setGatewayPending(false)
    setGatewayConfirmed(false)
    setConfirmingPayment(false)
    setSelectedMember(null)
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
            items: receiptData.items?.map(i => ({ name: i.name, qty: i.qty })) || [],
          })
        } catch (evtErr) {
          console.error('Failed to publish refund event:', evtErr)
        }
      }
    } catch (err) {
      console.error('Refund failed:', err)
      toast.error('退款失敗: ' + (err.message || '未知錯誤'))
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

  // Refund handler — looks up the real transaction from DB
  const handleRefund = async () => {
    if (!refundTxnId.trim()) return
    setRefundLoading(true)
    try {
      const { data: txn, error } = await getPOSTransactionByNumber(refundTxnId.trim())
      if (error || !txn) {
        toast.error('找不到該交易編號，請確認後再試')
        return
      }
      const items = (txn.items || []).map(item => ({ ...item, selected: false }))
      if (items.length === 0) {
        toast.error('該交易無可退貨品項')
        return
      }
      setRefundItems(items)
    } catch (err) {
      toast.error('查詢失敗：' + (err.message || '未知錯誤'))
    } finally {
      setRefundLoading(false)
    }
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {'serial' in navigator && (
              <button
                className="btn"
                style={{
                  background: thermalPort ? 'var(--accent-green-dim)' : 'var(--bg-tertiary)',
                  border: `1px solid ${thermalPort ? 'var(--accent-green)' : 'var(--border-primary)'}`,
                  color: thermalPort ? 'var(--accent-green)' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                onClick={connectDrawer}
                title={thermalPort ? '點擊斷開收據機' : '連接 USB 收據機 / 錢箱'}
              >
                <Usb size={14} />
                {thermalPort ? '收據機已連接' : '連接收據機'}
              </button>
            )}
            <POSQROrderQueue />
            <button className="btn" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }} onClick={() => setShowRefund(true)}>
              <RotateCcw size={14} /> 退貨/退款
            </button>
          </div>
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
          loading={productsLoading}
        />

        <POSCartPanel
          cart={cart}
          updateQty={updateQty}
          updateItemType={updateItemType}
          removeFromCart={removeFromCart}
          orderNote={orderNote}
          setOrderNote={setOrderNote}
          subtotal={subtotal}
          discount={discount}
          setDiscount={setDiscount}
          pointsUsed={pointsUsed}
          setPointsUsed={setPointsUsed}
          pointsDiscount={pointsDiscount}
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
          selectedMember={selectedMember}
          onMemberSearch={handleMemberSearch}
          onMemberClear={() => { setSelectedMember(null); setPointsUsed(0) }}
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
          refundLoading={refundLoading}
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
