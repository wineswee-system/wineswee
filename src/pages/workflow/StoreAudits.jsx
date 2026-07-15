import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { ModalOverlay } from '../../components/Modal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import StoreAuditDetailModal from '../../components/audit/StoreAuditDetailModal'

const STATUS_BADGE = {
  '草稿':   { bg: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)' },
  '待確認': { bg: 'rgba(99,102,241,0.15)',   color: '#6366f1' },
  '申請中': { bg: 'rgba(245,158,11,0.15)',   color: 'var(--accent-orange)' },
  '已核准': { bg: 'rgba(34,197,94,0.15)',    color: 'var(--accent-green)' },
  '已退回': { bg: 'rgba(239,68,68,0.15)',    color: 'var(--accent-red)' },
}

const SHIFTS = ['開店', '早班', '中班', '晚班', '打烊班']

export default function StoreAudits() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState([])
  const [stores, setStores] = useState([])
  const [chains, setChains] = useState([])

  const [filterStatus, setFilterStatus] = useState('all')
  const [filterStoreId, setFilterStoreId] = useState('')
  const [search, setSearch] = useState('')

  const [showNew, setShowNew] = useState(false)
  const [detailId, setDetailId] = useState(null)

  const [searchParams, setSearchParams] = useSearchParams()
  // 從任務綁定跳過來：?new=1&binding_id=N → 自動開新建 modal
  const bindingId = searchParams.get('binding_id')
    ? Number(searchParams.get('binding_id')) : null
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowNew(true)
      // 開完就把 new=1 拿掉，避免關 modal 再回來又彈出（binding_id 留著給 onCreated 用）
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const orgId = profile?.organization_id

  const load = async () => {
    if (!orgId) return
    setLoading(true)
    const [a, s, c] = await Promise.all([
      supabase.from('store_audits')
        .select('id, store_id, store_name, audit_date, shift, auditor_name, status, avg_score, total_deducted, created_at, approved_at')
        .eq('organization_id', orgId)
        .order('id', { ascending: false }),
      supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
      // 走 form_chain_configs 拿綁定 store_audit 的 chain（single mode 對應的綁定表）
      supabase.from('form_chain_configs').select('chain_id').eq('form_type', 'store_audit').eq('organization_id', orgId).maybeSingle(),
    ])
    setList(a.data || [])
    setStores(s.data || [])
    setChains(c.data?.chain_id ? [c.data] : [])  // [{chain_id:n}]
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  // 刪除草稿（只有草稿可刪；走 SECURITY DEFINER RPC 連子表一起刪）
  const handleDeleteDraft = async (e, r) => {
    e.stopPropagation()  // 別觸發開明細
    const ok = await confirm({ message: `確定刪除草稿稽核單 #${r.id}（${r.store_name}）？此動作無法復原。` })
    if (!ok) return
    const { data, error } = await supabase.rpc('delete_store_audit_draft', { p_id: r.id })
    if (error || !data?.ok) {
      toast.error('刪除失敗：' + (error?.message || data?.error || '未知'))
      return
    }
    toast.success(`已刪除草稿 #${r.id}`)
    load()
  }

  const filtered = useMemo(() => {
    let arr = list
    if (filterStatus !== 'all') arr = arr.filter(r => r.status === filterStatus)
    if (filterStoreId) arr = arr.filter(r => r.store_id === Number(filterStoreId))
    if (search.trim()) {
      const s = search.trim()
      arr = arr.filter(r => r.store_name?.includes(s) || r.auditor_name?.includes(s) || String(r.id).includes(s))
    }
    return arr
  }, [list, filterStatus, filterStoreId, search])

  if (loading) return <LoadingSpinner />

  const counts = {
    all: list.length,
    草稿: list.filter(r => r.status === '草稿').length,
    待確認: list.filter(r => r.status === '待確認').length,
    申請中: list.filter(r => r.status === '申請中').length,
    已核准: list.filter(r => r.status === '已核准').length,
    已退回: list.filter(r => r.status === '已退回').length,
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><ClipboardCheck size={20} style={{ display: 'inline', marginRight: 6 }} />門市稽核</h2>
            <p>共 {list.length} 筆 · 待確認 {counts['待確認']} · 簽核中 {counts['申請中']}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link to="/process/settings/chains/edit?formType=store_audit&label=門市稽核&mode=single"
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              title="設定門市稽核專用的簽核流程">
              <Settings size={16} /> 稽核簽核設定
            </Link>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              <Plus size={16} /> 新增稽核單
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', '草稿', '待確認', '申請中', '已核准', '已退回'].map(s => (
            <button key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, border: 'none', cursor: 'pointer',
                background: filterStatus === s ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                color: filterStatus === s ? '#fff' : 'var(--text-secondary)',
              }}>
              {s === 'all' ? '全部' : s} ({counts[s] || 0})
            </button>
          ))}
        </div>
        <select className="form-input" style={{ width: 180 }} value={filterStoreId} onChange={e => setFilterStoreId(e.target.value)}>
          <option value="">全部門市</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" placeholder="搜尋門市/稽核員/單號" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 28 }} />
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>單號</th>
                <th>門市</th>
                <th>稽核日期</th>
                <th>班次</th>
                <th>稽核員</th>
                <th>總平均</th>
                <th>狀態</th>
                <th>建立</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>沒有符合的稽核單</td></tr>
              )}
              {filtered.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                return (
                  <tr key={r.id} onClick={() => setDetailId(r.id)} style={{ cursor: 'pointer' }} title="點擊查看明細">
                    <td><b>#{r.id}</b></td>
                    <td>{r.store_name}</td>
                    <td>{r.audit_date}</td>
                    <td>{r.shift || '—'}</td>
                    <td>{r.auditor_name}</td>
                    <td style={{ fontWeight: 700, color: r.avg_score >= 90 ? 'var(--accent-green)' : r.avg_score >= 70 ? 'var(--accent-orange)' : r.avg_score > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {r.avg_score > 0 ? r.avg_score : '—'}
                    </td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {r.status === '草稿' && (
                        <button onClick={e => handleDeleteDraft(e, r)} title="刪除草稿"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4, display: 'inline-flex' }}>
                          <Trash2 size={15} />
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

      {showNew && (
        <NewAuditModal
          stores={stores}
          boundChainId={chains[0]?.chain_id || null}
          orgId={orgId}
          auditor={profile}
          bindingId={bindingId}
          onClose={() => setShowNew(false)}
          onCreated={id => {
            setShowNew(false); setDetailId(id); load()
            // 從任務綁定來的就把 binding_id 清掉
            if (bindingId) {
              const next = new URLSearchParams(searchParams)
              next.delete('binding_id')
              setSearchParams(next, { replace: true })
            }
          }}
        />
      )}

      {detailId && (
        <StoreAuditDetailModal
          auditId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => { load() }}
        />
      )}
    </div>
  )
}

// ─── 新增稽核單 modal（只填表頭，建立後自動帶 142 個評核項目）─────
function NewAuditModal({ stores, boundChainId, orgId, auditor, bindingId, onClose, onCreated }) {
  const today = new Date().toISOString().slice(0, 10)
  const [storeId, setStoreId] = useState('')
  const [date, setDate] = useState(today)
  const [shifts, setShifts] = useState([])
  const toggleShift = (sh) => setShifts(prev => prev.includes(sh) ? prev.filter(x => x !== sh) : [...prev, sh])
  const [arrive, setArrive] = useState('')
  const [depart, setDepart] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!storeId) { toast.warning('請選門市'); return }
    if (!date) { toast.warning('請選稽核日期'); return }
    setSaving(true)
    const store = stores.find(s => s.id === Number(storeId))
    const { data, error } = await supabase.from('store_audits').insert({
      organization_id: orgId,
      store_id: Number(storeId),
      store_name: store?.name || '',
      audit_date: date,
      shift: shifts.length ? shifts.join('、') : null,
      arrive_time: arrive || null,
      depart_time: depart || null,
      auditor_id: auditor?.id || null,
      auditor_name: auditor?.name || '',
      approval_chain_id: boundChainId || null,  // 自動綁設定好的 chain
      status: '草稿',
      linked_binding_id: bindingId || null,  // 從任務綁定跳過來時帶上
    }).select().single()
    setSaving(false)
    if (error) { toast.error('建立失敗：' + error.message); return }
    toast.success('已建立，請填寫評核項目')
    onCreated(data.id)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card" style={{ width: 'min(520px, 92vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0 }}>新增門市稽核單</h3>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 12, overflowY: 'auto', flex: 1 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>門市 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <select className="form-input" value={storeId} onChange={e => setStoreId(e.target.value)} style={{ width: '100%' }}>
              <option value="">請選擇</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>稽核日期 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>視察班別（可複選）</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {SHIFTS.map(sh => {
                const on = shifts.includes(sh)
                return (
                  <button key={sh} type="button" onClick={() => toggleShift(sh)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                      border: on ? '1px solid var(--accent-cyan)' : '1px solid var(--border)',
                      background: on ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                      color: on ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    }}>
                    {on ? '✓ ' : ''}{sh}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>到店時間</label>
              <input type="time" className="form-input" value={arrive} onChange={e => setArrive(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>離店時間</label>
              <input type="time" className="form-input" value={depart} onChange={e => setDepart(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 10, background: 'var(--bg-secondary)', borderRadius: 6 }}>
            {boundChainId
              ? '✓ 將套用「稽核簽核設定」中的簽核流程'
              : '⚠ 尚未設定稽核簽核流程，送出後將直接核准（點頁面右上「稽核簽核設定」前往設定）'}
          </div>
        </div>
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? '建立中…' : '建立 + 填表'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
