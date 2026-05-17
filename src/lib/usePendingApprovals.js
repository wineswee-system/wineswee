import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

// 撈「目前我這關該簽的單據 id 集合」，提供 canApprove(table, id) 判斷
// 用於 HR 表單頁的「核准/拒絕」按鈕顯示控制：
// 純看 status='待審核' 會讓 admin/super_admin 也看到不屬於自己關卡的單。
// 套這個 hook 後，按鈕需要 canApprove(table, id) 才會顯示。
export function usePendingApprovals() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data: rpcData, error } = await supabase.rpc('web_list_my_pending_approval_ids')
    if (error) {
      console.warn('[usePendingApprovals] RPC error:', error)
      setData({})
    } else {
      setData(rpcData || {})
    }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const canApprove = useCallback((table, id) => {
    if (!data || !data[table]) return false
    return data[table].includes(id)
  }, [data])

  // 總待簽數（給 Dashboard tab badge 用）
  const totalPending = data
    ? Object.values(data).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0

  return { canApprove, reload, loading, pendingByTable: data || {}, totalPending }
}
