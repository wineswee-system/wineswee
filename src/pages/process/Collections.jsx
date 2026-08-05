import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wallet, Handshake, Users, Plus, ChevronDown, ChevronRight, Trash2, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { fmtNT as fmt } from '../../lib/currency'

const n = (x) => Number(x) || 0
const today = () => new Date().toISOString().slice(0, 10)
const DEPOSIT_TARGET = 300000

// 加盟金三期目標（第三期用 總額−前兩期，免進位差）
function stageTargets(total) {
  const t = n(total)
  const t1 = Math.round(t * 0.45)
  const t2 = Math.round(t * 0.45)
  const t3 = t - t1 - t2
  return [t1, t2, t3]
}

function StatusBadge({ done }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap',
      color: done ? 'var(--accent-green)' : 'var(--accent-orange)',
      background: done ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {done ? <><Check size={12} /> 收款完成</> : '收款中'}
    </span>
  )
}

function Progress({ paid, target }) {
  const pct = target > 0 ? Math.min(100, Math.round((paid / target) * 100)) : 0
  const done = paid >= target && target > 0
  return (
    <div style={{ minWidth: 160 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span>{fmt(paid)} / {fmt(target)}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--accent-green)' : 'var(--accent-cyan)', transition: 'width .2s' }} />
      </div>
      {!done && target > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>還差 {fmt(target - paid)}</div>
      )}
    </div>
  )
}

const TABS = [
  { key: 'deposit',  label: '訂金',     icon: Wallet },
  { key: 'franchise', label: '加盟金',   icon: Handshake },
  { key: 'investor', label: '投資人',   icon: Users },
]

export default function Collections() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? getTenantOrgId()
  const [sp, setSp] = useSearchParams()
  const tab = TABS.some(t => t.key === sp.get('tab')) ? sp.get('tab') : 'deposit'
  const setTab = (k) => setSp(prev => { const p = new URLSearchParams(prev); p.set('tab', k); return p }, { replace: true })

  const [loading, setLoading] = useState(true)
  const [deposits, setDeposits] = useState([])
  const [depPays, setDepPays] = useState([])          // 訂金收款明細
  const [franchises, setFranchises] = useState([])
  const [ffPays, setFfPays] = useState([])            // 加盟金收款明細
  const [investors, setInvestors] = useState([])

  const reload = async () => {
    if (!orgId) { setLoading(false); return }
    const [dep, dp, ff, fp, inv] = await Promise.all([
      supabase.from('deposit_records').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('deposit_payments').select('*').eq('organization_id', orgId).order('paid_date'),
      supabase.from('franchise_fees').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('franchise_fee_payments').select('*').eq('organization_id', orgId).order('paid_date'),
      supabase.from('collection_investors').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    ])
    setDeposits(dep.data || [])
    setDepPays(dp.data || [])
    setFranchises(ff.data || [])
    setFfPays(fp.data || [])
    setInvestors(inv.data || [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>💵 收款</h2>
            <p>訂金（固定 30 萬）與加盟金（三期 45 / 45 / 10）收款記錄 — 純記帳，加總滿額自動完成</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border-medium)' }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 700,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
                borderBottom: `2px solid ${active ? 'var(--accent-cyan)' : 'transparent'}`, marginBottom: -1,
              }}>
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'deposit' && (
        <DepositTab orgId={orgId} profile={profile} deposits={deposits} depPays={depPays} reload={reload} />
      )}
      {tab === 'franchise' && (
        <FranchiseTab orgId={orgId} profile={profile} franchises={franchises} ffPays={ffPays}
          deposits={deposits} investors={investors} reload={reload} />
      )}
      {tab === 'investor' && (
        <InvestorTab orgId={orgId} profile={profile} investors={investors} franchises={franchises} reload={reload} />
      )}
    </div>
  )
}

