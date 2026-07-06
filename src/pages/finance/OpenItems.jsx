import { useMemo, useState } from 'react'
import { Scale, Plus, ArrowLeftRight, X } from 'lucide-react'
import { ModalOverlay } from '../../components/Modal'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getOpenItems } from '../../lib/db/openItems'
import {
  OPEN_ITEM_TYPES, OPEN_ITEM_DEFAULT_ACCOUNTS,
  createOpenItem, settleOpenItem, getOpenItemBalance, agingDays, agingBucket,
} from '../../lib/accounting'
import { useDbQuery } from '../../lib/hooks/useDbQuery'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'
import { fmtNT as fmt } from '../../lib/currency'

// F-A3 立沖帳：預收付/暫收付 立帳 → 部分/全額沖銷（傳票由 RPC 端自動拋轉）

const STATUS_BADGE = {
  '未沖':   { status: 'warning' },
  '部分沖': { status: 'info' },
  '已沖':   { status: 'success' },
}

const TYPE_COLOR = { '預收': 'cyan', '預付': 'purple', '暫收': 'blue', '暫付': 'orange' }

const inputStyle = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)',
}

const emptyForm = {
  itemType: '預收', amount: '', accountCode: OPEN_ITEM_DEFAULT_ACCOUNTS['預收'],
  partyType: '客戶', partyName: '', memo: '',
}

