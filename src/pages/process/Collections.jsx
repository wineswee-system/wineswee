import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wallet, Handshake, Users, Plus, ChevronDown, ChevronRight, Trash2, Check, X } from 'lucide-react'
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

// 三期目標（45/45/10，第三期用 額度−前兩期，免進位差）
function stageTargets(amount) {
  const a = n(amount)
  const t1 = Math.round(a * 0.45)
  const t2 = Math.round(a * 0.45)
  return [t1, t2, a - t1 - t2]
}

function Progress({ paid, target, small }) {
  const pct = target > 0 ? Math.min(100, Math.round((paid / target) * 100)) : 0
  const done = paid >= target && target > 0
  return (
    <div style={{ minWidth: small ? 120 : 160 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span style={{ whiteSpace: 'nowrap' }}>{fmt(paid)} / {fmt(target)}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--accent-green)' : 'var(--accent-cyan)', transition: 'width .2s' }} />
      </div>
      {!done && target > 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>還差 {fmt(target - paid)}</div>}
    </div>
  )
}

function StatusPill({ done, doneText = '收款完成', text = '收款中' }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap',
      color: done ? 'var(--accent-green)' : 'var(--accent-orange)',
      background: done ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>{done ? <><Check size={12} /> {doneText}</> : text}</span>
  )
}

const TABS = [
  { key: 'deposit',   label: '訂金',   icon: Wallet },
  { key: 'franchise', label: '加盟金', icon: Handshake },
  { key: 'investor',  label: '投資人', icon: Users },
]

export default function Collections() {
  const { profile, hasPermission } = useAuth()
  const canUse = hasPermission('collection.manage')   // admin/super_admin 預設有；其餘在權限頁開
  const orgId = profile?.organization_id ?? getTenantOrgId()
  const [sp, setSp] = useSearchParams()
  const tab = TABS.some(t => t.key === sp.get('tab')) ? sp.get('tab') : 'deposit'
  const setTab = (k) => setSp(prev => { const p = new URLSearchParams(prev); p.set('tab', k); return p }, { replace: true })

  const [loading, setLoading] = useState(true)
  const [deposits, setDeposits] = useState([])
  const [depPays, setDepPays] = useState([])
  const [franchises, setFranchises] = useState([])
  const [ffInvestors, setFfInvestors] = useState([])
  const [ffPays, setFfPays] = useState([])
  const [investors, setInvestors] = useState([])

  const reload = async () => {
    if (!orgId) { setLoading(false); return }
    const [dep, dp, ff, ffi, fp, inv] = await Promise.all([
      supabase.from('deposit_records').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('deposit_payments').select('*').eq('organization_id', orgId).order('paid_date'),
      supabase.from('franchise_fees').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('franchise_fee_investors').select('*').eq('organization_id', orgId).order('amount', { ascending: false }).order('investor_id'),
      supabase.from('franchise_fee_payments').select('*').eq('organization_id', orgId).order('paid_date'),
      supabase.from('collection_investors').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    ])
    setDeposits(dep.data || [])
    setDepPays(dp.data || [])
    setFranchises(ff.data || [])
    setFfInvestors(ffi.data || [])
    setFfPays(fp.data || [])
    setInvestors(inv.data || [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 新增投資人（共用：訂金/加盟金當場加），回傳新列
  const addInvestor = async ({ company, name, phone }) => {
    if (!name?.trim()) { toast.warning('名字必填'); return null }
    if (!phone?.trim()) { toast.warning('電話必填'); return null }
    const { data, error } = await supabase.from('collection_investors').insert({
      organization_id: orgId, company: company?.trim() || null, name: name.trim(), phone: phone.trim(), created_by: profile?.name || null,
    }).select().single()
    if (error) { toast.error('新增投資人失敗：' + error.message); return null }
    setInvestors(prev => [data, ...prev])
    return data
  }

  if (!canUse) return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
      <h3 style={{ color: 'var(--accent-red)' }}>權限不足</h3>
      <p>收款功能僅限管理員或已開通「收款」權限的員工使用。</p>
    </div>
  )
  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>💵 收款</h2>
            <p>訂金（固定 30 萬）與加盟金（投資人分攤，每人各自三期 45 / 45 / 10）收款記錄 — 純記帳，滿額自動完成</p>
          </div>
        </div>
      </div>

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
              }}><Icon size={15} /> {t.label}</button>
          )
        })}
      </div>

      {tab === 'deposit' && (
        <DepositTab orgId={orgId} profile={profile} deposits={deposits} depPays={depPays}
          investors={investors} addInvestor={addInvestor} reload={reload} />
      )}
      {tab === 'franchise' && (
        <FranchiseTab orgId={orgId} profile={profile} franchises={franchises} ffInvestors={ffInvestors} ffPays={ffPays}
          deposits={deposits} investors={investors} addInvestor={addInvestor} reload={reload} />
      )}
      {tab === 'investor' && (
        <InvestorTab orgId={orgId} profile={profile} investors={investors} deposits={deposits}
          ffInvestors={ffInvestors} addInvestor={addInvestor} reload={reload} />
      )}
    </div>
  )
}

