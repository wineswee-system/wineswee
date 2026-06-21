import { useState, useEffect, useCallback } from 'react'
import { Users, RefreshCw, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { getMemberGroups, deleteMemberGroup, refreshMemberGroup } from '../../lib/db'
import GroupBuilderModal from './components/GroupBuilderModal'
import GroupMemberList from './components/GroupMemberList'

const TYPE_LABELS = { dynamic: '動態', static: '靜態' }
const TYPE_COLORS = { dynamic: 'var(--accent-cyan)', static: 'var(--accent-purple)' }

export default function Groups() {
  const { currentOrg } = useTenant()
  const [groups, setGroups]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editGroup, setEditGroup]   = useState(null)
  const [expanded, setExpanded]     = useState(null)
  const [refreshing, setRefreshing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await getMemberGroups(currentOrg?.id)
    setGroups(data || [])
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { load() }, [load])

  async function handleRefresh(group) {
    setRefreshing(group.id)
    await refreshMemberGroup(group.id)
    await load()
    setRefreshing(null)
  }

  async function handleDelete(group) {
    if (!confirm(`確定刪除群組「${group.name}」？此操作無法復原。`)) return
    await deleteMemberGroup(group.id)
    if (expanded === group.id) setExpanded(null)
    await load()
  }

  function openNew() { setEditGroup(null); setModalOpen(true) }
  function openEdit(group) { setEditGroup(group); setModalOpen(true) }
  function toggleExpand(id) { setExpanded(prev => prev === id ? null : id) }

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={18} style={{ color: 'var(--accent-cyan)' }} />
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600 }}>會員群組</h2>
          <span style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', borderRadius: '10px', padding: '0.1rem 0.55rem', fontSize: '0.75rem' }}>
            {groups.length}
          </span>
        </div>
        <button onClick={openNew} style={btnPrimary}>
          <Plus size={14} /> 新增群組
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '3rem', textAlign: 'center' }}>載入中…</div>
      ) : groups.length === 0 ? (
        <div style={{ border: '1px dashed var(--border-primary)', borderRadius: '10px', padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Users size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <div style={{ fontSize: '0.9rem' }}>尚無群組。點擊「新增群組」建立動態或靜態會員群組。</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {groups.map(g => (
            <div key={g.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem' }}>
                <button onClick={() => toggleExpand(g.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }}>
                  {expanded === g.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                <span style={{ background: TYPE_COLORS[g.type] + '22', color: TYPE_COLORS[g.type], borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', fontWeight: 600, flexShrink: 0 }}>
                  {TYPE_LABELS[g.type]}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {g.name}
                  </div>
                  {g.description && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '1px' }}>{g.description}</div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '1.25rem', flexShrink: 0 }}>
                  <Stat label="會員數" value={g.member_count.toLocaleString()} accent />
                  <Stat
                    label="上次計算"
                    value={g.last_computed_at
                      ? new Date(g.last_computed_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  {g.type === 'dynamic' && (
                    <button onClick={() => handleRefresh(g)} disabled={refreshing === g.id} title="重新計算成員" style={{ ...btnIcon, color: refreshing === g.id ? 'var(--text-muted)' : 'var(--accent-cyan)' }}>
                      <RefreshCw size={14} style={{ animation: refreshing === g.id ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                  )}
                  <button onClick={() => openEdit(g)} style={btnIcon} title="編輯">✏️</button>
                  <button onClick={() => handleDelete(g)} style={{ ...btnIcon, color: 'var(--accent-red)' }} title="刪除">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {expanded === g.id && (
                <div style={{ borderTop: '1px solid var(--border-primary)' }}>
                  <GroupMemberList group={g} onCountChange={load} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <GroupBuilderModal
          group={editGroup}
          orgId={currentOrg?.id}
          onClose={() => setModalOpen(false)}
          onSaved={load}
        />
      )}

      <style>{`@keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{label}</div>
      <div style={{ color: accent ? 'var(--accent-cyan)' : 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: accent ? 700 : 500 }}>{value}</div>
    </div>
  )
}

const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'var(--accent-cyan)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.4rem 0.875rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }
const btnIcon = { background: 'none', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.3rem 0.4rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem' }
