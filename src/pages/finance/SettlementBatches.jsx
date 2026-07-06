import { useState, useEffect, useCallback, useMemo } from 'react'
import { CreditCard, PlusCircle, CheckCircle, Landmark } from 'lucide-react'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import Badge from '../../components/ui/Badge'
import { toast } from '../../lib/toast'
import { fmtNT as fmt } from '../../lib/currency'
import {
  getSettlementBatches,
  getUnassignedCardPayments,
  createTodayBatch,
  closeSettlementBatch,
  computeSettlementNet,
} from '../../lib/db/settlement'

const STATUS_META = {
  open:      { label: '開放中', status: 'info' },
  submitted: { label: '已送件', status: 'warning' },
  settled:   { label: '已結算', status: 'success' },
}

/**
 * 信用卡請款批次（F-D1 中國信託收單）
 * - 建立今日批次：把未歸批的中信卡收（ctbc_edc / ctbc_online）掛入批次
 * - 結算批次：輸入手續費 + 入帳日 → secure_close_settlement_batch RPC
 *   （淨額 = 總額 − 手續費；結算後發 finance.settlement.fee 事件供拋轉引擎）
 */
export default function SettlementBatches() {
  const orgId = useOrgId()
  const [batches, setBatches] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  // 結算 modal
  const [closeTarget, setCloseTarget] = useState(null) // 批次列
  const [feeInput, setFeeInput] = useState('')
  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [closing, setClosing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, u] = await Promise.all([
        getSettlementBatches(orgId),
        getUnassignedCardPayments(orgId),
      ])
      if (b.error) throw b.error
      setBatches(b.data ?? [])
      setUnassigned(u.data ?? [])
    } catch (err) {
      console.error('Failed to load settlement batches:', err)
      toast.error('請款批次載入失敗：' + (err.message || '未知錯誤'))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const handleCreateToday = async () => {
    setCreating(true)
    try {
      const result = await createTodayBatch({ organizationId: orgId })
      if (!result.batch) {
        toast.warning(result.message || '目前沒有未歸批的卡收付款')
      } else {
        toast.success(`已建立/更新批次 ${result.batch.batch_number}（掛入 ${result.assigned} 筆卡收）`)
      }
      await load()
    } catch (err) {
      toast.error('建立批次失敗：' + (err.message || '未知錯誤'))
    } finally {
      setCreating(false)
    }
  }

  const openCloseModal = (batch) => {
    setCloseTarget(batch)
    setFeeInput('')
    setDepositDate(new Date().toISOString().slice(0, 10))
  }

  // 淨額試算（輸入不合法時顯示 —）
  const netPreview = useMemo(() => {
    if (!closeTarget || feeInput === '') return null
    try {
      return computeSettlementNet(closeTarget.gross_amount, Number(feeInput))
    } catch {
      return null
    }
  }, [closeTarget, feeInput])

  const handleCloseBatch = async () => {
    if (!closeTarget) return
    const fee = Number(feeInput)
    if (feeInput === '' || !Number.isFinite(fee) || fee < 0) {
      toast.warning('請輸入正確的手續費（不可為負）')
      return
    }
    if (fee > Number(closeTarget.gross_amount)) {
      toast.warning('手續費不可大於批次總額')
      return
    }
    setClosing(true)
    try {
      const batch = await closeSettlementBatch({
        batchId: closeTarget.id,
        feeAmount: fee,
        depositDate: depositDate || null,
      })
      toast.success(`批次 ${batch?.batch_number ?? ''} 已結算，入帳淨額 ${fmt(batch?.net_amount ?? 0)}`)
      setCloseTarget(null)
      await load()
    } catch (err) {
      toast.error('結算失敗：' + (err.message || '未知錯誤'))
    } finally {
      setClosing(false)
    }
  }

  if (loading) return <LoadingSpinner />

  const unassignedTotal = unassigned.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const openCount = batches.filter(b => b.status !== 'settled').length
  const settledNet = batches
    .filter(b => b.status === 'settled')
    .reduce((s, b) => s + (Number(b.net_amount) || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💳</span> 信用卡請款批次</h2>
            <p>中國信託收單 — 日終請款、手續費認列與入帳對帳</p>
          </div>
          <button className="btn btn-primary" onClick={handleCreateToday} disabled={creating}>
            <PlusCircle size={14} /> {creating ? '建立中...' : '建立今日批次'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">未歸批卡收</div>
          <div className="stat-card-value">{unassigned.length} 筆</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">未歸批金額</div>
          <div className="stat-card-value">{fmt(unassignedTotal)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">未結算批次</div>
          <div className="stat-card-value">{openCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已結算入帳淨額</div>
          <div className="stat-card-value">{fmt(settledNet)}</div>
        </div>
      </div>

      {/* Batch table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><CreditCard size={16} /></span> 請款批次</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            結算後由拋轉引擎認列手續費（借 手續費支出／貸 應收卡款），入帳可於銀行對帳自動比對
          </span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>批次號</th><th>批次日</th><th>收單行</th>
                <th style={{ textAlign: 'right' }}>總額</th>
                <th style={{ textAlign: 'right' }}>手續費</th>
                <th style={{ textAlign: 'right' }}>入帳淨額</th>
                <th>入帳日</th><th>狀態</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無請款批次 — 點「建立今日批次」把未歸批卡收掛入</td></tr>
              )}
              {batches.map(b => {
                const meta = STATUS_META[b.status] ?? { label: b.status, status: 'info' }
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.batch_number}</td>
                    <td>{b.batch_date}</td>
                    <td>{b.acquirer}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(b.gross_amount)}</td>
                    <td style={{ textAlign: 'right', color: b.fee_amount != null ? 'var(--accent-red)' : undefined }}>
                      {b.fee_amount != null ? fmt(b.fee_amount) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {b.net_amount != null ? fmt(b.net_amount) : '—'}
                    </td>
                    <td>{b.deposit_date ?? '—'}</td>
                    <td><Badge status={meta.status} dot>{meta.label}</Badge></td>
                    <td>
                      {b.status !== 'settled' && (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-green-dim)', color: 'var(--accent-green)', border: '1px solid var(--accent-green)' }}
                          onClick={() => openCloseModal(b)}
                        >
                          <CheckCircle size={11} /> 結算
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

      {/* 結算 Modal */}
      {closeTarget && (
        <Modal
          title={`結算批次 ${closeTarget.batch_number}`}
          onClose={() => setCloseTarget(null)}
          onSubmit={handleCloseBatch}
          submitLabel={closing ? '結算中...' : '確認結算'}
          submitDisabled={closing}
        >
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', marginBottom: 12, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>批次總額（卡收明細合計）</span>
              <span style={{ fontWeight: 700 }}>{fmt(closeTarget.gross_amount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}><Landmark size={12} style={{ verticalAlign: 'middle' }} /> 入帳淨額試算</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>
                {netPreview != null ? fmt(netPreview) : '—'}
              </span>
            </div>
          </div>
          <Field label="手續費" required>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              style={{ width: '100%' }}
              placeholder="中信請款單上的手續費金額"
              value={feeInput}
              onChange={e => setFeeInput(e.target.value)}
            />
          </Field>
          <Field label="入帳日">
            <input
              className="form-input"
              type="date"
              style={{ width: '100%' }}
              value={depositDate}
              onChange={e => setDepositDate(e.target.value)}
            />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            結算後狀態轉為「已結算」且不可重複結算；手續費將發布 finance.settlement.fee
            事件由傳票拋轉引擎認列，入帳金額可於「銀行對帳」自動比對。
          </div>
        </Modal>
      )}
    </div>
  )
}