// ── 共用：投資人選擇器（下拉既有名冊 + 當場新增）──
function InvestorPicker({ value, onChange, investors, addInvestor, exclude = [], placeholder = '選擇投資人…', noAdd = false }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ company: '', name: '', phone: '' })
  const list = investors.filter(i => !exclude.includes(i.id) || i.id === value)

  const save = async () => {
    const row = await addInvestor(f)
    if (row) { onChange(row.id); setF({ company: '', name: '', phone: '' }); setAdding(false) }
  }

  if (adding) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="公司(選填)" value={f.company} onChange={e => setF(s => ({ ...s, company: e.target.value }))} style={{ width: 110 }} />
        <input className="form-input" placeholder="名字*" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} style={{ width: 100 }} />
        <input className="form-input" placeholder="電話*" value={f.phone} onChange={e => setF(s => ({ ...s, phone: e.target.value }))} style={{ width: 120 }} />
        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={save}>存</button>
        <button className="btn btn-secondary" style={{ padding: '5px 8px' }} onClick={() => setAdding(false)}><X size={13} /></button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select className="form-input" value={value || ''} onChange={e => onChange(e.target.value)} style={{ minWidth: 160 }}>
        <option value="">{placeholder}</option>
        {list.map(i => <option key={i.id} value={i.id}>{i.name}{i.company ? `（${i.company}）` : ''}</option>)}
      </select>
      {!noAdd && <button className="btn btn-secondary" style={{ padding: '5px 8px', whiteSpace: 'nowrap' }} onClick={() => setAdding(true)}><Plus size={13} /> 新增</button>}
    </div>
  )
}