// ══════════════════════════════ 訂金 ══════════════════════════════
function DepositTab({ orgId, profile, deposits, depPays, reload }) {
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [saving, setSaving] = useState(false)

  const paysByDep = useMemo(() => {
    const m = {}
    depPays.forEach(p => { (m[p.deposit_id] ||= []).push(p) })
    return m
  }, [depPays])

  const addDeposit = async () => {
    if (!title.trim()) { toast.warning('請填標的名稱'); return }
    setSaving(true)
    const { error } = await supabase.from('deposit_records').insert({
      organization_id: orgId, title: title.trim(), target_amount: DEPOSIT_TARGET, created_by: profile?.name || null,
    })
    setSaving(false)
    if (error) { toast.error('新增失敗：' + error.message); return }
    setTitle(''); setShowAdd(false); toast.success('已新增訂金案'); reload()
  }

  const delDeposit = async (d) => {
    if (!(await confirm({ message: `刪除訂金「${d.title}」及其所有收款明細？（若已開加盟金會被擋）` }))) return
    const { error } = await supabase.from('deposit_records').delete().eq('id', d.id)
    if (error) { toast.error('刪除失敗：' + (error.message.includes('foreign') ? '此訂金已開加盟金，不能刪' : error.message)); return }
    toast.success('已刪除'); reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><Plus size={14} /> 新增訂金案</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>標的 / 案子名稱</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：台中大墩加盟案" autoFocus />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>目標金額（固定）</label>
            <input className="form-input" value={fmt(DEPOSIT_TARGET)} disabled style={{ opacity: .7 }} />
          </div>
          <button className="btn btn-primary" onClick={addDeposit} disabled={saving}>{saving ? '儲存中…' : '建立'}</button>
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>標的</th>
              <th style={{ minWidth: 180 }}>收款進度</th>
              <th>狀態</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {deposits.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無訂金案</td></tr>
            )}
            {deposits.map(d => {
              const isExp = expanded === d.id
              const pays = paysByDep[d.id] || []
              const done = d.status === 'completed'
              return (
                <FragmentRow key={d.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : d.id)}>
                    <td>{isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>{d.title}</td>
                    <td><Progress paid={n(d.paid_total)} target={n(d.target_amount)} /></td>
                    <td><StatusBadge done={done} /></td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={e => { e.stopPropagation(); delDeposit(d) }}>
                        <Trash2 size={13} style={{ color: 'var(--accent-red)' }} />
                      </button>
                    </td>
                  </tr>
                  {isExp && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <PaymentEditor
                          rows={pays}
                          onAdd={async ({ paid_date, amount, note }) => {
                            const { error } = await supabase.from('deposit_payments').insert({
                              organization_id: orgId, deposit_id: d.id, paid_date, amount, note: note || null, created_by: profile?.name || null,
                            })
                            if (error) { toast.error('新增失敗：' + error.message); return false }
                            toast.success('已記錄收款'); reload(); return true
                          }}
                          onDelete={async (row) => {
                            const { error } = await supabase.from('deposit_payments').delete().eq('id', row.id)
                            if (error) { toast.error('刪除失敗：' + error.message); return }
                            reload()
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════ 加盟金 ══════════════════════════════
function FranchiseTab({ orgId, profile, franchises, ffPays, deposits, investors, reload }) {
  const [showAdd, setShowAdd] = useState(false)
  const [depId, setDepId] = useState('')
  const [invId, setInvId] = useState('')
  const [total, setTotal] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [saving, setSaving] = useState(false)

  const completedDeposits = deposits.filter(d => d.status === 'completed')
  const depTitle = useMemo(() => Object.fromEntries(deposits.map(d => [d.id, d.title])), [deposits])
  const invName = useMemo(() => Object.fromEntries(investors.map(i => [i.id, i])), [investors])
  const paysByFf = useMemo(() => {
    const m = {}
    ffPays.forEach(p => { (m[p.franchise_fee_id] ||= []).push(p) })
    return m
  }, [ffPays])

  const addFranchise = async () => {
    if (!depId) { toast.warning('請選擇（已完成的）訂金'); return }
    if (!invId) { toast.warning('請選擇投資人'); return }
    if (n(total) <= 0) { toast.warning('請填總額'); return }
    setSaving(true)
    const { error } = await supabase.from('franchise_fees').insert({
      organization_id: orgId, deposit_id: depId, investor_id: invId, total_amount: n(total), created_by: profile?.name || null,
    })
    setSaving(false)
    if (error) { toast.error('建立失敗：' + error.message); return }
    setDepId(''); setInvId(''); setTotal(''); setShowAdd(false); toast.success('已建立加盟金收款'); reload()
  }

  const delFranchise = async (f) => {
    if (!(await confirm({ message: '刪除此加盟金收款及其所有分期明細？' }))) return
    const { error } = await supabase.from('franchise_fees').delete().eq('id', f.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除'); reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><Plus size={14} /> 新增加盟金收款</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          {completedDeposits.length === 0 ? (
            <div style={{ color: 'var(--accent-orange)', fontSize: 13 }}>⚠ 目前沒有「收款完成」的訂金，先到「訂金」tab 把訂金收滿 30 萬才能開加盟金。</div>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 200 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>訂金（限已完成）</label>
                <select className="form-input" value={depId} onChange={e => setDepId(e.target.value)}>
                  <option value="">選擇訂金案…</option>
                  {completedDeposits.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 200 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>投資人</label>
                <select className="form-input" value={invId} onChange={e => setInvId(e.target.value)}>
                  <option value="">選擇投資人…</option>
                  {investors.map(i => <option key={i.id} value={i.id}>{i.name}{i.company ? `（${i.company}）` : ''}</option>)}
                </select>
                {investors.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>先到「投資人」tab 新增</div>}
              </div>
              <div style={{ minWidth: 160 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>加盟金總額</label>
                <input className="form-input" type="number" value={total} onChange={e => setTotal(e.target.value)} placeholder="0" />
                {n(total) > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    三期 {stageTargets(total).map(fmt).join(' / ')}
                  </div>
                )}
              </div>
              <button className="btn btn-primary" onClick={addFranchise} disabled={saving}>{saving ? '建立中…' : '建立'}</button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>訂金案</th>
              <th>投資人</th>
              <th style={{ minWidth: 180 }}>總進度</th>
              <th>狀態</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {franchises.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無加盟金收款</td></tr>
            )}
            {franchises.map(f => {
              const isExp = expanded === f.id
              const inv = invName[f.investor_id]
              const done = f.status === 'completed'
              const targets = stageTargets(f.total_amount)
              const paid = [n(f.paid_stage1), n(f.paid_stage2), n(f.paid_stage3)]
              const pays = paysByFf[f.id] || []
              return (
                <FragmentRow key={f.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : f.id)}>
                    <td>{isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>{depTitle[f.deposit_id] || '—'}</td>
                    <td>{inv ? <>{inv.name}{inv.company ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>（{inv.company}）</span> : null}</> : '—'}</td>
                    <td><Progress paid={n(f.paid_total)} target={n(f.total_amount)} /></td>
                    <td><span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                      color: done ? 'var(--accent-green)' : 'var(--accent-orange)',
                      background: done ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
                    }}>{done ? '✓ 收款成功' : '收款中'}</span></td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={e => { e.stopPropagation(); delFranchise(f) }}>
                        <Trash2 size={13} style={{ color: 'var(--accent-red)' }} />
                      </button>
                    </td>
                  </tr>
                  {isExp && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div style={{ background: 'var(--glass-light)', padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {[0, 1, 2].map(si => {
                            const stage = si + 1
                            const pct = [45, 45, 10][si]
                            const stagePays = pays.filter(p => p.stage === stage)
                            return (
                              <div key={stage}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <div style={{ fontWeight: 700, fontSize: 13 }}>第 {stage} 期 <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>（{pct}%）</span></div>
                                  <div style={{ minWidth: 180 }}><Progress paid={paid[si]} target={targets[si]} /></div>
                                </div>
                                <PaymentEditor
                                  compact
                                  rows={stagePays}
                                  onAdd={async ({ paid_date, amount, note }) => {
                                    const { error } = await supabase.from('franchise_fee_payments').insert({
                                      organization_id: orgId, franchise_fee_id: f.id, stage, paid_date, amount, note: note || null, created_by: profile?.name || null,
                                    })
                                    if (error) { toast.error('新增失敗：' + error.message); return false }
                                    toast.success(`已記錄第 ${stage} 期收款`); reload(); return true
                                  }}
                                  onDelete={async (row) => {
                                    const { error } = await supabase.from('franchise_fee_payments').delete().eq('id', row.id)
                                    if (error) { toast.error('刪除失敗：' + error.message); return }
                                    reload()
                                  }}
                                />
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════ 投資人名冊 ══════════════════════════════
function InvestorTab({ orgId, profile, investors, franchises, reload }) {
  const [form, setForm] = useState({ company: '', name: '', phone: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  const usedInvIds = useMemo(() => new Set(franchises.map(f => f.investor_id)), [franchises])

  const add = async () => {
    if (!form.name.trim()) { toast.warning('名字必填'); return }
    if (!form.phone.trim()) { toast.warning('電話必填'); return }
    setSaving(true)
    const { error } = await supabase.from('collection_investors').insert({
      organization_id: orgId, company: form.company.trim() || null, name: form.name.trim(), phone: form.phone.trim(), created_by: profile?.name || null,
    })
    setSaving(false)
    if (error) { toast.error('新增失敗：' + error.message); return }
    setForm({ company: '', name: '', phone: '' }); setShowAdd(false); toast.success('已新增投資人'); reload()
  }

  const del = async (i) => {
    if (usedInvIds.has(i.id)) { toast.error('此投資人已用於加盟金收款，不能刪'); return }
    if (!(await confirm({ message: `刪除投資人「${i.name}」？` }))) return
    const { error } = await supabase.from('collection_investors').delete().eq('id', i.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除'); reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><Plus size={14} /> 新增投資人</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>公司（選填）</label>
            <input className="form-input" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>名字 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>電話 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <button className="btn btn-primary" onClick={add} disabled={saving}>{saving ? '儲存中…' : '新增'}</button>
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>公司</th><th>名字</th><th>電話</th><th style={{ width: 40 }}></th></tr>
          </thead>
          <tbody>
            {investors.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無投資人</td></tr>
            )}
            {investors.map(i => (
              <tr key={i.id}>
                <td style={{ color: i.company ? 'var(--text-primary)' : 'var(--text-muted)' }}>{i.company || '—'}</td>
                <td style={{ fontWeight: 600 }}>{i.name}</td>
                <td>{i.phone}</td>
                <td>
                  <button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={() => del(i)}
                    title={usedInvIds.has(i.id) ? '已用於加盟金，不能刪' : '刪除'}>
                    <Trash2 size={13} style={{ color: usedInvIds.has(i.id) ? 'var(--text-muted)' : 'var(--accent-red)' }} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 共用：一組收款明細 + 新增列 ──
function PaymentEditor({ rows, onAdd, onDelete, compact }) {
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (n(amount) <= 0) { toast.warning('金額要 > 0'); return }
    setBusy(true)
    const ok = await onAdd({ paid_date: date, amount: n(amount), note })
    setBusy(false)
    if (ok) { setAmount(''); setNote('') }
  }

  return (
    <div style={{ background: compact ? 'transparent' : 'var(--glass-light)', padding: compact ? 0 : '14px 20px', borderTop: compact ? 'none' : '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無收款</div>}
        {rows.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', borderRadius: 6, background: 'var(--bg-card)', fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{p.paid_date}</span>
              {p.note && <span style={{ color: 'var(--text-muted)' }}>{p.note}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{fmt(n(p.amount))}</span>
              <button className="btn btn-secondary" style={{ padding: '1px 5px' }} onClick={() => onDelete(p)}>
                <Trash2 size={12} style={{ color: 'var(--accent-red)' }} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
        <input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="金額" style={{ width: 120 }} />
        <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="備註（選填）" style={{ flex: 1, minWidth: 120 }} />
        <button className="btn btn-primary" style={{ padding: '6px 12px' }} onClick={submit} disabled={busy}>
          <Plus size={13} /> {busy ? '記錄中…' : '記一筆'}
        </button>
      </div>
    </div>
  )
}

// 小工具：讓 <tr> 群組不吃 key 警告（等同 Fragment，但語意清楚）
function FragmentRow({ children }) { return <>{children}</> }
