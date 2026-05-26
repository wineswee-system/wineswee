/**
 * useRealtimeSync — Supabase Realtime helpers for the SME-Ops task/workflow system.
 *
 * Usage:
 *   useRealtimeTasks(setTasks)
 *   useRealtimeWorkflowInstances(setInstances)
 *   useRealtimeTable('approval_forms', { onUpdate: row => ... })
 *
 * Each hook opens a Postgres Changes channel on mount and tears it down on unmount.
 * State callbacks are stored in a ref so they never need to be listed as deps.
 */
import { useEffect, useRef } from 'react'
import { supabase } from '../supabase'

/**
 * Low-level hook: subscribe to any table's INSERT / UPDATE / DELETE events.
 *
 * @param {string}   table
 * @param {object}   opts
 * @param {Function} [opts.onInsert]  - (newRow) => void
 * @param {Function} [opts.onUpdate]  - (newRow, oldRow) => void
 * @param {Function} [opts.onDelete]  - (oldRow) => void
 * @param {object}   [opts.filter]    - { column: string, value: string|number }
 *                                      adds a server-side row filter
 */
export function useRealtimeTable(table, { onInsert, onUpdate, onDelete, filter } = {}) {
  const cbRef = useRef({ onInsert, onUpdate, onDelete })
  cbRef.current = { onInsert, onUpdate, onDelete }

  // Stable serialisation of filter for dep array
  const filterKey = filter ? `${filter.column}=${filter.value}` : ''

  useEffect(() => {
    const changeOpts = { event: '*', schema: 'public', table }
    if (filter) changeOpts.filter = `${filter.column}=eq.${filter.value}`

    const channelName = `rt:${table}:${filterKey || 'all'}`
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', changeOpts, (payload) => {
        switch (payload.eventType) {
          case 'INSERT':
            cbRef.current.onInsert?.(payload.new)
            break
          case 'UPDATE':
            cbRef.current.onUpdate?.(payload.new, payload.old)
            break
          case 'DELETE':
            cbRef.current.onDelete?.(payload.old)
            break
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[Realtime] channel error on table "${table}"`)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filterKey])
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Keeps a tasks array in sync with the "tasks" table in real-time.
 * INSERTs are prepended (newest-first); UPDATEs replace by id; DELETEs remove.
 *
 * @param {Function} setTasks  - React state setter for tasks array
 * @param {object}   [filter]  - optional server-side row filter
 */
export function useRealtimeTasks(setTasks, filter) {
  useRealtimeTable('tasks', {
    filter,
    onInsert: (row) =>
      setTasks((prev) => [row, ...prev.filter((t) => t.id !== row.id)]),
    onUpdate: (row) =>
      setTasks((prev) => prev.map((t) => (t.id === row.id ? row : t))),
    onDelete: (row) =>
      setTasks((prev) => prev.filter((t) => t.id !== row.id)),
  })
}

/**
 * Keeps a workflow_instances array in sync with the DB.
 *
 * @param {Function} setInstances - React state setter for instances array
 * @param {object}   [filter]     - optional server-side row filter
 */
export function useRealtimeWorkflowInstances(setInstances, filter) {
  useRealtimeTable('workflow_instances', {
    filter,
    onInsert: (row) =>
      setInstances((prev) => [...prev.filter((i) => i.id !== row.id), row]),
    onUpdate: (row) =>
      setInstances((prev) => prev.map((i) => (i.id === row.id ? row : i))),
    onDelete: (row) =>
      setInstances((prev) => prev.filter((i) => i.id !== row.id)),
  })
}
