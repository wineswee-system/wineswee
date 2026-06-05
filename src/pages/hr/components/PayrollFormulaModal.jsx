import { createPortal } from 'react-dom'
import { X, FunctionSquare } from 'lucide-react'
import { fmtNT as fmt } from '../../../lib/currency'

// 每項顯示一張小卡片：標籤 / 數值 / 公式 / 變數明細
function FormulaRow({ label, value, formula, vars, color, sub, hint }) {
  const isNeg = value < 0
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)' }}>{label}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: color || (isNeg ? 'var(--accent-orange)' : 'var(--text-primary)'), whiteSpace: 'nowrap' }}>
          {isNeg ? '−' : ''}{fmt(Math.abs(value || 0))}
        </div>
      </div>
      {formula && (
        <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-secondary)', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
          {formula}
        </div>
      )}
      {vars && vars.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
          {vars.map((v, i) => (
            <span key={i} style={{
              padding: '2px 8px', borderRadius: 4,
              background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
              fontFamily: 'ui-monospace, monospace',
            }}>
              {v.k} = {typeof v.v === 'number' ? (Number.isInteger(v.v) ? v.v.toLocaleString() : v.v.toFixed(2)) : v.v}
            </span>
          ))}
        </div>
      )}
      {hint && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>※ {hint}</div>
      )}
    </div>
  )
}

