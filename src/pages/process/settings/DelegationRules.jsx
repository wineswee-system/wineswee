import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'

const EMPTY = { delegator_employee_id: '', delegate_employee_id: '', effective_from: '', effective_to: '', reason: '' }

export default function DelegationRules() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [rules, setRules] = useState([])
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    Promise.all([
      supabase.from('approval_delegation_rules')
        .select('*, delegator:delegator_employee_id(name), delegate:delegate_employee_id(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id,name').eq('status', '在職').eq('organization_id', orgId).order('name'),
    ]).then(([r, e]) => {
      setRules(r.data || [])
      setEmployees(e.data || [])
      setLoading(false)
    })
  }, [orgId])

  const save = async () => {
    if (!form.delegator_employee_id || !form.delegate_employee_id || !form.effective_from) {
      toast.error('請填寫委託人、代理人及生效日期'); return
    }
    if (form.delegator_employee_id === form.delegate_employee_id) {
      toast.error('委託人與代理人不能相同'); return
    }
    setSaving(true)
    const { data, error } = await supabase.from('approval_delegation_rules')
      .insert({ ...form, delegator_employee_id: Number(form.delegator_employee_id), delegate_employee_id: Number(form.delegate_employee_id) })
      .select('*, delegator:delegator_employee_id(name), delegate:delegate_employee_id(name)')
      .single()
    if (error) { toast.error('儲存失敗：' + error.message); setSaving(false); return }
    setRules(prev => [data, ...prev])
    setForm(EMPTY)
    toast.success('代理規則已建立')
    setSaving(false)
  }

  const toggleActive = async (rule) => {
    const { data } = await supabase.from('approval_delegation_rules')
      .update({ is_active: !rule.is_active }).eq('id', rule.id)
      .select('*, delegator:delegator_employee_id(name), delegate:delegate_employee_id(name)').single()
    if (data) setRules(prev => prev.map(r => r.id === rule.id ? data : r))
  }

  const remove = async (id) => {
    await supabase.from('approval_delegation_rules').delete().eq('id', id)
    setRules(prev => prev.filter(r => r.id !== id))
    toast.success('已刪除代理規則')
  }

  const empOpts = employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)
  const today = new Date().toISOString().slice(0, 10)

  const isCurrentlyActive = (rule) =>
    rule.is_active &&
    rule.effective_from <= today &&
    (!rule.effective_to || rule.effective_to >= today)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🔄</span> 簽核代理規則</h2>
        <p>設定當簽核人請假或不在時，自動將簽核任務委託給指定的代理人。</p>
      </div>

      {/* Add form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>新增代理規則</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>委託人（原簽核人）</div>
            <select className="form-input" value={form.delegator_employee_id} onChange={e => setForm(f => ({ ...f, delegator_employee_id: e.target.value }))}>
              <option value="">— 選擇員工 —</option>
              {empOpts}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>代理人</div>
            <select className="form-input" value={form.delegate_employee_id} onChange={e => setForm(f => ({ ...f, delegate_employee_id: e.target.value }))}>
              <option value="">— 選擇員工 —</option>
              {empOpts}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>生效日</div>
            <input type="date" className="form-input" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>結束日（選填）</div>
            <input type="date" className="form-input" value={form.effective_to} onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>原因說明</div>
            <input type="text" className="form-input" placeholder="例：出差、休假…" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} disabled={saving} onClick={save}>
          <Plus size={14} /> {saving ? '儲存中…' : '新增代理規則'}
        </button>
      </div>

      {/* Rules table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
        ) : rules.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔄</div>
            尚未設定任何代理規則
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
                {['委託人', '代理人', '生效日', '結束日', '原因', '狀態', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => {
                const active = isCurrentlyActive(rule)
                return (
                  <tr key={rule.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{rule.delegator?.name || rule.delegator_employee_id}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>→ {rule.delegate?.name || rule.delegate_employee_id}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{rule.effective_from}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{rule.effective_to || '無限期'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{rule.reason || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => toggleActive(rule)} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                        {active ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {active ? '生效中' : rule.is_active ? '待生效/已過期' : '已停用'}
                      </button>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => remove(rule.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)' }} title="刪除">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
