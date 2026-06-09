import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'

// 極簡 chain library — 直接撈所有 chain 顯示，繞過原本 ChainConfigModal
// 不擋 isAdmin gate（這頁本來就唯讀；撈不到 chain 就會顯示空）
export default function Chains() {
  const { user, profile, role } = useAuth()
  const [chains, setChains] = useState([])
  const [steps, setSteps] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [debug, setDebug] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // 走 SECURITY DEFINER RPC，繞 approval_chains RLS（之前直查吃 503）
        const { data, error: e1 } = await supabase.rpc('list_all_chains_with_steps')
        if (cancelled) return
        if (e1) { setError(`list_all_chains_with_steps 失敗：${e1.message}`); setLoading(false); return }
        const list = data?.chains || []
        const stepList = data?.steps || []
        setChains(list)
        setDebug(`role=${data?.role || '無'} · org=${data?.org_id ?? '無'} · 撈到 ${list.length} 條 chain / ${stepList.length} 個 step`)
        const map = {}
        for (const s of stepList) {
          if (!map[s.chain_id]) map[s.chain_id] = []
          map[s.chain_id].push(s)
        }
        setSteps(map)
      } catch (err) {
        if (!cancelled) setError(`例外：${err?.message || String(err)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⚙️</span> 簽核鏈設定</h2>
            <p>整個組織的簽核鏈池子（共 {chains.length} 條）</p>
          </div>
        </div>
      </div>

      {/* Debug strip — 永遠顯示，確認 component 有 mount */}
      <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'monospace' }}>
        user={user?.email || '無'} · role={role?.name || '無'} · org={profile?.organization_id ?? '無'} · {debug || (loading ? '載入中…' : '尚未撈')}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          ❌ {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
      ) : chains.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          沒有任何 chain（如果 DB 有資料但這裡看不到，多半是 RLS 擋掉 — role={role?.name || '未知'}）
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {chains.map(c => (
            <div key={c.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                  {c.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.description}</div>}
                  {c.category && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>分類：{c.category}</div>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{c.id}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {(steps[c.id] || []).length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}>（無步驟）</span>
                ) : (
                  (steps[c.id] || []).map((s, i) => (
                    <span key={s.step_order}>
                      {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>}
                      <span style={{ background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4 }}>
                        {s.label || s.target_type}
                      </span>
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24, padding: 12, background: 'var(--bg-card)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        💡 目前是唯讀檢視。要編輯步驟，請去 SQL 或之後我加 inline 編輯功能。
      </div>
    </div>
  )
}
