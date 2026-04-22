import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Send, Loader } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  updateTask,
  getChecklistItems, updateChecklistItem, updateChecklist,
  createTaskComment,
  getTaskChecklists,
} from '../../lib/db'

const STATUS_COLORS = {
  '待處理': '#94a3b8',
  '進行中': '#06b6d4',
  '已完成': '#34d399',
  '已擱置': '#ef4444',
}

export default function LiffTask() {
  const [employee, setEmployee] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tasks, setTasks] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [checklistItems, setChecklistItems] = useState([])
  const [, setLinkedChecklists] = useState([])
  const [commentText, setCommentText] = useState('')
  const [sending, setSending] = useState(false)

  // ── LIFF Init ──
  useEffect(() => { initLiff() }, [])

  async function initLiff() {
    try {
      if (window.liff) {
        const liffId = import.meta.env.VITE_LIFF_TASK_ID || import.meta.env.VITE_LIFF_ID
        if (liffId) {
          await window.liff.init({ liffId })
          if (!window.liff.isLoggedIn()) { window.liff.login(); return }
          const profile = await window.liff.getProfile()
          const { data: ela } = await supabase
            .from('employee_line_accounts')
            .select('employee_id, employees:employee_id(*)')
            .eq('line_user_id', profile.userId)
            .limit(1)
            .maybeSingle()
          const emp = ela?.employees
          if (emp) { setEmployee(emp); await loadTasks(emp.id); return }
        }
      }
      // Fallback: URL param
      const params = new URLSearchParams(window.location.search)
      const empName = params.get('employee')
      if (empName) {
        const { data: emp } = await supabase.from('employees')
          .select('*').eq('name', empName).maybeSingle()
        if (emp) { setEmployee(emp); await loadTasks(emp.id); return }
      }
      setError('無法識別身份，請從 LINE 開啟此頁面')
    } catch (err) {
      console.error(err)
      setError('載入失敗：' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadTasks(assigneeId) {
    const { data } = await supabase.from('tasks')
      .select('*')
      .eq('assignee_id', assigneeId)
      .in('status', ['未開始', '進行中', '待處理'])
      .order('due_date', { ascending: true, nullsFirst: false })
    setTasks(data || [])
  }

  // ── Expand task: load checklists ──
  async function handleExpand(task) {
    if (expandedId === task.id) { setExpandedId(null); return }
    setExpandedId(task.id)
    setCommentText('')
    // Load linked checklists and their items
    const { data: links } = await getTaskChecklists(task.id)
    setLinkedChecklists(links || [])
    if (links && links.length > 0) {
      const allItems = []
      for (const lc of links) {
        const { data: items } = await getChecklistItems(lc.checklist_id)
        allItems.push(...(items || []).map(i => ({ ...i, _checklistName: lc.checklists?.name })))
      }
      setChecklistItems(allItems)
    } else {
      setChecklistItems([])
    }
  }

  // ── Actions ──
  async function handleComplete(task) {
    const { data } = await updateTask(task.id, {
      status: '已完成', completed_at: new Date().toISOString(),
    })
    if (data) setTasks(prev => prev.filter(t => t.id !== task.id))
  }

  async function handleToggleItem(item) {
    const { data } = await updateChecklistItem(item.id, { checked: !item.checked })
    if (data) {
      const updated = checklistItems.map(i => i.id === item.id ? { ...data, _checklistName: i._checklistName } : i)
      setChecklistItems(updated)
      const clItems = updated.filter(i => i.checklist_id === item.checklist_id)
      const completed = clItems.filter(i => i.checked).length
      await updateChecklist(item.checklist_id, { completed })
    }
  }

  async function handleSendComment(taskId) {
    if (!commentText.trim() || sending) return
    setSending(true)
    await createTaskComment({
      task_id: taskId,
      author: employee?.name || '使用者',
      content: commentText.trim(),
      source: 'line',
    })
    setCommentText('')
    setSending(false)
  }

  // ── Render ──
  if (loading) return (
    <div style={styles.center}>
      <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
      <p style={{ marginTop: 12, color: '#94a3b8' }}>載入中...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (error) return (
    <div style={styles.center}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
      <p style={{ color: '#ef4444', textAlign: 'center' }}>{error}</p>
    </div>
  )

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>📋 我的任務</div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {employee?.name} · {tasks.length} 個待辦
        </div>
      </div>

      {/* Task List */}
      {tasks.length === 0 ? (
        <div style={{ ...styles.center, minHeight: 200 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
          <p style={{ color: '#94a3b8' }}>太棒了！目前沒有待辦任務</p>
        </div>
      ) : tasks.map(task => {
        const isOpen = expandedId === task.id
        const sc = STATUS_COLORS[task.status] || '#94a3b8'
        return (
          <div key={task.id} style={styles.card}>
            {/* Task header */}
            <div onClick={() => handleExpand(task)} style={styles.cardHeader}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {isOpen ? <ChevronDown size={16} color="#94a3b8" /> : <ChevronRight size={16} color="#94a3b8" />}
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{task.title}</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', paddingLeft: 24 }}>
                  {task.store || task.workflow || ''}
                  {task.due_date && <span> · 截止 {task.due_date}</span>}
                </div>
              </div>
              <span style={{
                padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                background: sc + '20', color: sc, border: `1px solid ${sc}40`,
                whiteSpace: 'nowrap',
              }}>{task.status}</span>
            </div>

            {/* Expanded content */}
            {isOpen && (
              <div style={styles.cardBody}>
                {/* Complete button */}
                <button onClick={() => handleComplete(task)} style={styles.completeBtn}>
                  <Check size={16} /> 回報完成
                </button>

                {/* Checklist items */}
                {checklistItems.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
                      📋 清單項目 ({checklistItems.filter(i => i.checked).length}/{checklistItems.length})
                    </div>
                    {checklistItems.map(item => (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 0', borderBottom: '1px solid #f1f5f9',
                      }}>
                        <button onClick={() => handleToggleItem(item)} style={{
                          width: 24, height: 24, borderRadius: 6, flexShrink: 0, padding: 0,
                          border: `2px solid ${item.checked ? '#34d399' : '#cbd5e1'}`,
                          background: item.checked ? '#34d399' : '#fff',
                          color: '#fff', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {item.checked && <Check size={14} />}
                        </button>
                        <span style={{
                          fontSize: 14,
                          textDecoration: item.checked ? 'line-through' : 'none',
                          color: item.checked ? '#94a3b8' : '#1e293b',
                        }}>{item.title}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick comment */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>💬 回報備註</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text" placeholder="輸入備註..."
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendComment(task.id)}
                      style={styles.input}
                    />
                    <button onClick={() => handleSendComment(task.id)} disabled={sending}
                      style={styles.sendBtn}>
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Close LIFF */}
      {window.liff && (
        <button onClick={() => window.liff.closeWindow()} style={styles.closeBtn}>
          關閉
        </button>
      )}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh', background: '#f8fafc',
    padding: '0 0 80px', fontFamily: "'Noto Sans TC', sans-serif",
  },
  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  header: {
    padding: '20px 16px 16px', background: '#fff',
    borderBottom: '1px solid #e2e8f0', marginBottom: 12,
    position: 'sticky', top: 0, zIndex: 10,
  },
  card: {
    background: '#fff', margin: '0 12px 10px', borderRadius: 12,
    border: '1px solid #e2e8f0', overflow: 'hidden',
  },
  cardHeader: {
    padding: '14px 16px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardBody: {
    padding: '0 16px 16px', borderTop: '1px solid #f1f5f9',
    paddingTop: 16,
  },
  completeBtn: {
    width: '100%', padding: '12px', borderRadius: 10,
    background: '#34d399', color: '#fff', border: 'none',
    fontSize: 15, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  input: {
    flex: 1, padding: '10px 14px', borderRadius: 10,
    border: '1px solid #e2e8f0', fontSize: 14, outline: 'none',
  },
  sendBtn: {
    padding: '10px 14px', borderRadius: 10,
    background: '#3b82f6', color: '#fff', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
  },
  closeBtn: {
    position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
    padding: '10px 32px', borderRadius: 20,
    background: '#64748b', color: '#fff', border: 'none',
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
}
