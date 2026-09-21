import { useEffect, useState, useCallback } from 'react'
import { Trash2, RotateCcw, AlertTriangle, Clock, Package } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const TABLE_LABELS = {
  leave_requests:      '請假申請',
  overtime_requests:   '加班申請',
  clock_corrections:   '打卡校正',
  business_trips:      '出差申請',
  headcount_requests:  '人力需求',
  expense_requests:    '費用申請',
  form_submissions:    '表單申請',
  shift_swaps:         '換班申請',
  off_requests:        '休假申請',
}

const TABLE_COLORS = {
  leave_requests:      { bg: 'var(--accent-blue-dim)',   color: 'var(--accent-blue)' },
  overtime_requests:   { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' },
  clock_corrections:   { bg: 'var(--accent-purple-dim)', color: 'var(--accent-purple)' },
  business_trips:      { bg: 'var(--accent-cyan-dim)',   color: 'var(--accent-cyan)' },
  headcount_requests:  { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)' },
  expense_requests:    { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)' },
  form_submissions:    { bg: 'var(--accent-blue-dim)',   color: 'var(--accent-blue)' },
  shift_swaps:         { bg: 'var(--accent-cyan-dim)',   color: 'var(--accent-cyan)' },
  off_requests:        { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)' },
}

function urgencyColor(days) {
  if (days <= 7)  return 'var(--accent-red)'
  if (days <= 14) return 'var(--accent-orange)'
  return 'var(--text-muted)'
}

export default function RecentlyDeleted() {
  const { profile, isManagerOrAbove, hasPermission } = useAuth()
  // 控管者(admin/super_admin/manager) 或被授予「還原已刪除單據」者（權限設定頁可分人）
  const isAdmin = isManagerOrAbove || hasPermission('hr_form.restore')

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('v_recently_deleted').select('*').order('deleted_at', { ascending: false })
    // non-super_admin 只看自己 org 的記錄
    if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id)
    const { data, error } = await q
    if (error) toast.error('載入失敗：' + error.message)
    setItems(data || [])
    setLoading(false)
  }, [profile?.organization_id])

  useEffect(() => { load() }, [load])

  const handleRestore = async (item) => {
    if (!(await confirm({ message: `復原「${item.label}」？此記錄將重新出現在對應的申請列表。` }))) return
    setBusyId(item.record_id + item.source_table)
    const { error } = await supabase.rpc('restore_request', { p_table: item.source_table, p_id: item.record_id })
    setBusyId(null)
    if (error) { toast.error('復原失敗：' + error.message); return }
    toast.success('已復原')
    setItems(prev => prev.filter(x => !(x.record_id === item.record_id && x.source_table === item.source_table)))
  }

  const handlePermanentDelete = async (item) => {
    if (!(await confirm({ message: `永久刪除「${item.label}」？此操作無法復原。`, confirmText: '永久刪除', destructive: true }))) return
    setBusyId(item.record_id + item.source_table)

    if (item.source_table === 'expense_requests') {
      // 清 storage 附件再刪 row
      const { data: paths, error } = await supabase.rpc('hard_delete_expense_request', { p_id: item.record_id })
      if (error) { setBusyId(null); toast.error('刪除失敗：' + error.message); return }
      if (paths?.length) await supabase.storage.from('attachments').remove(paths)
    } else {
      const { error } = await supabase.from(item.source_table).delete().eq('id', item.record_id)
      if (error) { setBusyId(null); toast.error('刪除失敗：' + error.message); return }
    }

    setBusyId(null)
    toast.success('已永久刪除')
    setItems(prev => prev.filter(x => !(x.record_id === item.record_id && x.source_table === item.source_table)))
  }

  const tableOptions = ['all', ...Object.keys(TABLE_LABELS)]
  const filtered = filter === 'all' ? items : items.filter(x => x.source_table === filter)

  const totalCount = items.length
  const urgentCount = items.filter(x => x.days_remaining <= 7).length

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in" style={{ padding: '24px', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: 'var(--accent-red-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Trash2 size={20} color="var(--accent-red)" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>最近刪除</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            申請記錄保留 60 天，到期後自動永久清除
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {totalCount > 0 && (
            <span style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
            }}>
              共 {totalCount} 筆
            </span>
          )}
          {urgentCount > 0 && (
            <span style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <AlertTriangle size={12} /> {urgentCount} 筆即將清除
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {tableOptions.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 500,
              background: filter === t ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
              color: filter === t ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {t === 'all' ? '全部' : TABLE_LABELS[t]}
            {t !== 'all' && items.filter(x => x.source_table === t).length > 0 && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                {items.filter(x => x.source_table === t).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '64px 24px',
          color: 'var(--text-muted)', background: 'var(--bg-secondary)',
          borderRadius: 12, border: '1px dashed var(--border-subtle)',
        }}>
          <Package size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>沒有已刪除的申請</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>刪除的記錄會在這裡保留 60 天</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(item => {
            const key = item.record_id + item.source_table
            const isBusy = busyId === key
            const c = TABLE_COLORS[item.source_table] || { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' }
            const dayColor = urgencyColor(item.days_remaining)
            const deletedDate = new Date(item.deleted_at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })

            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                opacity: isBusy ? 0.5 : 1,
                transition: 'opacity 0.2s',
              }}>
                {/* Type badge */}
                <span style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: c.bg, color: c.color, whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {TABLE_LABELS[item.source_table] || item.source_table}
                </span>

                {/* Label + employee */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                    {item.employee_name || '—'}
                  </div>
                </div>

                {/* Time info */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {deletedDate} 刪除
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: dayColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 2,
                  }}>
                    <Clock size={11} />
                    {item.days_remaining > 0 ? `${item.days_remaining} 天後清除` : '即將清除'}
                  </div>
                </div>

                {/* Actions */}
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={isBusy}
                      title="復原"
                      style={{
                        padding: '6px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500,
                      }}
                    >
                      <RotateCcw size={13} /> 復原
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item)}
                      disabled={isBusy}
                      title="永久刪除"
                      style={{
                        padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer note */}
      {items.length > 0 && (
        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          每月自動清理超過 60 天的記錄。復原後記錄會重新出現在原始申請頁面。
        </p>
      )}
    </div>
  )
}
