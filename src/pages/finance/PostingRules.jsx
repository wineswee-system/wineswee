import { useMemo, useState } from 'react'
import { BookOpenCheck, Plus, Trash2, Edit3, X, Calculator, RotateCcw } from 'lucide-react'
import { ModalOverlay } from '../../components/Modal'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getPostingRules, saveOrgPostingRule, deletePostingRule, getAccounts } from '../../lib/db'
import { POSTING_DOC_TYPES, previewVoucher, clearRuleCache } from '../../lib/accounting'
import { useDbQuery } from '../../lib/hooks/useDbQuery'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'
import { confirm } from '../../lib/confirm'
import { fmtNT as fmt } from '../../lib/currency'

const SAMPLE_PAYLOADS = {
  sales_shipment:       { total: 105000, tax: 5000, store_id: 'S01' },
  sales_return:         { total: 10500, tax: 500, store_id: 'S01' },
  purchase_receipt:     { total: 52500, tax: 2500, warehouse_id: 'WH1' },
  purchase_return:      { total: 10500, tax: 500, warehouse_id: 'WH1' },
  payment_received:     { amount: 105000, store_id: 'S01' },
  payment_made:         { amount: 52500, store_id: 'S01' },
  inventory_count:      { amount: 3200, warehouse_id: 'WH1' },
  payroll_monthly:      { gross: 380000, net: 322000, department: 'OPS' },
  depreciation_monthly: { amount: 12500, cost_center: 'CC-HQ' },
  open_item_settle:     { amount: 20000, store_id: 'S01' },
}

const emptyLine = { account_code: '', account_name: '', side: 'debit', amount_expr: '', cost_center_from: '' }

