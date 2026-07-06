import { useMemo, useState } from 'react'
import { FileCheck2, Plus, CalendarDays, X } from 'lucide-react'
import { ModalOverlay } from '../../components/Modal'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getNotes } from '../../lib/db/notes'
import { NOTE_KINDS, nextStates, dueSoon, registerNote, transitionNote } from '../../lib/accounting'
import { useDbQuery } from '../../lib/hooks/useDbQuery'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'
import { confirm } from '../../lib/confirm'
import { fmtNT as fmt } from '../../lib/currency'

// F-A4 票據管理：登錄 → 狀態機操作（每次轉換自動拋傳票）+ 到期日曆

const STATUS_BADGE = {
  '在庫': { status: 'info' },
  '託收': { status: 'warning' },
  '兌現': { status: 'success' },
  '退票': { status: 'error' },
  '轉回': { color: 'gray' },
  '開立': { status: 'info' },
  '作廢': { color: 'gray' },
}

// 破壞性/警示動作用色（其餘走 secondary）
const ACTION_VARIANT = { bounce: 'danger', void: 'danger' }

const inputStyle = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)',
}

const emptyForm = { note_number: '', bank: '', due_date: '', amount: '', party_name: '', memo: '' }

/** 週起日（週一）— 到期日曆分組鍵 */
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  const day = (d.getDay() + 6) % 7 // Mon=0
  d.setDate(d.getDate() - day)
  return d
}

