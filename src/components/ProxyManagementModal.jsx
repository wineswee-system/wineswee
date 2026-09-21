import { useState, useEffect, useCallback } from 'react'
import { ArrowRightLeft, CheckCircle2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { empLabel } from '../lib/empLabel'
import { toast } from '../lib/toast'
import { confirm } from '../lib/confirm'

// 代理管理：列出目前代理中的人，可再轉手 / 轉正式交接
export default function ProxyManagementModal({ allEmployees, currentUserEmpId, onClose }) {
  const [rows, setRows] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [pick, setPick] = useState({})  // log_id → new_emp_id

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_active_proxies')
    if (error) { toast.error('載入失敗：' + error.message); setRows([]); return }
    setRows(Array.isArray(data) ? data : [])
  }, [])
  useEffect(() => { load() }, [load])

  const candidates = (allEmployees || []).filter(e => e.status === '在職')

  const doReassign = async (row) => {
    const newId = pick[row.log_id]
    if (!newId) { toast.error('請先選新承接人'); return }
    setBusyId(row.log_id)
    const { data, error } = await supabase.rpc('reassign_delegation', {
      p_log_id: row.log_id, p_new_emp: Number(newId), p_actor: currentUserEmpId || null,
    })
    setBusyId(null)
    if (error || !data?.ok) { toast.error('轉手失敗：' + (error?.message || data?.error)); return }
    toast.success('已再轉手')
    setPick(p => ({ ...p, [row.log_id]: '' }))
    load()
  }

  const doConvert = async (row) => {
    if (!(await confirm({ message: `把「${row.original_name} → ${row.delegate_name}」的代理轉成正式交接？以後不再列入可轉手。` }))) return
    setBusyId(row.log_id)
    const { data, error } = await supabase.rpc('convert_proxy_to_transfer', {
      p_log_id: row.log_id, p_actor: currentUserEmpId || null,
    })
    setBusyId(null)
    if (error || !data?.ok) { toast.error('轉正式失敗：' + (error?.message || data?.error)); return }
    toast.success('已轉為正式交接')
    load()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-medium)', width: '100%', maxWidth: 720, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🟡 代理管理</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>目前代理中的工作，可再轉給別人或轉成正式交接</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 22px', overflowY: 'auto' }}>
          {rows === null && <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>載入中…</div>}
          {rows?.length === 0 && (
            <div style={{ textAlign: 'center', padding: 28, borderRadius: 10, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>
              目前沒有代理中的工作
            </div>
          )}
          {rows?.map(row => (
            <div key={row.log_id} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-medium)', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>{row.original_name}</span>
                <ArrowRightLeft size={13} style={{ color: 'var(--accent-orange)' }} />
                <b style={{ color: 'var(--accent-cyan)' }}>{row.delegate_name}</b>
                <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', fontWeight: 600 }}>
                  代理 {row.item_count} 項
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>再轉給：</span>
                <select
                  className="form-input"
                  style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                  value={pick[row.log_id] || ''}
                  onChange={e => setPick(p => ({ ...p, [row.log_id]: e.target.value }))}
                >
                  <option value="">挑選新承接人</option>
                  {candidates.filter(e => e.id !== row.delegate_emp_id).map(e => (
                    <option key={e.id} value={e.id}>{empLabel(e)}{e.position ? ` — ${e.position}` : ''}</option>
                  ))}
                </select>
                <button
                  onClick={() => doReassign(row)}
                  disabled={busyId === row.log_id || !pick[row.log_id]}
                  style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, border: 'none', cursor: pick[row.log_id] ? 'pointer' : 'not-allowed', background: pick[row.log_id] ? 'var(--accent-cyan)' : 'var(--glass-light)', color: pick[row.log_id] ? '#fff' : 'var(--text-muted)', whiteSpace: 'nowrap' }}
                >
                  <ArrowRightLeft size={11} /> 再轉手
                </button>
                <button
                  onClick={() => doConvert(row)}
                  disabled={busyId === row.log_id}
                  style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, border: '1px solid var(--accent-green)', cursor: 'pointer', background: 'transparent', color: 'var(--accent-green)', whiteSpace: 'nowrap' }}
                >
                  <CheckCircle2 size={11} /> 轉正式
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
