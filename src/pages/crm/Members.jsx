import { useState, useEffect } from 'react'
import { Plus, Search, Star, Gift, ShoppingCart, Hash, ArrowUpCircle, ChevronDown, ChevronUp, RefreshCw, Copy } from 'lucide-react'
import { getMembers, createMember } from '../../lib/db'
import { earnPoints, redeemPoints, calculatePointsEarned, calculateTier, generateReferralCode, TIER_RULES } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const LEVELS = ['一般', '銀卡', '金卡', '白金', '鑽石']
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

  const memberHistoryFor = (memberId) => pointHistory.filter(h => h.member_id === memberId)

  return (
    <div className="fade-in">
      {/* Tier upgrade notification */}
      {tierUpgrade && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 2000,
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

      {/* ==================== TAB: Member List ==================== */}
      {activeTab === 'list' && (
        <>
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📋</span> 會員列表</div>
              <div className="search-bar">
                <Search className="search-icon" />
                <input type="text" placeholder="搜尋會員..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>會員編號</th><th>姓名</th><th>電話</th><th>等級</th><th>總點數</th><th>可用點數</th><th>累計消費</th><th>到店次數</th><th>最後到店</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無會員</td></tr>}
                  {filtered.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.member_number}</td>
                      <td>{m.name}</td>
                      <td>{m.phone}</td>
                      <td>
                        <span className={`badge ${levelBadge(m.level)}`}>
                          <span className="badge-dot"></span>{m.level}
                        </span>
                      </td>
                      <td>{(m.total_points || 0).toLocaleString()}</td>
                      <td>{(m.available_points || 0).toLocaleString()}</td>
                      <td>NT$ {(m.total_spent || 0).toLocaleString()}</td>
                      <td>{m.visit_count || 0}</td>
                      <td>{m.last_visit}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openPurchase(m)} title="模擬消費">
                            <ShoppingCart size={12} /> 模擬消費
                          </button>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openRedeem(m)} title="兌換點數">
                            <Gift size={12} /> 兌換
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* POS Transactions Section */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🧾</span> POS 交易</div>
            </div>
            {posTransactions.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                尚無 POS 交易紀錄。使用「模擬消費」按鈕來產生交易。
              </div>
            ) : (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>交易編號</th><th>會員</th><th>消費金額</th><th>獲得點數</th><th>時間</th></tr>
                  </thead>
                  <tbody>
                    {posTransactions.slice(0, 20).map(tx => (
                      <tr key={tx.id}>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{tx.id}</td>
                        <td>{tx.member_name}</td>
                        <td>NT$ {tx.amount.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>+{tx.points_earned}</td>
                        <td style={{ fontSize: 12 }}>{formatTime(tx.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ==================== TAB: Tier Rules ==================== */}
      {activeTab === 'tiers' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">⭐</span> 等級規則</div>
          </div>
          <div style={{ padding: '4px 0' }}>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>等級</th>
                    <th>最低累計消費</th>
                    <th>最低累計點數</th>
                    <th>累點倍率</th>
                    <th>折扣 %</th>
                    <th>說明</th>
                  </tr>
                </thead>
                <tbody>
                  {TIER_RULES.map((tier, i) => (
                    <tr key={tier.level}>
                      <td>
                        <span className={`badge ${levelBadge(tier.level)}`}>
                          <span className="badge-dot"></span>{tier.level}
                        </span>
                      </td>
                      <td>NT$ {tier.min_spent.toLocaleString()}</td>
                      <td>{tier.min_points.toLocaleString()}</td>
                      <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{tier.earn_rate}x</td>
                      <td style={{ fontWeight: 600, color: tier.discount > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{tier.discount}%</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {i === 0 ? '基本等級，每消費 $10 得 1 點' :
                          `消費滿 $${tier.min_spent.toLocaleString()} 且點數達 ${tier.min_points.toLocaleString()} 自動升級`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}>
            <strong>升級機制：</strong>每次消費後系統自動檢查累計消費與點數，達標自動升級。點數計算公式：消費金額 / 10 × 等級倍率（無條件捨去）。
          </div>

          {/* Current member tier distribution */}
          <div style={{ padding: '0 20px 20px' }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>會員等級分佈</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {LEVELS.map(level => {
                const count = members.filter(m => m.level === level).length
                return (
                  <div key={level} style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                    fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span className={`badge ${levelBadge(level)}`}>
                      <span className="badge-dot"></span>{level}
                    </span>
                    <span style={{ fontWeight: 700 }}>{count}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>人</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB: Referral Program ==================== */}
      {activeTab === 'referral' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🎁</span> 推薦計畫</div>
          </div>
          <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
            每位會員可產生專屬推薦碼，成功推薦可獲得 <strong>200 點</strong>獎勵。每組推薦碼最多可使用 10 次。
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>會員編號</th><th>姓名</th><th>等級</th><th>推薦碼</th><th>使用次數</th><th>獎勵點數</th><th>操作</th></tr>
              </thead>
              <tbody>
                {members.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無會員</td></tr>}
                {members.map(m => {
                  const ref = referralCodes[m.id]
                  return (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.member_number}</td>
                      <td>{m.name}</td>
                      <td>
                        <span className={`badge ${levelBadge(m.level)}`}>
                          <span className="badge-dot"></span>{m.level}
                        </span>
                      </td>
                      <td>
                        {ref ? (
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: 'var(--accent-blue)' }}>
                            {ref.code}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>尚未產生</span>
                        )}
                      </td>
                      <td>{ref ? `${ref.uses} / ${ref.max_uses}` : '-'}</td>
                      <td>{ref ? `${ref.bonus_points} 點/次` : '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {!ref ? (
                            <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => handleGenerateReferral(m)}>
                              <Hash size={12} /> 產生推薦碼
                            </button>
                          ) : (
                            <>
                              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => copyCode(ref.code)} title="複製推薦碼">
                                <Copy size={12} /> 複製
                              </button>
                              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleGenerateReferral(m)} title="重新產生">
                                <RefreshCw size={12} /> 重新產生
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== TAB: Point History ==================== */}
      {activeTab === 'history' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📊</span> 點數紀錄</div>
          </div>
          {pointHistory.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              尚無點數異動紀錄。透過「模擬消費」或「兌換」產生紀錄。
            </div>
          ) : (
            <>
              {/* All history table */}
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>交易編號</th><th>會員</th><th>類型</th><th>點數</th><th>描述</th><th>時間</th></tr>
                  </thead>
                  <tbody>
                    {pointHistory.map(h => {
                      const member = members.find(m => m.id === h.member_id)
                      return (
                        <tr key={h.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{h.id}</td>
                          <td>{member?.name || h.member_id}</td>
                          <td>
                            <span className={`badge ${h.type === 'earn' ? 'badge-green' : 'badge-orange'}`}>
                              <span className="badge-dot"></span>{h.type === 'earn' ? '累點' : '兌換'}
                            </span>
                          </td>
                          <td style={{
                            fontWeight: 700,
                            color: h.points > 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                          }}>
                            {h.points > 0 ? '+' : ''}{h.points}
                          </td>
                          <td style={{ fontSize: 12 }}>{h.description}</td>
                          <td style={{ fontSize: 12 }}>{formatTime(h.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Per-member expandable summary */}
              <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)' }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>依會員檢視</h4>
                {members.filter(m => memberHistoryFor(m.id).length > 0).map(m => {
                  const history = memberHistoryFor(m.id)
                  const isExpanded = expandedMember === m.id
                  const totalEarned = history.filter(h => h.type === 'earn').reduce((s, h) => s + h.points, 0)
                  const totalRedeemed = history.filter(h => h.type === 'redeem').reduce((s, h) => s + Math.abs(h.points), 0)
                  return (
                    <div key={m.id} style={{
                      border: '1px solid var(--border-subtle)', borderRadius: 8,
                      marginBottom: 8, overflow: 'hidden',
                    }}>
                      <div
                        style={{
                          padding: '10px 16px', display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', cursor: 'pointer', background: 'var(--bg-tertiary)',
                        }}
                        onClick={() => setExpandedMember(isExpanded ? null : m.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                          <span className={`badge ${levelBadge(m.level)}`}>
                            <span className="badge-dot"></span>{m.level}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                          <span style={{ color: 'var(--accent-green)' }}>累計 +{totalEarned}</span>
                          <span style={{ color: 'var(--accent-red)' }}>兌換 -{totalRedeemed}</span>
                          <span>{history.length} 筆</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 16px 12px' }}>
                          <table className="data-table" style={{ marginTop: 8 }}>
                            <thead>
                              <tr><th>類型</th><th>點數</th><th>描述</th><th>時間</th></tr>
                            </thead>
                            <tbody>
                              {history.map(h => (
                                <tr key={h.id}>
                                  <td>
                                    <span className={`badge ${h.type === 'earn' ? 'badge-green' : 'badge-orange'}`}>
                                      <span className="badge-dot"></span>{h.type === 'earn' ? '累點' : '兌換'}
                                    </span>
                                  </td>
                                  <td style={{ fontWeight: 700, color: h.points > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                    {h.points > 0 ? '+' : ''}{h.points}
                                  </td>
                                  <td style={{ fontSize: 12 }}>{h.description}</td>
                                  <td style={{ fontSize: 12 }}>{formatTime(h.created_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ==================== Modals ==================== */}

      {/* Create Member Modal */}
      {showModal && (
        <Modal title="新增會員" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="會員編號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="MEM-001" value={form.member_number} onChange={e => set('member_number', e.target.value)} />
            </Field>
            <Field label="姓名 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="會員姓名" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="電話">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0912-345-678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="等級">
              <select className="form-input" style={{ width: '100%' }} value={form.level} onChange={e => set('level', e.target.value)}>
                {LEVELS.map(l => <option key={l}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="總點數">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.total_points} onChange={e => set('total_points', Number(e.target.value))} />
            </Field>
            <Field label="可用點數">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.available_points} onChange={e => set('available_points', Number(e.target.value))} />
            </Field>
            <Field label="累計消費">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.total_spent} onChange={e => set('total_spent', Number(e.target.value))} />
            </Field>
          </div>
        </Modal>
      )}

      {/* Purchase Simulation Modal */}
      {showPurchaseModal && purchaseMember && (
        <Modal
          title={`模擬消費 — ${purchaseMember.name}`}
          onClose={() => { setShowPurchaseModal(false); setPurchaseResult(null) }}
          onSubmit={purchaseResult ? () => { setShowPurchaseModal(false); setPurchaseResult(null) } : handlePurchase}
          submitLabel={purchaseResult ? '完成' : '確認消費'}
        >
          {!purchaseResult ? (
            <>
              <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>目前等級</span>
                  <span className={`badge ${levelBadge(purchaseMember.level)}`}>
                    <span className="badge-dot"></span>{purchaseMember.level}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>累計消費</span><span style={{ fontWeight: 600 }}>NT$ {(purchaseMember.total_spent || 0).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>可用點數</span><span style={{ fontWeight: 600 }}>{(purchaseMember.available_points || 0).toLocaleString()}</span>
                </div>
              </div>
              <Field label="消費金額 (NT$)">
                <input
                  className="form-input" type="number" style={{ width: '100%' }}
                  placeholder="輸入消費金額" value={purchaseAmount}
                  onChange={e => setPurchaseAmount(e.target.value)}
                  min="1"
                />
              </Field>
              {purchaseAmount && Number(purchaseAmount) > 0 && (
                <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>預計獲得點數</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>
                      +{calculatePointsEarned(Number(purchaseAmount), purchaseMember.level)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                    計算方式：${Number(purchaseAmount).toLocaleString()} / 10 × {TIER_RULES.find(t => t.level === purchaseMember.level)?.earn_rate || 1}x 倍率
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>消費處理完成</div>
              </div>
              <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>消費金額</span><span style={{ fontWeight: 600 }}>NT$ {Number(purchaseAmount).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>獲得點數</span><span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>+{purchaseResult.pointsEarned}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>新累計消費</span><span style={{ fontWeight: 600 }}>NT$ {purchaseResult.newTotalSpent.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>新總點數</span><span style={{ fontWeight: 600 }}>{purchaseResult.newTotalPoints.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>新可用點數</span><span style={{ fontWeight: 600 }}>{purchaseResult.newAvailablePoints.toLocaleString()}</span>
                </div>
              </div>
              {purchaseResult.tierChanged && (
                <div style={{
                  padding: '12px 16px', borderRadius: 8,
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(236,72,153,0.15))',
                  border: '1px solid var(--accent-purple)',
                  textAlign: 'center',
                }}>
                  <ArrowUpCircle size={20} style={{ color: 'var(--accent-purple)', marginBottom: 4 }} />
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent-purple)' }}>升級！</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    {purchaseMember.level} → <span style={{ fontWeight: 700 }}>{purchaseResult.newTier}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Redemption Modal */}
      {showRedeemModal && redeemMember && (
        <Modal
          title={`兌換點數 — ${redeemMember.name}`}
          onClose={() => setShowRedeemModal(false)}
          onSubmit={handleRedeem}
          submitLabel="確認兌換"
        >
          <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>目前等級</span>
              <span className={`badge ${levelBadge(redeemMember.level)}`}>
                <span className="badge-dot"></span>{redeemMember.level}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>可用點數</span>
              <span style={{ fontWeight: 700 }}>{(redeemMember.available_points || 0).toLocaleString()}</span>
            </div>
          </div>
          <Field label="兌換點數">
            <input
              className="form-input" type="number" style={{ width: '100%' }}
              placeholder="輸入要兌換的點數" value={redeemAmount}
              onChange={e => setRedeemAmount(e.target.value)}
              min="1" max={redeemMember.available_points || 0}
            />
          </Field>
          {redeemAmount && Number(redeemAmount) > 0 && (
            <div style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>折抵金額</span>
                <span style={{ fontWeight: 700, color: 'var(--accent-orange)' }}>
                  NT$ {Math.floor(Number(redeemAmount) * 0.5).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                匯率：1 點 = $0.5
              </div>
              {Number(redeemAmount) > (redeemMember.available_points || 0) && (
                <div style={{ color: 'var(--accent-red)', fontSize: 12, marginTop: 6 }}>
                  點數不足！可用點數為 {(redeemMember.available_points || 0).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