const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`

export default function NotesManagement() {
  const orgId = useOrgId()
  const [kind, setKind] = useState('receivable')
  const [creating, setCreating] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { data: notes = [], isLoading, refetch } = useDbQuery(
    ['org', orgId, 'notes', kind],
    () => getNotes(kind, orgId).then(r => { if (r.error) throw r.error; return r.data ?? [] }),
    { enabled: !!orgId },
  )

  // 30 日內到期（含逾期）提示 + 到期日曆（依週分組，僅未了結票據）
  const dueList = useMemo(() => dueSoon(notes, 30), [notes])
  const dueSet = useMemo(() => new Set(dueList.map(n => n.id)), [dueList])
  const calendarWeeks = useMemo(() => {
    const groups = new Map()
    for (const n of dueSoon(notes, 90)) { // 日曆看 90 天，30 天內另掛提示 Badge
      const start = weekStart(n.due_date)
      const key = start.toISOString().slice(0, 10)
      if (!groups.has(key)) groups.set(key, { start, notes: [] })
      groups.get(key).notes.push(n)
    }
    return [...groups.values()].sort((a, b) => a.start - b.start)
  }, [notes])

  const handleRegister = async () => {
    setError(null)
    setBusy(true)
    try {
      await registerNote(kind, {
        note_number: creating.note_number,
        bank: creating.bank || undefined,
        due_date: creating.due_date || undefined,
        amount: Number(creating.amount),
        party_name: creating.party_name || undefined,
        memo: creating.memo || undefined,
      })
      setCreating(null)
      refetch()
    } catch (err) {
      setError(err.message)
      logger.error('[NotesManagement] 票據登錄失敗', { kind, error: err.message })
    } finally {
      setBusy(false)
    }
  }

  const handleAction = async (note, move) => {
    setError(null)
    const ok = await confirm({
      message: `票據 ${note.note_number}：${note.status} → ${move.to}（${move.label}）？將自動拋轉傳票。`,
    })
    if (!ok) return
    setBusy(true)
    try {
      await transitionNote(kind, note.id, move.action)
      refetch()
    } catch (err) {
      setError(err.message)
      logger.error('[NotesManagement] 狀態轉換失敗', { kind, noteId: note.id, action: move.action, error: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <LoadingSpinner />

  const dueBadge = (note) => {
    if (!dueSet.has(note.id)) return null
    const d = dueList.find(n => n.id === note.id)?._dueInDays ?? 0
    return d < 0
      ? <Badge status="error" size="sm">已逾期 {-d} 天</Badge>
      : <Badge status="warning" size="sm">{d === 0 ? '今日到期' : `${d} 天內到期`}</Badge>
  }

  return (
    <div className="fade-in">
      <PageHeader
        icon={FileCheck2}
        title="票據管理"
        description="Notes Management — 應收/應付票據登錄、託收/兌現/退票狀態機與到期日曆（F-A4）"
        actions={<Button variant="primary" icon={Plus} onClick={() => { setError(null); setCreating({ ...emptyForm }) }}>
          登錄{NOTE_KINDS[kind]}
        </Button>}
      />

      {error && !creating && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* AR / AP 分頁 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {Object.entries(NOTE_KINDS).map(([k, label]) => (
          <Button key={k} size="sm" variant={kind === k ? 'primary' : 'secondary'} onClick={() => { setKind(k); setError(null) }}>
            {label}
          </Button>
        ))}
        {dueList.length > 0 && (
          <span style={{ alignSelf: 'center' }}>
            <Badge status="warning" dot size="sm">30 日內到期 {dueList.length} 張</Badge>
          </span>
        )}
      </div>

      {notes.length === 0 ? (
        <EmptyState icon={FileCheck2} title={`尚無${NOTE_KINDS[kind]}`} description="點「登錄」建立票據，登錄與每次狀態轉換都會自動拋轉傳票" />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>票號</th>
                <th>銀行</th>
                <th>到期日</th>
                <th style={{ textAlign: 'right' }}>金額</th>
                <th>對象</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {notes.map(note => (
                <tr key={note.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {note.note_number}
                    {note.memo && <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>{note.memo}</div>}
                  </td>
                  <td>{note.bank || '-'}</td>
                  <td>
                    <span style={{ fontFamily: 'monospace' }}>{note.due_date || '-'}</span>
                    {' '}{dueBadge(note)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(note.amount)}</td>
                  <td>
                    {note.party_name || '-'}
                    {note.party_type && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--text-muted)' }}>{note.party_type}</span>}
                  </td>
                  <td><Badge {...STATUS_BADGE[note.status]} dot size="sm">{note.status}</Badge></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {nextStates(kind, note.status).map(move => (
                        <Button key={move.action} size="xs"
                          variant={ACTION_VARIANT[move.action] || 'secondary'}
                          disabled={busy}
                          onClick={() => handleAction(note, move)}>
                          {move.label}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 到期日曆（依週分組；30 日內以 Badge 提示 — 顏色+文字） */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <CalendarDays size={18} /> 到期日曆（未來 90 天，含逾期未了結）
        </h3>
        {calendarWeeks.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>近期無到期票據</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {calendarWeeks.map(week => {
              const end = new Date(week.start); end.setDate(end.getDate() + 6)
              return (
                <div key={week.start.toISOString()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                    {fmtDate(week.start)} – {fmtDate(end)} 週
                    <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontWeight: 400 }}>
                      {week.notes.length} 張／合計 {fmt(week.notes.reduce((s, n) => s + Number(n.amount || 0), 0))}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {week.notes.map(n => (
                      <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{n.due_date}</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{n.note_number}</span>
                        <span style={{ fontFamily: 'monospace' }}>{fmt(n.amount)}</span>
                        <Badge {...STATUS_BADGE[n.status]} size="sm">{n.status}</Badge>
                        {dueBadge(n)}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 登錄 modal */}
      {creating && (
        <ModalOverlay onClose={() => setCreating(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 460, maxWidth: '95vw', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>登錄{NOTE_KINDS[kind]}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setCreating(null)}><X size={20} /></button>
            </div>
            {error && (
              <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '6px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>
            )}
            <div style={{ background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', padding: '6px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
              {kind === 'receivable' ? '登錄即拋轉：借 應收票據 / 貸 應收帳款' : '登錄即拋轉：借 應付帳款 / 貸 應付票據'}
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>票據號碼
                  <input type="text" value={creating.note_number}
                    onChange={e => setCreating(f => ({ ...f, note_number: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace' }} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600 }}>金額
                  <input type="number" min="0" value={creating.amount}
                    onChange={e => setCreating(f => ({ ...f, amount: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4 }} />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>付款銀行
                  <input type="text" value={creating.bank}
                    onChange={e => setCreating(f => ({ ...f, bank: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600 }}>到期日
                  <input type="date" value={creating.due_date}
                    onChange={e => setCreating(f => ({ ...f, due_date: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4 }} />
                </label>
              </div>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{kind === 'receivable' ? '客戶名稱' : '供應商名稱'}
                <input type="text" value={creating.party_name}
                  onChange={e => setCreating(f => ({ ...f, party_name: e.target.value }))}
                  style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>備註
                <input type="text" value={creating.memo}
                  onChange={e => setCreating(f => ({ ...f, memo: e.target.value }))}
                  style={{ ...inputStyle, marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Button variant="secondary" onClick={() => setCreating(null)}>取消</Button>
              <Button variant="primary" onClick={handleRegister} loading={busy}
                disabled={!creating.note_number || !(Number(creating.amount) > 0)}>
                登錄並拋轉傳票
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
