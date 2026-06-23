import { supabase } from '../../lib/supabase'
import FormBindingsPicker from '../FormBindingsPicker'

const STATUS_STYLE = {
  '未填':   { bg: 'var(--glass-light)',       color: 'var(--text-muted)',    icon: '⚪' },
  '簽核中': { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', icon: '🔵' },
  '已退回': { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)',    icon: '❌' },
  '已完成': { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)',  icon: '✅' },
}

const applyTypeFor = (ft) =>
  ft === 'expense_settle' ? 'expense_apply'
  : ft === 'goods_transfer_receipt' ? 'goods_transfer_apply'
  : null

function navTo(b, bindings) {
  const at = applyTypeFor(b.form_type)
  const sibDone = at ? bindings.find(x => x.form_type === at)?.status === '已完成' : true
  if (at && !sibDone) return

  let u = null
  if (b.form_type === 'expense_settle') {
    u = b.form_id ? `/process/expense-requests?focus=${b.form_id}&settle=1` : null
  } else if (b.form_type === 'goods_transfer_receipt') {
    u = b.form_id ? `/process/transfer-requests?focus=${b.form_id}&receipt=1` : null
  } else {
    u = (b.form_type === 'expense_request' || b.form_type === 'expense_apply') ? `/process/expense-requests?binding_id=${b.id}`
      : b.form_type === 'expense'         ? `/process/expenses?binding_id=${b.id}`
      : b.form_type === 'store_audit'     ? `/process/store-audits?new=1&binding_id=${b.id}`
      : (b.form_type === 'goods_transfer' || b.form_type === 'goods_transfer_apply') ? `/process/transfer-requests?new=1&binding_id=${b.id}`
      : `/process/forms/custom/${b.form_template_id}?binding_id=${b.id}`
  }
  if (u) window.open(u, '_blank')
}

export default function TaskFormsTab({ task, formBindings, setFormBindings }) {
  const isLocked = (b) => {
    const at = applyTypeFor(b.form_type)
    if (!at) return false
    const sib = formBindings.find(x => x.form_type === at)
    return sib ? sib.status !== '已完成' : false
  }

  const actionFor = (b) => {
    if (isLocked(b)) return { label: '🔒 申請核准後解鎖', clickable: false }
    if (b.form_type === 'expense_settle')
      return b.form_id ? { label: '→ 去核銷', clickable: true } : { label: '等申請建立', clickable: false }
    if (b.form_type === 'goods_transfer_receipt')
      return b.form_id ? { label: '→ 去驗收', clickable: true } : { label: '等申請建立', clickable: false }
    if (!b.form_id) return { label: '→ 去填寫', clickable: true }
    return { label: '', clickable: false }
  }

  const handleChange = async (next) => {
    const curr = formBindings
    const keyOf = (o) => `${o.form_type}-${o.form_template_id ?? 'null'}`
    const nextKeys = new Set(next.map(keyOf))
    const currKeys = new Set(curr.map(keyOf))
    for (const item of next) {
      if (!currKeys.has(keyOf(item))) {
        await supabase.rpc('create_task_form_binding', {
          p_task_id: task.id, p_form_type: item.form_type, p_form_template_id: item.form_template_id || null,
        })
      }
    }
    for (const item of curr) {
      if (!nextKeys.has(keyOf(item)) && !item.form_id) {
        await supabase.from('task_form_bindings').delete().eq('id', item.id)
      }
    }
    const { data } = await supabase.from('task_form_bindings').select('*').eq('task_id', task.id).order('id')
    setFormBindings(data || [])
  }

  const completed = formBindings.filter(b => b.status === '已完成').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Picker ── */}
      <div style={{ padding: '16px 20px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6 }}>
          📋 綁定表單（選填）
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          執行人需填完選定的表單，全部完成才能完成此任務。已填過的綁定（🔒）不能移除。
        </div>
        <FormBindingsPicker
          value={formBindings.map(b => ({
            form_type: b.form_type,
            form_template_id: b.form_template_id,
            label: b.form_label,
            _binding_id: b.id,
            _has_form: !!b.form_id,
          }))}
          onChange={handleChange}
          lockedKeys={formBindings.filter(b => b.form_id).map(b => `${b.form_type}-${b.form_template_id ?? 'null'}`)}
        />
      </div>

      {/* ── Status list (only when bindings exist) ── */}
      {formBindings.length > 0 && (
        <div style={{ padding: '16px 20px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)' }}>📄 填寫狀態</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{completed}/{formBindings.length} 完成</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {formBindings.map(b => {
              const s = STATUS_STYLE[b.status] || STATUS_STYLE['未填']
              const act = actionFor(b)
              const locked = isLocked(b)
              return (
                <div key={b.id}
                  onClick={() => act.clickable && navTo(b, formBindings)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', borderRadius: 6, background: 'var(--bg-secondary)',
                    cursor: act.clickable ? 'pointer' : 'default',
                    opacity: locked ? 0.6 : 1,
                    border: '1px solid var(--border-subtle)',
                  }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {s.icon} {b.form_label}
                      {b.form_id && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>#{b.form_id}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      完成條件：{b.required_status}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
                      {b.status}
                    </span>
                    {act.label && (
                      <span style={{ fontSize: 11, color: locked ? 'var(--text-muted)' : 'var(--accent-cyan)', fontWeight: 600 }}>
                        {act.label}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