// ══════════════════════════════ 訂金 ══════════════════════════════
function DepositTab({ orgId, profile, deposits, depPays, investors, addInvestor, reload }) {
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [invId, setInvId] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [saving, setSaving] = useState(false)

  const invById = useMemo(() => Object.fromEntries(investors.map(i => [i.id, i])), [investors])
  const paysByDep = useMemo(() => { const m = {}; depPays.forEach(p => { (m[p.deposit_id] ||= []).push(p) }); return m }, [depPays])

  const addDeposit = async () => {
    if (!title.trim()) { toast.warning('請填標的名稱'); return }
    if (!invId) { toast.warning('請選投資人'); return }
    setSaving(true)
    const { error } = await supabase.from('deposit_records').insert({
      organization_id: orgId, title: title.trim(), target_amount: DEPOSIT_TARGET, investor_id: invId, created_by: profile?.name || null,
    })
    setSaving(false)
    if (error) { toast.error('新增失敗：' + error.message); return }
    setTitle(''); setInvId(''); setShowAdd(false); toast.success('已新增訂金案'); reload()
  }

  const delDeposit = async (d) => {
    if (!(await confirm({ message: `刪除訂金「${d.title}」及其所有收款明細？（若已開加盟金會被擋）` }))) return
    const { error } = await supabase.from('deposit_records').delete().eq('id', d.id)
    if (error) { toast.error(error.message.includes('foreign') ? '此訂金已開加盟金，不能刪' : '刪除失敗：' + error.message); return }
    toast.success('已刪除'); reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><Plus size={14} /> 新增訂金案</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>標的 / 案子名稱</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：台中大墩加盟案" autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>投資人</label>
            <InvestorPicker value={invId} onChange={setInvId} investors={investors} addInvestor={addInvestor} />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>目標（固定）</label>
            <input className="form-input" value={fmt(DEPOSIT_TARGET)} disabled style={{ opacity: .7 }} />
          </div>
          <button className="btn btn-primary" onClick={addDeposit} disabled={saving}>{saving ? '儲存中…' : '建立'}</button>
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th><th>標的</th><th>投資人</th>
              <th style={{ minWidth: 180 }}>收款進度</th><th>狀態</th><th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {deposits.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無訂金案</td></tr>}
            {deposits.map(d => {
              const isExp = expanded === d.id
              const inv = invById[d.investor_id]
              return (
                <Grp key={d.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : d.id)}>
                    <td>{isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>{d.title}</td>
                    <td>{inv ? <>{inv.name}{inv.company ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>（{inv.company}）</span> : null}</> : '—'}</td>
                    <td><Progress paid={n(d.paid_total)} target={n(d.target_amount)} /></td>
                    <td><StatusPill done={d.status === 'completed'} /></td>
                    <td><button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={e => { e.stopPropagation(); delDeposit(d) }}><Trash2 size={13} style={{ color: 'var(--accent-red)' }} /></button></td>
                  </tr>
                  {isExp && (
                    <tr><td colSpan={6} style={{ padding: 0 }}>
                      <PaymentEditor rows={paysByDep[d.id] || []} max={Math.max(0, n(d.target_amount) - n(d.paid_total))}
                        onAdd={async ({ paid_date, amount, note }) => {
                          const { error } = await supabase.from('deposit_payments').insert({ organization_id: orgId, deposit_id: d.id, paid_date, amount, note: note || null, created_by: profile?.name || null })
                          if (error) { toast.error('新增失敗：' + error.message); return false }
                          toast.success('已記錄收款'); reload(); return true
                        }}
                        onDelete={async (row) => { const { error } = await supabase.from('deposit_payments').delete().eq('id', row.id); if (error) { toast.error('刪除失敗：' + error.message); return } reload() }}
                      />
                    </td></tr>
                  )}
                </Grp>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════ 加盟金 ══════════════════════════════
function FranchiseTab({ orgId, profile, franchises, ffInvestors, ffPays, deposits, investors, addInvestor, reload }) {
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [total, setTotal] = useState('')
  const [allocs, setAllocs] = useState([{ investor_id: '', amount: '' }])   // 分攤列
  const [expanded, setExpanded] = useState(null)
  const [saving, setSaving] = useState(false)

  // 加盟金投資人只能從「已付訂金(訂金收款完成)」的投資人裡選
  const eligibleInvestors = useMemo(() => {
    const ok = new Set(deposits.filter(d => d.status === 'completed' && d.investor_id).map(d => d.investor_id))
    return investors.filter(i => ok.has(i.id))
  }, [deposits, investors])
  const invById = useMemo(() => Object.fromEntries(investors.map(i => [i.id, i])), [investors])
  // ★ 固定排序：記款會 UPDATE ffi 列 → 實體順序會變 → 每次 reload 區塊會跳。
  //   照分攤額大→小(同額用 investor_id)排,順序穩定不再跳。
  const ffiByFf = useMemo(() => {
    const m = {}
    ffInvestors.forEach(x => { (m[x.franchise_fee_id] ||= []).push(x) })
    Object.values(m).forEach(arr => arr.sort((a, b) => n(b.amount) - n(a.amount) || String(a.investor_id).localeCompare(String(b.investor_id))))
    return m
  }, [ffInvestors])
  const paysByFf = useMemo(() => { const m = {}; ffPays.forEach(p => { (m[p.franchise_fee_id] ||= []).push(p) }); return m }, [ffPays])

  const allocSum = allocs.reduce((s, a) => s + n(a.amount), 0)
  const pickedIds = allocs.map(a => a.investor_id).filter(Boolean)
  const setAlloc = (i, k, v) => setAllocs(prev => prev.map((a, idx) => idx === i ? { ...a, [k]: v } : a))

  const resetForm = () => { setTitle(''); setTotal(''); setAllocs([{ investor_id: '', amount: '' }]) }

  const addFranchise = async () => {
    if (!title.trim()) { toast.warning('請填標的名稱'); return }
    if (n(total) <= 0) { toast.warning('請填總額'); return }
    const rows = allocs.filter(a => a.investor_id && n(a.amount) > 0)
    if (rows.length === 0) { toast.warning('至少一位投資人 + 分攤金額'); return }
    if (new Set(rows.map(r => r.investor_id)).size !== rows.length) { toast.warning('同一投資人重複了'); return }
    if (Math.abs(allocSum - n(total)) > 0.5) { toast.warning(`分攤加總 ${fmt(allocSum)} ≠ 總額 ${fmt(n(total))}`); return }
    setSaving(true)
    const { data: ff, error } = await supabase.from('franchise_fees').insert({
      organization_id: orgId, title: title.trim(), total_amount: n(total), created_by: profile?.name || null,
    }).select().single()
    if (error) { setSaving(false); toast.error('建立失敗：' + error.message); return }
    const { error: e2 } = await supabase.from('franchise_fee_investors').insert(
      rows.map(r => ({ organization_id: orgId, franchise_fee_id: ff.id, investor_id: r.investor_id, amount: n(r.amount) }))
    )
    setSaving(false)
    if (e2) { toast.error('分攤寫入失敗：' + e2.message); reload(); return }
    resetForm(); setShowAdd(false); toast.success('已建立加盟金收款'); reload()
  }

  const delFranchise = async (f) => {
    if (!(await confirm({ message: '刪除此加盟金收款及其所有分攤/明細？' }))) return
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
          {(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>標的 / 案名</label>
                  <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：台中大墩加盟案" autoFocus />
                </div>
                <div style={{ minWidth: 160 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>加盟金總額</label>
                  <input className="form-input" type="number" value={total} onChange={e => setTotal(e.target.value)} placeholder="0" />
                </div>
              </div>

              {/* 投資人分攤 */}
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>投資人分攤（每位金額各自拆 45 / 45 / 10 三期，加總須等於總額）— 只能選「已付訂金」的投資人</div>
                {eligibleInvestors.length === 0 && <div style={{ fontSize: 12, color: 'var(--accent-orange)', marginBottom: 6 }}>⚠ 目前沒有「訂金收款完成」的投資人，先到「訂金」讓投資人付滿 30 萬。</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allocs.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <InvestorPicker value={a.investor_id} onChange={v => setAlloc(i, 'investor_id', v)}
                        investors={eligibleInvestors} addInvestor={addInvestor} noAdd exclude={pickedIds.filter(id => id !== a.investor_id)} />
                      <input className="form-input" type="number" value={a.amount} onChange={e => setAlloc(i, 'amount', e.target.value)} placeholder="分攤金額" style={{ width: 140 }} />
                      {n(a.amount) > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>三期 {stageTargets(a.amount).map(fmt).join(' / ')}</span>}
                      {allocs.length > 1 && <button className="btn btn-secondary" style={{ padding: '5px 8px' }} onClick={() => setAllocs(prev => prev.filter((_, idx) => idx !== i))}><X size={13} /></button>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                  <button className="btn btn-secondary" style={{ padding: '5px 10px' }} onClick={() => setAllocs(prev => [...prev, { investor_id: '', amount: '' }])}><Plus size={13} /> 加一位</button>
                  <span style={{ fontSize: 12, color: Math.abs(allocSum - n(total)) > 0.5 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    分攤加總 {fmt(allocSum)} {n(total) > 0 ? `/ 總額 ${fmt(n(total))}` : ''} {n(total) > 0 && (Math.abs(allocSum - n(total)) > 0.5 ? '✗ 不符' : '✓')}
                  </span>
                </div>
              </div>

              <div><button className="btn btn-primary" onClick={addFranchise} disabled={saving}>{saving ? '建立中…' : '建立'}</button></div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th><th>標的</th><th>投資人</th>
              <th style={{ minWidth: 180 }}>總進度</th><th>狀態</th><th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {franchises.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無加盟金收款</td></tr>}
            {franchises.map(f => {
              const isExp = expanded === f.id
              const done = f.status === 'completed'
              const ffis = ffiByFf[f.id] || []
              const pays = paysByFf[f.id] || []
              return (
                <Grp key={f.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : f.id)}>
                    <td>{isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>{f.title || '—'}</td>
                    <td style={{ fontSize: 12 }}>{ffis.map(x => invById[x.investor_id]?.name || '?').join('、') || '—'}</td>
                    <td><Progress paid={n(f.paid_total)} target={n(f.total_amount)} /></td>
                    <td><StatusPill done={done} doneText="收款成功" /></td>
                    <td><button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={e => { e.stopPropagation(); delFranchise(f) }}><Trash2 size={13} style={{ color: 'var(--accent-red)' }} /></button></td>
                  </tr>
                  {isExp && (
                    <tr><td colSpan={6} style={{ padding: 0 }}>
                      <div style={{ background: 'var(--glass-light)', padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 18 }}>
                        {ffis.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>此加盟金尚無投資人分攤</div>}
                        {ffis.map(ffi => {
                          const inv = invById[ffi.investor_id]
                          const targets = stageTargets(ffi.amount)
                          const paidStages = [n(ffi.paid_stage1), n(ffi.paid_stage2), n(ffi.paid_stage3)]
                          const invDone = paidStages.every((p, i) => p >= targets[i])
                          return (
                            <div key={ffi.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12, background: 'var(--bg-card)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <div style={{ fontWeight: 700, fontSize: 14 }}>
                                  {inv?.name || '?'}{inv?.company ? <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 500 }}>（{inv.company}）</span> : null}
                                  <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, marginLeft: 8 }}>分攤 {fmt(n(ffi.amount))}</span>
                                </div>
                                <StatusPill done={invDone} doneText="已收滿" />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {[0, 1, 2].map(si => {
                                  const stage = si + 1
                                  const pct = [45, 45, 10][si]
                                  const stagePays = pays.filter(p => p.investor_id === ffi.investor_id && p.stage === stage)
                                  return (
                                    <div key={stage}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                        <div style={{ fontWeight: 600, fontSize: 12 }}>第 {stage} 期 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>（{pct}%）</span></div>
                                        <Progress small paid={paidStages[si]} target={targets[si]} />
                                      </div>
                                      <PaymentEditor compact rows={stagePays} max={Math.max(0, targets[si] - paidStages[si])}
                                        onAdd={async ({ paid_date, amount, note }) => {
                                          const { error } = await supabase.from('franchise_fee_payments').insert({
                                            organization_id: orgId, franchise_fee_id: f.id, investor_id: ffi.investor_id, stage, paid_date, amount, note: note || null, created_by: profile?.name || null,
                                          })
                                          if (error) { toast.error('新增失敗：' + error.message); return false }
                                          toast.success(`已記錄 ${inv?.name || ''} 第 ${stage} 期`); reload(); return true
                                        }}
                                        onDelete={async (row) => { const { error } = await supabase.from('franchise_fee_payments').delete().eq('id', row.id); if (error) { toast.error('刪除失敗：' + error.message); return } reload() }}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </td></tr>
                  )}
                </Grp>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════ 投資人名冊 ══════════════════════════════
function InvestorTab({ orgId, profile, investors, deposits, ffInvestors, addInvestor, reload }) {
  const [form, setForm] = useState({ company: '', name: '', phone: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  // 被訂金或加盟金分攤引用 → 不能刪
  const usedIds = useMemo(() => {
    const s = new Set()
    deposits.forEach(d => d.investor_id && s.add(d.investor_id))
    ffInvestors.forEach(x => s.add(x.investor_id))
    return s
  }, [deposits, ffInvestors])

  const add = async () => {
    setSaving(true)
    const row = await addInvestor(form)
    setSaving(false)
    if (row) { setForm({ company: '', name: '', phone: '' }); setShowAdd(false); toast.success('已新增投資人') }
  }

  const del = async (i) => {
    if (usedIds.has(i.id)) { toast.error('此投資人已用於訂金/加盟金，不能刪'); return }
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
          <thead><tr><th>公司</th><th>名字</th><th>電話</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {investors.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無投資人</td></tr>}
            {investors.map(i => (
              <tr key={i.id}>
                <td style={{ color: i.company ? 'var(--text-primary)' : 'var(--text-muted)' }}>{i.company || '—'}</td>
                <td style={{ fontWeight: 600 }}>{i.name}</td>
                <td>{i.phone}</td>
                <td><button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={() => del(i)} title={usedIds.has(i.id) ? '已被引用，不能刪' : '刪除'}>
                  <Trash2 size={13} style={{ color: usedIds.has(i.id) ? 'var(--text-muted)' : 'var(--accent-red)' }} />
                </button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 共用：一組收款明細 + 新增列（max：本期/本案剩餘上限，超收擋下）──
function PaymentEditor({ rows, onAdd, onDelete, compact, max }) {
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const capped = max != null
  const remaining = capped ? Math.max(0, n(max)) : null
  const full = capped && remaining <= 0.5

  const submit = async () => {
    if (n(amount) <= 0) { toast.warning('金額要 > 0'); return }
    if (capped && n(amount) > remaining + 0.5) { toast.warning(`超過剩餘上限，最多再記 ${fmt(remaining)}`); return }
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
              <button className="btn btn-secondary" style={{ padding: '1px 5px' }} onClick={() => onDelete(p)}><Trash2 size={12} style={{ color: 'var(--accent-red)' }} /></button>
            </div>
          </div>
        ))}
      </div>
      {full ? (
        <div style={{ fontSize: 12, color: 'var(--accent-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={13} /> 已收滿</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
          <input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={capped ? `金額（最多 ${fmt(remaining)}）` : '金額'} style={{ width: capped ? 180 : 120 }} />
          <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="備註（選填）" style={{ flex: 1, minWidth: 120 }} />
          <button className="btn btn-primary" style={{ padding: '6px 12px' }} onClick={submit} disabled={busy}><Plus size={13} /> {busy ? '記錄中…' : '記一筆'}</button>
        </div>
      )}
    </div>
  )
}

function Grp({ children }) { return <>{children}</> }
