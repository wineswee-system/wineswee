import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, ArrowUpCircle } from 'lucide-react'
import { getMembers, createMember, updateMember, createPointTransaction, getAllPointTransactions, getReferralCodes, createReferralCode, getReferralCodeByCode, getReferralRedemptionsByReferee, createReferralRedemption, updateReferralCode, getAllReferralRedemptions } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { earnPoints, redeemPoints, refundPoints, generateReferralCode } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import MemberListTab from './components/MemberListTab'
import TierRulesTab from './components/TierRulesTab'
import ReferralTab from './components/ReferralTab'
import PointHistoryTab from './components/PointHistoryTab'
import PurchaseModal from './components/PurchaseModal'
import RedeemModal from './components/RedeemModal'
import RefundModal from './components/RefundModal'
import MemberFormModal from './components/MemberFormModal'

const TABS = [
  { key: 'list', label: '📋 會員列表' },
  { key: 'tiers', label: '⭐ 等級規則' },
  { key: 'referral', label: '🎁 推薦計畫' },
  { key: 'history', label: '📊 點數紀錄' },
]

export default function Members() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('list')
  const [form, setForm] = useState({ member_number: '', name: '', phone: '', level: '一般', total_points: 0, available_points: 0, total_spent: 0, referral_code: '' })

  // Purchase simulation
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [purchaseMember, setPurchaseMember] = useState(null)
  const [purchaseAmount, setPurchaseAmount] = useState('')
  const [purchaseResult, setPurchaseResult] = useState(null)

  // Redemption
  const [showRedeemModal, setShowRedeemModal] = useState(false)
  const [redeemMember, setRedeemMember] = useState(null)
  const [redeemAmount, setRedeemAmount] = useState('')

  // Refund
  const [showRefundModal, setShowRefundModal] = useState(false)
  const [refundMember, setRefundMember] = useState(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundResult, setRefundResult] = useState(null)

  // POS transactions
  const [posTransactions, setPosTransactions] = useState([])

  // Point transaction history
  const [pointHistory, setPointHistory] = useState([])

  // Referral codes (keyed by member_id)
  const [referralCodes, setReferralCodes] = useState({})
  const [redemptions, setRedemptions] = useState([])
  const [applyingCode, setApplyingCode] = useState(false)

  // Expanded rows in history
  const [expandedMember, setExpandedMember] = useState(null)

  // Tier upgrade notification
  const [tierUpgrade, setTierUpgrade] = useState(null)

  useEffect(() => {
    Promise.all([
      getMembers(),
      getAllPointTransactions(),
      getReferralCodes(),
      getAllReferralRedemptions(),
    ]).then(([membersRes, txRes, refRes, redemptionsRes]) => {
      setMembers(membersRes.data || [])
      setPointHistory(txRes.data || [])
      setRedemptions(redemptionsRes.data || [])
      // Index referral codes by member_id
      const codes = {}
      for (const rc of (refRes.data || [])) {
        if (rc.status === '有效') codes[rc.member_id] = rc
      }
      setReferralCodes(codes)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name || !form.member_number) return
    try {
      const { referral_code, ...memberData } = form
      const { data, error } = await createMember({ ...memberData, visit_count: 0, last_visit: new Date().toISOString().slice(0, 10) })
      if (error) throw error
      if (data) {
        setMembers(prev => [...prev, data])
        setShowModal(false)
        setForm({ member_number: '', name: '', phone: '', level: '一般', total_points: 0, available_points: 0, total_spent: 0, referral_code: '' })

        // Auto-apply referral code if provided
        if (referral_code.trim()) {
          const result = await handleApplyReferral(data.id, referral_code.trim())
          if (result.success) {
            // Refresh member data to reflect bonus points
            const { data: updated } = await getMembers()
            if (updated) setMembers(updated)
          } else {
            alert(`會員已建立，但推薦碼兌換失敗：${result.message}`)
          }
        }
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // --- Purchase simulation ---
  const openPurchase = (member) => {
    setPurchaseMember(member)
    setPurchaseAmount('')
    setPurchaseResult(null)
    setShowPurchaseModal(true)
  }

  const handlePurchase = async () => {
    const amount = Number(purchaseAmount)
    if (!amount || amount <= 0 || !purchaseMember) return
    const result = earnPoints(purchaseMember, amount, '消費累點')
    setPurchaseResult(result)

    // ★ 用 atomic RPC 取代「讀-算-雙寫」，避免兩次同時請求弄丟點數
    //   RPC 內部 SELECT FOR UPDATE 鎖會員列，再原子更新 total/available/visit + 寫 transaction
    const reference = `POS-${Date.now()}`
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('earn_member_points_atomic', {
      p_member_id: purchaseMember.id,
      p_points_delta: result.pointsEarned,
      p_amount: amount,
      p_reason: result.transaction.description,
      p_reference_no: reference,
      p_operator: '系統',
    })

    const memberUpdate = {
      total_points: rpcResult?.ok ? rpcResult.total_points : result.newTotalPoints,
      available_points: rpcResult?.ok ? rpcResult.available_points : result.newAvailablePoints,
      total_spent: result.newTotalSpent,
      level: result.newTier,
      visit_count: (purchaseMember.visit_count || 0) + 1,
      last_visit: new Date().toISOString().slice(0, 10),
    }

    if (rpcErr || !rpcResult?.ok) {
      console.error('Atomic points failed, fallback:', rpcErr || rpcResult)
      // Fallback：RPC 沒部署或失敗時，沿用舊路徑（接受雙寫風險）
      try {
        await updateMember(purchaseMember.id, memberUpdate)
        await createPointTransaction({
          member_id: purchaseMember.id,
          type: 'earn',
          points: result.pointsEarned,
          balance: result.newAvailablePoints,
          reference,
          description: result.transaction.description,
        })
      } catch (err) {
        console.error('Fallback also failed:', err)
      }
    }

    // Update local state（RPC 回傳的 total/available 會優先採用）
    setMembers(prev => prev.map(m => m.id !== purchaseMember.id ? m : { ...m, ...memberUpdate }))
    setPointHistory(prev => [result.transaction, ...prev])

    // Add POS transaction display
    const posTx = {
      id: `POS-${Date.now()}`,
      member_id: purchaseMember.id,
      member_name: purchaseMember.name,
      amount,
      points_earned: result.pointsEarned,
      created_at: new Date().toISOString(),
    }
    setPosTransactions(prev => [posTx, ...prev])

    // Show tier upgrade notification
    if (result.tierChanged) {
      setTierUpgrade({ name: purchaseMember.name, oldTier: purchaseMember.level, newTier: result.newTier })
      setTimeout(() => setTierUpgrade(null), 5000)
    }
  }

  // --- Redemption flow ---
  const openRedeem = (member) => {
    setRedeemMember(member)
    setRedeemAmount('')
    setShowRedeemModal(true)
  }

  const handleRedeem = async () => {
    const pts = Number(redeemAmount)
    if (!pts || pts <= 0 || !redeemMember) return
    const result = redeemPoints(redeemMember, pts, 'discount')
    if (!result.success) {
      alert(result.error)
      return
    }

    // Persist to DB
    try {
      const [memberRes, txRes] = await Promise.all([
        updateMember(redeemMember.id, { available_points: result.newAvailablePoints }),
        createPointTransaction({
          member_id: redeemMember.id,
          type: 'redeem',
          points: -pts,
          balance: result.newAvailablePoints,
          reference: `RDM-${Date.now()}`,
          description: result.transaction.description,
        }),
      ])
      if (memberRes.error) throw memberRes.error
      if (txRes.error) throw txRes.error

      setMembers(prev => prev.map(m => m.id !== redeemMember.id ? m : { ...m, available_points: result.newAvailablePoints }))
      setPointHistory(prev => [txRes.data || result.transaction, ...prev])
    } catch (err) {
      console.error('Failed to persist redemption:', err)
      setMembers(prev => prev.map(m => m.id !== redeemMember.id ? m : { ...m, available_points: result.newAvailablePoints }))
      setPointHistory(prev => [result.transaction, ...prev])
    }

    setShowRedeemModal(false)
    alert(`兌換成功！折抵金額：NT$ ${result.discountAmount}`)
  }

  // --- Refund flow ---
  const openRefund = (member) => {
    setRefundMember(member)
    setRefundAmount('')
    setRefundResult(null)
    setShowRefundModal(true)
  }

  const handleRefund = async () => {
    const amount = Number(refundAmount)
    if (!amount || amount <= 0 || !refundMember) return
    const result = refundPoints(refundMember, amount, refundMember.total_spent || 0, '會員退款')
    setRefundResult(result)

    const memberUpdate = {
      total_points: result.newTotalPoints,
      available_points: result.newAvailablePoints,
      total_spent: result.newTotalSpent,
      level: result.newTier,
    }

    try {
      const [memberRes, txRes] = await Promise.all([
        updateMember(refundMember.id, memberUpdate),
        createPointTransaction({
          member_id: refundMember.id,
          type: 'refund',
          points: -result.pointsReversed,
          balance: result.newAvailablePoints,
          reference: `REFUND-${Date.now()}`,
          description: result.transaction.description,
        }),
      ])
      if (memberRes.error) throw memberRes.error
      if (txRes.error) throw txRes.error

      setMembers(prev => prev.map(m => m.id !== refundMember.id ? m : { ...m, ...memberUpdate }))
      setPointHistory(prev => [txRes.data || result.transaction, ...prev])
    } catch (err) {
      console.error('Failed to persist refund:', err)
      setMembers(prev => prev.map(m => m.id !== refundMember.id ? m : { ...m, ...memberUpdate }))
      setPointHistory(prev => [result.transaction, ...prev])
    }
  }

  // --- Referral ---
  const handleGenerateReferral = async (member) => {
    const ref = generateReferralCode(member.id)
    // If member already has a code, deactivate the old one
    const existing = referralCodes[member.id]
    try {
      if (existing) {
        await updateReferralCode(existing.id, { status: '停用' })
      }
      const { data, error } = await createReferralCode({
        member_id: member.id,
        code: ref.code,
        max_uses: ref.max_uses,
        bonus_points: ref.bonus_points,
      })
      if (error) throw error
      setReferralCodes(prev => ({ ...prev, [member.id]: data }))
    } catch (err) {
      console.error('Failed to create referral code:', err)
      alert('推薦碼建立失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleApplyReferral = async (refereeId, code) => {
    setApplyingCode(true)
    try {
      // 1. Validate code exists
      const { data: refCode } = await getReferralCodeByCode(code)
      if (!refCode) return { success: false, message: '推薦碼不存在或已停用' }

      // 2. Can't use own code
      if (refCode.member_id === refereeId) return { success: false, message: '不能使用自己的推薦碼' }

      // 3. Check if referee already used any referral code
      const { data: existingUse } = await getReferralRedemptionsByReferee(refereeId)
      if (existingUse) return { success: false, message: '此會員已使用過推薦碼' }

      // 4. Check max uses
      const currentUses = redemptions.filter(r => r.referral_code_id === refCode.id).length
      if (currentUses >= refCode.max_uses) return { success: false, message: '此推薦碼已達使用上限' }

      const referrerId = refCode.member_id
      const referrer = members.find(m => m.id === referrerId)
      const referee = members.find(m => m.id === refereeId)
      if (!referrer || !referee) return { success: false, message: '找不到會員資料' }

      const referrerPoints = refCode.bonus_points
      const refereePoints = Math.floor(refCode.bonus_points / 2)

      // 5. Persist: redemption record + point transactions + member updates
      const [redemptionRes, referrerTxRes, refereeTxRes] = await Promise.all([
        createReferralRedemption({
          referral_code_id: refCode.id,
          referrer_id: referrerId,
          referee_id: refereeId,
          referrer_points: referrerPoints,
          referee_points: refereePoints,
        }),
        createPointTransaction({
          member_id: referrerId,
          type: 'earn',
          points: referrerPoints,
          balance: (referrer.available_points || 0) + referrerPoints,
          reference: `REF-${refCode.code}`,
          description: `推薦獎勵 (推薦 ${referee.name})`,
        }),
        createPointTransaction({
          member_id: refereeId,
          type: 'earn',
          points: refereePoints,
          balance: (referee.available_points || 0) + refereePoints,
          reference: `REF-${refCode.code}`,
          description: `被推薦獎勵 (推薦碼 ${refCode.code})`,
        }),
      ])

      // 6. Update member points in DB
      await Promise.all([
        updateMember(referrerId, {
          total_points: (referrer.total_points || 0) + referrerPoints,
          available_points: (referrer.available_points || 0) + referrerPoints,
        }),
        updateMember(refereeId, {
          total_points: (referee.total_points || 0) + refereePoints,
          available_points: (referee.available_points || 0) + refereePoints,
        }),
      ])

      // 7. Update local state
      setMembers(prev => prev.map(m => {
        if (m.id === referrerId) return { ...m, total_points: (m.total_points || 0) + referrerPoints, available_points: (m.available_points || 0) + referrerPoints }
        if (m.id === refereeId) return { ...m, total_points: (m.total_points || 0) + refereePoints, available_points: (m.available_points || 0) + refereePoints }
        return m
      }))
      if (redemptionRes.data) setRedemptions(prev => [redemptionRes.data, ...prev])
      const newTxs = [referrerTxRes.data, refereeTxRes.data].filter(Boolean)
      if (newTxs.length) setPointHistory(prev => [...newTxs, ...prev])

      return { success: true, message: `推薦成功！${referrer.name} 獲得 ${referrerPoints} 點，${referee.name} 獲得 ${refereePoints} 點` }
    } catch (err) {
      console.error('Failed to apply referral:', err)
      return { success: false, message: '兌換失敗：' + (err.message || '未知錯誤') }
    } finally {
      setApplyingCode(false)
    }
  }

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => alert('已複製推薦碼')).catch(() => {})
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = members.filter(m =>
    search === '' || m.name?.includes(search) || m.member_number?.includes(search) || m.phone?.includes(search)
  )

  const total = filtered.length
  const now = new Date()
  const newThisMonth = filtered.filter(m => {
    const d = new Date(m.created_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length
  const vipCount = filtered.filter(m => m.level && m.level !== '一般').length
  const totalAvailablePoints = filtered.reduce((sum, m) => sum + (m.available_points || 0), 0)

  const levelBadge = (level) => {
    const map = { '一般': 'badge-info', '銀卡': 'badge-cyan', '金卡': 'badge-warning', '白金': 'badge-purple', '鑽石': 'badge-pink' }
    return map[level] || 'badge-info'
  }

  const formatTime = (iso) => {
    if (!iso) return '-'
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="fade-in">
      {/* Tier upgrade notification */}
      {tierUpgrade && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 10000,
          background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-pink))',
          color: '#fff', padding: '16px 24px', borderRadius: 12,
          boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.3s ease',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <ArrowUpCircle size={22} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>升級！</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{tierUpgrade.name}：{tierUpgrade.oldTier} → {tierUpgrade.newTier}</div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👑</span> 會員管理</h2>
            <p>會員資料與等級管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增會員</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總會員</div>
          <div className="stat-card-value">{total}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">本月新增</div>
          <div className="stat-card-value">{newThisMonth}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">VIP會員</div>
          <div className="stat-card-value">{vipCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">總可用點數</div>
          <div className="stat-card-value">{totalAvailablePoints.toLocaleString()}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ fontSize: 13 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'list' && (
        <MemberListTab
          filtered={filtered}
          search={search}
          setSearch={setSearch}
          levelBadge={levelBadge}
          formatTime={formatTime}
          openPurchase={openPurchase}
          openRedeem={openRedeem}
          openRefund={openRefund}
          posTransactions={posTransactions}
        />
      )}

      {activeTab === 'tiers' && (
        <TierRulesTab members={members} levelBadge={levelBadge} />
      )}

      {activeTab === 'referral' && (
        <ReferralTab
          members={members}
          referralCodes={referralCodes}
          levelBadge={levelBadge}
          handleGenerateReferral={handleGenerateReferral}
          copyCode={copyCode}
          handleApplyReferral={handleApplyReferral}
          redemptions={redemptions}
          applyingCode={applyingCode}
        />
      )}

      {activeTab === 'history' && (
        <PointHistoryTab
          members={members}
          pointHistory={pointHistory}
          expandedMember={expandedMember}
          setExpandedMember={setExpandedMember}
          levelBadge={levelBadge}
          formatTime={formatTime}
        />
      )}

      {/* Modals */}
      {showModal && (
        <MemberFormModal
          form={form}
          set={set}
          onClose={() => setShowModal(false)}
          onSubmit={handleSubmit}
        />
      )}

      {showPurchaseModal && purchaseMember && (
        <PurchaseModal
          purchaseMember={purchaseMember}
          purchaseAmount={purchaseAmount}
          setPurchaseAmount={setPurchaseAmount}
          purchaseResult={purchaseResult}
          handlePurchase={handlePurchase}
          onClose={() => { setShowPurchaseModal(false); setPurchaseResult(null) }}
          levelBadge={levelBadge}
        />
      )}

      {showRedeemModal && redeemMember && (
        <RedeemModal
          redeemMember={redeemMember}
          redeemAmount={redeemAmount}
          setRedeemAmount={setRedeemAmount}
          handleRedeem={handleRedeem}
          onClose={() => setShowRedeemModal(false)}
          levelBadge={levelBadge}
        />
      )}

      {showRefundModal && refundMember && (
        <RefundModal
          refundMember={refundMember}
          refundAmount={refundAmount}
          setRefundAmount={setRefundAmount}
          refundResult={refundResult}
          handleRefund={handleRefund}
          onClose={() => { setShowRefundModal(false); setRefundResult(null) }}
          levelBadge={levelBadge}
        />
      )}
    </div>
  )
}