function Section({ title, color, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: color || 'var(--text-primary)',
        marginBottom: 8, paddingBottom: 4, borderBottom: `2px solid ${color || 'var(--border-medium)'}`,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export default function PayrollFormulaModal({ payroll, month, onClose }) {
  if (!payroll) return null
  const p = payroll
  const isHourly = p._is_hourly
  const hr = p._hourly_rate || 0
  const _p = p.salary_prorate_ratio ?? 1
  const isProrated = _p < 0.9999

  // 加項數值
  const allowancesSum = (p.role_allowance||0) + (p.meal_allowance||0) + (p.transport_allowance||0)
    + (p.night_allowance||0) + (p.cross_store_allowance||0) + (p.other_custom_total||0) + (p.attendance_bonus||0)
  const otSum = (p.regular_overtime_pay||0) + (p.extra_overtime_pay||0)
  const grossCheck = (p.base_salary||0) + allowancesSum + otSum + (p.policyBonus||0)

  // 扣項數值
  const leaveDeduction = (p.unpaidDeduction||0) + (p.halfPayDeduction||0)
  const totalDedCheck = (p.laborInsurance||0) + (p.healthInsurance||0) + (p.pension||0)
    + leaveDeduction + (p.lateDeduction||0) + (p.legal_deduction||0)

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 20px 20px',
      overflow: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', borderRadius: 16,
        border: '1px solid var(--border-medium)', boxShadow: 'var(--shadow-xl)',
        width: '100%', maxWidth: 800,
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <FunctionSquare size={16} /> 薪資計算公式 — {p.employee}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {month} · {p.position || '-'} · {p.dept || '-'} · {isHourly ? '時薪制' : '月薪制'}
              {isProrated && (
                <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 4, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}>
                  在職比例 {(_p * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', maxHeight: '80vh', overflowY: 'auto' }}>

          {/* ── 加項 ── */}
          <Section title="① 加項" color="var(--accent-cyan)">
            <FormulaRow
              label="本薪"
              value={p.base_salary}
              formula={isHourly
                ? `hourly_rate × 當月工時${isProrated ? '（已含比例）' : ''}`
                : `salary_structures.base_salary${isProrated ? ` × 工作日比例` : ''}`}
              vars={isHourly
                ? [{ k: 'hourly_rate', v: hr }, { k: 'work_hours', v: p.workHours }]
                : isProrated
                  ? [{ k: 'base', v: Math.round(p.base_salary / _p) }, { k: '比例', v: `${p.salary_actual_wd}/${p.salary_total_wd}` }]
                  : [{ k: 'base', v: p.base_salary }]
              }
            />

            {(p.role_allowance > 0 || p._raw_role_allowance > 0 || p._supervisor_allowance > 0) && (
              <FormulaRow
                label="主管/職務津貼"
                value={p.role_allowance}
                formula="supervisor_allowance + role_allowance"
                vars={[
                  { k: 'supervisor', v: p._supervisor_allowance },
                  { k: 'role', v: p._raw_role_allowance },
                  ...(isProrated ? [{ k: '比例', v: _p }] : []),
                ]}
                hint="2026-05-13 後新資料用 supervisor_allowance；舊資料 role_allowance > 0 仍會吃（永春 setup script）"
              />
            )}

            {p.meal_allowance > 0 && (
              <FormulaRow label="伙食津貼" value={p.meal_allowance}
                formula={`meal_allowance${isProrated ? ' × 比例' : ''}`} />
            )}
            {p.transport_allowance > 0 && (
              <FormulaRow label="交通津貼" value={p.transport_allowance}
                formula={`transport_allowance${isProrated ? ' × 比例' : ''}`} />
            )}
            {p.night_allowance > 0 && (
              <FormulaRow label="夜間津貼" value={p.night_allowance}
                formula={`night_shift_allowance${isProrated ? ' × 比例' : ''}`} />
            )}
            {p.cross_store_allowance > 0 && (
              <FormulaRow label="跨店津貼" value={p.cross_store_allowance}
                formula={`cross_store_allowance${isProrated ? ' × 比例' : ''}`} />
            )}
            {p.other_custom_total > 0 && (
              <FormulaRow label="其他自訂津貼" value={p.other_custom_total}
                formula="SUM(custom_allowances) 排除已歸類的夜班/跨區" />
            )}
            <FormulaRow
              label="全勤獎金"
              value={p.attendance_bonus}
              formula="lateMins=0 AND absenceDays=0 ? attendance_bonus_base : 0"
              vars={[
                { k: 'late_mins', v: p.lateMins },
                { k: 'absence_days', v: p.absenceDays },
              ]}
              hint={p.attendance_bonus === 0 && (p.lateMins > 0 || p.absenceDays > 0)
                ? '有遲到或無薪缺勤 → 不發' : null}
            />

            {p.regular_overtime_pay > 0 && (
              <FormulaRow
                label="加班費（平日+休息日）"
                value={p.regular_overtime_pay}
                formula="平日: ≤2h ×1.34；>2h: 2×hr×1.34 + (剩)×hr×1.67｜休息日: ≤2h ×1.34；3-8h ×1.67；9-12h ×2.67"
                vars={[
                  { k: 'ot_weekday', v: p.otWeekday },
                  { k: 'ot_restday', v: p.otRestday },
                  { k: 'hr', v: hr },
                  { k: '平日OT$', v: p.otPayWeekday },
                  { k: '休息日OT$', v: p.otPayRestday },
                ]}
              />
            )}
            {p.extra_overtime_pay > 0 && (
              <FormulaRow
                label="額外加班（國定/例假 + 國定打卡加給）"
                value={p.extra_overtime_pay}
                formula="國定/例假加班: ot_hours × hr × 2｜時薪制國定打卡: holiday_hours × hr × 1（再加 1 倍）"
                vars={[
                  { k: 'ot_holiday', v: p.otHoliday },
                  { k: 'holiday_hours', v: p.holidayHours || 0 },
                  { k: '國定/例假OT$', v: p.otPayHoliday },
                  { k: '國定打卡加給', v: p.holidayBonus || 0 },
                ]}
                hint={isHourly ? '時薪制：國定打卡 baseSalary 已含 1 倍，這裡再加 1 倍 → 合計 ×2' : '月薪制：固定值已含整月工資，國定打卡不另外加給'}
              />
            )}
            {p.policyBonus > 0 && (
              <FormulaRow label="政策獎金" value={p.policyBonus}
                formula="SUM(getEffectiveBenefits('bonus')) — 業績/出勤等規則"
                hint="目前 sales=0, attendance_rate=1 是 stub" />
            )}

            <FormulaRow
              label="應領合計"
              value={p.gross}
              color="var(--accent-green)"
              formula="本薪 + 所有津貼 + 加班費 + 政策獎金"
              vars={[
                { k: '本薪', v: p.base_salary },
                { k: '津貼小計', v: allowancesSum },
                { k: '加班費', v: otSum },
                { k: '獎金', v: p.policyBonus || 0 },
                { k: '加總', v: grossCheck },
              ]}
            />
          </Section>

          {/* ── 扣項 ── */}
          <Section title="② 扣項" color="var(--accent-orange)">
            <FormulaRow
              label="投保金額"
              value={p.insuredLabor === p.insuredHealth ? p.insuredLabor : 0}
              formula="salary_structures.base_insured (若有) 否則 = base + 所有經常性津貼"
              vars={p.insuredLabor === p.insuredHealth
                ? [{ k: 'insured', v: p.insuredLabor }]
                : [{ k: '勞保上限', v: p.insuredLabor }, { k: '健保上限', v: p.insuredHealth }]
              }
              hint={p.insuredLabor !== p.insuredHealth ? '高薪：勞保上限 45,800 / 健保上限 313,000，故兩者不同' : null}
            />
            <FormulaRow
              label="勞保（員工自付）"
              value={-p.laborInsurance}
              formula="級距表 lookup × 員工分擔比例 (20%)"
              hint={isProrated ? `在職曆日比例 ${p.in_service_days}/${p.month_days} 已套用` : null}
            />
            <FormulaRow
              label="健保（員工自付）"
              value={-p.healthInsurance}
              formula="級距表 lookup × 員工分擔比例 (30%) × (1 + 眷屬數)"
              vars={[{ k: '眷屬', v: p.health_ins_dependents }]}
              hint="健保不打在職比例（月初有保就全月）"
            />
            {p.pension > 0 && (
              <FormulaRow
                label="勞退（員工自提）"
                value={-p.pension}
                formula="投保金額 × voluntary_pension_rate%"
                vars={[{ k: 'rate%', v: p.pension_self_pct }]}
                hint={isProrated ? '已套在職比例' : null}
              />
            )}
            {leaveDeduction > 0 && (
              <FormulaRow
                label="請假扣款"
                value={-leaveDeduction}
                formula="無薪假: hours × hr × 1.0｜半薪假(病/生理): hours × hr × 0.5"
                vars={[
                  { k: 'unpaid_h', v: p.unpaidHours },
                  { k: 'halfPay_h', v: p.halfPayHours },
                  { k: 'hr', v: hr },
                  { k: 'unpaid扣', v: p.unpaidDeduction },
                  { k: 'halfPay扣', v: p.halfPayDeduction },
                ]}
                hint={isHourly ? '時薪制 PT 請假不扣（沒上班→沒工時→自然不算薪）' : null}
              />
            )}
            {p.lateDeduction > 0 && (
              <FormulaRow
                label="遲到扣款"
                value={-p.lateDeduction}
                formula="FLOOR(lateMins / 30) × hr × 0.5"
                vars={[{ k: 'late_mins', v: p.lateMins }, { k: 'hr', v: hr }]}
                hint="每滿 30 分鐘扣半小時薪"
              />
            )}
            {p.legal_deduction > 0 && (
              <FormulaRow
                label="法扣（民事執行/養育費/債務）"
                value={-p.legal_deduction}
                formula="SUM(legal_deductions WHERE status=進行中 AND started_month ≤ 當月)"
                hint="目前只算 fixed amount；percent 型待加"
              />
            )}

            <FormulaRow
              label="減項合計"
              value={-p.totalDeductions}
              color="var(--accent-red)"
              formula="勞保 + 健保 + 勞退自提 + 請假扣 + 遲到扣 + 法扣"
              vars={[{ k: '加總驗算', v: totalDedCheck }]}
            />
          </Section>

          {/* ── 實領 ── */}
          <Section title="③ 實領" color="var(--accent-green)">
            <FormulaRow
              label="實領"
              value={p.netSalary}
              color="var(--accent-green)"
              formula="應領合計 − 減項合計"
              vars={[
                { k: '應領', v: p.gross },
                { k: '減項', v: p.totalDeductions },
              ]}
              hint="所得稅依集團政策不代扣（員工自行申報）"
            />
          </Section>

          {/* ── 雇主負擔 ── */}
          <Section title="④ 雇主負擔（成本參考，不影響員工實領）" color="var(--text-muted)">
            <FormulaRow label="勞保（公司）" value={p.laborEmployer}
              formula="級距 × 70%" />
            <FormulaRow label="健保（公司）" value={p.healthEmployer}
              formula="級距 × 60%（公司分擔比例）" />
            <FormulaRow label="勞退（公司）" value={p.pensionEmployer}
              formula="投保金額 × 6%（強制提撥）" />
            <FormulaRow
              label="總人事成本"
              value={(p.laborEmployer || 0) + (p.healthEmployer || 0) + (p.pensionEmployer || 0) + p.gross}
              color="var(--text-secondary)"
              formula="應領合計 + 勞保(公司) + 健保(公司) + 勞退(公司)"
            />
          </Section>
        </div>
      </div>
    </div>,
    document.body
  )
}
