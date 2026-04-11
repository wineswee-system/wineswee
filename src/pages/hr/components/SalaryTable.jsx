import { ChevronDown, ChevronRight } from 'lucide-react'
import { calculateLaborInsurance, calculateHealthInsurance, calculateLaborPension } from '../../../lib/payroll'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

// ── Deduction breakdown row items ──
function buildBreakdownItems(r) {
  const base = r.base_salary || 0
  const laborDetail = calculateLaborInsurance(base)
  const healthDetail = calculateHealthInsurance(base, r.dependents || 0)
  const pensionDetail = calculateLaborPension(base, (r.voluntary_pension_rate || 0) / 100)
  const dailyRate = Math.round(base / 30)
  const hourlyRate = Math.round(dailyRate / 8)

  return [
    { label: '底薪', value: base, color: 'var(--text-primary)', sign: '', section: 'add' },
    { label: '加班費', value: r.overtime || 0, color: 'var(--accent-cyan)', sign: '+', section: 'add',
      note: r.overtime ? `時薪 ${hourlyRate} = 月薪 ${base.toLocaleString()} ÷ 30 ÷ 8（勞基法 §24）` : null },
    { label: '津貼', value: r.allowance || 0, color: 'var(--accent-green)', sign: '+', section: 'add' },
    { label: '獎金', value: r.bonus || 0, color: 'var(--accent-purple)', sign: '+', section: 'add' },
    { label: null, section: 'divider-gross' },
    { label: '總薪資', value: base + (r.overtime || 0) + (r.allowance || 0) + (r.bonus || 0), color: 'var(--accent-cyan)', sign: '=', section: 'total', bold: true },
    { label: null, section: 'divider-deduct' },
    { label: '勞保自付額', value: r.labor_insurance || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
      note: `投保級距 ${laborDetail.insured_salary.toLocaleString()} × 12% × 20% = ${laborDetail.employee_share.toLocaleString()}（勞保條例 §15）` },
    { label: '健保自付額', value: r.health_insurance || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
      note: `投保級距 ${healthDetail.insured_salary.toLocaleString()} × 5.17% × 30%${r.dependents ? ` × ${1 + Math.min(r.dependents, 3)}口` : ''} = ${healthDetail.employee_share.toLocaleString()}（健保法 §27）` },
    { label: '勞退自提', value: r.pension_self || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
      note: r.voluntary_pension_rate ? `提繳工資 ${Math.min(base, 150000).toLocaleString()} × ${r.voluntary_pension_rate}% = ${pensionDetail.employee_voluntary.toLocaleString()}（勞退條例 §14）` : '未自提（可自提 0~6% 節稅，勞退條例 §14）' },
    { label: '所得稅扣繳', value: r.income_tax || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct',
      note: '依各類所得扣繳率標準（所得稅法 §88）' },
    { label: '事假扣薪', value: r.absence_deduction || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct',
      note: r.absence_deduction ? `日薪 ${dailyRate.toLocaleString()} = 月薪 ÷ 30（勞工請假規則 §7，不給薪）` : null },
    { label: '遲到扣薪', value: r.late_deduction || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct' },
    { label: `其他扣款${r.deduction_note ? `（${r.deduction_note}）` : ''}`, value: r.other_deduction || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct' },
  ]
}

export default function SalaryTable({ filtered, expanded, setExpanded, getEmpDept, getBonusDetail, openEdit }) {
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
              <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>本月尚無薪資紀錄</td></tr>
            )}
            {filtered.map(r => {
              const bonusDetail = getBonusDetail(r.employee)
              const isExpanded = expanded === r.id
              const breakdownItems = buildBreakdownItems(r)
              return (
                <tbody key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : r.id)}>
                    <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>{r.employee}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(r.employee) || '-'}</td>
                    <td>{fmt(r.base_salary)}</td>
                    <td style={{ color: 'var(--accent-cyan)' }}>{r.overtime ? `+${(r.overtime).toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-green)' }}>{r.allowance ? `+${(r.allowance).toLocaleString()}` : '-'}</td>
                    <td style={{ color: 'var(--accent-purple)' }}>{r.bonus ? `+${(r.bonus).toLocaleString()}` : '-'}</td>
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
                      <td colSpan={13} style={{ padding: 0 }}>
                        <div style={{ background: 'var(--glass-light)', padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                            {/* Payroll breakdown */}
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📐 薪資計算明細</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                {breakdownItems.map((item, i) => {
                                  if (item.section === 'divider-gross' || item.section === 'divider-deduct') {
                                    return <div key={i} style={{ borderTop: '1px dashed var(--border-medium)', margin: '4px 0' }} />
                                  }
                                  if (item.section === 'total') {
                                    return (
                                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan)', fontSize: 13 }}>
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
                                        {item.value === 0 ? '—' : `${item.sign} ${fmt(item.value).replace('NT$ ', 'NT$ ')}`}
                                      </span>
                                    </div>
                                  )
                                })}
                                {/* Net salary */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 14, marginTop: 6 }}>
                                  <span style={{ fontWeight: 700 }}>= 實領薪資</span>
                                  <span style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(r.net_salary)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Bonus detail */}
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

                              {/* Employer cost summary */}
                              <div style={{ marginTop: 16 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🏢 雇主成本（參考）</div>
                                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {(() => {
                                    const laborEr = calculateLaborInsurance(r.base_salary || 0).employer_share
                                    const healthEr = calculateHealthInsurance(r.base_salary || 0, r.dependents || 0).employer_share
                                    const pensionEr = calculateLaborPension(r.base_salary || 0).employer_contribution
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
                </tbody>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
