import { memo } from 'react'

import { fmtNT as fmt } from '../../../lib/currency'

const DetailRow = memo(function DetailRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
})

// 二代健保補充保費（now stored in DB, fallback to legacy calc if not set）
function suppNhi(rec) {
  if (rec.nhi_supplementary != null) return rec.nhi_supplementary
  const bonus = (rec.bonus_total || 0)
  return Math.round(Math.max(0, bonus - 2000) * 0.0211)
}

// Props: record, employee, selectedRun, printPayslip
// Called as a <tr> replacement — must be used inside a <tbody>
export default function PayslipRow({ record: rec, employee: emp, selectedRun, printPayslip }) {
  return (
    <tr style={{ background: 'var(--bg-tertiary)' }}>
      <td colSpan={6} style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {/* Income */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-green)' }}>收入項目</div>
            <DetailRow label="本薪" value={fmt(rec.base_salary)} />
            {rec.base_insured > 0 && rec.base_insured !== rec.base_salary && (
              <DetailRow label="└ 申報底薪" value={fmt(rec.base_insured)} />
            )}
            {rec.supervisor_allowance > 0 && <DetailRow label="主管加給" value={fmt(rec.supervisor_allowance)} />}
            <DetailRow label="職務津貼" value={fmt(rec.role_allowance)} />
            {rec.night_shift_allowance > 0 && <DetailRow label="夜班津貼" value={fmt(rec.night_shift_allowance)} />}
            {rec.cross_store_allowance > 0 && <DetailRow label="跨區津貼" value={fmt(rec.cross_store_allowance)} />}
            <DetailRow label="伙食津貼" value={fmt(rec.meal_allowance)} />
            <DetailRow label="交通津貼" value={fmt(rec.transport_allowance)} />
            <DetailRow label="全勤獎金" value={fmt(rec.attendance_bonus_earned)} />
            <DetailRow label="加班費" value={fmt(rec.overtime_pay)} />
            {(rec.overtime_pay_weekday > 0 || rec.overtime_pay_restday > 0 || rec.overtime_pay_holiday > 0 || rec.overtime_pay_national > 0) && (
              <>
                {rec.overtime_pay_weekday > 0 && <DetailRow label="└ 平日加班" value={fmt(rec.overtime_pay_weekday)} />}
                {rec.overtime_pay_restday > 0 && <DetailRow label="└ 休息日加班" value={fmt(rec.overtime_pay_restday)} />}
                {rec.overtime_pay_holiday > 0 && <DetailRow label="└ 例假加班" value={fmt(rec.overtime_pay_holiday)} />}
                {rec.overtime_pay_national > 0 && <DetailRow label="└ 國定加班" value={fmt(rec.overtime_pay_national)} />}
              </>
            )}
            {rec.rest_day_unused_pay > 0 && <DetailRow label="休息未休補償" value={fmt(rec.rest_day_unused_pay)} />}
            {rec.back_pay_adjustment > 0 && <DetailRow label="補發前期差額" value={fmt(rec.back_pay_adjustment)} />}
            {rec.performance_bonus > 0 && <DetailRow label="績效獎金" value={fmt(rec.performance_bonus)} />}
            {rec.commission > 0 && <DetailRow label="業績/差額" value={fmt(rec.commission)} />}
            {rec.festival_bonus > 0 && <DetailRow label="三節獎金" value={fmt(rec.festival_bonus)} />}
            {rec.other_bonus > 0 && <DetailRow label="其他獎金" value={fmt(rec.other_bonus)} />}
            {rec.year_end_bonus > 0 && <DetailRow label="年終獎金" value={fmt(rec.year_end_bonus)} />}
            {rec.unused_leave_payout > 0 && <DetailRow label={`未休特休折現（${rec.unused_leave_days || 0} 天）`} value={fmt(rec.unused_leave_payout)} />}
            {Array.isArray(rec.custom_allowances_breakdown) && rec.custom_allowances_breakdown.length > 0 && (
              <>
                {rec.custom_allowances_breakdown.map((c, i) => (
                  <DetailRow key={i} label={`└ ${c.name}`} value={fmt(c.amount)} />
                ))}
                <DetailRow label="自訂津貼合計" value={fmt(rec.custom_allowances_total)} bold />
              </>
            )}
            <DetailRow label="應發合計" value={fmt(rec.gross_salary)} bold />
          </div>
          {/* Deductions */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-red)' }}>扣除項目</div>
            {rec.paid_leave_deduction > 0 && <DetailRow label="請假扣款（有薪）" value={fmt(rec.paid_leave_deduction)} />}
            {rec.unpaid_leave_deduction > 0 && <DetailRow label="請假扣款（無薪）" value={fmt(rec.unpaid_leave_deduction)} />}
            {(rec.leave_deduction > 0 && !rec.paid_leave_deduction && !rec.unpaid_leave_deduction) && (
              <DetailRow label="請假扣款" value={fmt(rec.leave_deduction)} />
            )}
            {rec.late_deduction > 0 && <DetailRow label="遲到扣款" value={fmt(rec.late_deduction)} />}
            {rec.advance_recovery > 0 && <DetailRow label="預支扣回" value={fmt(rec.advance_recovery)} />}
            <DetailRow label="勞保（個人）" value={fmt(rec.labor_ins_employee)} />
            <DetailRow label="健保（個人）" value={fmt(rec.health_ins_employee)} />
            <DetailRow label="勞退（個人）" value={fmt(rec.labor_pension_employee)} />
            <DetailRow label="代扣所得稅" value={fmt(rec.income_tax_withheld)} />
            {suppNhi(rec) > 0 && (
              <DetailRow label="二代健保補充保費 (2.11%)" value={fmt(suppNhi(rec))} />
            )}
            {Array.isArray(rec.nhi_supplementary_breakdown) && rec.nhi_supplementary_breakdown.length > 0 && (
              rec.nhi_supplementary_breakdown.map((n, i) => (
                <DetailRow key={`nhi-${i}`} label={`└ ${n.category}`} value={fmt(n.premium)} />
              ))
            )}
            {Array.isArray(rec.legal_deduction_breakdown) && rec.legal_deduction_breakdown.length > 0 && (
              <>
                {rec.legal_deduction_breakdown.map((d, i) => (
                  <DetailRow
                    key={i}
                    label={`└ ${d.title}${d.shortfall > 0 ? ' ⚠️' : ''}`}
                    value={fmt(d.amount)}
                  />
                ))}
                <DetailRow label="法扣合計" value={fmt(rec.legal_deduction_total)} bold />
              </>
            )}
            <DetailRow label="扣除合計" value={fmt(rec.total_deductions)} bold />
            {Array.isArray(rec.legal_deduction_breakdown) &&
              rec.legal_deduction_breakdown.some(d => d.shortfall > 0) && (
              <div style={{
                marginTop: 6, fontSize: 11, color: 'var(--accent-orange)',
                padding: '4px 8px', background: 'rgba(251,146,60,0.08)',
                borderRadius: 6,
              }}>
                ⚠️ 部分法扣金額不足當月扣完，已自動延後到下月
              </div>
            )}
          </div>
          {/* Summary */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-cyan)' }}>其他資訊</div>
            <DetailRow label="實際工時" value={rec.hours_worked != null ? `${rec.hours_worked} 小時` : '-'} />
            <DetailRow label="實發薪資" value={fmt(rec.net_salary)} bold />
            <DetailRow label="薪資單發送" value={rec.payslip_sent_at ? new Date(rec.payslip_sent_at).toLocaleString('zh-TW') : '尚未發送'} />
            <button
              onClick={() => printPayslip(rec, emp, selectedRun)}
              style={{
                marginTop: 12, padding: '8px 16px', borderRadius: 8,
                background: 'var(--accent-cyan)', color: '#fff',
                border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >🧾 列印薪資條</button>
          </div>
          {/* 公司負擔 */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-purple)' }}>公司負擔</div>
            <DetailRow label="勞保（公司）" value={fmt(rec.labor_ins_employer)} />
            <DetailRow label="健保（公司）" value={fmt(rec.health_ins_employer)} />
            <DetailRow label="勞退提撥（6%）" value={fmt(rec.labor_pension_employer)} />
            {rec.occupational_injury_employer > 0 && (
              <DetailRow label="職災保險" value={fmt(rec.occupational_injury_employer)} />
            )}
            {rec.nhi_supplementary_employer > 0 && (
              <DetailRow label="二代健保補充（公司）" value={fmt(rec.nhi_supplementary_employer)} />
            )}
            {rec.employer_total_cost > 0 && (
              <DetailRow label="公司總成本" value={fmt(rec.employer_total_cost)} bold />
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}
