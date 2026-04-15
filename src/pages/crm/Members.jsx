import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ArrowUpCircle } from 'lucide-react'
import { getMembers, createMember } from '../../lib/db'
import { earnPoints, redeemPoints, generateReferralCode } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import MemberListTab from './components/MemberListTab'
import TierRulesTab from './components/TierRulesTab'
import ReferralTab from './components/ReferralTab'
import PointHistoryTab from './components/PointHistoryTab'
import PurchaseModal from './components/PurchaseModal'
import RedeemModal from './components/RedeemModal'
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
  const [form, setForm] = useState({ member_number: '', name: '', phone: '', level: '一般', total_points: 0, available_points: 0, total_spent: 0 })

  // Purchase simulation
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [purchaseMember, setPurchaseMember] = useState(null)
  const [purchaseAmount, setPurchaseAmount] = useState('')
  const [purchaseResult, setPurchaseResult] = useState(null)

  // Redemption
  const [showRedeemModal, setShowRedeemModal] = useState(false)
  const [redeemMember, setRedeemMember] = useState(null)
  const [redeemAmount, setRedeemAmount] = useState('')

  // POS transactions
  const [posTransactions, setPosTransactions] = useState([])

  // Point transaction history
  const [pointHistory, setPointHistory] = useState([])

  // Referral codes
  const [referralCodes, setReferralCodes] = useState({})

  // Expanded rows in history
  const [expandedMember, setExpandedMember] = useState(null)

  // Tier upgrade notification
  const [tierUpgrade, setTierUpgrade] = useState(null)

  useEffect(() => {
    getMembers().then(({ data }) => { setMembers(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name || !form.member_number) return
    try {
      const { data, error } = await createMember({ ...form, visit_count: 0, last_visit: new Date().toISOString().slice(0, 10) })
      if (error) throw error
      if (data) {
        setMembers(prev => [...prev, data])
        setShowModal(false)
        setForm({ member_number: '', name: '', phone: '', level: '一般', total_points: 0, available_points: 0, total_spent: 0 })
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

  const handlePurchase = () => {
    const amount = Number(purchaseAmount)
    if (!amount || amount <= 0 || !purchaseMember) return
    const result = earnPoints(purchaseMember, amount, '消費累點')
    setPurchaseResult(result)

    // Update member in state
    setMembers(prev => prev.map(m => {
      if (m.id !== purchaseMember.id) return m
      return {
        ...m,
        total_points: result.newTotalPoints,
        available_points: result.newAvailablePoints,
        total_spent: result.newTotalSpent,
        level: result.newTier,
        visit_count: (m.visit_count || 0) + 1,
        last_visit: new Date().toISOString().slice(0, 10),
      }
    }))

    // Add to point history
    setPointHistory(prev => [result.transaction, ...prev])

    // Add POS transaction
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

  const handleRedeem = () => {
    const pts = Number(redeemAmount)
    if (!pts || pts <= 0 || !redeemMember) return
    const result = redeemPoints(redeemMember, pts, 'discount')
    if (!result.success) {
      alert(result.error)
      return
    }

    setMembers(prev => prev.map(m => {
      if (m.id !== redeemMember.id) return m
      return { ...m, available_points: result.newAvailablePoints }
    }))

    setPointHistory(prev => [result.transaction, ...prev])
    setShowRedeemModal(false)
    alert(`兌換成功！折抵金額：NT$ ${result.discountAmount}`)
  }

  // --- Referral ---
  const handleGenerateReferral = (member) => {
    const ref = generateReferralCode(member.id)
    setReferralCodes(prev => ({ ...prev, [member.id]: ref }))
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
    </div>
  )
}
