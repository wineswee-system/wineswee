import { useState, useEffect } from 'react'
import { Plus, Calculator, X, AlertCircle, Check, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const STATUS_BADGE = {
  pending:   { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', text: '待支付' },
  paid:      { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)',  text: '已支付' },
  cancelled: { bg: 'rgba(156,163,175,0.12)',   color: 'var(--text-muted)',    text: '已取消' },
}

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '—'

// 勞基法 §11 + §13 但書 法定資遣事由（select 下拉用）
const LEGAL_REASONS = [
  '§11-1 歇業或轉讓',
  '§11-2 虧損或業務緊縮',
  '§11-3 不可抗力暫停工作 1 個月以上',
  '§11-4 業務性質變更，有減少勞工之必要，又無適當工作可供安置',
  '§11-5 勞工對於所擔任之工作確不能勝任',
  '§13 但書 天災事變',
]

export default function Severance() {
  const { profile, role, hasPermission } = useAuth()
  const canExecute = role?.name === 'admin' || role?.name === 'super_admin' || hasPermission('severance.execute')
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCalcModal, setShowCalcModal] = useState(false)
  const [tab, setTab] = useState('all')   // all | pending | paid

  // 試算 form
  const [form, setForm] = useState({
    employee_id: '', termination_date: '', reason: '',
    notice_paid: true,        // 是否實際給預告（true=不付 notice_wage）
    unused_leave_days: 0,
    unused_leave_wage: 0,
    avg_wage_override: '',    // 手動覆蓋平均工資
    notes: '',
  })
  const [calcResult, setCalcResult] = useState(null)  // RPC 試算結果
  const [calcing, setCalcing] = useState(false)
  const [saving, setSaving] = useState(false)
  // 「資遣原因」select 選「其他」時開關自訂 input。reason 自身只存實際值
  const [useOtherReason, setUseOtherReason] = useState(false)

  const load = async () => {
    setLoading(true)
    const orgId = profile?.organization_id
    const [recRes, empRes] = await Promise.all([
      supabase.from('severance_records').select('*').order('created_at', { ascending: false }),
      supabase.from('employees')
        .select('id, name, name_en, employee_number, status, position, join_date, dept, store, departments!department_id(name), stores!store_id(name)')
        .eq('organization_id', orgId || 1).order('name'),
    ])
    setRecords(recRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [profile?.organization_id])

  // 試算 — 按「試算」按鈕觸發
  const handleCalc = async () => {
    if (!form.employee_id || !form.termination_date) { toast.warning('請選員工 + 離職日'); return }
    setCalcing(true)
    setCalcResult(null)
    const { data, error } = await supabase.rpc('calc_severance', {
      p_employee_id: Number(form.employee_id),
      p_termination_date: form.termination_date,
      p_avg_wage_override: form.avg_wage_override ? Number(form.avg_wage_override) : null,
    })
    setCalcing(false)
    if (error) { toast.error(`試算失敗：${error.message}`); return }
    if (!data?.ok) {
      toast.error(data?.message || `試算失敗：${data?.error || 'unknown'}`)
      return
    }
    setCalcResult(data)
  }

  const handleSave = async () => {
    if (!calcResult) { toast.warning('請先試算'); return }
    setSaving(true)
    const noticeWage = form.notice_paid ? 0 : Number(calcResult.notice_wage || 0)
    const unusedLeaveWage = Number(form.unused_leave_wage || 0)
    const total = Number(calcResult.severance_amount || 0) + noticeWage + unusedLeaveWage
    const { error } = await supabase.from('severance_records').insert({
      employee_id: calcResult.employee_id,
      employee_name_snapshot: calcResult.employee_name,
      join_date: calcResult.join_date,
      termination_date: calcResult.termination_date,
      reason: form.reason || null,
      service_years: calcResult.service_years,
      average_monthly_wage: calcResult.average_monthly_wage,
      severance_months: calcResult.severance_months,
      severance_amount: calcResult.severance_amount,
      notice_days: calcResult.notice_days,
      notice_wage: noticeWage,
      notice_paid: form.notice_paid,
      unused_leave_days: Number(form.unused_leave_days || 0),
      unused_leave_wage: unusedLeaveWage,
      total_amount: total,
      status: 'pending',
      notes: form.notes || null,
      organization_id: profile?.organization_id || null,
      created_by: profile?.name || null,
    })
    if (error) { setSaving(false); toast.error(`儲存失敗：${error.message}`); return }

    // 同步把員工 cascade 為「離職」(resign_type='involuntary' = 資遣)
    // 涵蓋：employees.status / resign_date / 主要 assignment 關閉 / 刪未來班表 / 取消待審單
    const { data: cascadeResult, error: cascadeErr } = await supabase.rpc('apply_employee_resignation', {
      p_emp_id: calcResult.employee_id,
      p_resign_date: calcResult.termination_date,
      p_resign_reason: form.reason || '資遣',
      p_resign_type: 'involuntary',
    })
    setSaving(false)
    if (cascadeErr || !cascadeResult?.ok) {
      toast.error(`資遣紀錄已存但員工狀態未同步：${cascadeErr?.message || cascadeResult?.error || '未知錯誤'}`)
    } else {
      toast.success('資遣紀錄已建立，員工狀態已同步為離職')
    }
    setShowCalcModal(false)
    setForm({ employee_id: '', termination_date: '', reason: '', notice_paid: true, unused_leave_days: 0, unused_leave_wage: 0, avg_wage_override: '', notes: '' })
    setCalcResult(null)
    setUseOtherReason(false)
    load()
  }

  const handleMarkPaid = async (rec) => {
    if (!(await confirm({ message: `標記 ${rec.employee_name_snapshot} 的資遣費為「已支付」？` }))) return
    const { error } = await supabase.from('severance_records').update({
      status: 'paid', paid_at: new Date().toISOString(),
    }).eq('id', rec.id)
    if (error) { toast.error(`更新失敗：${error.message}`); return }
    load()
  }

  const handleCancel = async (rec) => {
    const reason = prompt('取消原因：')
    if (!reason) return
    const { error } = await supabase.from('severance_records').update({
      status: 'cancelled', notes: (rec.notes ? rec.notes + '\n' : '') + `[取消] ${reason}`,
    }).eq('id', rec.id)
    if (error) { toast.error(`取消失敗：${error.message}`); return }
    load()
  }

  const filtered = records.filter(r => tab === 'all' || r.status === tab)
  if (loading) return <LoadingSpinner />

  const totals = {
    pending:  records.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.total_amount || 0), 0),
    paid:     records.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.total_amount || 0), 0),
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⚖️</span> 資遣管理</h2>
            <p>勞退新制：服務年資 × 0.5 月平均工資（封頂 6 個月）+ 預告工資（10/20/30 日）</p>
          </div>
          {canExecute && <button className="btn btn-primary" onClick={() => setShowCalcModal(true)}>
            <Plus size={14} /> 新增資遣計算
          </button>}
        </div>
      </div>

      {/* 統計卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>待支付總額</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-orange)' }}>{fmt(totals.pending)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{records.filter(r => r.status === 'pending').length} 筆</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>已支付總額</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-green)' }}>{fmt(totals.paid)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{records.filter(r => r.status === 'paid').length} 筆</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden', marginBottom: 16, maxWidth: 480 }}>
        {[
          { key: 'all',     label: `📋 全部 (${records.length})` },
          { key: 'pending', label: `⏳ 待支付 (${records.filter(r => r.status === 'pending').length})` },
          { key: 'paid',    label: `✅ 已支付 (${records.filter(r => r.status === 'paid').length})` },
        ].map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
            padding: '8px 14px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: 1,
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color:      tab === t.key ? '#fff' : 'var(--text-muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* 列表 */}
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>到職 → 離職</th>
                <th style={{ textAlign: 'right' }}>年資</th>
                <th style={{ textAlign: 'right' }}>平均月薪</th>
                <th style={{ textAlign: 'right' }}>資遣金</th>
                <th style={{ textAlign: 'right' }}>預告</th>
                <th style={{ textAlign: 'right' }}>特休</th>
                <th style={{ textAlign: 'right' }}>總額</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>無資料</td></tr>
              )}
              {filtered.map(r => {
                const sb = STATUS_BADGE[r.status] || {}
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.employee_name_snapshot}</div>
                      {r.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.reason}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.join_date} → <b>{r.termination_date}</b>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{Number(r.service_years || 0).toFixed(2)} 年</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.average_monthly_wage)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmt(r.severance_amount)}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{Number(r.severance_months || 0).toFixed(2)} 月</div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {r.notice_paid ? <span style={{ color: 'var(--text-muted)' }}>已預告</span> : fmt(r.notice_wage)}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.notice_days} 日</div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {Number(r.unused_leave_wage || 0) > 0 ? fmt(r.unused_leave_wage) : '—'}
                      {Number(r.unused_leave_days || 0) > 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.unused_leave_days} 天</div>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-cyan)' }}>{fmt(r.total_amount)}</td>
                    <td><span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: sb.bg, color: sb.color }}>{sb.text}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canExecute && r.status === 'pending' && (
                          <>
                            <AsyncButton className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-green)' }} onClick={() => handleMarkPaid(r)} busyLabel="處理中…">
                              <Check size={11} /> 標已付
                            </AsyncButton>
                            <AsyncButton className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleCancel(r)} busyLabel="處理中…">
                              <X size={11} /> 取消
                            </AsyncButton>
                          </>
                        )}
                        {r.status === 'paid' && r.paid_at && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(r.paid_at).toLocaleDateString('zh-TW')}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 計算 modal */}
      {showCalcModal && (
        <Modal title="新增資遣計算" onClose={() => { setShowCalcModal(false); setCalcResult(null) }} onSubmit={null} maxWidth={680}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工" required>
              <SearchableSelect
                value={form.employee_id}
                options={empOptions(employees.filter(e => e.status === '在職' || e.status === '留職停薪'))}
                onChange={v => setForm(f => ({ ...f, employee_id: v }))}
                placeholder="搜尋員工..."
              />
            </Field>
            <Field label="離職日期" required>
              <input type="date" className="form-input" style={{ width: '100%' }}
                value={form.termination_date}
                onChange={e => setForm(f => ({ ...f, termination_date: e.target.value }))} />
            </Field>
          </div>

          <Field label="資遣原因（勞基法 §11 / §13 但書）">
            <select className="form-input" style={{ width: '100%' }}
              value={
                useOtherReason ? '__other__' :
                LEGAL_REASONS.includes(form.reason) ? form.reason : ''
              }
              onChange={e => {
                const v = e.target.value
                if (v === '__other__') {
                  setUseOtherReason(true)
                  // 若原本是法定事由，切到「其他」要清空讓 user 重打
                  if (LEGAL_REASONS.includes(form.reason)) {
                    setForm(f => ({ ...f, reason: '' }))
                  }
                } else {
                  setUseOtherReason(false)
                  setForm(f => ({ ...f, reason: v }))
                }
              }}>
              <option value="">— 選擇法定資遣事由 —</option>
              <optgroup label="勞基法 §11 雇主預告終止勞動契約">
                <option value="§11-1 歇業或轉讓">§11-1 歇業或轉讓</option>
                <option value="§11-2 虧損或業務緊縮">§11-2 虧損或業務緊縮</option>
                <option value="§11-3 不可抗力暫停工作 1 個月以上">§11-3 不可抗力暫停工作 1 個月以上</option>
                <option value="§11-4 業務性質變更，有減少勞工之必要，又無適當工作可供安置">§11-4 業務性質變更，有減少勞工之必要，又無適當工作可供安置</option>
                <option value="§11-5 勞工對於所擔任之工作確不能勝任">§11-5 勞工對於所擔任之工作確不能勝任</option>
              </optgroup>
              <optgroup label="其他法定">
                <option value="§13 但書 天災事變">§13 但書 天災、事變或其他不可抗力（須主管機關核定）</option>
              </optgroup>
              <option value="__other__">其他（自行填寫）</option>
            </select>
            {useOtherReason && (
              <input type="text" className="form-input" style={{ width: '100%', marginTop: 8 }}
                placeholder="自行填寫資遣原因"
                autoFocus
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            )}
          </Field>

          <Field label="平均工資手動覆蓋（選填，留空則自動撈離職前 6 個月薪資平均）">
            <input type="number" className="form-input" style={{ width: '100%' }}
              placeholder="留空則自動計算"
              value={form.avg_wage_override}
              onChange={e => setForm(f => ({ ...f, avg_wage_override: e.target.value }))} />
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 16 }}>
            <button className="btn btn-secondary" onClick={handleCalc} disabled={calcing}>
              <Calculator size={14} /> {calcing ? '試算中...' : '試算'}
            </button>
          </div>

          {/* 試算結果 */}
          {calcResult && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={14} /> 試算結果
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>員工：</span><b>{calcResult.employee_name}</b> {calcResult.employee_number && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>({calcResult.employee_number})</span>}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>到職日：</span>{calcResult.join_date}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>服務年資：</span><b>{calcResult.service_label}</b> ({Number(calcResult.service_years).toFixed(3)} 年)</div>
                <div><span style={{ color: 'var(--text-muted)' }}>平均月薪：</span><b style={{ fontFamily: 'monospace' }}>{fmt(calcResult.average_monthly_wage)}</b>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>
                    ({calcResult.avg_wage_source === 'manual' ? '手動' : calcResult.avg_wage_source === 'payroll_6m_avg' ? '近 6 月平均' : '薪資結構'})
                  </span>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed var(--border-medium)', marginTop: 12, paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>資遣月數：</span><b>{Number(calcResult.severance_months).toFixed(2)} 月</b> <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(封頂 6)</span></div>
                <div><span style={{ color: 'var(--text-muted)' }}>資遣金：</span><b style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>{fmt(calcResult.severance_amount)}</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>預告天數：</span><b>{calcResult.notice_days} 日</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>預告工資：</span><b style={{ fontFamily: 'monospace' }}>{fmt(calcResult.notice_wage)}</b></div>
              </div>

              {/* 預告工資選項 + 特休未休 */}
              <div style={{ borderTop: '1px dashed var(--border-medium)', marginTop: 12, paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                  <input type="checkbox" id="notice_paid"
                    checked={form.notice_paid}
                    onChange={e => setForm(f => ({ ...f, notice_paid: e.target.checked }))} />
                  <label htmlFor="notice_paid">已實際給予預告（不需付預告工資）</label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="特休未休天數">
                    <input type="number" step="0.5" className="form-input" style={{ width: '100%' }}
                      value={form.unused_leave_days}
                      onChange={e => setForm(f => ({ ...f, unused_leave_days: e.target.value }))} />
                  </Field>
                  <Field label="特休未休折算工資">
                    <input type="number" className="form-input" style={{ width: '100%' }}
                      value={form.unused_leave_wage}
                      onChange={e => setForm(f => ({ ...f, unused_leave_wage: e.target.value }))} />
                  </Field>
                </div>
              </div>

              {/* 總計 */}
              <div style={{ borderTop: '2px solid var(--accent-cyan)', marginTop: 12, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>總額</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>
                  {fmt(
                    Number(calcResult.severance_amount || 0)
                    + (form.notice_paid ? 0 : Number(calcResult.notice_wage || 0))
                    + Number(form.unused_leave_wage || 0)
                  )}
                </div>
              </div>
            </div>
          )}

          <Field label="備註">
            <textarea className="form-input" rows={2} style={{ width: '100%' }}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>

          {!calcResult && (
            <div style={{ background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', padding: 10, borderRadius: 8, fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>填好員工 + 離職日期後按「試算」，確認金額無誤再儲存。</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => { setShowCalcModal(false); setCalcResult(null) }}>取消</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!calcResult || saving}>
              {saving ? '儲存中...' : '儲存資遣紀錄'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
