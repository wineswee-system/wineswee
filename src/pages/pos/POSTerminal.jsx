import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, Usb } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { createPOSTransaction, updatePOSTransaction, createInvoice, searchMemberByQuery, getPOSTransactionByNumber, getMemberCoupons, redeemCoupon } from '../../lib/db'
import { useTenant } from '../../contexts/TenantContext'
import { getEventBus } from '../../lib/events/index.js'
import { createPaymentRequest, processRefund } from '../../lib/payment'
import { processPayment, confirmPayment, refundPayment, getPaymentMethods, validateEdcFields, recordEdcPayment } from '../../lib/paymentGateway'
import { calculateInvoiceTax, generateInvoiceNumber } from '../../lib/einvoice'
import { printReceipt, connectThermalPrinter, kickCashDrawer } from '../../lib/receiptPrinter'
import POSPaymentOverlay from './components/POSPaymentOverlay'
import POSProductGrid from './components/POSProductGrid'
import POSCartPanel from './components/POSCartPanel'
import POSReceiptModal from './components/POSReceiptModal'
import POSRefundModal from './components/POSRefundModal'
import POSQROrderQueue from './components/POSQROrderQueue'
import POSVariantModal from './components/POSVariantModal'
import POSComboModal from './components/POSComboModal'
import { cacheProducts, cacheMenuItems, getCachedProducts, getCachedMenuItems, isOnline, queueTransaction } from '../../lib/posCache'
import { initOfflineSync } from '../../lib/posOfflineSync'
import OfflineSyncBadge from './components/OfflineSyncBadge'
import EdcPaymentForm from './components/EdcPaymentForm'
import { parseTableQR } from '../../lib/tableQR'

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
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [discount, setDiscount] = useState(0)
  const [pointsUsed, setPointsUsed] = useState(0)
  const [availableCoupons, setAvailableCoupons] = useState([])
  const [selectedCoupon, setSelectedCoupon] = useState(null)
  const [couponsLoading, setCouponsLoading] = useState(false)
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
  const [paymentSplits, setPaymentSplits] = useState([])

  // 中信 EDC 刷卡登錄（F-D1：credit_card = 端末機記錄模式，與 ECPay 脫鉤）
  const [edcInfo, setEdcInfo] = useState({ card_brand: 'VISA', card_last4: '', auth_code: '' })

  // Auto-print preference (persisted in localStorage)
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem('pos_auto_print') === 'true' } catch { return false }
  })

  // Hold / Recall orders
  const [savedOrders, setSavedOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pos_saved_orders') || '[]') } catch { return [] }
  })
  const [showRecallMenu, setShowRecallMenu] = useState(false)

  // Offline mode
  const [isOfflineMode, setIsOfflineMode] = useState(false)

  // Variant / combo
  const [variantModal, setVariantModal] = useState(null) // { item, variantGroups }
  const [combos, setCombos] = useState([])
  const [itemVariants, setItemVariants] = useState({}) // { menuItemId: variantGroups[] }

  useEffect(() => {
    try { localStorage.setItem('pos_auto_print', String(autoPrint)) } catch {}
  }, [autoPrint])

  // 離線交易自動同步：恢復連線 / 進入 POS 時補送佇列（冪等，重複呼叫只生效一次）
  useEffect(() => { initOfflineSync() }, [])

  useEffect(() => {
    const orgId = tenant?.organization_id
    if (!orgId) { setProductsLoading(false); return }
    setProductsLoading(true)

    const loadProducts = async () => {
      try {
        const { data, error } = await supabase
          .from('pos_products')
          .select('id, name, barcode, retail_price, category, sku_id')
          .eq('organization_id', orgId)
          .eq('is_available', true)
          .order('category')

        if (error) throw error

        const mapped = (data || []).map(p => ({
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          price: Number(p.retail_price),
          category: p.category || '其他',
          sku_id: p.sku_id,
        }))
        setProducts(mapped)
        cacheProducts(orgId, mapped)
      } catch (err) {
        toast.error('商品載入失敗')
        if (!isOnline()) {
          const cached = getCachedProducts(orgId)
          if (cached.length > 0) { setProducts(cached); setIsOfflineMode(true) }
        }
      } finally {
        setProductsLoading(false)
      }
    }

    const loadCombosAndVariants = async () => {
      try {
        const { data: comboData } = await supabase
          .from('pos_menu_combos')
          .select('*, items:pos_menu_combo_items(*, menu_item:pos_menu_items(name, unit_price))')
          .eq('store_id', orgId)
          .eq('is_active', true)
          .order('display_order')
        setCombos(comboData || [])

        const { data: menuItems } = await supabase
          .from('pos_menu_items')
          .select('id')
          .eq('store_id', orgId)
          .eq('is_active', true)

        if (menuItems?.length > 0) {
          const itemIds = menuItems.map(i => i.id)
          const { data: varData } = await supabase
            .from('pos_menu_item_variants')
            .select('*')
            .in('menu_item_id', itemIds)
            .order('sort_order')
          const grouped = {}
          ;(varData || []).forEach(v => {
            if (!grouped[v.menu_item_id]) grouped[v.menu_item_id] = []
            grouped[v.menu_item_id].push(v)
          })
          setItemVariants(grouped)
        }
      } catch {
        // non-critical — combos/variants fail silently
      }
    }

    loadProducts()
    loadCombosAndVariants()
  }, [tenant?.organization_id])

  // Member lookup — identifies customer for loyalty/CRM downstream handlers
  const [selectedMember, setSelectedMember] = useState(null)

  const handleMemberSearch = async (query) => {
    const found = await searchMemberByQuery(query)
    if (found) { setSelectedMember(found); setPointsUsed(0); loadMemberCoupons(found) }
    return found
  }

  const loadMemberCoupons = async (member) => {
    setCouponsLoading(true)
    const { data } = await getMemberCoupons(member.id)
    const now = new Date()
    const valid = (data ?? []).filter(ca =>
      !ca.used_at &&
      (!ca.expires_at || new Date(ca.expires_at) > now) &&
      (!ca.coupons?.valid_until || new Date(ca.coupons.valid_until) > now)
    )
    setAvailableCoupons(valid)
    setSelectedCoupon(null)
    setCouponsLoading(false)
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

  // Open variant modal if item has variants; otherwise add directly
  const handleMenuItemClick = (item) => {
    const variants = itemVariants[item.id]
    if (variants?.length > 0) {
      setVariantModal({ item, variantGroups: variants })
    } else {
      addToCart(item)
    }
  }

  const updateItemType = (id, type) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, order_type: type } : c))
  }

  const handleBarcodeSubmit = (e) => {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    const q = barcodeInput.trim()
    // 掃到桌卡 QR（客人點餐連結）→ 跳轉服務員模式該桌結帳
    const tableQR = parseTableQR(q)
    if (tableQR) {
      setBarcodeInput('')
      navigate(`/pos/waiter?store=${encodeURIComponent(tableQR.storeId)}&table=${encodeURIComponent(tableQR.tableId)}&checkout=1`)
      return
    }
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

  // Hold current cart as a saved order
  function holdOrder() {
    if (cart.length === 0) return
    const held = {
      id: Date.now().toString(),
      savedAt: new Date().toISOString(),
      cart,
      selectedMember,
      discount,
      orderNote: orderNote ?? '',
      pointsUsed: pointsUsed ?? 0,
    }
    const next = [...savedOrders, held]
    setSavedOrders(next)
    localStorage.setItem('pos_saved_orders', JSON.stringify(next))
    setCart([])
    setSelectedMember(null)
    setDiscount(0)
    setPointsUsed(0)
    setOrderNote('')
  }

  // Recall a previously held order (hold current cart first if non-empty)
  function recallOrder(held) {
    if (cart.length > 0) holdOrder()
    setCart(held.cart)
    setSelectedMember(held.selectedMember)
    setDiscount(held.discount || 0)
    setPointsUsed(held.pointsUsed || 0)
    setOrderNote(held.orderNote || '')
    const next = savedOrders.filter(o => o.id !== held.id)
    setSavedOrders(next)
    localStorage.setItem('pos_saved_orders', JSON.stringify(next))
    setShowRecallMenu(false)
  }

    const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0)
  const pointsDiscount = Math.floor((Number(pointsUsed) || 0) * 0.5)
  const couponDiscount = (() => {
    if (!selectedCoupon?.coupons) return 0
    const c = selectedCoupon.coupons
    if (c.type === 'pct_off')   return Math.floor(subtotal * ((Number(c.value) || 0) / 100))
    if (c.type === 'fixed_off') return Math.min(subtotal, Number(c.value) || 0)
    return 0
  })()

  // ★ 折扣先攤掉，tax 才算在實付金額上（之前 tax 用原價算 → 客戶付了沒享受到折扣的稅）
  const safeDiscount = Math.max(0, Math.min(subtotal, (Number(discount) || 0) + pointsDiscount + couponDiscount))
  const taxableAmount = Math.max(0, subtotal - safeDiscount)
  const taxCalc = calculateInvoiceTax(
    [{ description: '小計（折扣後）', qty: 1, unitPrice: taxableAmount }],
    '應稅'
  )
  const tax = taxCalc.taxAmount
  const total = taxableAmount + tax

  const changeAmount = selectedPayment === 'cash' && cashTendered ? Math.max(0, Number(cashTendered) - total) : 0

  // Use first split method if splits defined, else use selectedPayment
  const effectivePaymentMethod = paymentSplits.length > 0 ? paymentSplits[0].method : selectedPayment
  const currentPaymentLabel = PAYMENT_METHOD_MAP.find(m => m.code === effectivePaymentMethod)?.label || effectivePaymentMethod

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
    if (effectivePaymentMethod === 'cash') {
      const tendered = Number(cashTendered)
      if (!tendered || tendered < total) {
        toast.error('現金金額不足')
        return
      }
    }

    // 信用卡（中信 EDC）：結帳前必須完成 卡別/末四碼/授權碼 登錄
    if (effectivePaymentMethod === 'credit_card') {
      const edcErrors = validateEdcFields(edcInfo)
      if (edcErrors.length > 0) {
        toast.error(edcErrors[0])
        return
      }
    }

    // ★ 離線模式：僅支援現金，交易入本機佇列（帶冪等鍵），連線後自動同步
    if (!isOnline()) {
      if (effectivePaymentMethod !== 'cash') {
        toast.error('離線狀態僅支援現金交易')
        return
      }
      const txnNum = `POS-${String(Date.now()).slice(-6)}`
      queueTransaction({
        transaction_number: txnNum,
        store: '威士威企業總部',
        cashier: '系統',
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, order_type: c.order_type })),
        subtotal, discount: safeDiscount, tax, total,
        payment_method: currentPaymentLabel,
        member_id: selectedMember?.id ?? null,
        points_earned: selectedMember ? Math.floor(total / 10) : 0,
        points_used: pointsUsed,
      })
      const nowDate = new Date()
      const printTime = nowDate.toLocaleString('zh-TW', { hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-')
      setReceiptData({
        storeName: tenant?.store_name || tenant?.name || '威士威企業總部',
        txnNum,
        invoiceNum: null, // 離線無法配號，同步後由補開流程開立
        paymentId: txnNum,
        printTime, terminalId: '01', orderType: '外帶', orderNum: txnNum,
        seqNum: null, openedAt: printTime,
        date: nowDate.toLocaleString('zh-TW'),
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, amount: c.price * c.qty })),
        subtotal, discount: safeDiscount, pointsUsed, pointsDiscount, tax, total,
        paymentMethod: currentPaymentLabel,
        cashTendered: Number(cashTendered),
        change: changeAmount,
        carrierType: null, carrierValue: null,
        note: orderNote.trim() || null,
        offline: true,
      })
      setPaymentResult({ paymentId: txnNum, offline: true })
      setGatewayPending(false)
      setGatewayConfirmed(true)
      setPaymentStage('success')
      setProcessingMsg('')
      toast.success('離線交易已暫存，連線後將自動同步')
      if (thermalPort) kickCashDrawer(thermalPort).catch(() => {})
      return
    }

    setPaymentStage('paying')
    setProcessingMsg('處理付款中...')

    try {
      // 1. Process payment via gateway abstraction layer
      const orderId = `POS-${Date.now()}`
      const gatewayResult = await processPayment(effectivePaymentMethod, total, orderId, {
        cashTendered: effectivePaymentMethod === 'cash' ? Number(cashTendered) : undefined,
      })

      // Also create payment request via legacy payment lib for compatibility
      const payResult = createPaymentRequest(
        { orderId, amount: total, currency: 'TWD', description: 'POS 銷售' },
        effectivePaymentMethod
      )

      // Track gateway pending status
      const isPending = gatewayResult.status === 'pending_confirmation'

      // Simulate processing delay for card/digital payments
      if (effectivePaymentMethod !== 'cash' && effectivePaymentMethod !== 'bank_transfer') {
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

      const newTransactionId = txnRecord ?? txnNum

      // Patch note onto transaction record (RPC doesn't accept it directly)
      if (orderNote.trim() && txnRecord) {
        updatePOSTransaction(txnRecord, { note: orderNote.trim() }).catch(() => {})
      }

      // Insert one pos_payments row per split; single payment uses default behavior
      if (paymentSplits.length > 0) {
        for (const split of paymentSplits) {
          await supabase.from('pos_payments').insert({
            order_id: newTransactionId,
            method: split.method,
            amount: split.amount,
          })
        }
      }

      // 中信 EDC 卡付登錄：寫入 pos_payments（gateway='ctbc_edc'）。
      // invoice_status 維持預設 'pending'，由 issue-invoice 補開 — 發票與付款方式解耦。
      // 失敗不擋結帳（卡已於刷卡機過卡完成），僅記錄警示供日後補登。
      if (effectivePaymentMethod === 'credit_card' && paymentSplits.length === 0) {
        try {
          await recordEdcPayment({
            organization_id: tenant?.organization_id ?? null,
            store_id: tenant?.store_id ?? null,
            order_id: newTransactionId,
            amount: total,
            ...edcInfo,
          })
        } catch (e) {
          console.warn('[POS] EDC 卡付登錄失敗（交易已完成，請至卡收明細補登）:', e.message)
        }
      }

      // House account deduction
      if (effectivePaymentMethod === 'house_account' && selectedMember) {
        const roundedTotal = Math.round(total)
        const { error: haErr } = await supabase.rpc('deduct_member_credit', {
          p_member_id: selectedMember.id,
          p_amount: roundedTotal,
          p_reference_id: newTransactionId,
        })
        if (haErr) { setPaymentStage('failed'); return }
        await supabase.from('pos_house_account_txns').insert({
          member_id: selectedMember.id,
          amount: -roundedTotal,
          balance_after: (selectedMember.credit_balance - roundedTotal),
          reference_type: 'pos_payment',
          reference_id: newTransactionId,
        })
      }

      // Publish event → Finance AR, WMS stock deduction, CRM loyalty/purchase/survey
      try {
        const bus = getEventBus()
        await bus.publish('pos.transaction.completed', {
          transaction_id: String(newTransactionId),
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

      // Mark coupon assignment as redeemed (fire-and-forget — checkout already succeeded)
      if (selectedCoupon?.id) {
        redeemCoupon(selectedCoupon.id, txnRecord).catch(e =>
          console.warn('[POS] coupon redemption failed:', e.message)
        )
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
      const debitAccount = effectivePaymentMethod === 'cash' ? '1100' : '1200'
      const debitName = effectivePaymentMethod === 'cash' ? '現金' : '銀行存款'
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
      const nowDate = new Date()
      const printTime = nowDate.toLocaleString('zh-TW', { hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-')
      const receipt = {
        storeName: tenant?.store_name || tenant?.name || '威士威企業總部',
        txnNum,
        invoiceNum,
        paymentId: payResult.paymentId,
        printTime,
        terminalId: '01',
        orderType: '外帶',
        orderNum: txnNum,
        seqNum: invoiceSeq,
        openedAt: printTime,
        date: nowDate.toLocaleString('zh-TW'),
        items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, amount: c.price * c.qty })),
        subtotal,
        discount: safeDiscount,
        pointsUsed,
        pointsDiscount,
        tax,
        total,
        paymentMethod: currentPaymentLabel,
        cashTendered: effectivePaymentMethod === 'cash' ? Number(cashTendered) : null,
        change: effectivePaymentMethod === 'cash' ? changeAmount : null,
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
      if (effectivePaymentMethod === 'cash' && thermalPort) {
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
          cashReceived: effectivePaymentMethod === 'cash' ? Number(cashTendered) : null,
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
    setAvailableCoupons([])
    setSelectedCoupon(null)
    setPaymentSplits([])
    setEdcInfo({ card_brand: 'VISA', card_last4: '', auth_code: '' })
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

            {/* Hold / Recall controls */}
            {cart.length > 0 && (
              <button
                className="btn"
                style={{
                  background: 'var(--accent-orange-dim)',
                  border: '1px solid var(--accent-orange)',
                  color: 'var(--accent-orange)',
                }}
                onClick={holdOrder}
              >
                掛單
              </button>
            )}
            <div style={{ position: 'relative' }}>
              <button
                className="btn"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-primary)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                onClick={() => setShowRecallMenu(v => !v)}
              >
                叫回
                {savedOrders.length > 0 && (
                  <span style={{
                    background: 'var(--accent-orange)',
                    color: '#fff',
                    borderRadius: '50%', fontSize: 11, fontWeight: 700,
                    width: 18, height: 18,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {savedOrders.length}
                  </span>
                )}
              </button>
              {showRecallMenu && savedOrders.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, zIndex: 50,
                  background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
                  borderRadius: 8, minWidth: 240, padding: 8, marginTop: 4,
                }}>
                  {savedOrders.map(o => (
                    <button
                      key={o.id}
                      onClick={() => recallOrder(o)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', borderRadius: 6, border: 'none',
                        background: 'transparent', color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {new Date(o.savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                      　{o.cart.length} 項　NT{o.cart.reduce((s, i) => s + i.price * i.qty, 0)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="btn" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }} onClick={() => setShowRefund(true)}>
              <RotateCcw size={14} /> 退貨/退款
            </button>

            <OfflineSyncBadge />
          </div>
        </div>
      </div>

      {isOfflineMode && (
        <div style={{
          background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)',
          padding: '6px 16px', fontSize: 13, textAlign: 'center',
        }}>
          ⚠️ 離線模式 — 顯示快取資料，交易將在連線後同步
        </div>
      )}

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
        paymentSplits={paymentSplits}
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
          onMemberClear={() => { setSelectedMember(null); setPointsUsed(0); setAvailableCoupons([]); setSelectedCoupon(null) }}
          availableCoupons={availableCoupons}
          selectedCoupon={selectedCoupon}
          onCouponSelect={setSelectedCoupon}
          couponsLoading={couponsLoading}
          couponDiscount={couponDiscount}
          paymentSplits={paymentSplits}
          onPaymentSplitsChange={setPaymentSplits}
          onUpdateItemCourse={(id, course) => setCart(prev => prev.map(c => c.id === id ? { ...c, course } : c))}
        />
      </div>

      {/* 中信 EDC 刷卡登錄（選擇信用卡付款時顯示） */}
      {paymentStage === 'cart' && effectivePaymentMethod === 'credit_card' && (
        <EdcPaymentForm value={edcInfo} onChange={setEdcInfo} />
      )}

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
