import { Fragment, useState, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { calculateLaborInsurance, calculateHealthInsurance, calculateLaborPension } from '../../../lib/payroll'
import { supabase } from '../../../lib/supabase'

import { fmtNT as fmt } from '../../../lib/currency'

const n = (x) => Number(x) || 0

// ── Fallback（RPC 失敗時用 salary_records 彙總值，至少有東西看）──
function buildFallbackItems(r, brackets) {
  const base = r.base_salary || 0
  const laborDetail = calculateLaborInsurance(base, { brackets: brackets?.labor })
  const healthDetail = calculateHealthInsurance(base, { dependents: r.health_ins_dependents || 0, brackets: brackets?.health })
  return [
    { label: '底薪', value: base, color: 'var(--text-primary)', sign: '', section: 'add' },
    { label: '加班費', value: r.overtime || r.overtime_pay || 0, color: 'var(--accent-cyan)', sign: '+', section: 'add' },
    { label: '津貼', value: r.allowance || 0, color: 'var(--accent-green)', sign: '+', section: 'add' },
    { label: '獎金', value: r.bonus || 0, color: 'var(--accent-purple)', sign: '+', section: 'add' },
    { section: 'divider' },
    { label: '總薪資', value: base + n(r.overtime || r.overtime_pay) + n(r.allowance) + n(r.bonus), color: 'var(--accent-cyan)', sign: '=', section: 'total' },
    { section: 'divider' },
    { label: '勞健保', value: r.insurance || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
      note: `勞保自付約 ${laborDetail.employee_share.toLocaleString()}、健保自付約 ${healthDetail.employee_share.toLocaleString()}` },
    { label: '其他扣款', value: r.deductions || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct' },
  ]
}

const OT_CAT_LABEL = { weekday: '平日', restday: '休息日', weekly_off: '例假', holiday: '國定假' }

// ── 完整計算過程（從 _compute_payroll_for_employee 的回傳組）──
function buildFullItems(d) {
  const items = []
  const push = (o) => items.push(o)
  push({ label: '底薪', value: n(d.base_salary), sign: '', section: 'add', color: 'var(--text-primary)' })

  // 加班費（分類 + 時數）
  ;[['平日加班', d.otWeekday, d.otPayWeekday],
    ['休息日加班', d.otRestday, d.otPayRestday],
    ['例假加班', d.otWeeklyOff, d.otPayWeeklyOff],
    ['國定加班', d.otHoliday, d.otPayHoliday],
  ].forEach(([lbl, hrs, pay]) => {
    if (n(pay) > 0 || n(hrs) > 0) push({ label: lbl, value: n(pay), sign: '+', section: 'add', color: 'var(--accent-cyan)', note: `${n(hrs)} 小時` })
  })
  if (n(d.comp_time_settled_pay) > 0) push({ label: '補休兌現', value: n(d.comp_time_settled_pay), sign: '+', section: 'add', color: 'var(--accent-cyan)', note: `${n(d.comp_time_settled_count)} 筆` })
  if (n(d.holidayBonus) > 0) push({ label: '國定假日出勤加給', value: n(d.holidayBonus), sign: '+', section: 'add', color: 'var(--accent-cyan)' })

  // 津貼（逐項）
  ;[['主管加給', d.role_allowance], ['餐費津貼', d.meal_allowance], ['交通津貼', d.transport_allowance],
    ['夜班津貼', d.night_allowance], ['跨區津貼', d.cross_store_allowance],
  ].forEach(([lbl, v]) => { if (n(v) > 0) push({ label: lbl, value: n(v), sign: '+', section: 'add', color: 'var(--accent-green)' }) })
  if (Array.isArray(d.custom_allowances)) {
    d.custom_allowances.forEach(c => { if (n(c.amount) > 0) push({ label: c.name || '自訂津貼', value: n(c.amount), sign: '+', section: 'add', color: 'var(--accent-green)' }) })
  } else if (n(d.other_custom_total) > 0) {
    push({ label: '其他自訂津貼', value: n(d.other_custom_total), sign: '+', section: 'add', color: 'var(--accent-green)' })
  }
  if (n(d.attendance_bonus) > 0) push({ label: '全勤獎金', value: n(d.attendance_bonus), sign: '+', section: 'add', color: 'var(--accent-green)' })
  if (n(d.policyBonus) > 0) push({ label: '獎金', value: n(d.policyBonus), sign: '+', section: 'add', color: 'var(--accent-purple)' })

  push({ section: 'divider' })
  push({ label: '總薪資（應發）', value: n(d.gross), sign: '=', section: 'total', color: 'var(--accent-cyan)' })
  push({ section: 'divider' })

  // 減項
  const ded = (label, value, note) => { if (n(value) > 0) push({ label, value: n(value), sign: '-', section: 'deduct', color: 'var(--accent-orange)', note }) }
  ded('勞保自付', d.laborInsurance, n(d.insuredLabor) ? `投保級距 ${n(d.insuredLabor).toLocaleString()}` : null)
  ded('健保自付', d.healthInsurance, n(d.insuredHealth) ? `投保級距 ${n(d.insuredHealth).toLocaleString()}${n(d.health_ins_dependents) ? ` ×${1 + Math.min(n(d.health_ins_dependents), 3)}口` : ''}` : null)
  ded('勞退自提', d.pension, n(d.pension_self_pct) ? `自提 ${d.pension_self_pct}%` : null)
  if (n(d.absenceDeduction) > 0) push({ label: '事假/缺勤扣', value: n(d.absenceDeduction), sign: '-', section: 'deduct', color: 'var(--accent-red)', note: n(d.absenceDays) ? `${n(d.absenceDays)} 天` : null })
  if (n(d.unpaidDeduction) > 0) push({ label: '無薪假扣', value: n(d.unpaidDeduction), sign: '-', section: 'deduct', color: 'var(--accent-red)' })
  if (n(d.halfPayDeduction) > 0) push({ label: '半薪假扣', value: n(d.halfPayDeduction), sign: '-', section: 'deduct', color: 'var(--accent-red)' })
  if (n(d.lateDeduction) > 0) push({ label: '遲到扣', value: n(d.lateDeduction), sign: '-', section: 'deduct', color: 'var(--accent-red)', note: n(d.lateMins) ? `${n(d.lateMins)} 分鐘` : null })
  if (n(d.legal_deduction) > 0) push({ label: '法定扣款', value: n(d.legal_deduction), sign: '-', section: 'deduct', color: 'var(--accent-red)' })

  push({ section: 'divider' })
  push({ label: '減項合計', value: n(d.totalDeductions), sign: '-', section: 'subtotal', color: 'var(--accent-orange)' })
  return items
}

export default function SalaryTable({ filtered, expanded, setExpanded, getEmpDept, getBonusDetail, openEdit, brackets }) {
  // 展開時呼叫批次同款引擎 RPC，取完整計算過程（依 row id 快取）
  const [detailMap, setDetailMap] = useState({})
  const [loadingId, setLoadingId] = useState(null)
  useEffect(() => {
    if (!expanded || detailMap[expanded] !== undefined) return
    const row = filtered.find(r => r.id === expanded)
    if (!row || !row.employee_id || !row.month) { setDetailMap(m => ({ ...m, [expanded]: null })); return }
    setLoadingId(expanded)
    supabase.rpc('_compute_payroll_for_employee', { p_emp_id: row.employee_id, p_period: row.month })
      .then(({ data, error }) => setDetailMap(m => ({ ...m, [expanded]: error ? null : data })))
      .finally(() => setLoadingId(null))
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">📋</span> 薪資明細</div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>點擊列展開完整計算過程</span>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>員工</th>
              <th>部門</th>
              <th>底薪</th>
              <th>加班費</th>
              <th>津貼</th>
              <th>獎金</th>
              <th style={{ color: 'var(--accent-green)' }}>特休折現</th>
              <th style={{ color: 'var(--accent-orange)' }}>勞保</th>
              <th style={{ color: 'var(--accent-orange)' }}>健保</th>
              <th style={{ color: 'var(--accent-orange)' }}>勞退自提</th>
              <th style={{ color: 'var(--accent-red)' }}>所得稅</th>
              <th style={{ fontWeight: 800 }}>實領薪資</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={14} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>本月尚無薪資紀錄</td></tr>
            )}
            {filtered.map(r => {
              const isExpanded = expanded === r.id
              const bonusDetail = isExpanded ? getBonusDetail(r.employee) : []
              const detail = detailMap[r.id]   // object | null | undefined
              const items = isExpanded ? (detail ? buildFullItems(detail) : buildFallbackItems(r, brackets)) : []
              const shownNet = detail ? n(detail.netSalary) : n(r.net_salary)
              const savedNet = n(r.net_salary)
              return (
                <Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : r.id)}>
                    <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>{r.employee}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(r.employee) || '-'}</td>
                    <td>{fmt(r.base_salary)}</td>
                    <td style={{ color: 'var(--accent-cyan)' }}>{r.overtime ? `+${(r.overtime).toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-green)' }}>{r.allowance ? `+${(r.allowance).toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-purple)' }}>{r.bonus ? `+${(r.bonus).toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-green)', fontSize: 12 }}>{r.unused_leave_payout ? `+${(r.unused_leave_payout).toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-orange)', fontSize: 12 }}>-{(r.labor_insurance || 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)', fontSize: 12 }}>-{(r.health_insurance || 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)', fontSize: 12 }}>{r.pension_self ? `-${r.pension_self.toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-red)', fontSize: 12 }}>{r.income_tax ? `-${r.income_tax.toLocaleString()}` : '-'}</td>
                    <td style={{ fontWeight: 800, color: 'var(--accent-green)', fontSize: 15 }}>{fmt(r.net_salary)}</td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={e => { e.stopPropagation(); openEdit(r) }}>編輯</button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={14} style={{ padding: 0 }}>
                        <div style={{ background: 'var(--glass-light)', padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                            {/* Payroll breakdown */}
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
                                📐 薪資計算明細{detail ? '（系統計算過程）' : ''}
                              </div>
                              {loadingId === r.id && detail === undefined ? (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 16 }}>計算中…</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {!detail && (
                                    <div style={{ fontSize: 10, color: 'var(--accent-orange)', marginBottom: 2 }}>
                                      ⚠ 無法取得系統計算過程，以下為存檔彙總值
                                    </div>
                                  )}
                                  {items.map((item, i) => {
                                    if (item.section === 'divider') {
                                      return <div key={i} style={{ borderTop: '1px dashed var(--border-medium)', margin: '4px 0' }} />
                                    }
                                    if (item.section === 'total' || item.section === 'subtotal') {
                                      const isTotal = item.section === 'total'
                                      return (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8,
                                          background: isTotal ? 'var(--accent-cyan-dim)' : 'var(--accent-orange-dim)',
                                          border: `1px solid ${isTotal ? 'var(--accent-cyan)' : 'var(--accent-orange)'}`, fontSize: 13 }}>
                                          <span style={{ fontWeight: 700 }}>{item.sign} {item.label}</span>
                                          <span style={{ color: item.color, fontWeight: 800 }}>{fmt(item.value)}</span>
                                        </div>
                                      )
                                    }
                                    return (
                                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: 7, background: 'var(--bg-card)', fontSize: 13 }}>
                                        <div>
                                          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                                          {item.note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.note}</div>}
                                        </div>
                                        <span style={{ color: item.value === 0 ? 'var(--text-muted)' : item.color, fontWeight: 600 }}>
                                          {item.value === 0 ? '—' : `${item.sign} ${fmt(item.value)}`}
                                        </span>
                                      </div>
                                    )
                                  })}
                                  {/* Net salary */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 14, marginTop: 6 }}>
                                    <span style={{ fontWeight: 700 }}>= 實領薪資</span>
                                    <span style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(shownNet)}</span>
                                  </div>
                                  {detail && Math.abs(shownNet - savedNet) > 1 && (
                                    <div style={{ fontSize: 10, color: 'var(--accent-orange)', textAlign: 'right' }}>
                                      ⚠ 存檔實領為 {fmt(savedNet)}（可能經手動調整，以存檔為準）
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Right column: bonus / legal / employer cost */}
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>🏆 獎金明細</div>
                              {bonusDetail.length === 0 ? (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 16, background: 'var(--bg-card)', borderRadius: 8, textAlign: 'center' }}>
                                  本月尚無獎金紀錄<br />
                                  <span style={{ fontSize: 11 }}>可至「績效獎金」頁面新增</span>
                                </div>
                              ) : bonusDetail.map(b => (
                                <div key={b.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700 }}>{b.role_type} 獎金</span>
                                    <span style={{ color: 'var(--accent-purple)', fontWeight: 800 }}>{fmt(b.total_bonus)}</span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                                      <span>基本績效獎</span><span>{fmt(b.base_bonus)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                                      <span>數據達標獎</span><span>{fmt(b.data_bonus)}</span>
                                    </div>
                                  </div>
                                  {b.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, padding: '4px 8px', background: 'var(--glass-light)', borderRadius: 6 }}>說明：{b.notes}</div>}
                                </div>
                              ))}

                              {/* 加班逐筆明細（合併 legal+exception，逐日逐筆） */}
                              {detail && [...(detail._ot_rows || []), ...(detail._ot_exception_rows || [])].length > 0 && (
                                <div style={{ marginTop: 16 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🕐 加班逐筆明細</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {[...(detail._ot_rows || []), ...(detail._ot_exception_rows || [])]
                                      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                                      .map((ot, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', borderRadius: 7, background: 'var(--bg-card)', fontSize: 12 }}>
                                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>{ot.date}</span>
                                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--glass-light)', color: 'var(--text-muted)' }}>{OT_CAT_LABEL[ot.category] || ot.category}</span>
                                            <span style={{ color: 'var(--text-muted)' }}>{n(ot.hours)} 小時</span>
                                            {ot._rate_label && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{ot._rate_label}</span>}
                                          </div>
                                          <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(n(ot._pay))}</span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                              {/* Legal reference */}
                              <div style={{ marginTop: 16 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>📖 法規依據</div>
                                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {[
                                    { law: '勞基法 §24', desc: '加班費計算：前2h加給1/3，後2h加給2/3' },
                                    { law: '勞基法 §38-4', desc: '特休未休應折算工資（日薪 × 未休天數）' },
                                    { law: '勞保條例 §15', desc: '勞保費分攤：勞工20%、雇主70%、政府10%' },
                                    { law: '健保法 §27', desc: '健保費分攤：被保險人30%、雇主60%、政府10%' },
                                    { law: '勞退條例 §14', desc: '雇主提繳6%，勞工可自提0~6%（免稅）' },
                                    { law: '所得稅法 §88', desc: '薪資所得扣繳，依扣繳率標準表計算' },
                                    { law: '2026 基本工資', desc: '月薪 NT$29,500 / 時薪 NT$196' },
                                  ].map((item, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 8 }}>
                                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, whiteSpace: 'nowrap' }}>{item.law}</span>
                                      <span>{item.desc}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Employer cost summary（優先用系統計算） */}
                              <div style={{ marginTop: 16 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🏢 雇主成本（參考）</div>
                                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {(() => {
                                    const laborEr = detail ? n(detail.laborEmployer) : calculateLaborInsurance(r.base_salary || 0, { brackets: brackets?.labor }).employer_share
                                    const healthEr = detail ? n(detail.healthEmployer) : calculateHealthInsurance(r.base_salary || 0, { dependents: r.health_ins_dependents || 0, brackets: brackets?.health }).employer_share
                                    const pensionEr = detail ? n(detail.pensionEmployer) : calculateLaborPension(r.base_salary || 0).employer_contribution
                                    return (
                                      <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ color: 'var(--text-muted)' }}>勞保雇主負擔</span><span>{fmt(laborEr)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ color: 'var(--text-muted)' }}>健保雇主負擔</span><span>{fmt(healthEr)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ color: 'var(--text-muted)' }}>勞退 6% 提繳</span><span>{fmt(pensionEr)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 4, marginTop: 2 }}>
                                          <span style={{ fontWeight: 600 }}>雇主額外成本</span>
                                          <span style={{ fontWeight: 700, color: 'var(--accent-red)' }}>{fmt(laborEr + healthEr + pensionEr)}</span>
                                        </div>
                                      </>
                                    )
                                  })()}
                                </div>
                              </div>
                            </div>

                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
