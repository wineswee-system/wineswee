import { useState, useMemo } from 'react'
import { X, Search, UserPlus, UserMinus, Store as StoreIcon, Users, Shuffle } from 'lucide-react'
import { ModalOverlay } from '../../../components/Modal'
import { updateEmployee } from '../../../lib/db'
import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'

// 門市員工名冊 — 「從門市選員工」的反向指派 UI。
//   左區:主要門市成員(store_id)。加入=把人的主要門市改成本店(自動搬離原店,排班跟著人走不刪)。
//   右區:跨店支援(additional_stores 存門市「名字」)。純加減,不動主要門市。
export default function StoreRosterModal({ store, employees, onClose, onPatch }) {
  const [saving, setSaving] = useState(null)     // 正在存的員工 id
  const [bulkBusy, setBulkBusy] = useState(false)
  const [qMain, setQMain] = useState('')
  const [qCross, setQCross] = useState('')

  const active = useMemo(() => employees.filter(e => e.status === '在職'), [employees])
  const storeNameOf = (e) => e.stores?.name || e.store || ''

  const mainMembers = active.filter(e => e.store_id === store.id)
  const crossMembers = active.filter(e => e.store_id !== store.id && (e.additional_stores || []).includes(store.name))

  const match = (e, q) => {
    if (!q) return true
    const s = q.toLowerCase()
    return [e.name, e.name_en, e.position, e.employee_number, storeNameOf(e)].some(x => String(x || '').toLowerCase().includes(s))
  }
  const mainCandidatesAll = active.filter(e => e.store_id !== store.id && match(e, qMain))
  const crossCandidatesAll = active.filter(e => e.store_id !== store.id && !(e.additional_stores || []).includes(store.name) && match(e, qCross))
  const mainCandidates = mainCandidatesAll.slice(0, 60)
  const crossCandidates = crossCandidatesAll.slice(0, 60)

  const assignMain = async (emp) => {
    setSaving(emp.id)
    const { error } = await updateEmployee(emp.id, { store_id: store.id })
    setSaving(null)
    if (error) { toast.error('指派失敗:' + (error.message || '')); return }
    onPatch(emp.id, { store_id: store.id, store: store.name, stores: { name: store.name } })
    toast.success(`已把 ${emp.name} 指派到 ${store.name}`)
  }
  const removeMain = async (emp) => {
    if (!(await confirm({ message: `把「${emp.name}」從「${store.name}」的主要門市移除?移除後他將沒有主要門市,需另外指派。`, danger: true, confirmLabel: '移除' }))) return
    setSaving(emp.id)
    const { error } = await updateEmployee(emp.id, { store_id: null, store: null })
    setSaving(null)
    if (error) { toast.error('移除失敗:' + (error.message || '')); return }
    onPatch(emp.id, { store_id: null, store: null, stores: null })
    toast.success(`已把 ${emp.name} 移出 ${store.name}`)
  }
  const addCross = async (emp) => {
    const next = [...new Set([...(emp.additional_stores || []), store.name])]
    setSaving(emp.id)
    const { error } = await updateEmployee(emp.id, { additional_stores: next })
    setSaving(null)
    if (error) { toast.error('加入失敗:' + (error.message || '')); return }
    onPatch(emp.id, { additional_stores: next })
    toast.success(`已把 ${emp.name} 加為 ${store.name} 跨店支援`)
  }
  const removeCross = async (emp) => {
    const next = (emp.additional_stores || []).filter(s => s !== store.name && s !== store.id)
    setSaving(emp.id)
    const { error } = await updateEmployee(emp.id, { additional_stores: next })
    setSaving(null)
    if (error) { toast.error('移除失敗:' + (error.message || '')); return }
    onPatch(emp.id, { additional_stores: next })
    toast.success(`已移除 ${emp.name} 的 ${store.name} 跨店支援`)
  }

  // 批次:把目前搜尋清單「全部加入」,免得一個一個點
  const bulkAssignMain = async (list) => {
    if (!list.length) return
    if (!(await confirm({ message: `把這 ${list.length} 位員工的主要門市全部改成「${store.name}」?原本在別店的會一起搬過來(排班跟著人不刪)。`, confirmLabel: `全部加入 ${list.length} 位` }))) return
    setBulkBusy(true)
    const results = await Promise.all(list.map(e => updateEmployee(e.id, { store_id: store.id }).then(r => ({ e, r }))))
    setBulkBusy(false)
    let ok = 0
    results.forEach(({ e, r }) => { if (!r.error) { onPatch(e.id, { store_id: store.id, store: store.name, stores: { name: store.name } }); ok++ } })
    if (ok < list.length) toast.error(`${list.length - ok} 位加入失敗(可能無權限)`)
    if (ok > 0) toast.success(`已把 ${ok} 位加入 ${store.name}`)
  }
  const bulkAddCross = async (list) => {
    if (!list.length) return
    if (!(await confirm({ message: `把這 ${list.length} 位員工全部加為「${store.name}」跨店支援?(主要門市不變)`, confirmLabel: `全部加入 ${list.length} 位` }))) return
    setBulkBusy(true)
    const results = await Promise.all(list.map(e => {
      const next = [...new Set([...(e.additional_stores || []), store.name])]
      return updateEmployee(e.id, { additional_stores: next }).then(r => ({ e, r, next }))
    }))
    setBulkBusy(false)
    let ok = 0
    results.forEach(({ e, r, next }) => { if (!r.error) { onPatch(e.id, { additional_stores: next }); ok++ } })
    if (ok < list.length) toast.error(`${list.length - ok} 位加入失敗(可能無權限)`)
    if (ok > 0) toast.success(`已把 ${ok} 位加為 ${store.name} 跨店支援`)
  }

  const empLine = (e) => `${e.position || '—'}${storeNameOf(e) ? ` · 原 ${storeNameOf(e)}` : ''}`

  return (
    <ModalOverlay onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 12, width: 'min(920px, 96vw)', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: '1px solid var(--border-medium)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StoreIcon size={20} color="var(--accent-cyan)" />
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>管理員工 — {store.name}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}><X size={22} /></button>
        </div>

        {/* Body: two columns */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* LEFT: primary members */}
          <Section
            icon={<Users size={15} color="var(--accent-cyan)" />}
            title="主要門市成員"
            hint="這間店主要的員工。加入會把人的主要門市改成本店(自動搬離原店,排班跟著人走)。"
            count={mainMembers.length}
            accent="var(--accent-cyan)"
            members={mainMembers}
            renderMember={(e) => (
              <MemberRow key={e.id} name={e.name} line={e.position || '—'} busy={saving === e.id}
                onRemove={() => removeMain(e)} removeTitle="移出主要門市" />
            )}
            q={qMain} setQ={setQMain}
            candidates={mainCandidates}
            bulkCount={mainCandidatesAll.length}
            bulkBusy={bulkBusy}
            onBulkAdd={() => bulkAssignMain(mainCandidatesAll)}
            renderCandidate={(e) => (
              <CandidateRow key={e.id} name={e.name} line={empLine(e)} busy={saving === e.id}
                icon={e.store_id ? <Shuffle size={13} /> : <UserPlus size={13} />}
                label={e.store_id ? '搬來這店' : '加入'} onAdd={() => assignMain(e)} />
            )}
          />
          <div style={{ width: 1, background: 'var(--border-subtle)', flexShrink: 0 }} />
          {/* RIGHT: cross-store supporters */}
          <Section
            icon={<Shuffle size={15} color="var(--accent-orange)" />}
            title="跨店支援"
            hint="主要門市不變,額外「也能排到本店 / 來本店打卡」。適合支援人力。"
            count={crossMembers.length}
            accent="var(--accent-orange)"
            members={crossMembers}
            renderMember={(e) => (
              <MemberRow key={e.id} name={e.name} line={`原 ${storeNameOf(e) || '—'}`} busy={saving === e.id}
                onRemove={() => removeCross(e)} removeTitle="移除跨店支援" />
            )}
            q={qCross} setQ={setQCross}
            candidates={crossCandidates}
            bulkCount={crossCandidatesAll.length}
            bulkBusy={bulkBusy}
            bulkAccent="var(--accent-orange)"
            onBulkAdd={() => bulkAddCross(crossCandidatesAll)}
            renderCandidate={(e) => (
              <CandidateRow key={e.id} name={e.name} line={empLine(e)} busy={saving === e.id}
                icon={<UserPlus size={13} />} label="加為支援" accent="var(--accent-orange)" onAdd={() => addCross(e)} />
            )}
          />
        </div>
      </div>
    </ModalOverlay>
  )
}

