import { useState, useEffect, Fragment } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, Send, Ban } from 'lucide-react'
import { getJournalEntries, getJournalLines, createJournalEntry, createJournalLine } from '../../lib/db'
import { validateJournalEntry, validateJournalBalance, postJournalEntry, CHART_OF_ACCOUNTS } from '../../lib/accounting'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const emptyLine = { account_code: '', account_name: '', description: '', debit: '', credit: '' }

const emptyForm = {
  entry_number: '', entry_date: new Date().toISOString().slice(0, 10),
  description: '', source: '', status: '草稿', created_by: ''
}

export default function JournalEntries() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [lines, setLines] = useState({})
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formLines, setFormLines] = useState([{ ...emptyLine }, { ...emptyLine }])
  const [submitError, setSubmitError] = useState(null)
  const [posting, setPosting] = useState(null)
  const [statusFilter, setStatusFilter] = useState('全部')

  useEffect(() => {
    loadEntries()
  }, [])

  const loadEntries = () => {
    setLoading(true)
    getJournalEntries().then(({ data }) => {
      setEntries(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // -- Form lines helpers --
  const updateLine = (idx, field, value) => {
    setFormLines(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      // Auto-fill account_name when selecting from CHART_OF_ACCOUNTS
      if (field === 'account_code') {
        const acct = CHART_OF_ACCOUNTS.find(a => a.code === value)
        if (acct) next[idx].account_name = acct.name
      }
      return next
    })
  }

  const addLine = () => setFormLines(prev => [...prev, { ...emptyLine }])

  const removeLine = (idx) => {
    if (formLines.length <= 2) return
    setFormLines(prev => prev.filter((_, i) => i !== idx))
  }

  // Real-time validation for the modal
  const linesForValidation = formLines.map(l => ({
    account_code: l.account_code,
    account_name: l.account_name,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
  }))
  const totalDebit = linesForValidation.reduce((s, l) => s + l.debit, 0)
  const totalCredit = linesForValidation.reduce((s, l) => s + l.credit, 0)
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100
  const isBalanced = difference === 0 && totalDebit > 0

  // -- Expand / collapse --
  const toggleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!lines[id]) {
      const { data } = await getJournalLines(id)
      setLines(prev => ({ ...prev, [id]: data || [] }))
    }
  }

  // -- Load lines for a specific entry (force refresh) --
  const loadLines = async (id) => {
    const { data } = await getJournalLines(id)
    setLines(prev => ({ ...prev, [id]: data || [] }))
    return data || []
  }

  // -- Submit new journal entry with lines --
  const handleSubmit = async () => {
    setSubmitError(null)
    if (!form.entry_number) { setSubmitError('請輸入傳票編號'); return }

    const validation = validateJournalEntry(linesForValidation)
    if (!validation.valid) {
      setSubmitError(validation.errors.join('；'))
      return
    }

    try {
      const { data: entry, error: entryErr } = await createJournalEntry({
        entry_number: form.entry_number,
        entry_date: form.entry_date,
        description: form.description,
        source: form.source,
        status: '草稿',
        created_by: form.created_by,
      })
      if (entryErr || !entry) { setSubmitError('建立傳票失敗'); return }

      // Create all journal lines
      for (const line of formLines) {
        const debit = Number(line.debit) || 0
        const credit = Number(line.credit) || 0
        if (debit === 0 && credit === 0) continue
        await createJournalLine({
          entry_id: entry.id,
          account_code: line.account_code,
          account_name: line.account_name,
          description: line.description,
          debit,
          credit,
        })
      }

      // Update local state
      setEntries(prev => [entry, ...prev])
      await loadLines(entry.id)
      setExpanded(entry.id)
      setShowModal(false)
      setForm(emptyForm)
      setFormLines([{ ...emptyLine }, { ...emptyLine }])
    } catch (err) {
      setSubmitError(`發生錯誤：${err.message}`)
    }
  }

  // -- Post (過帳) — 使用會計引擎進行完整過帳（含科目餘額更新）--
  const handlePost = async (entry) => {
    if (entry.status !== '草稿') return
    setPosting(entry.id)

    try {
      // Load lines if not already loaded
      let entryLines = lines[entry.id]
      if (!entryLines) {
        entryLines = await loadLines(entry.id)
      }

      const mappedLines = entryLines.map(l => ({
        account_code: l.account_code,
        account_name: l.account_name,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }))

      // 快速借貸平衡檢查
      const balanceCheck = validateJournalBalance(mappedLines)
      if (!balanceCheck.balanced) {
        alert(`借貸不平衡：借方 ${balanceCheck.totalDebit} / 貸方 ${balanceCheck.totalCredit}`)
        setPosting(null)
        return
      }

      // 使用會計引擎過帳（驗證 + 更新狀態 + 更新科目餘額）
      const result = await postJournalEntry(entry.id, mappedLines, supabase)

      if (!result.success) {
        alert(`無法過帳：${result.errors.join('；')}`)
        setPosting(null)
        return
      }

      // Optimistic UI update
      setEntries(prev => prev.map(e =>
        e.id === entry.id ? { ...e, status: '已過帳' } : e
      ))
    } catch (err) {
      alert(`過帳時發生錯誤：${err.message}`)
    } finally {
      setPosting(null)
    }
  }

  // -- Void (作廢) — creates a reversing entry --
  const handleVoid = async (entry) => {
    if (entry.status !== '已過帳') return
    if (!window.confirm(`確定要作廢傳票 ${entry.entry_number}？\n系統將自動產生沖銷傳票。`)) return

    try {
      let entryLines = lines[entry.id]
      if (!entryLines) {
        entryLines = await loadLines(entry.id)
      }

      // Mark original as voided
      await supabase.from('journal_entries')
        .update({ status: '已作廢' })
        .eq('id', entry.id)

      // Create reversing entry
      const reversalNumber = `${entry.entry_number}-REV`
      const { data: reversal } = await createJournalEntry({
        entry_number: reversalNumber,
        entry_date: new Date().toISOString().slice(0, 10),
        description: `沖銷：${entry.description || entry.entry_number}`,
        source: '沖銷',
        status: '已過帳',
        created_by: entry.created_by,
      })

      if (reversal) {
        // Create reversed lines (swap debit and credit)
        for (const line of entryLines) {
          await createJournalLine({
            entry_id: reversal.id,
            account_code: line.account_code,
            account_name: line.account_name,
            description: `沖銷 ${entry.entry_number}`,
            debit: Number(line.credit) || 0,
            credit: Number(line.debit) || 0,
          })
        }
      }

      // Refresh all entries
      const { data: refreshed } = await getJournalEntries()
      setEntries(refreshed || [])
      // Clear cached lines so they reload
      setLines({})
      setExpanded(null)
    } catch (err) {
      alert(`作廢失敗：${err.message}`)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const totalEntries = entries.length
  const posted = entries.filter(e => e.status === '已過帳').length
  const drafts = entries.filter(e => e.status === '草稿').length
  const voided = entries.filter(e => e.status === '已作廢').length

  const filteredEntries = statusFilter === '全部'
    ? entries
    : entries.filter(e => e.status === statusFilter)

  const statusBadge = (status) => {
    if (status === '已過帳') return <span className="badge badge-success"><span className="badge-dot"></span>{status}</span>
    if (status === '草稿') return <span className="badge badge-warning"><span className="badge-dot"></span>{status}</span>
    if (status === '已作廢') return <span className="badge badge-danger"><span className="badge-dot"></span>{status}</span>
    return <span className="badge badge-info"><span className="badge-dot"></span>{status}</span>
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📒</span> 傳票管理</h2>
            <p>會計傳票與分錄管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增傳票</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總傳票數</div>
          <div className="stat-card-value">{totalEntries}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已過帳</div>
          <div className="stat-card-value">{posted}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">草稿</div>
          <div className="stat-card-value">{drafts}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已作廢</div>
          <div className="stat-card-value">{voided}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 傳票列表</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>狀態篩選：</label>
            <select
              className="form-input"
              style={{ fontSize: 12, padding: '4px 8px', minWidth: 100 }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="全部">全部</option>
              <option value="草稿">草稿</option>
              <option value="已過帳">已過帳</option>
              <option value="已作廢">已作廢</option>
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>點擊列展開分錄明細</span>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>傳票編號</th>
                <th>日期</th>
                <th>說明</th>
                <th>來源</th>
                <th>狀態</th>
                <th>建立者</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{statusFilter === '全部' ? '尚無傳票資料' : `無「${statusFilter}」狀態的傳票`}</td></tr>}
              {filteredEntries.map(e => {
                const isExpanded = expanded === e.id
                const entryLines = lines[e.id] || []
                const entryTotalDebit = entryLines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
                const entryTotalCredit = entryLines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
                return (
                  <Fragment key={e.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(e.id)}>
                      <td style={{ width: 32 }}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td style={{ fontWeight: 600 }}>{e.entry_number}</td>
                      <td>{e.entry_date}</td>
                      <td>{e.description || '-'}</td>
                      <td>{e.source || '-'}</td>
                      <td>{statusBadge(e.status)}</td>
                      <td>{e.created_by || '-'}</td>
                      <td onClick={ev => ev.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {e.status === '草稿' && (
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                              disabled={posting === e.id}
                              onClick={() => handlePost(e)}
                              title="過帳"
                            >
                              <Send size={12} /> 過帳
                            </button>
                          )}
                          {e.status === '已過帳' && (
                            <button
                              className="btn"
                              style={{ fontSize: 12, padding: '4px 10px', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }}
                              onClick={() => handleVoid(e)}
                              title="作廢"
                            >
                              <Ban size={12} /> 作廢
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ background: 'var(--glass-light)', padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📐 分錄明細</div>
                            {entryLines.length === 0 ? (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>尚無分錄</div>
                            ) : (
                              <table className="data-table" style={{ fontSize: 13 }}>
                                <thead>
                                  <tr>
                                    <th>科目代碼</th>
                                    <th>科目名稱</th>
                                    <th>摘要</th>
                                    <th style={{ textAlign: 'right', color: 'var(--accent-green)' }}>借方</th>
                                    <th style={{ textAlign: 'right', color: 'var(--accent-red)' }}>貸方</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entryLines.map(l => (
                                    <tr key={l.id}>
                                      <td>{l.account_code || '-'}</td>
                                      <td>{l.account_name || '-'}</td>
                                      <td>{l.description || '-'}</td>
                                      <td style={{ textAlign: 'right', color: 'var(--accent-green)', fontWeight: 600 }}>
                                        {(Number(l.debit) || 0) > 0 ? fmt(Number(l.debit)) : ''}
                                      </td>
                                      <td style={{ textAlign: 'right', color: 'var(--accent-red)', fontWeight: 600 }}>
                                        {(Number(l.credit) || 0) > 0 ? fmt(Number(l.credit)) : ''}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                                    <td colSpan={3} style={{ textAlign: 'right' }}>合計</td>
                                    <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>
                                      {fmt(entryTotalDebit)}
                                    </td>
                                    <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>
                                      {fmt(entryTotalCredit)}
                                    </td>
                                  </tr>
                                  {Math.round((entryTotalDebit - entryTotalCredit) * 100) / 100 !== 0 && (
                                    <tr>
                                      <td colSpan={3} style={{ textAlign: 'right', color: 'var(--accent-red)', fontWeight: 600 }}>差額</td>
                                      <td colSpan={2} style={{ textAlign: 'right', color: 'var(--accent-red)', fontWeight: 700 }}>
                                        {fmt(Math.abs(entryTotalDebit - entryTotalCredit))}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Enhanced Create Modal ── */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--bg-modal-overlay)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowModal(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="新增傳票"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              borderRadius: 16,
              width: '100%', maxWidth: 780,
              maxHeight: '90vh', overflowY: 'auto',
              boxShadow: 'var(--shadow-xl)',
              animation: 'fadeIn 0.15s ease',
            }} onClick={ev => ev.stopPropagation()}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>新增傳票</h3>
              <button className="btn" style={{ padding: 4 }} onClick={() => { setShowModal(false); setSubmitError(null) }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Entry header fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="傳票編號 *">
                  <input className="form-input" style={{ width: '100%' }} value={form.entry_number} onChange={e => set('entry_number', e.target.value)} placeholder="JE-2026-001" />
                </Field>
                <Field label="日期">
                  <input className="form-input" type="date" style={{ width: '100%' }} value={form.entry_date} onChange={e => set('entry_date', e.target.value)} />
                </Field>
              </div>
              <Field label="說明">
                <input className="form-input" style={{ width: '100%' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="傳票說明" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="來源">
                  <input className="form-input" style={{ width: '100%' }} value={form.source} onChange={e => set('source', e.target.value)} placeholder="例：銷售、採購" />
                </Field>
                <Field label="建立者">
                  <input className="form-input" style={{ width: '100%' }} value={form.created_by} onChange={e => set('created_by', e.target.value)} placeholder="姓名" />
                </Field>
              </div>

              {/* Journal lines section */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>📐 分錄明細</div>
                  <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addLine}>
                    <Plus size={12} /> 新增行
                  </button>
                </div>

                <table className="data-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 180 }}>會計科目</th>
                      <th>摘要</th>
                      <th style={{ width: 120, textAlign: 'right' }}>借方</th>
                      <th style={{ width: 120, textAlign: 'right' }}>貸方</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map((line, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            className="form-input"
                            style={{ width: '100%', fontSize: 12 }}
                            value={line.account_code}
                            onChange={e => updateLine(idx, 'account_code', e.target.value)}
                          >
                            <option value="">選擇科目</option>
                            {CHART_OF_ACCOUNTS.map(a => (
                              <option key={a.code} value={a.code}>{a.code} {a.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="form-input"
                            style={{ width: '100%', fontSize: 12 }}
                            value={line.description}
                            onChange={e => updateLine(idx, 'description', e.target.value)}
                            placeholder="摘要"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            style={{ width: '100%', fontSize: 12, textAlign: 'right' }}
                            value={line.debit}
                            onChange={e => updateLine(idx, 'debit', e.target.value)}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            style={{ width: '100%', fontSize: 12, textAlign: 'right' }}
                            value={line.credit}
                            onChange={e => updateLine(idx, 'credit', e.target.value)}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <button
                            className="btn"
                            style={{ padding: 4, color: 'var(--accent-red)', opacity: formLines.length <= 2 ? 0.3 : 1 }}
                            disabled={formLines.length <= 2}
                            onClick={() => removeLine(idx)}
                            title="刪除此行"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Running totals / balance indicator */}
                <div style={{
                  marginTop: 12,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: isBalanced ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${isBalanced ? 'var(--accent-green)' : 'var(--accent-red)'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <span>借方合計：<span style={{ color: 'var(--accent-green)' }}>{fmt(totalDebit)}</span></span>
                    <span>貸方合計：<span style={{ color: 'var(--accent-red)' }}>{fmt(totalCredit)}</span></span>
                  </div>
                  <div style={{ color: isBalanced ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {isBalanced
                      ? '✓ 借貸平衡'
                      : `✗ 差額 ${fmt(Math.abs(difference))}`
                    }
                  </div>
                </div>
              </div>

              {/* Error message */}
              {submitError && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)', fontSize: 13 }}>
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}>
              <button className="btn" onClick={() => { setShowModal(false); setSubmitError(null) }}>取消</button>
              <button
                className="btn btn-primary"
                disabled={!isBalanced}
                style={{ opacity: isBalanced ? 1 : 0.5 }}
                onClick={handleSubmit}
              >
                儲存傳票
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
