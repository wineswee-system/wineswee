import { useState, useEffect, useCallback } from 'react'
import { Plus, Tag, Copy, Check } from 'lucide-react'
import { useOrgId } from '../../contexts/AuthContext'
import { getCoupons, deleteCoupon, updateCoupon, getCouponAssignments } from '../../lib/db'
import Badge from '../../components/ui/Badge'
import CouponFormModal from './components/CouponFormModal'
import CouponAssignModal from './components/CouponAssignModal'

const TYPE_LABEL  = { pct_off: '折扣%', fixed_off: '折抵', free_item: '贈品', bogo: '買送', points_2x: '點數倍增' }
const TYPE_COLOR  = { pct_off: 'success', fixed_off: 'info', free_item: 'warning', bogo: 'warning', points_2x: 'default' }
const STATUS_LABEL   = { draft: '草稿', active: '啟用', paused: '暫停', expired: '已過期' }
const STATUS_VARIANT = { draft: 'default', active: 'success', paused: 'warning', expired: 'default' }

function couponValueLabel(c) {
  if (c.type === 'pct_off')   return `${c.value}% OFF`
  if (c.type === 'fixed_off') return `折抵 NT$${Number(c.value).toLocaleString()}`
  if (c.type === 'points_2x') return `點數 ${c.value}× 倍增`
  if (c.type === 'free_item') return '贈品兌換'
  if (c.type === 'bogo')      return 'Buy X Get Y'
  return '—'
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}

