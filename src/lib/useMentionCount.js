import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

export function useMentionCount() {
  const [count, setCount] = useState(0)

  const reload = useCallback(async () => {
    const { data } = await supabase.rpc('web_get_my_unread_mention_count')
    setCount(data || 0)
  }, [])

  useEffect(() => {
    reload()
    const id = setInterval(reload, 60_000)
    return () => clearInterval(id)
  }, [reload])

  const markSeen = useCallback(async () => {
    await supabase.rpc('web_mark_my_mentions_seen')
    setCount(0)
  }, [])

  return { mentionCount: count, reloadMentions: reload, markSeen }
}
