import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { toast } from '../../lib/toast'
import FormBindingsPicker from '../FormBindingsPicker'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import FillFormModal from './FillFormModal'
import SettlePickerModal from './SettlePickerModal'
import { applyTypeFor, bindingFillPath, bindingViewPath } from './bindingFillUrl'

const STATUS_STYLE = {
  '未填':   { bg: 'var(--glass-light)',       color: 'var(--text-muted)',    icon: '⚪' },
  '簽核中': { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', icon: '🔵' },
  '已退回': { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)',    icon: '❌' },
  '已完成': { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)',  icon: '✅' },
}

function navTo(b, bindings) {
  const u = bindingFillPath(b, bindings)
  if (u) window.open(u, '_blank')
}

export default function TaskFormsTab({ task, formBindings, setFormBindings }) {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [pickerFor, setPickerFor] = useState(null)   // binding.id 目前展開選人的列
  const [busyId, setBusyId] = useState(null)         // 正在送指派 / 切模式的列
  const [fillBinding, setFillBinding] = useState(null) // 自己填 inline 彈窗
  const [settlePicker, setSettlePicker] = useState(null) // 核銷段挑單

  // 載入員工清單（指派他人填寫用）
  useEffect(() => {
    const orgId = task?.organization_id
    let q = supabase.from('employees').select('id, name, name_en, position, dept, store').eq('status', '在職').order('name')
    if (orgId) q = q.eq('organization_id', orgId)
    q.then(({ data }) => setEmployees(data || []))
  }, [task?.organization_id])

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`

  const reloadBindings = async () => {
    const { data } = await supabase.from('task_form_bindings').select('*').eq('task_id', task.id).order('id')
    setFormBindings(data || [])
  }

  const isLocked = (b) => {
    const at = applyTypeFor(b.form_type)
    if (!at) return false
    const sib = formBindings.find(x => x.form_type === at)
    return sib ? sib.status !== '已完成' : false
  }

  const actionFor = (b) => {
    if (isLocked(b)) return { label: '🔒 申請核准後解鎖', clickable: false }
    if (b.form_type === 'expense_settle')
      return b.form_id ? { label: '→ 去核銷', clickable: true } : { label: '→ 選擇要核銷的單', clickable: true }
    if (b.form_type === 'order_settle')
      return b.form_id ? { label: '→ 去驗收', clickable: true } : { label: '等申請建立', clickable: false }
    if (b.form_type === 'goods_transfer_receipt')
      return b.form_id ? { label: '→ 去驗收', clickable: true } : { label: '等申請建立', clickable: false }
    if (!b.form_id) return { label: '→ 去填寫', clickable: true }
    return { label: '', clickable: false }
  }

  // 點動作：核銷段未綁單 → 先挑要核銷的費用申請單；其餘（含已綁驗收段）以任務內 overlay 開啟
  const onAction = (b) => {
    if (b.form_type === 'expense_settle' && !b.form_id) {
      return setSettlePicker(b)
    }
    setFillBinding(b)
  }

  // 切「自己填」：清掉指派
  const setSelfMode = async (b) => {
    if (b.fill_mode === 'self' && !b.assignee_id) { setPickerFor(null); return }
    setBusyId(b.id)
    try {
      const { error } = await supabase.from('task_form_bindings')
        .update({ fill_mode: 'self', assignee_id: null }).eq('id', b.id)
      if (error) throw error
      setPickerFor(null)
      await reloadBindings()
    } catch (err) {
      toast.error('切換失敗：' + (err.message || '未知錯誤'))
    } finally {
      setBusyId(null)
    }
  }

  // 切「他人填」：展開選人；已選人則直接指派 + 通知
  const onPickOther = (b) => {
    setPickerFor(pickerFor === b.id ? null : b.id)
  }

  const assignFiller = async (b, empId) => {
    if (!empId) return
    setBusyId(b.id)
    try {
      const { data, error } = await supabase.rpc('assign_task_form_binding_filler', {
        p_binding_id: b.id, p_employee_id: Number(empId),
      })
      if (error) throw error
      if (data?.ok === false) throw new Error(data.error || '指派失敗')
      toast.success(data?.notified ? `已指派並通知 ${empName(Number(empId))}` : `已指派給 ${empName(Number(empId))}（該員未綁 LINE，未推播）`)
      setPickerFor(null)
      await reloadBindings()
    } catch (err) {
      toast.error('指派失敗：' + (err.message || '未知錯誤'))
    } finally {
      setBusyId(null)
    }
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
    await reloadBindings()
  }

  const completed = formBindings.filter(b => b.status === '已完成').length

  // 小型切換 pill
  const ModePill = ({ active, onClick, disabled, children }) => (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
        border: '1px solid ' + (active ? 'var(--accent-cyan)' : 'var(--border-subtle)'),
        background: active ? 'var(--accent-cyan-dim)' : 'transparent',
        color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      {children}
    </button>
  )

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
              const isOther = b.fill_mode === 'other'
              const done = b.status === '已完成'
              const vp = b.form_id ? bindingViewPath(b) : null
              const rowClickable = !!vp || act.clickable
              const handleRowClick = () => { if (vp) navigate(vp); else if (act.clickable) onAction(b) }
              return (
                <div key={b.id}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 8,
                    padding: '10px 12px', borderRadius: 6, background: 'var(--bg-secondary)',
                    opacity: locked ? 0.7 : 1,
                    border: '1px solid var(--border-subtle)',
                  }}>
                  {/* 第一列：表單 + 狀態 + 動作 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: rowClickable ? 'pointer' : 'default' }}
                    onClick={handleRowClick}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {s.icon} {b.form_label}
                        {b.form_id && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: vp ? 'var(--accent-cyan)' : 'var(--text-muted)', textDecoration: vp ? 'underline' : 'none' }}>
                            #{b.form_id}
                          </span>
                        )}
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

                  {/* 第二列：誰來填（已完成不再可改） */}
                  {!done && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>誰來填：</span>
                      <ModePill active={!isOther} disabled={busyId === b.id} onClick={() => setSelfMode(b)}>自己填</ModePill>
                      <ModePill active={isOther} disabled={busyId === b.id} onClick={() => onPickOther(b)}>他人填</ModePill>
                      {isOther && b.assignee_id && pickerFor !== b.id && (
                        <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600 }}>
                          指派給 {empName(b.assignee_id)}・已通知
                        </span>
                      )}
                      {pickerFor === b.id && (
                        <div style={{ minWidth: 200, flex: 1 }} onClick={e => e.stopPropagation()}>
                          <SearchableSelect
                            value={b.assignee_id || ''}
                            onChange={v => assignFiller(b, v)}
                            options={empOptions(employees)}
                            placeholder="搜尋要指派的員工…"
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {done && isOther && b.assignee_id && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>由 {empName(b.assignee_id)} 填寫</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {fillBinding && (
        <FillFormModal
          binding={fillBinding}
          bindings={formBindings}
          onClose={() => setFillBinding(null)}
          onDone={reloadBindings}
        />
      )}

      {settlePicker && (
        <SettlePickerModal
          binding={settlePicker}
          task={task}
          onClose={() => setSettlePicker(null)}
          onPicked={(reqId) => {
            setSettlePicker(null)
            reloadBindings()
            window.open(`/process/expense-requests?focus=${reqId}&settle=1`, '_blank')
          }}
        />
      )}
    </div>
  )
}
