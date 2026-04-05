import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, X, Tag, ChevronDown, ChevronRight } from 'lucide-react'
import { getPriceLists, createPriceList, updatePriceList, deletePriceList, getPriceRules, createPriceRule, deletePriceRule, getSKUs } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const emptyListForm = { name: '', currency: 'NTD', valid_from: '', valid_to: '', status: '啟用', is_default: false }
const emptyRuleForm = { sku_id: '', min_qty: '1', unit_price: '', discount_percent: '0', priority: '0' }

export default function PricingRules() {
  const [priceLists, setPriceLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showListModal, setShowListModal] = useState(false)
  const [listForm, setListForm] = useState(emptyListForm)
  const [editingListId, setEditingListId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Expanded price list to show rules
  const [expandedId, setExpandedId] = useState(null)
  const [rules, setRules] = useState([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [ruleForm, setRuleForm] = useState(emptyRuleForm)
  const [skus, setSKUs] = useState([])

  const setL = (k, v) => setListForm(f => ({ ...f, [k]: v }))
  const setR = (k, v) => setRuleForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [plRes, skuRes] = await Promise.all([getPriceLists(), getSKUs()])
    if (plRes.error) setError(plRes.error.message)
    else setPriceLists(plRes.data || [])
    setSKUs(skuRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleListSubmit = async () => {
    if (!listForm.name) return
    setSaving(true)
    const payload = { ...listForm }
    delete payload.id

    if (editingListId) {
      const { error } = await updatePriceList(editingListId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createPriceList(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowListModal(false)
    setListForm(emptyListForm)
    setEditingListId(null)
    load()
  }

  const handleDeleteList = async (id) => {
    if (!confirm('刪除此價格表將同時刪除所有規則，確定？')) return
    const { error } = await deletePriceList(id)
    if (error) setError(error.message)
    else { if (expandedId === id) setExpandedId(null); load() }
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setRulesLoading(true)
    const { data } = await getPriceRules(id)
    setRules(data || [])
    setRulesLoading(false)
  }

  const handleRuleSubmit = async () => {
    if (!ruleForm.unit_price) return
    setSaving(true)
    const payload = {
      price_list_id: expandedId,
      sku_id: ruleForm.sku_id ? Number(ruleForm.sku_id) : null,
      min_qty: Number(ruleForm.min_qty) || 1,
      unit_price: Number(ruleForm.unit_price),
      discount_percent: Number(ruleForm.discount_percent) || 0,
      priority: Number(ruleForm.priority) || 0,
    }
    const { error } = await createPriceRule(payload)
    if (error) { setError(error.message); setSaving(false); return }
    setSaving(false)
    setShowRuleModal(false)
    setRuleForm(emptyRuleForm)
    // Reload rules
    const { data } = await getPriceRules(expandedId)
    setRules(data || [])
  }

  const handleDeleteRule = async (id) => {
    const { error } = await deletePriceRule(id)
    if (error) setError(error.message)
    else {
      const { data } = await getPriceRules(expandedId)
      setRules(data || [])
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💲</span> 價格規則</h2>
            <p>Pricing Rules — 價格表管理、量階定價、客戶專屬折扣</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setListForm(emptyListForm); setEditingListId(null); setShowListModal(true) }}>
            <Plus size={14} /> 新增價格表
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      {priceLists.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>尚無價格表，請新增</div>
      ) : priceLists.map(pl => (
        <div key={pl.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', marginBottom: 12, overflow: 'hidden' }}>
          {/* Price list header */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 12 }} onClick={() => toggleExpand(pl.id)}>
            {expandedId === pl.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Tag size={16} style={{ color: 'var(--accent-blue)' }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, marginRight: 12 }}>{pl.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{pl.currency}</span>
              {pl.is_default && <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>預設</span>}
              {pl.valid_from && <span style={{ marginLeft: 12, fontSize: 11, color: 'var(--text-secondary)' }}>{pl.valid_from} ~ {pl.valid_to || '...'}</span>}
            </div>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: pl.status === '啟用' ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)', color: pl.status === '啟用' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{pl.status}</span>
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={e => { e.stopPropagation(); setListForm({ name: pl.name, currency: pl.currency, valid_from: pl.valid_from || '', valid_to: pl.valid_to || '', status: pl.status, is_default: pl.is_default }); setEditingListId(pl.id); setShowListModal(true) }}><Edit3 size={13} /></button>
            <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={e => { e.stopPropagation(); handleDeleteList(pl.id) }}><Trash2 size={13} /></button>
          </div>

          {/* Rules table (expanded) */}
          {expandedId === pl.id && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>價格規則 ({rules.length})</span>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => { setRuleForm(emptyRuleForm); setShowRuleModal(true) }}>
                  <Plus size={12} /> 新增規則
                </button>
              </div>
              {rulesLoading ? <LoadingSpinner /> : rules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>尚無規則</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>商品</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>最低數量</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>單價</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>折扣 %</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>優先序</th>
                      <th style={{ padding: '6px 8px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map(rule => (
                      <tr key={rule.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px' }}>{rule.skus ? `${rule.skus.code} ${rule.skus.name}` : '全部商品'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{rule.min_qty}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(rule.unit_price)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{rule.discount_percent}%</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{rule.priority}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--accent-red)' }} onClick={() => handleDeleteRule(rule.id)}><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Price List Modal */}
      {showListModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowListModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 420, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingListId ? '編輯價格表' : '新增價格表'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowListModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>名稱 *</label>
                <input type="text" value={listForm.name} onChange={e => setL('name', e.target.value)} placeholder="例：VIP 客戶價格" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>有效起日</label>
                  <input type="date" value={listForm.valid_from} onChange={e => setL('valid_from', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>有效迄日</label>
                  <input type="date" value={listForm.valid_to} onChange={e => setL('valid_to', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={listForm.is_default} onChange={e => setL('is_default', e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>設為預設價格表</span>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowListModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleListSubmit} disabled={saving}>{saving ? '儲存中...' : editingListId ? '更新' : '新增'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Price Rule Modal */}
      {showRuleModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowRuleModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 420, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>新增價格規則</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowRuleModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>商品（留空 = 全部）</label>
                <select value={ruleForm.sku_id} onChange={e => setR('sku_id', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">全部商品</option>
                  {skus.map(s => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>最低數量</label>
                  <input type="number" value={ruleForm.min_qty} onChange={e => setR('min_qty', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>單價 *</label>
                  <input type="number" value={ruleForm.unit_price} onChange={e => setR('unit_price', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>折扣 %</label>
                  <input type="number" value={ruleForm.discount_percent} onChange={e => setR('discount_percent', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>優先序（高 = 優先）</label>
                  <input type="number" value={ruleForm.priority} onChange={e => setR('priority', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowRuleModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleRuleSubmit} disabled={saving}>{saving ? '儲存中...' : '新增'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
