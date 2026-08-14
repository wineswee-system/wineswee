import { useMemo, useState, useEffect } from 'react'
import { Paperclip } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import Time24 from '../../../components/Time24'
import { LEAVE_TYPES, getLeaveTypeInfo, leaveRequiresProof } from '../../../lib/leavePolicy'
import { clearError } from '../../../lib/formValidation'
import CarriedAttachments from '../../../components/CarriedAttachments'
import { countWorkDays, snapToStep, diffHours } from '../../../lib/leaveDaysCalc'
import { supabase } from '../../../lib/supabase'

// 產假情形（對齊後端 maternity_max_days：56/28/7/5）
const MATERNITY_SITUATIONS = [
  { code: 'childbirth', label: '分娩', days: 56 },
  { code: 'miscarriage_ge3m', label: '妊娠滿3個月以上流產', days: 28 },
  { code: 'miscarriage_2to3m', label: '妊娠2個月以上未滿3個月流產', days: 7 },
  { code: 'miscarriage_lt2m', label: '妊娠未滿2個月流產', days: 5 },
]

// Props: open, onClose, form, setForm, employees, departments, stepSettings,
//        onSubmit, errors, setErrors, editingId, attachFiles, onFileSelect,
//        removeAttach, validationMsg, uploading, leaves, holidays
export default function LeaveFormModal({
  open,
  onClose,
  form,
  setForm,
  employees,
  stepSettings,
  onSubmit,
  errors,
  setErrors,
  editingId,
  attachFiles,
  onFileSelect,
  removeAttach,
  validationMsg,
  uploading,
  leaves,
  holidays,
  carriedAtts = [],
  onRemoveCarried,
}) {
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
  }

  const selectedPolicy = getLeaveTypeInfo(form.type)

  // 補休：查 comp_time_ledger 餘額（只有 type=comp_time 時 fetch）
  const [compBalance, setCompBalance] = useState(null) // { totalRemaining, ledgers: [...] }
  useEffect(() => {
    if (!selectedPolicy || selectedPolicy.code !== 'comp_time' || !form.employee) {
      setCompBalance(null)
      return
    }
    const emp = employees.find(e => e.name === form.employee)
    if (!emp?.id) { setCompBalance(null); return }
    let cancelled = false
    supabase.rpc('get_comp_time_balance', { p_employee_id: emp.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { console.error('[comp_time_balance]', error); setCompBalance({ totalRemaining: 0, ledgers: [] }); return }
      const ledgers = data || []
      const totalRemaining = ledgers.reduce((s, l) => s + Number(l.hours_remaining || 0), 0)
      setCompBalance({ totalRemaining, ledgers })
    })
    return () => { cancelled = true }
  }, [form.employee, selectedPolicy?.code, employees])

  // 特休:抓 leave_balances(104 匯入單一真相,對齊 create_leave_request/餘額頁);只有 annual 時抓,現在期且 total>0 才用
  const [annualBal, setAnnualBal] = useState(null) // { total_days, used_days }
  useEffect(() => {
    if (!selectedPolicy || selectedPolicy.code !== 'annual' || !form.employee) { setAnnualBal(null); return }
    const emp = employees.find(e => e.name === form.employee)
    if (!emp?.id) { setAnnualBal(null); return }
    let cancelled = false
    const today = new Date().toISOString().slice(0, 10)
    supabase.from('leave_balances').select('total_days, used_days, period_start, expires_at')
      .eq('employee_id', emp.id).eq('leave_type', 'annual')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setAnnualBal(null); return }
        const cur = (data || []).find(b =>
          (!b.period_start || String(b.period_start).slice(0, 10) <= today) &&
          (!b.expires_at   || String(b.expires_at).slice(0, 10)   >= today))
        setAnnualBal(cur && Number(cur.total_days) > 0 ? cur : null)
      })
    return () => { cancelled = true }
  }, [form.employee, selectedPolicy?.code, employees])

  // 時數假即時預覽：抓「扣休息後」的淨時數(對齊送出後 trigger 存進去的值)
  const [netHours, setNetHours] = useState(null)
  useEffect(() => {
    if (form.unit !== 'hour' || !form.start_time || !form.end_time || !form.start_date || !form.employee) {
      setNetHours(null); return
    }
    const emp = employees.find(e => e.name === form.employee)
    if (!emp?.id) { setNetHours(null); return }
    let cancelled = false
    supabase.rpc('preview_leave_net_hours', {
      p_emp_id: emp.id, p_date: form.start_date, p_start: form.start_time, p_end: form.end_time,
    }).then(({ data }) => { if (!cancelled) setNetHours(data != null ? Number(data) : null) })
    return () => { cancelled = true }
  }, [form.unit, form.start_time, form.end_time, form.start_date, form.employee, employees])

  // 計算員工該假別的年度餘額（顯示在 modal 法源 info 下方）
  const balance = useMemo(() => {
    if (!selectedPolicy || !form.employee) return null
    const empFor = employees.find(em => em.name === form.employee)
    // 特休:有 104 匯入的 leave_balances(現在期、total>0)→ 用它當單一真相(對齊送出閘門/餘額頁);否則 fallback §38
    if (selectedPolicy.code === 'annual' && annualBal) {
      const total = Number(annualBal.total_days || 0), used = Number(annualBal.used_days || 0)
      return { total, used, remaining: Math.max(0, total - used) }
    }
    let total = 0
    if (selectedPolicy.code === 'annual' && empFor?.join_date) {
      const yrs = (new Date() - new Date(empFor.join_date)) / (365.25 * 86400000)
      total = selectedPolicy.calcEntitlement ? selectedPolicy.calcEntitlement(yrs) : 0
    } else if (selectedPolicy.maxDays) {
      total = selectedPolicy.maxDays
    }
    if (total === 0) return null
    const used = (leaves || [])
      .filter(l => l.employee === form.employee && !['已退回', '已駁回', '已取消', '已拒絕'].includes(l.status))
      .filter(l => l.type === form.type || l.type === selectedPolicy.shortName)
      .reduce((s, l) => s + (l.days || 0), 0)
    return { total, used, remaining: Math.max(0, total - used) }
  }, [form.employee, form.type, selectedPolicy, employees, leaves, annualBal])

  if (!open) return null

  return (
    <Modal
      title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增假單'}
      onClose={onClose}
      onSubmit={onSubmit}
      successMessage={editingId ? '已重新送審，主管會收到通知' : '請假申請已送出，等待主管簽核'}
    >
      <Field label="員工" required error={errors.employee} errorMsg="請選擇員工">
        <SearchableSelect
          value={form.employee}
          onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
          options={empOptions(employees, { keyBy: 'name' })}
          placeholder="搜尋員工姓名/職稱..."
        />
      </Field>
      <Field label="假別" required>
        <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
          {LEAVE_TYPES
            // 女性專屬假別(產假/生理假/產檢假/哺乳)男性看不到;性別未知(null)不限制。男性對應的是陪產假(不分性別)
            .filter(t => !(t.gender === 'female' && employees.find(e => e.name === form.employee)?.gender === '男'))
            // 謀職假(§16):只有資遣預告期(involuntary + resign_date 未到)的員工才顯示
            .filter(t => {
              if (t.code !== 'job_seeking') return true
              const e = employees.find(x => x.name === form.employee)
              return e?.resign_type === 'involuntary' && e?.resign_date && String(e.resign_date).slice(0, 10) >= new Date().toISOString().slice(0, 10)
            })
            .map(t => (
              <option key={t.code} value={t.code}>{t.shortName}（{t.law}）</option>
            ))}
        </select>
      </Field>
      {/* 產假:情形選擇（分娩/流產週數）→ 決定上限 56/28/7/5（性平法）。後端 create_leave_request 會依此擋超額。 */}
      {selectedPolicy?.code === 'maternity' && (
        <Field label="產假情形" required>
          <select
            className="form-input"
            style={{ width: '100%' }}
            value={form.maternity_type || 'childbirth'}
            onChange={e => set('maternity_type', e.target.value)}
          >
            {MATERNITY_SITUATIONS.map(m => (
              <option key={m.code} value={m.code}>{m.label}（上限 {m.days} 天）</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            依《性別平等工作法》，不同情形有不同天數上限；超過上限送出會被擋下。
          </div>
          {/* 產假薪資：依到職滿6個月與否（§50，同計薪引擎判斷：起始日 < 到職+6月 → 半薪） */}
          {(() => {
            const empMat = employees.find(e => e.name === form.employee)
            if (!empMat?.join_date) return null
            const ref = new Date(form.start_date || new Date().toISOString().slice(0, 10))
            const sixMo = new Date(empMat.join_date); sixMo.setMonth(sixMo.getMonth() + 6)
            const half = ref < sixMo
            return (
              <div style={{
                marginTop: 6, fontSize: 12, fontWeight: 600,
                color: half ? 'var(--accent-orange)' : 'var(--accent-green)',
              }}>
                產假薪資：{half ? '半薪（到職未滿 6 個月，§50 減半發給）' : '全薪（到職滿 6 個月，工資照給）'}
                {!form.start_date && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
                    （以今日估算，實際依產假起始日）
                  </span>
                )}
              </div>
            )
          })()}
        </Field>
      )}
      {/* Policy info */}
      {selectedPolicy && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 12, marginBottom: 12,
          background: 'var(--accent-cyan-dim)', border: '1px solid rgba(34,211,238,0.15)',
          color: 'var(--text-secondary)', lineHeight: 1.7,
        }}>
          {selectedPolicy.law && <div><strong style={{ color: 'var(--accent-cyan)' }}>法源：</strong>{selectedPolicy.law}</div>}
          {selectedPolicy.salary && <div><strong style={{ color: 'var(--accent-cyan)' }}>薪資：</strong>{selectedPolicy.salary}</div>}
          <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>{selectedPolicy.description}</div>
          {selectedPolicy.code === 'comp_time' && compBalance && (
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: '1px dashed rgba(34,211,238,0.2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: 'var(--accent-cyan)' }}>補休餘額</strong>
                <span style={{ fontSize: 14, fontWeight: 700, color: compBalance.totalRemaining <= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                  剩 {compBalance.totalRemaining} 小時
                </span>
              </div>
              {compBalance.ledgers.length > 0 ? (
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <div style={{ marginBottom: 4 }}>📋 明細（最早到期先扣 / FIFO）：</div>
                  {compBalance.ledgers.slice(0, 5).map(l => (
                    <div key={l.ledger_id}>
                      • {l.ot_date} 加班 → 剩 <b style={{ color: 'var(--text-secondary)' }}>{l.hours_remaining}h</b>，
                      {l.expires_at} 到期
                      {l.days_to_expire <= 30 && (
                        <span style={{ color: 'var(--accent-orange)', marginLeft: 4 }}>
                          （{l.days_to_expire} 天後到期）
                        </span>
                      )}
                    </div>
                  ))}
                  {compBalance.ledgers.length > 5 && (
                    <div style={{ marginTop: 2, fontStyle: 'italic' }}>… 另有 {compBalance.ledgers.length - 5} 筆</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
                  目前沒有補休餘額（加班申請時選「補休」才會累積）
                </div>
              )}
            </div>
          )}
          {selectedPolicy.code !== 'comp_time' && balance && (
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: '1px dashed rgba(34,211,238,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <strong style={{ color: 'var(--accent-cyan)' }}>該員餘額</strong>
              <span style={{ fontSize: 14, fontWeight: 700, color: balance.remaining <= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                剩 {balance.remaining} / {balance.total} 天
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  （已用 {balance.used}）
                </span>
              </span>
            </div>
          )}
          {(() => {
            const empSel = employees.find(em => em.name === form.employee)
            const sk = empSel?.store_id || null
            const cfg = (sk && stepSettings[sk]?.[form.type]) || stepSettings.all?.[form.type]
            if (!cfg) return null
            return (
              <div style={{ fontSize: 11, marginTop: 6, paddingTop: 6, borderTop: '1px dashed rgba(34,211,238,0.2)' }}>
                <strong style={{ color: 'var(--accent-purple)' }}>廠商設定：</strong>
                最小單位 {cfg.step} {cfg.unit === 'day' ? '天' : '小時'}
                （在「工時/假別單位」設定）· 不滿一個單位會自動進位
              </div>
            )
          })()}
        </div>
      )}
      {/* Unit toggle */}
      {selectedPolicy?.allowHourly && (
        <Field label="請假單位">
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ v: 'day', l: '整天' }, { v: 'hour', l: '時數' }].map(u => (
              <button key={u.v} type="button" onClick={() => set('unit', u.v)} style={{
                flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
                background: form.unit === u.v ? 'var(--accent-cyan)' : 'var(--bg-card)',
                color: form.unit === u.v ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer', outline: `1px solid ${form.unit === u.v ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
              }}>{u.l}</button>
            ))}
          </div>
        </Field>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: form.unit === 'hour' ? '1fr' : '1fr 1fr', gap: 12 }}>
        <Field label={form.unit === 'hour' ? '日期' : '開始日期'} required error={errors.start_date} errorMsg="請選日期">
          <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => { set('start_date', e.target.value); clearError('start_date', setErrors) }} />
        </Field>
        {form.unit === 'day' && (
          <Field label="結束日期" required error={errors.end_date} errorMsg="請選結束日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => { set('end_date', e.target.value); clearError('end_date', setErrors) }} />
          </Field>
        )}
      </div>
      {form.unit === 'hour' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="開始時間" required error={errors.start_time} errorMsg="請選開始時間">
            <Time24 value={form.start_time} onChange={v => { set('start_time', v); clearError('start_time', setErrors) }} />
          </Field>
          <Field label="結束時間" required error={errors.end_time} errorMsg="請選結束時間">
            <Time24 value={form.end_time} onChange={v => { set('end_time', v); clearError('end_time', setErrors) }} />
          </Field>
        </div>
      )}
      {/* 天數預覽：扣週末/國假 + step 進位後的實際天/時 */}
      {(() => {
        const empForStep = employees.find(em => em.name === form.employee)
        const sKey = empForStep?.store_id || null
        const cfg = (sKey && stepSettings[sKey]?.[form.type]) || stepSettings.all?.[form.type] || { step: 0.5, unit: form.unit }
        let preview
        if (form.unit === 'hour') {
          if (!form.start_time || !form.end_time) preview = null
          else {
            const h = diffHours(form.start_time, form.end_time)
            const snapped = cfg.unit === 'hour' ? snapToStep(h, cfg.step) : h
            // netHours(扣休息,來自後端)有值就以它為準 = 送出後 trigger 存的值
            const val = netHours != null ? netHours : snapped
            preview = { value: val, unit: '小時', hasBreak: netHours != null && netHours < h - 1e-6 }
          }
        } else {
          if (!form.start_date) preview = null
          else if (selectedPolicy?.code === 'maternity') {
            // 產假法定以「曆日」計(含例假),對齊後端;不扣週末國假、不套 step
            const s = new Date(form.start_date), e = new Date(form.end_date || form.start_date)
            const cal = Math.round((e - s) / 86400000) + 1
            preview = { value: cal, unit: '天', calendar: true }
          } else {
            const wd = countWorkDays(form.start_date, form.end_date || form.start_date, holidays)
            const snapped = cfg.unit === 'day' ? snapToStep(wd, cfg.step) : wd
            preview = { value: snapped, unit: '天' }
          }
        }
        return (
          <Field label="總計">
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: preview ? 'var(--accent-cyan-dim)' : 'var(--glass-light)',
              color: preview ? 'var(--accent-cyan)' : 'var(--text-muted)',
              fontWeight: 700, fontSize: 18,
              border: '1px solid var(--border-subtle)',
            }}>
              {preview ? `${preview.value} ${preview.unit}` : '請填日期 / 時間'}
            </div>
            {form.unit === 'day' && preview && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {preview.calendar
                  ? '產假以曆日計（含例假／國定假日）'
                  : `已扣除週末 + 國定假日 · 最小單位 ${cfg.step} ${cfg.unit === 'day' ? '天' : '小時'}`}
              </div>
            )}
            {form.unit === 'hour' && preview?.hasBreak && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                已扣除班中休息時間（休息不計入請假）
              </div>
            )}
          </Field>
        )
      })()}
      <Field label="事由" required error={errors.reason} errorMsg="請填寫請假事由">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="請輸入請假事由" value={form.reason} onChange={e => { set('reason', e.target.value); clearError('reason', setErrors) }} />
      </Field>
      <Field
        label={leaveRequiresProof(form.type) ? '附件（證明）' : '附件（最多 5 個）'}
        required={leaveRequiresProof(form.type)}
        error={leaveRequiresProof(form.type) && errors.attachment}
        errorMsg="請附上證明，以免被駁回"
      >
        <div>
          {leaveRequiresProof(form.type) && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-orange)', marginBottom: 6 }}>
              ⚠ 此假別請附上證明（診斷書／相關文件），以免被駁回
            </div>
          )}
          <CarriedAttachments atts={carriedAtts} onRemove={onRemoveCarried} />
          <input type="file" multiple accept="image/*,application/pdf"
            onChange={onFileSelect}
            style={{ fontSize: 12 }}
          />
          {attachFiles.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {attachFiles.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                  <Paperclip size={11} />
                  <span style={{ flex: 1 }}>{a.file.name}</span>
                  <button type="button" onClick={() => removeAttach(i)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          {uploading && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📤 附件上傳中…</div>}
        </div>
      </Field>
      {validationMsg && (
        <div style={{ padding: '10px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 13, fontWeight: 600 }}>
          {validationMsg}
        </div>
      )}
    </Modal>
  )
}