export default function Coupons() {
  const orgId = useOrgId()
  const [coupons,      setCoupons]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [formOpen,     setFormOpen]     = useState(false)
  const [editCoupon,   setEditCoupon]   = useState(null)
  const [assignOpen,   setAssignOpen]   = useState(false)
  const [assignTarget, setAssignTarget] = useState(null)
  const [detailId,     setDetailId]     = useState(null)
  const [assignments,  setAssignments]  = useState([])
  const [asnLoading,   setAsnLoading]   = useState(false)
  const [copiedId,     setCopiedId]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await getCoupons(orgId, { status: statusFilter || undefined })
    setCoupons(data ?? [])
    setLoading(false)
  }, [orgId, statusFilter])

  useEffect(() => { load() }, [load])

  async function loadAssignments(couponId) {
    setAsnLoading(true)
    const { data } = await getCouponAssignments(couponId)
    setAssignments(data ?? [])
    setAsnLoading(false)
  }

  function openDetail(id) {
    if (detailId === id) { setDetailId(null); return }
    setDetailId(id)
    loadAssignments(id)
  }

  async function toggleStatus(coupon) {
    const next = coupon.status === 'active' ? 'paused' : 'active'
    await updateCoupon(coupon.id, { status: next })
    setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, status: next } : c))
  }

  async function handleDelete(id) {
    if (!confirm('確定刪除此優惠券？已發放的紀錄不受影響。')) return
    await deleteCoupon(id)
    setCoupons(prev => prev.filter(c => c.id !== id))
    if (detailId === id) setDetailId(null)
  }

  function copyCode(code, id) {
    navigator.clipboard.writeText(code)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const stats = {
    total:   coupons.length,
    active:  coupons.filter(c => c.status === 'active').length,
    redeems: coupons.reduce((s, c) => s + (c.used_count || 0), 0),
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>優惠券管理</h1>
        <button onClick={() => { setEditCoupon(null); setFormOpen(true) }} style={S.addBtn}>
          <Plus size={16} /> 新增優惠券
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          ['優惠券總數', stats.total,   'var(--text-secondary)'],
          ['啟用中',     stats.active,  'var(--accent-green)'],
          ['已兌換次數', stats.redeems, 'var(--accent-cyan)'],
        ].map(([l, v, c]) => (
          <div key={l} style={S.statCard}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.select}>
          <option value="">全部狀態</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{coupons.length} 筆</span>
      </div>

      {/* Coupon table */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
        ) : coupons.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Tag size={36} style={{ marginBottom: 12, opacity: 0.3, display: 'block', margin: '0 auto 12px' }} />
            <div>尚無優惠券，點擊「新增優惠券」開始建立</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                {['代碼', '名稱', '類型', '折扣', '有效期限', '使用次數', '狀態', '操作'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coupons.map(c => (
                <>
                  <tr
                    key={c.id}
                    style={{ borderTop: '1px solid var(--border-primary)', cursor: 'pointer', background: detailId === c.id ? 'var(--bg-tertiary)' : 'transparent' }}
                    onClick={() => openDetail(c.id)}
                  >
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ fontSize: 12, background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, color: 'var(--accent-cyan)' }}>{c.code}</code>
                        <button
                          onClick={e => { e.stopPropagation(); copyCode(c.code, c.id) }}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                        >
                          {copiedId === c.id ? <Check size={13} color="var(--accent-green)" /> : <Copy size={13} />}
                        </button>
                      </div>
                    </td>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</td>
                    <td style={S.td}><Badge variant={TYPE_COLOR[c.type] ?? 'default'}>{TYPE_LABEL[c.type] ?? c.type}</Badge></td>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--accent-cyan)' }}>{couponValueLabel(c)}</td>
                    <td style={S.td}>
                      {c.valid_until ? (
                        <span style={{ color: new Date(c.valid_until) < new Date() ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: 13 }}>
                          {fmtDate(c.valid_from)} – {fmtDate(c.valid_until)}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>永久有效</span>}
                    </td>
                    <td style={S.td}>
                      <span style={{ fontWeight: 600 }}>{c.used_count ?? 0}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{c.usage_limit_total ? ` / ${c.usage_limit_total}` : ''}</span>
                    </td>
                    <td style={S.td}><Badge variant={STATUS_VARIANT[c.status] ?? 'default'}>{STATUS_LABEL[c.status] ?? c.status}</Badge></td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => { setAssignTarget(c); setAssignOpen(true) }} style={S.actBtn('var(--accent-cyan)')}>發放</button>
                        {c.status !== 'expired' && (
                          <button onClick={() => toggleStatus(c)} style={S.actBtn(c.status === 'active' ? 'var(--accent-orange)' : 'var(--accent-green)')}>
                            {c.status === 'active' ? '暫停' : '啟用'}
                          </button>
                        )}
                        <button onClick={() => { setEditCoupon(c); setFormOpen(true) }} style={S.actBtn('var(--bg-tertiary)', 'var(--text-secondary)')}>編輯</button>
                        <button onClick={() => handleDelete(c.id)} style={S.actBtn('var(--accent-red)')}>刪除</button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {detailId === c.id && (
                    <tr key={`detail-${c.id}`}>
                      <td colSpan={8} style={{ background: 'var(--bg-tertiary)', padding: '16px 20px', borderTop: '1px solid var(--border-primary)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10, fontSize: 13 }}>設定詳情</div>
                            {[
                              ['最低消費', c.min_purchase ? `NT$${Number(c.min_purchase).toLocaleString()}` : '無限制'],
                              ['每人限用', c.usage_limit_per_member != null ? `${c.usage_limit_per_member} 次` : '不限'],
                              ['可疊加使用', c.combinable ? '✓ 可疊加' : '✗ 不可疊加'],
                              ['描述', c.description || '—'],
                            ].map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--border-primary)', fontSize: 13 }}>
                                <span style={{ color: 'var(--text-muted)', minWidth: 80 }}>{k}</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{v}</span>
                              </div>
                            ))}
                          </div>

                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10, fontSize: 13 }}>
                              發放紀錄（最近 5 筆）
                              {asnLoading && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>載入中…</span>}
                            </div>
                            {assignments.length === 0 && !asnLoading && (
                              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>尚未發放給任何會員</div>
                            )}
                            {assignments.slice(0, 5).map(a => (
                              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-primary)', fontSize: 13 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>
                                  {a.members?.name ?? '—'}
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{a.members?.phone ?? ''}</span>
                                </span>
                                <Badge variant={a.used_at ? 'success' : 'default'}>{a.used_at ? '已使用' : '未使用'}</Badge>
                              </div>
                            ))}
                            {assignments.length > 5 && (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>… 另有 {assignments.length - 5} 筆</div>
                            )}
                          </div>

                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <CouponFormModal
          orgId={orgId}
          initial={editCoupon}
          onClose={() => { setFormOpen(false); setEditCoupon(null) }}
          onSaved={row => {
            setFormOpen(false); setEditCoupon(null)
            if (editCoupon) setCoupons(prev => prev.map(c => c.id === row.id ? row : c))
            else            setCoupons(prev => [row, ...prev])
          }}
        />
      )}

      {assignOpen && assignTarget && (
        <CouponAssignModal
          coupon={assignTarget}
          orgId={orgId}
          onClose={() => { setAssignOpen(false); setAssignTarget(null) }}
          onAssigned={() => { setAssignOpen(false); setAssignTarget(null); load() }}
        />
      )}
    </div>
  )
}

const S = {
  th:      { padding: '10px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' },
  td:      { padding: '10px 14px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  addBtn:  { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  actBtn:  (bg, color = '#fff') => ({ padding: '4px 10px', borderRadius: 6, border: 'none', background: bg, color, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }),
  statCard: { background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: '12px 20px', minWidth: 110 },
  select:  { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' },
}