export default function OpenItems() {
  const orgId = useOrgId()
  const [tab, setTab] = useState('全部')
  const [creating, setCreating] = useState(null)   // form 物件
  const [settling, setSettling] = useState(null)   // { item, amount, docType, docId }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { data: items = [], isLoading, refetch } = useDbQuery(
    ['org', orgId, 'openItems'],
    () => getOpenItems(orgId).then(r => { if (r.error) throw r.error; return r.data ?? [] }),
    { enabled: !!orgId },
  )

  const shown = useMemo(
    () => (tab === '全部' ? items : items.filter(i => i.item_type === tab)),
    [items, tab],
  )

  const openCreate = () => { setError(null); setCreating({ ...emptyForm }) }
  const setForm = (key, value) => setCreating(f => {
    const next = { ...f, [key]: value }
    // 換類型時帶入預設科目（使用者已改過就不動）
    if (key === 'itemType' && (f.accountCode === OPEN_ITEM_DEFAULT_ACCOUNTS[f.itemType] || !f.accountCode)) {
      next.accountCode = OPEN_ITEM_DEFAULT_ACCOUNTS[value]
    }
    return next
  })

  const handleCreate = async () => {
    setError(null)
    setBusy(true)
    try {
      await createOpenItem({
        itemType: creating.itemType,
        amount: Number(creating.amount),
        accountCode: creating.accountCode || undefined,
        partyType: creating.partyType || undefined,
        partyName: creating.partyName || undefined,
        memo: creating.memo || undefined,
      })
      setCreating(null)
      refetch()
    } catch (err) {
      setError(err.message)
      logger.error('[OpenItems] 立帳失敗', { error: err.message })
    } finally {
      setBusy(false)
    }
  }

  const openSettle = (item) => {
    setError(null)
    setSettling({ item, amount: String(getOpenItemBalance(item)), docType: '', docId: '' })
  }

  const handleSettle = async () => {
    setError(null)
    setBusy(true)
    try {
      await settleOpenItem(settling.item.id, Number(settling.amount), {
        settleDocType: settling.docType || undefined,
        settleDocId: settling.docId || undefined,
      })
      setSettling(null)
      refetch()
    } catch (err) {
      setError(err.message)
      logger.error('[OpenItems] 沖銷失敗', { error: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <PageHeader
        icon={Scale}
        title="立沖帳"
        description="Open Items — 預收/預付/暫收/暫付 立帳與沖銷，傳票自動拋轉（F-A3）"
        actions={<Button variant="primary" icon={Plus} onClick={openCreate}>立帳</Button>}
      />

      {error && !creating && !settling && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* 類型分頁 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['全部', ...OPEN_ITEM_TYPES].map(t => (
          <Button key={t} size="sm" variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
            {t}
            {t !== '全部' && (
              <span style={{ marginLeft: 4, fontSize: 12, opacity: 0.8 }}>
                {items.filter(i => i.item_type === t && i.status !== '已沖').length}
              </span>
            )}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Scale} title="尚無立沖單" description="點「立帳」建立預收/預付/暫收/暫付款項" />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>類型</th>
                <th>科目</th>
                <th>對象</th>
                <th style={{ textAlign: 'right' }}>立帳金額</th>
                <th style={{ textAlign: 'right' }}>已沖</th>
                <th style={{ textAlign: 'right' }}>未沖餘額</th>
                <th>帳齡</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(item => {
                const balance = getOpenItemBalance(item)
                const days = agingDays(item)
                const bucket = agingBucket(days)
                return (
                  <tr key={item.id}>
                    <td><Badge color={TYPE_COLOR[item.item_type]} size="sm">{item.item_type}</Badge></td>
                    <td style={{ fontFamily: 'monospace' }}>{item.account_code}</td>
                    <td>
                      {item.party_name || '-'}
                      {item.party_type && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--text-muted)' }}>{item.party_type}</span>}
                      {item.memo && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.memo}</div>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.amount)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.settled_amount)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(balance)}</td>
                    <td>
                      <span style={{ fontFamily: 'monospace' }}>{days} 天</span>
                      {item.status !== '已沖' && bucket === '90+' && (
                        <Badge status="error" size="sm">逾 90 天</Badge>
                      )}
                      {item.status !== '已沖' && bucket === '61-90' && (
                        <Badge status="warning" size="sm">61-90 天</Badge>
                      )}
                    </td>
                    <td><Badge {...STATUS_BADGE[item.status]} dot size="sm">{item.status}</Badge></td>
                    <td>
                      {item.status !== '已沖' && (
                        <Button variant="secondary" size="xs" icon={ArrowLeftRight} onClick={() => openSettle(item)}>沖銷</Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 立帳 modal */}
      {creating && (
        <ModalOverlay onClose={() => setCreating(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 460, maxWidth: '95vw', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>立沖立帳</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setCreating(null)}><X size={20} /></button>
            </div>
            {error && (
              <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '6px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>
            )}
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>類型
                <select value={creating.itemType} onChange={e => setForm('itemType', e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                  {OPEN_ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>金額
                <input type="number" min="0" value={creating.amount} onChange={e => setForm('amount', e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>立沖科目
                <input type="text" value={creating.accountCode} onChange={e => setForm('accountCode', e.target.value)}
                  style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>對象類型
                  <select value={creating.partyType} onChange={e => setForm('partyType', e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                    {['客戶', '供應商', '員工'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, fontWeight: 600 }}>對象名稱
                  <input type="text" value={creating.partyName} onChange={e => setForm('partyName', e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
                </label>
              </div>
              <label style={{ fontSize: 13, fontWeight: 600 }}>備註
                <input type="text" value={creating.memo} onChange={e => setForm('memo', e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Button variant="secondary" onClick={() => setCreating(null)}>取消</Button>
              <Button variant="primary" onClick={handleCreate} loading={busy} disabled={!(Number(creating.amount) > 0)}>
                立帳並拋轉傳票
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* 沖銷 modal */}
      {settling && (
        <ModalOverlay onClose={() => setSettling(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 460, maxWidth: '95vw', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>沖銷 — {settling.item.item_type}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setSettling(null)}><X size={20} /></button>
            </div>
            {error && (
              <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '6px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>
            )}
            <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13, display: 'grid', gap: 4 }}>
              <div>立帳金額：<span style={{ fontFamily: 'monospace' }}>{fmt(settling.item.amount)}</span></div>
              <div>已沖金額：<span style={{ fontFamily: 'monospace' }}>{fmt(settling.item.settled_amount)}</span></div>
              <div style={{ fontWeight: 600 }}>未沖餘額：<span style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>{fmt(getOpenItemBalance(settling.item))}</span></div>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>本次沖銷金額（可部分沖銷）
                <input type="number" min="0" value={settling.amount}
                  onChange={e => setSettling(s => ({ ...s, amount: e.target.value }))}
                  style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              {Number(settling.amount) > getOpenItemBalance(settling.item) && (
                <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '6px 12px', borderRadius: 8, fontSize: 13 }}>
                  沖銷金額超過未沖餘額
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>沖銷單據類型
                  <input type="text" placeholder="例：wms.shipment" value={settling.docType}
                    onChange={e => setSettling(s => ({ ...s, docType: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace' }} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600 }}>沖銷單據編號
                  <input type="text" placeholder="例：SHIP-001" value={settling.docId}
                    onChange={e => setSettling(s => ({ ...s, docId: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace' }} />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Button variant="secondary" onClick={() => setSettling(null)}>取消</Button>
              <Button variant="primary" onClick={handleSettle} loading={busy}
                disabled={!(Number(settling.amount) > 0) || Number(settling.amount) > getOpenItemBalance(settling.item)}>
                沖銷並拋轉傳票
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