export default function PostingRules() {
  const orgId = useOrgId()
  const [editing, setEditing] = useState(null)   // { docType, templateName, lines, isActive, isGlobal, ruleId }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [payloadText, setPayloadText] = useState('')
  const [preview, setPreview] = useState(null)

  const { data: rules = [], isLoading, refetch } = useDbQuery(
    ['org', orgId, 'postingRules'],
    () => getPostingRules(orgId).then(r => { if (r.error) throw r.error; return r.data ?? [] }),
    { enabled: !!orgId },
  )
  const { data: accounts = [] } = useDbQuery(
    ['org', orgId, 'accounts'],
    () => getAccounts(orgId).then(r => { if (r.error) throw r.error; return r.data ?? [] }),
    { enabled: !!orgId },
  )

  // 有效規則：同 (doc_type, template_name) 組織列覆寫全域列
  const effectiveRules = useMemo(() => {
    const map = new Map()
    for (const r of rules) {
      const key = `${r.doc_type}::${r.template_name || 'default'}`
      const prev = map.get(key)
      if (!prev || (prev.organization_id == null && r.organization_id != null)) map.set(key, r)
    }
    return [...map.values()].sort((a, b) =>
      a.doc_type === b.doc_type
        ? (a.template_name || '').localeCompare(b.template_name || '')
        : a.doc_type.localeCompare(b.doc_type))
  }, [rules])

  const openEditor = (rule) => {
    setError(null)
    setPreview(null)
    setEditing({
      docType: rule.doc_type,
      templateName: rule.template_name || 'default',
      isActive: rule.is_active !== false,
      lines: (rule.lines || []).map(l => ({ ...emptyLine, ...l })),
      isGlobal: rule.organization_id == null,
      ruleId: rule.id,
    })
    setPayloadText(JSON.stringify(SAMPLE_PAYLOADS[rule.doc_type] || { amount: 1000 }, null, 2))
  }

  const setLine = (i, key, value) => {
    setEditing(e => {
      const lines = e.lines.map((l, idx) => {
        if (idx !== i) return l
        const next = { ...l, [key]: value }
        if (key === 'account_code') {
          const acct = accounts.find(a => a.code === value)
          if (acct) next.account_name = acct.name
        }
        return next
      })
      return { ...e, lines }
    })
    setPreview(null)
  }

  const runPreview = () => {
    setError(null)
    let payload
    try {
      payload = JSON.parse(payloadText || '{}')
    } catch {
      setError('樣本資料不是合法 JSON')
      return
    }
    setPreview(previewVoucher({ lines: editing.lines }, payload, accounts.length ? { accounts } : {}))
  }

  const handleToggle = async (rule) => {
    setError(null)
    const { error: err } = await saveOrgPostingRule(orgId, rule.doc_type, rule.template_name, {
      lines: rule.lines,
      is_active: !(rule.is_active !== false),
    })
    if (err) { setError(err.message); logger.error('[PostingRules] 切換規則失敗', { error: err.message }); return }
    clearRuleCache()
    refetch()
  }

  const handleSave = async () => {
    setError(null)
    const invalid = validateLines(editing.lines)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    const { error: err } = await saveOrgPostingRule(orgId, editing.docType, editing.templateName, {
      lines: editing.lines,
      is_active: editing.isActive,
    })
    setSaving(false)
    if (err) { setError(err.message); logger.error('[PostingRules] 儲存規則失敗', { error: err.message }); return }
    clearRuleCache()
    setEditing(null)
    refetch()
  }

  // 刪除組織覆寫 → 回落全域預設
  const handleResetToDefault = async (rule) => {
    if (rule.organization_id == null) return
    if (!(await confirm({ message: '刪除組織自訂規則並回復全域預設？' }))) return
    const { error: err } = await deletePostingRule(rule.id)
    if (err) { setError(err.message); return }
    clearRuleCache()
    refetch()
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <PageHeader
        icon={BookOpenCheck}
        title="傳票自動拋轉規則"
        description="Posting Rules — 單據→傳票的借貸模板、啟停與試算預覽（F-A2）"
      />

      {error && !editing && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {effectiveRules.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="尚無拋轉規則"
          description="套用 migration 後會載入 10 種單據類型的全域預設模板"
        />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>單據類型</th>
                <th>模板</th>
                <th>來源</th>
                <th>分錄行</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {effectiveRules.map(rule => {
                const active = rule.is_active !== false
                return (
                  <tr key={`${rule.doc_type}::${rule.template_name}`}>
                    <td style={{ fontWeight: 600 }}>
                      {POSTING_DOC_TYPES[rule.doc_type] || rule.doc_type}
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{rule.doc_type}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{rule.template_name || 'default'}</td>
                    <td>
                      {rule.organization_id == null
                        ? <Badge color="gray" size="sm">全域預設</Badge>
                        : <Badge color="cyan" size="sm">組織自訂</Badge>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                        {(rule.lines || []).map((l, i) => (
                          <span key={i} style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                            {l.side === 'debit' ? '借' : '貸'} {l.account_code} {l.account_name} = {l.amount_expr}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Badge status={active ? 'success' : 'error'} dot size="sm">{active ? '啟用' : '停用'}</Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button variant="secondary" size="xs" onClick={() => handleToggle(rule)}>
                          {active ? '停用' : '啟用'}
                        </Button>
                        <Button variant="secondary" size="xs" icon={Edit3} onClick={() => openEditor(rule)}>編輯/試算</Button>
                        {rule.organization_id != null && (
                          <Button variant="ghost" size="xs" icon={RotateCcw} onClick={() => handleResetToDefault(rule)}>回復預設</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ModalOverlay onClose={() => setEditing(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 760, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>
                編輯拋轉規則 — {POSTING_DOC_TYPES[editing.docType] || editing.docType}
                <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{editing.templateName}</span>
              </h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setEditing(null)}><X size={20} /></button>
            </div>

            {editing.isGlobal && (
              <div style={{ background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', padding: '6px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                此為全域預設模板 — 儲存後會建立組織自訂覆寫，不影響其他組織
              </div>
            )}
            {error && (
              <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '6px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>
            )}

            {/* 分錄行編輯 */}
            <table className="data-table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 220 }}>科目</th>
                  <th style={{ width: 90 }}>借/貸</th>
                  <th>金額運算式</th>
                  <th style={{ width: 140 }}>成本中心來源鍵</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {editing.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.account_code} onChange={e => setLine(i, 'account_code', e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}>
                        <option value="">— 選擇科目 —</option>
                        {!accounts.some(a => a.code === l.account_code) && l.account_code && (
                          <option value={l.account_code}>{l.account_code} {l.account_name}（不在科目表）</option>
                        )}
                        {accounts.map(a => (
                          <option key={a.code} value={a.code}>{a.code} {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={l.side} onChange={e => setLine(i, 'side', e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}>
                        <option value="debit">借</option>
                        <option value="credit">貸</option>
                      </select>
                    </td>
                    <td>
                      <input type="text" value={l.amount_expr} onChange={e => setLine(i, 'amount_expr', e.target.value)}
                        placeholder="total ｜ total-tax ｜ total*0.05"
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'monospace' }} />
                    </td>
                    <td>
                      <input type="text" value={l.cost_center_from || ''} onChange={e => setLine(i, 'cost_center_from', e.target.value)}
                        placeholder="store_id"
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'monospace' }} />
                    </td>
                    <td>
                      <button onClick={() => { setEditing(e => ({ ...e, lines: e.lines.filter((_, idx) => idx !== i) })); setPreview(null) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <Button variant="secondary" size="sm" icon={Plus}
                onClick={() => { setEditing(e => ({ ...e, lines: [...e.lines, { ...emptyLine }] })); setPreview(null) }}>
                新增分錄行
              </Button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <input type="checkbox" checked={editing.isActive} onChange={e => setEditing(ed => ({ ...ed, isActive: e.target.checked }))} />
                啟用此規則
              </label>
            </div>

            {/* 試算預覽 */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>樣本單據資料（JSON）</label>
                  <textarea value={payloadText} onChange={e => { setPayloadText(e.target.value); setPreview(null) }} rows={6}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13 }} />
                </div>
                <div style={{ paddingTop: 22 }}>
                  <Button variant="primary" size="sm" icon={Calculator} onClick={runPreview}>試算預覽</Button>
                </div>
              </div>

              {preview && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                    {preview.balanced
                      ? <Badge status="success" dot>借貸平衡</Badge>
                      : <Badge status="error" dot>未平衡或有錯誤</Badge>}
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      借方合計 {fmt(preview.totalDebit)} ／ 貸方合計 {fmt(preview.totalCredit)}
                    </span>
                  </div>
                  {preview.errors.length > 0 && (
                    <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '6px 12px', borderRadius: 8, marginBottom: 8, fontSize: 13 }}>
                      {preview.errors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  )}
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>科目</th>
                        <th style={{ textAlign: 'right' }}>借方</th>
                        <th style={{ textAlign: 'right' }}>貸方</th>
                        <th>成本中心</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'monospace' }}>{l.account_code} {l.account_name}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{l.debit ? fmt(l.debit) : '-'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{l.credit ? fmt(l.credit) : '-'}</td>
                          <td style={{ fontFamily: 'monospace' }}>{l.cost_center || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>儲存（組織自訂）</Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

/** 存檔前基本檢查：至少兩行、皆有科目與運算式 */
function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return '至少需要兩行分錄（一借一貸）'
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].account_code) return `第 ${i + 1} 行未選擇科目`
    if (!String(lines[i].amount_expr || '').trim()) return `第 ${i + 1} 行缺少金額運算式`
  }
  return null
}