function Section({ icon, title, hint, count, accent, members, renderMember, q, setQ, candidates, renderCandidate, bulkCount = 0, bulkBusy, bulkAccent = 'var(--accent-cyan)', onBulkAdd }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
          {icon} {title}
          <span style={{ fontSize: 12, fontWeight: 700, padding: '1px 9px', borderRadius: 20, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>{count}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{hint}</div>
      </div>
      {/* current members */}
      <div style={{ padding: '0 18px', maxHeight: 200, overflowY: 'auto' }}>
        {members.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>尚無</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{members.map(renderMember)}</div>}
      </div>
      {/* add picker */}
      <div style={{ padding: '12px 18px 6px', borderTop: '1px dashed var(--border-subtle)', marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="form-input" style={{ width: '100%', paddingLeft: 32 }} placeholder="搜尋員工加入…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {onBulkAdd && (
            <button disabled={bulkBusy || bulkCount === 0} onClick={onBulkAdd} title="把目前清單全部加入"
              style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 12px', borderRadius: 8,
                border: 'none', cursor: (bulkBusy || bulkCount === 0) ? 'default' : 'pointer', fontSize: 13, fontWeight: 700,
                background: bulkAccent, color: '#fff', opacity: (bulkBusy || bulkCount === 0) ? 0.45 : 1, whiteSpace: 'nowrap',
              }}>
              <Users size={14} /> {bulkBusy ? '加入中…' : `全部加入${bulkCount ? ` (${bulkCount})` : ''}`}
            </button>
          )}
        </div>
      </div>
      <div style={{ padding: '0 18px 16px', flex: 1, overflowY: 'auto' }}>
        {candidates.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>{q ? '查無符合員工' : '打字搜尋要加入的員工'}</div>
          : <>
              {bulkCount > candidates.length && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 0 8px' }}>顯示前 {candidates.length} 位;「全部加入」會處理全部 {bulkCount} 位</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{candidates.map(renderCandidate)}</div>
            </>}
      </div>
    </div>
  )
}

function MemberRow({ name, line, busy, onRemove, removeTitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{line}</div>
      </div>
      <button className="btn btn-sm btn-secondary" disabled={busy} title={removeTitle} onClick={onRemove} style={{ color: 'var(--accent-red)', flexShrink: 0 }}>
        <UserMinus size={13} />
      </button>
    </div>
  )
}

function CandidateRow({ name, line, busy, icon, label, accent = 'var(--accent-cyan)', onAdd }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</div>
      </div>
      <button disabled={busy} onClick={onAdd} style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 7,
        border: 'none', cursor: busy ? 'default' : 'pointer', fontSize: 12, fontWeight: 700,
        background: accent, color: '#fff', opacity: busy ? 0.5 : 1,
      }}>{icon} {label}</button>
    </div>
  )
}
