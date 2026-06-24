import { useState, useEffect } from 'react'
import { UserCheck, Plus, Trash2, Power } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (d) => d ? String(d).slice(0, 10) : '—'
const isActiveNow = (r) => r.is_active && r.effective_from <= today() && (!r.effective_to || r.effective_to >= today())

// 簽核代理：委託人不在時，由代理人代簽（代理期間 + 全簽核類型通用）
export default function ApprovalDelegations() {
  const { profile, isAdmin } = useAuth()
  const [rules, setRules] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`

  const [form, setForm] = useState({ delegator_employee_id: '', delegate_employee_id: '', effective_from: today(), effective_to: '', reason: '' })

  const load = async () => {
    setLoading(true)
    const orgId = profile?.organization_id
    const [rRes, eRes] = await Promise.all([
      supabase.from('approval_delegation_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, name_en, position, dept').eq('status', '在職').order('name'),
    ])
    setRules(rRes.data || [])
    setEmployees(eRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 非 admin 只能設「自己為委託人」(把自己的簽核權讓出去)
  const lockedDelegator = !isAdmin

  const add = async () => {
    const delegator = lockedDelegator ? profile?.id : Number(form.delegator_employee_id)
    const delegate = Number(form.delegate_employee_id)
    if (!delegator || !delegate) { toast.error('請選委託人與代理人'); return }
    if (delegator === delegate) { toast.error('委託人與代理人不能是同一人'); return }
    if (!form.effective_from) { toast.error('請填生效起日'); return }
    if (form.effective_to && form.effective_to < form.effective_from) { toast.error('結束日不能早於起日'); return }
    setSaving(true)
    const { error } = await supabase.from('approval_delegation_rules').insert({
      org_id: profile?.organization_id,
      delegator_employee_id: delegator,
      delegate_employee_id: delegate,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      reason: form.reason || null,
      is_active: true,
    })
    setSaving(false)
    if (error) { toast.error('新增失敗：' + error.message); return }
    toast.success('已新增代理規則')
    setForm({ delegator_employee_id: '', delegate_employee_id: '', effective_from: today(), effective_to: '', reason: '' })
    load()
  }

  const toggle = async (r) => {
    const { error } = await supabase.from('approval_delegation_rules').update({ is_active: !r.is_active }).eq('id', r.id)
    if (error) { toast.error('更新失敗：' + error.message); return }
    load()
  }
  const remove = async (r) => {
    if (!(await confirm({ message: `刪除「${empName(r.delegator_employee_id)} → ${empName(r.delegate_employee_id)}」代理規則？`, danger: true }))) return
    const { error } = await supabase.from('approval_delegation_rules').delete().eq('id', r.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    load()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <h2><UserCheck size={20} style={{ color: 'var(--accent-cyan)', verticalAlign: -3, marginRight: 6 }} />簽核代理</h2>
        <p>委託人不在時，由代理人在「代理期間」代簽所有簽核（待簽清單會出現在代理人那邊）。</p>
      </div>

      {/* 新增 */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 12 }}>＋ 新增代理</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>委託人（誰的簽核）</label>
            {lockedDelegator ? (
              <input className="form-input" value={profile?.name || '我'} disabled style={{ width: '100%' }} />
            ) : (
              <SearchableSelect value={form.delegator_employee_id}
                onChange={v => setForm(f => ({ ...f, delegator_employee_id: v }))}
                options={empOptions(employees)} placeholder="搜尋委託人…" />
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>代理人（誰來代簽）</label>
            <SearchableSelect value={form.delegate_employee_id}
              onChange={v => setForm(f => ({ ...f, delegate_employee_id: v }))}
              options={empOptions(employees)} placeholder="搜尋代理人…" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>生效起日</label>
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.effective_from}
              onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束日（空=長期）</label>
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.effective_to}
              onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>原因（選填）</label>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：出國 / 休假"
              value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button className="btn btn-primary" onClick={add} disabled={saving}>
            <Plus size={14} /> {saving ? '新增中…' : '新增代理'}
          </button>
        </div>
      </div>

      {/* 清單 */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 12 }}>代理規則（{rules.length}）</div>
        {rules.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>目前沒有代理規則</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map(r => {
              const active = isActiveNow(r)
              return (
                <div key={r.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                  opacity: r.is_active ? 1 : 0.55,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {empName(r.delegator_employee_id)} <span style={{ color: 'var(--text-muted)' }}>→</span> <span style={{ color: 'var(--accent-cyan)' }}>{empName(r.delegate_employee_id)}</span> 代簽
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {fmt(r.effective_from)} – {r.effective_to ? fmt(r.effective_to) : '長期'}{r.reason ? ` · ${r.reason}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                      background: active ? 'var(--accent-green-dim)' : 'var(--glass-light)',
                      color: active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                      {!r.is_active ? '已停用' : active ? '代理中' : '未到期/已過期'}
                    </span>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} title={r.is_active ? '停用' : '啟用'} onClick={() => toggle(r)}>
                      <Power size={13} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} title="刪除" onClick={() => remove(r)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
