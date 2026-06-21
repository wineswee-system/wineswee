import { useState, useEffect, useCallback } from 'react'
import { UserMinus, UserPlus, Search } from 'lucide-react'
import { useTenant } from '../../../contexts/TenantContext'
import { getMemberGroupMembers, removeStaticGroupMember, addStaticGroupMember, getMembers } from '../../../lib/db'

export default function GroupMemberList({ group, onCountChange }) {
  const { currentOrg } = useTenant()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [query, setQuery]       = useState('')
  const [adding, setAdding]     = useState(false)
  const [allMembers, setAll]    = useState([])
  const [pickerQ, setPickerQ]   = useState('')
  const [removing, setRemoving] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await getMemberGroupMembers(group.id)
    setRows(data || [])
    setLoading(false)
  }, [group.id])

  useEffect(() => { load() }, [load])

  async function handleRemove(memberId) {
    setRemoving(memberId)
    await removeStaticGroupMember(group.id, memberId)
    await load()
    onCountChange?.()
    setRemoving(null)
  }

  async function openPicker() {
    const { data } = await getMembers(currentOrg?.id)
    const existing = new Set(rows.map(r => r.member_id))
    setAll((data || []).filter(m => !existing.has(m.id)))
    setPickerQ('')
    setAdding(true)
  }

  async function handleAdd(member) {
    await addStaticGroupMember(group.id, member.id)
    await load()
    onCountChange?.()
    setAll(prev => prev.filter(m => m.id !== member.id))
  }

  const filtered = rows.filter(r => {
    if (!query) return true
    const m = r.members
    return (m?.name || '').includes(query) || (m?.phone || '').includes(query)
  })

  const pickerFiltered = allMembers.filter(m =>
    !pickerQ || m.name?.includes(pickerQ) || m.phone?.includes(pickerQ)
  )

  return (
    <div style={{ padding: '1rem' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '0.875rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={13} style={{ position: 'absolute', left: '0.55rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋姓名或電話"
            style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.35rem 0.6rem 0.35rem 1.8rem', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }}
          />
        </div>
        {group.type === 'static' && (
          <button onClick={openPicker} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.35rem 0.75rem', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            <UserPlus size={13} /> 加入會員
          </button>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{rows.length} 人</span>
      </div>

      {/* Member table */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.85rem' }}>載入中…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.85rem' }}>
          {rows.length === 0 ? '此群組目前沒有成員' : '沒有符合的搜尋結果'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                {['姓名','電話','等級','累計消費','積分','可用點數', group.type === 'static' ? '操作' : ''].map((h, i) => h ? (
                  <th key={i} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem' }}>{h}</th>
                ) : null)}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const m = r.members || {}
                return (
                  <tr key={r.member_id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-primary)', fontWeight: 500 }}>{m.name || '—'}</td>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-muted)' }}>{m.phone || '—'}</td>
                    <td style={{ padding: '0.5rem 0.6rem' }}>
                      <span style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderRadius: '4px', padding: '0.1rem 0.45rem', fontSize: '0.75rem' }}>
                        {m.level || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-secondary)' }}>
                      {m.lifetime_spend != null ? `NT$ ${Number(m.lifetime_spend).toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-secondary)' }}>
                      {m.lifetime_points != null ? Number(m.lifetime_points).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--accent-green)', fontWeight: 600 }}>
                      {m.available_points != null ? Number(m.available_points).toLocaleString() : '—'}
                    </td>
                    {group.type === 'static' && (
                      <td style={{ padding: '0.5rem 0.6rem' }}>
                        <button
                          onClick={() => handleRemove(r.member_id)}
                          disabled={removing === r.member_id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: 'none', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: removing === r.member_id ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}
                        >
                          <UserMinus size={12} /> 移除
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add-member picker (static groups only) */}
      {adding && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', width: '100%', maxWidth: '400px', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>加入會員</span>
              <button onClick={() => setAdding(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem' }}>✕</button>
            </div>
            <div style={{ padding: '0.75rem 1rem' }}>
              <input
                value={pickerQ}
                onChange={e => setPickerQ(e.target.value)}
                placeholder="搜尋姓名或電話"
                autoFocus
                style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.5rem 0.75rem' }}>
              {pickerFiltered.slice(0, 50).map(m => (
                <button
                  key={m.id}
                  onClick={() => handleAdd(m)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', borderRadius: '6px', padding: '0.5rem 0.75rem', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}>{m.name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{m.phone} · {m.level}</div>
                  </div>
                  <UserPlus size={14} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                </button>
              ))}
              {pickerFiltered.length === 0 && (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.85rem' }}>
                  沒有可加入的會員
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
