import { useState, useEffect, useRef } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Search, Landmark, Zap, CheckCircle, Link2, FileText, X, ArrowRight } from 'lucide-react'
import { getBankTransactions, getJournalEntries, createJournalEntry } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

import { toast } from '../../lib/toast'
import { fmtNT as fmt } from '../../lib/currency'

// Similarity score between two strings (simple token overlap)
function stringSimilarity(a, b) {
  if (!a || !b) return 0
  const tokA = a.toLowerCase().replace(/[^\u4e00-\u9fff\w]/g, ' ').split(/\s+/).filter(Boolean)
  const tokB = b.toLowerCase().replace(/[^\u4e00-\u9fff\w]/g, ' ').split(/\s+/).filter(Boolean)
  if (tokA.length === 0 || tokB.length === 0) return 0
  const setB = new Set(tokB)
  const overlap = tokA.filter(t => setB.has(t)).length
  return overlap / Math.max(tokA.length, tokB.length)
}

// Days between two date strings
function daysBetween(d1, d2) {
  if (!d1 || !d2) return 999
  const a = new Date(d1)
  const b = new Date(d2)
  return Math.abs((a - b) / (1000 * 60 * 60 * 24))
}

export default function BankReconciliation() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [transactions, setTransactions] = useState([])
  const [journalEntries, setJournalEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  // Matching state
  const [matchedPairs, setMatchedPairs] = useState([]) // [{bankId, journalId, confidence, bankDesc, journalDesc, amount}]
  const [confirmedMatches, setConfirmedMatches] = useState(new Set()) // Set of bankId
  const [autoMatched, setAutoMatched] = useState(false)
  const [matching, setMatching] = useState(false)
  const matchTimerRef = useRef(null)

  // Manual matching state
  const [selectedBankId, setSelectedBankId] = useState(null)
  const [selectedJournalId, setSelectedJournalId] = useState(null)

  // Adjustment entry modal
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState(null) // the unmatched bank transaction
  const [adjustForm, setAdjustForm] = useState({ description: '', account: '' })

  useEffect(() => {
    Promise.all([
      getBankTransactions(orgId),
      getJournalEntries(orgId),
    ]).then(([bt, je]) => {
      setTransactions(bt.data || [])
      setJournalEntries(je.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [orgId])

  useEffect(() => () => clearTimeout(matchTimerRef.current), [])

  // Auto-match logic
  const handleAutoMatch = () => {
    setMatching(true)
    matchTimerRef.current = setTimeout(() => {
      const pairs = []
      const usedJournals = new Set()
      const usedBanks = new Set()

      // Build candidate pairs with scores
      const candidates = []
      for (const bt of transactions) {
        if (bt.matched || confirmedMatches.has(bt.id)) continue
        const btAmount = (bt.debit || 0) - (bt.credit || 0)
        for (const je of journalEntries) {
          if (usedJournals.has(je.id)) continue
          const jeAmount = (je.debit_total || je.amount || 0) - (je.credit_total || 0)

          // Score components
          let score = 0
          let reasons = []

          // Exact amount match (most important)
          if (Math.abs(btAmount - jeAmount) < 1) {
            score += 50
            reasons.push('金額完全相符')
          } else if (Math.abs(Math.abs(btAmount) - Math.abs(jeAmount)) < 1) {
            score += 35
            reasons.push('金額絕對值相符')
          } else if (Math.abs(btAmount - jeAmount) < Math.abs(btAmount) * 0.05) {
            score += 15
            reasons.push('金額接近 (5%)')
          }

          // Date proximity
          const days = daysBetween(bt.transaction_date, je.date || je.entry_date)
          if (days === 0) { score += 30; reasons.push('日期相同') }
          else if (days <= 1) { score += 25; reasons.push('日期相差1天') }
          else if (days <= 3) { score += 15; reasons.push('日期接近') }
          else if (days <= 7) { score += 5; reasons.push('日期7天內') }

          // Description similarity
          const sim = stringSimilarity(bt.description, je.description || je.memo || je.reference)
          if (sim > 0.5) { score += 20; reasons.push('描述相似') }
          else if (sim > 0.2) { score += 10; reasons.push('描述部分相符') }

          if (score >= 30) {
            candidates.push({
              bankId: bt.id,
              journalId: je.id,
              score,
              reasons,
              bankDesc: bt.description,
              journalDesc: je.description || je.memo || je.reference || '-',
              bankDate: bt.transaction_date,
              journalDate: je.date || je.entry_date,
              amount: btAmount,
              jeAmount,
            })
          }
        }
      }

      // Greedy matching: pick highest score pairs, no duplicates
      candidates.sort((a, b) => b.score - a.score)
      for (const c of candidates) {
        if (usedBanks.has(c.bankId) || usedJournals.has(c.journalId)) continue
        usedBanks.add(c.bankId)
        usedJournals.add(c.journalId)
        pairs.push({
          ...c,
          confidence: c.score >= 80 ? '高' : c.score >= 50 ? '中' : '低',
          confidenceScore: c.score,
        })
      }

      setMatchedPairs(pairs)
      setAutoMatched(true)
      setMatching(false)
    }, 600)
  }

  // Confirm all matches
  const handleConfirmAll = async () => {
    const newConfirmed = new Set(confirmedMatches)
    for (const pair of matchedPairs) {
      newConfirmed.add(pair.bankId)
      // Update bank transaction matched status
      try {
        await supabase.from('bank_transactions').update({ matched: true }).eq('id', pair.bankId)
      } catch (e) { /* continue */ }
    }
    setConfirmedMatches(newConfirmed)
    setTransactions(prev => prev.map(t => newConfirmed.has(t.id) ? { ...t, matched: true } : t))
    setMatchedPairs([])
    setAutoMatched(false)
    toast.success('已確認所有比對結果！')
  }

  // Confirm single match
  const handleConfirmSingle = async (pair) => {
    const newConfirmed = new Set(confirmedMatches)
    newConfirmed.add(pair.bankId)
    try {
      await supabase.from('bank_transactions').update({ matched: true }).eq('id', pair.bankId)
    } catch (e) { /* continue */ }
    setConfirmedMatches(newConfirmed)
    setTransactions(prev => prev.map(t => t.id === pair.bankId ? { ...t, matched: true } : t))
    setMatchedPairs(prev => prev.filter(p => p.bankId !== pair.bankId))
  }

  // Remove a suggested match
  const handleRejectMatch = (pair) => {
    setMatchedPairs(prev => prev.filter(p => p.bankId !== pair.bankId))
  }

  // Manual matching
  const handleManualMatch = () => {
    if (!selectedBankId || !selectedJournalId) return
    const bt = transactions.find(t => t.id === selectedBankId)
    const je = journalEntries.find(j => j.id === selectedJournalId)
    if (!bt || !je) return

    const btAmount = (bt.debit || 0) - (bt.credit || 0)
    const jeAmount = (je.debit_total || je.amount || 0) - (je.credit_total || 0)

    const newPair = {
      bankId: bt.id,
      journalId: je.id,
      score: 100,
      confidence: '高',
      confidenceScore: 100,
      reasons: ['手動比對'],
      bankDesc: bt.description,
      journalDesc: je.description || je.memo || je.reference || '-',
      bankDate: bt.transaction_date,
      journalDate: je.date || je.entry_date,
      amount: btAmount,
      jeAmount,
    }

    setMatchedPairs(prev => [...prev.filter(p => p.bankId !== bt.id), newPair])
    setSelectedBankId(null)
    setSelectedJournalId(null)
  }

  // Adjustment entry
  const handleOpenAdjust = (bt) => {
    setAdjustTarget(bt)
    setAdjustForm({
      description: `調整分錄 - ${bt.description || '銀行交易'}`,
      account: '',
    })
    setShowAdjustModal(true)
  }

  const handleCreateAdjustEntry = async () => {
    if (!adjustTarget) return
    if (!adjustForm.description?.trim()) {
      toast.warning('請填寫調整說明')
      return
    }
    const amount = (adjustTarget.debit || 0) - (adjustTarget.credit || 0)
    try {
      const { data, error } = await createJournalEntry({
        date: adjustTarget.transaction_date,
        description: adjustForm.description,
        reference: `ADJ-${adjustTarget.id}`,
        debit_total: amount > 0 ? Math.abs(amount) : 0,
        credit_total: amount < 0 ? Math.abs(amount) : 0,
        status: '草稿',
      })
      if (error) throw error
      if (data) {
        setJournalEntries(prev => [data, ...prev])
        toast.error('調整分錄已建立！')
      }
      setShowAdjustModal(false)
      setAdjustTarget(null)
    } catch (err) {
      console.error('Create adjustment entry failed:', err)
      toast.error('建立調整分錄失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = transactions.filter(t =>
    search === '' || t.description?.includes(search)
  )

  const totalCount = filtered.length
  const matchedCount = filtered.filter(t => t.matched).length
  const unmatchedCount = totalCount - matchedCount
  const pendingMatchCount = matchedPairs.length
  const diffAmount = filtered.filter(t => !t.matched).reduce((sum, t) => sum + ((t.debit || 0) - (t.credit || 0)), 0)

  // Unmatched bank items (not matched in DB and not in pending matches)
  const pendingBankIds = new Set(matchedPairs.map(p => p.bankId))
  const unmatchedBankItems = filtered.filter(t => !t.matched && !pendingBankIds.has(t.id))

  // Unmatched journal entries
  const matchedJournalIds = new Set(matchedPairs.map(p => p.journalId))
  const unmatchedJournals = journalEntries.filter(je => !matchedJournalIds.has(je.id))

  const confidenceColor = (conf) => {
    if (conf === '高') return 'var(--accent-green)'
    if (conf === '中') return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  const rowBg = (t) => {
    if (t.matched) return 'var(--accent-green-dim)'
    if (pendingBankIds.has(t.id)) return 'var(--accent-orange-dim)'
    return undefined
  }

  const rowBorder = (t) => {
    if (t.matched) return '2px solid var(--accent-green)'
    if (pendingBankIds.has(t.id)) return '2px solid var(--accent-orange)'
    return '2px solid transparent'
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏦</span> 銀行對帳</h2>
            <p>銀行交易記錄與帳務比對</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAutoMatch} disabled={matching}>
              <Zap size={14} /> {matching ? '比對中...' : '自動比對'}
            </button>
            {matchedPairs.length > 0 && (
              <button className="btn" style={{ background: 'var(--accent-green)', color: '#fff', border: 'none' }} onClick={handleConfirmAll}>
                <CheckCircle size={14} /> 確認比對 ({matchedPairs.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總筆數</div>
          <div className="stat-card-value">{totalCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已對帳</div>
          <div className="stat-card-value">{matchedCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">建議比對</div>
          <div className="stat-card-value">{pendingMatchCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">未對帳</div>
          <div className="stat-card-value">{unmatchedBankItems.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">差異金額</div>
          <div className="stat-card-value">{fmt(Math.abs(diffAmount))}</div>
        </div>
      </div>

      {/* Auto-match results */}
      {autoMatched && matchedPairs.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Link2 size={16} /></span> 自動比對結果</div>
            <span className="badge badge-warning"><span className="badge-dot"></span>待確認 {matchedPairs.length} 筆</span>
          </div>
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matchedPairs.map((pair, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderRadius: 10, background: 'var(--glass-light)',
                border: `1px solid ${confidenceColor(pair.confidence)}30`,
              }}>
                {/* Bank side */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>銀行交易</div>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair.bankDesc}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pair.bankDate} | {fmt(pair.amount)}</div>
                </div>

                {/* Arrow + confidence */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <ArrowRight size={18} style={{ color: confidenceColor(pair.confidence) }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: confidenceColor(pair.confidence),
                    padding: '1px 6px', borderRadius: 4, background: `${confidenceColor(pair.confidence)}18`,
                  }}>
                    {pair.confidence} ({pair.confidenceScore}%)
                  </span>
                </div>

                {/* Journal side */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>帳務分錄</div>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair.journalDesc}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pair.journalDate} | {fmt(pair.jeAmount)}</div>
                </div>

                {/* Reasons */}
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                  {pair.reasons.map((r, ri) => (
                    <span key={ri} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>{r}</span>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '4px 10px', background: 'var(--accent-green)', color: '#fff', border: 'none' }}
                    onClick={() => handleConfirmSingle(pair)}
                    title="確認比對"
                  >
                    <CheckCircle size={12} />
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '4px 10px', background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
                    onClick={() => handleRejectMatch(pair)}
                    title="移除比對"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {autoMatched && matchedPairs.length === 0 && unmatchedBankItems.length === 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <CheckCircle size={36} style={{ color: 'var(--accent-green)', marginBottom: 8 }} />
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>所有交易已完成對帳</div>
          </div>
        </div>
      )}

      {/* Manual matching section */}
      {autoMatched && unmatchedBankItems.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Link2 size={16} /></span> 手動比對</div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>選擇一筆銀行交易 + 一筆帳務分錄後點擊「配對」</span>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'start' }}>
              {/* Bank side */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--accent-red)' }}>未對帳銀行交易</div>
                <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unmatchedBankItems.map(t => (
                    <div
                      key={t.id}
                      onClick={() => setSelectedBankId(t.id === selectedBankId ? null : t.id)}
                      style={{
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        background: t.id === selectedBankId ? 'var(--accent-cyan-dim)' : 'var(--glass-light)',
                        border: t.id === selectedBankId ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{t.description}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t.transaction_date} | {t.debit ? fmt(t.debit) + ' (借)' : fmt(t.credit) + ' (貸)'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Match button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 30 }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 16px' }}
                  disabled={!selectedBankId || !selectedJournalId}
                  onClick={handleManualMatch}
                >
                  <Link2 size={14} /> 配對
                </button>
              </div>

              {/* Journal side */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--accent-blue)' }}>帳務分錄</div>
                <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unmatchedJournals.slice(0, 20).map(je => (
                    <div
                      key={je.id}
                      onClick={() => setSelectedJournalId(je.id === selectedJournalId ? null : je.id)}
                      style={{
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        background: je.id === selectedJournalId ? 'var(--accent-cyan-dim)' : 'var(--glass-light)',
                        border: je.id === selectedJournalId ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{je.description || je.memo || je.reference || '-'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {je.date || je.entry_date} | {fmt(je.debit_total || je.amount || 0)}
                      </div>
                    </div>
                  ))}
                  {unmatchedJournals.length === 0 && (
                    <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>無可用分錄</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank Transactions Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Landmark size={16} /></span> 交易記錄</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--accent-green-dim)', marginRight: 4, verticalAlign: 'middle' }}></span>已對帳</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--accent-orange-dim)', marginRight: 4, verticalAlign: 'middle' }}></span>建議比對</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--accent-red-dim)', marginRight: 4, verticalAlign: 'middle' }}></span>未對帳</span>
            </div>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋交易..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>交易日期</th><th>說明</th><th>借方</th><th>貸方</th><th>餘額</th><th>對帳狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無交易記錄</td></tr>}
              {filtered.map(t => {
                const isPending = pendingBankIds.has(t.id)
                const isUnmatched = !t.matched && !isPending
                return (
                  <tr key={t.id} style={{
                    background: rowBg(t),
                    borderLeft: rowBorder(t),
                    transition: 'background 0.2s ease',
                  }}>
                    <td>{t.transaction_date}</td>
                    <td style={{ fontWeight: 600 }}>{t.description}</td>
                    <td style={{ color: t.debit ? 'var(--accent-red)' : undefined }}>{t.debit ? fmt(t.debit) : '-'}</td>
                    <td style={{ color: t.credit ? 'var(--accent-green)' : undefined }}>{t.credit ? fmt(t.credit) : '-'}</td>
                    <td>{fmt(t.balance)}</td>
                    <td>
                      {t.matched ? (
                        <span className="badge badge-success"><span className="badge-dot"></span>已對帳</span>
                      ) : isPending ? (
                        <span className="badge badge-warning"><span className="badge-dot"></span>建議比對</span>
                      ) : (
                        <span className="badge badge-danger">
                          <span className="badge-dot"></span>未對帳
                        </span>
                      )}
                    </td>
                    <td>
                      {isUnmatched && (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}
                          onClick={() => handleOpenAdjust(t)}
                        >
                          <FileText size={11} /> 調整分錄
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjustment Entry Modal */}
      {showAdjustModal && adjustTarget && (
        <Modal
          title="建立調整分錄"
          onClose={() => { setShowAdjustModal(false); setAdjustTarget(null) }}
          onSubmit={handleCreateAdjustEntry}
        >
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>對應銀行交易</div>
            <div style={{ fontWeight: 700 }}>{adjustTarget.description}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {adjustTarget.transaction_date} | {adjustTarget.debit ? fmt(adjustTarget.debit) + ' (借方)' : fmt(adjustTarget.credit) + ' (貸方)'}
            </div>
          </div>
          <Field label="分錄說明" required>
            <input
              className="form-input"
              type="text"
              style={{ width: '100%' }}
              value={adjustForm.description}
              onChange={e => setAdjustForm(f => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label="會計科目">
            <input
              className="form-input"
              type="text"
              style={{ width: '100%' }}
              placeholder="例：1101 銀行存款"
              value={adjustForm.account}
              onChange={e => setAdjustForm(f => ({ ...f, account: e.target.value }))}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="借方金額">
              <div className="form-input" style={{ background: 'var(--glass-light)' }}>
                {adjustTarget.debit ? fmt(adjustTarget.debit) : '-'}
              </div>
            </Field>
            <Field label="貸方金額">
              <div className="form-input" style={{ background: 'var(--glass-light)' }}>
                {adjustTarget.credit ? fmt(adjustTarget.credit) : '-'}
              </div>
            </Field>
          </div>
        </Modal>
      )}

      {/* Matching overlay */}
      {matching && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div style={{ background: 'var(--bg-card)', padding: 32, borderRadius: 16, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <LoadingSpinner />
            <p style={{ marginTop: 12, color: 'var(--text-primary)', fontWeight: 600 }}>正在自動比對交易...</p>
          </div>
        </div>
      )}
    </div>
  )
}
