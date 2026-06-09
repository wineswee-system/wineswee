import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'

// 極簡版 chain library — 直接撈所有 chain 顯示，繞過原本 ChainConfigModal 套件
export default function Chains() {
  const { isAdmin, isSuperAdmin } = useAuth()
  const [chains, setChains] = useState([])
  const [steps, setSteps] = useState({})  // chain_id → steps[]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    supabase.from('approval_chains')
      .select('id, name, description, category, is_active, organization_id, min_amount, max_amount')
      .order('category', { ascending: true, nullsFirst: false })
      .order('name')
      .then(async ({ data, error }) => {
        if (error) { setError(error.message); setLoading(false); return }
        const list = data || []
        setChains(list)
        if (list.length > 0) {
          const ids = list.map(c => c.id)
          const { data: stepData } = await supabase.from('approval_chain_steps')
            .select('chain_id, step_order, label, target_type, target_emp_id, target_role_id, target_dept_id, target_store_id')
            .in('chain_id', ids).order('step_order')
          const map = {}
          for (const s of (stepData || [])) {
            if (!map[s.chain_id]) map[s.chain_id] = []
            map[s.chain_id].push(s)
          }
          setSteps(map)
        }
        setLoading(false)
      })
  }, [])

  if (!(isAdmin || isSuperAdmin)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 可管理簽核鏈</p>
      </div>
    )
  }

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

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          載入失敗：{error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
      ) : chains.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>沒有任何 chain</div>
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
