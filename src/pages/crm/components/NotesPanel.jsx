import { useState, useEffect } from 'react'
import { Plus, Pin, Trash2, Edit3, Check, X } from 'lucide-react'
import { getCRMNotes, createCRMNote, updateCRMNote, deleteCRMNote } from '../../../lib/db'

import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
/**
 * Reusable notes panel for any CRM entity.
 * Props: entityType ('customer'|'opportunity'|'service_ticket'), entityId (number)
 */
export default function NotesPanel({ entityType, entityId }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editContent, setEditContent] = useState('')

  useEffect(() => {
    if (!entityType || !entityId) return
    getCRMNotes(entityType, entityId)
      .then(({ data }) => setNotes(data || []))
      .finally(() => setLoading(false))
  }, [entityType, entityId])

  const addNote = async () => {
    if (!newNote.trim()) return
    const { data, error } = await createCRMNote({
      entity_type: entityType,
      entity_id: entityId,
      content: newNote,
      author: '系統使用者',
    })
    if (error) { toast.error('新增失敗'); return }
    setNotes(prev => [data, ...prev])
    setNewNote('')
  }

  const togglePin = async (note) => {
    const { data } = await updateCRMNote(note.id, { is_pinned: !note.is_pinned })
    if (data) setNotes(prev => prev.map(n => n.id === note.id ? data : n).sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)))
  }

  const startEdit = (note) => {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  const saveEdit = async () => {
    if (!editContent.trim()) return
    const { data } = await updateCRMNote(editingId, { content: editContent })
    if (data) setNotes(prev => prev.map(n => n.id === editingId ? data : n))
    setEditingId(null)
    setEditContent('')
  }

  const removeNote = async (id) => {
    if (!(await confirm({ message: '確定要刪除此備註？' }))) return
    await deleteCRMNote(id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>載入中...</div>

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>備註 ({notes.length})</div>

      {/* Add note */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <textarea
          className="form-input"
          rows={2}
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="新增備註..."
          style={{ flex: 1, resize: 'vertical', fontSize: 12 }}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) addNote() }}
        />
        <button className="btn btn-primary" style={{ alignSelf: 'flex-end', fontSize: 11, padding: '6px 10px' }} onClick={addNote} disabled={!newNote.trim()}>
          <Plus size={12} /> 新增
        </button>
      </div>

      {/* Notes list */}
      {notes.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>尚無備註</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {notes.map(note => (
          <div key={note.id} style={{
            padding: '8px 10px', borderRadius: 8,
            background: note.is_pinned ? 'var(--accent-orange-dim, rgba(249,115,22,0.08))' : 'var(--glass-light)',
            border: note.is_pinned ? '1px solid var(--accent-orange)33' : '1px solid var(--border-subtle)',
          }}>
            {editingId === note.id ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <textarea className="form-input" rows={2} value={editContent} onChange={e => setEditContent(e.target.value)} style={{ flex: 1, fontSize: 12, resize: 'vertical' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-green)' }} onClick={saveEdit}><Check size={14} /></button>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setEditingId(null)}><X size={14} /></button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note.content}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {note.author} · {new Date(note.created_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: note.is_pinned ? 'var(--accent-orange)' : 'var(--text-muted)', padding: 2 }} onClick={() => togglePin(note)} title="釘選">
                      <Pin size={12} />
                    </button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }} onClick={() => startEdit(note)} title="編輯">
                      <Edit3 size={12} />
                    </button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }} onClick={() => removeNote(note.id)} title="刪除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
