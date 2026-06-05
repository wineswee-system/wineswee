import { createPortal } from 'react-dom'
import { X, FunctionSquare } from 'lucide-react'
import { fmtNT as fmt } from '../../../lib/currency'

const CATEGORY_LABEL = {
  weekday: '平日',
  restday: '休息日',
  holiday: '國定/例假',
}

const CATEGORY_COLOR = {
  weekday: 'var(--accent-cyan)',
  restday: 'var(--accent-orange)',
  holiday: 'var(--accent-red)',
}

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
        <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
          {formula}
        </div>
      )}
      {vars && vars.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
          {vars.map((v, i) => (
            <span key={i} style={{
              padding: '2px 8px', borderRadius: 4,
              background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
            }}>
              {v.k}：{typeof v.v === 'number' ? (Number.isInteger(v.v) ? v.v.toLocaleString() : v.v.toFixed(2)) : v.v}
            </span>
          ))}
        </div>
      )}
      {hint && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>※ {hint}</div>
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

// 加班明細小表
function OvertimeDetailTable({ rows, hourlyRate }) {
  if (!rows || rows.length === 0) return (
    <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>本月無加班申請</div>
  )
  // 單筆獨立用三桶算（假設這筆是該分類的全部 ot 時數）
  // 跟上面「加班費」欄的合算結果可能略有差異（因為合算是按該分類「全月累計總時數」分段）
  const calcRowPay = (hours, cat) => {
    if (cat === 'holiday') return Math.round(hours * hourlyRate * 2)
    if (cat === 'restday') {
      const rd1 = Math.min(hours, 2)
      const rd2 = Math.min(Math.max(hours - 2, 0), 6)
      const rd3 = Math.max(hours - 8, 0)
      return Math.round(rd1 * hourlyRate * 1.34 + rd2 * hourlyRate * 1.67 + rd3 * hourlyRate * 2.67)
    }
    // weekday
    return hours <= 2
      ? Math.round(hours * hourlyRate * 1.34)
      : Math.round(2 * hourlyRate * 1.34 + (hours - 2) * hourlyRate * 1.67)
  }
  const rateLabelFor = (hours, cat) => {
    if (cat === 'holiday') return '×2.0'
    if (cat === 'restday') return hours <= 2 ? '×1.34' : hours <= 8 ? '×1.34 / ×1.67' : '×1.34 / ×1.67 / ×2.67'
    return hours <= 2 ? '×1.34' : '×1.34 / ×1.67'
  }

  const sorted = [...rows].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', borderRadius: 6, marginBottom: 6 }}>
        <span>單筆金額 = 該筆時數獨立套三桶階梯（時薪 <strong style={{ color: 'var(--accent-cyan)' }}>NT$ {hourlyRate.toLocaleString()}</strong>）</span>
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>日期</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>類別</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>時數</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>適用倍率</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>本筆金額</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const cat = r.category || 'weekday'
            const amount = calcRowPay(r.hours, cat)
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '5px 8px' }}>{r.date}</td>
                <td style={{ padding: '5px 8px' }}>
                  <span style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-card)', color: CATEGORY_COLOR[cat], fontSize: 11 }}>
                    {CATEGORY_LABEL[cat]}
                  </span>
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{r.hours} 小時</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{rateLabelFor(r.hours, cat)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(amount)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 6, padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        ※ 上面「加班費」欄是「同分類全月加總後」才套三桶算，跟這裡的逐筆獨立加總可能略有差異（差異來自階梯交界的時數歸屬）。
      </div>
    </div>
  )
}

// 遲到明細小表
function LateDetailTable({ rows, hourlyRate, lateDeduction }) {
  if (!rows || rows.length === 0) return (
    <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>本月無遲到紀錄</div>
  )
  const sorted = [...rows].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const totalMins = sorted.reduce((s, r) => s + (r.late_minutes || 0), 0)
  const totalUnits = Math.floor(totalMins / 30)
  // 取一筆做容差顯示（同員工同月通常都在同一門市，容差相同）
  const tolerance = sorted[0]?.tolerance
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>日期</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>遲到分鐘</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>滿 30 分單位數</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '5px 8px' }}>{r.date}</td>
              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--accent-orange)' }}>{r.late_minutes} 分</td>
              <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{Math.floor(r.late_minutes / 30)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border-medium)', fontWeight: 700, background: 'var(--bg-secondary)' }}>
            <td style={{ padding: '6px 8px' }}>合計</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--accent-orange)' }}>{totalMins} 分</td>
            <td style={{ padding: '6px 8px', textAlign: 'right' }}>{totalUnits} 單位</td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 6, padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        {tolerance != null && <>※ 門市容差：≤ {tolerance} 分鐘的遲到忽略不計，本表只列超過者。<br/></>}
        ※ 扣款公式：合計分鐘 ÷ 30（無條件捨去）× 時薪 × 0.5
        ＝ {totalUnits} × {hourlyRate} × 0.5 ＝ {fmt(lateDeduction || 0)}
      </div>
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
  const otRows = p._ot_rows || []
  const lateRows = p._late_rows || []

  const allowancesSum = (p.role_allowance||0) + (p.meal_allowance||0) + (p.transport_allowance||0)
    + (p.night_allowance||0) + (p.cross_store_allowance||0) + (p.other_custom_total||0) + (p.attendance_bonus||0)
  const otSum = (p.regular_overtime_pay||0) + (p.extra_overtime_pay||0)
  const grossCheck = (p.base_salary||0) + allowancesSum + otSum + (p.policyBonus||0)

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
        width: '100%', maxWidth: 820,
      }}>
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

        <div style={{ padding: '16px 20px', maxHeight: '80vh', overflowY: 'auto' }}>

          {/* ── 加項 ── */}
          <Section title="① 加項" color="var(--accent-cyan)">
            <FormulaRow
              label="本薪"
              value={p.base_salary}
              formula={isHourly
                ? `時薪 × 當月實際打卡工時${isProrated ? '（已含在職比例）' : ''}`
                : `月薪設定值${isProrated ? ' × 在職工作日比例' : ''}`}
              vars={isHourly
                ? [{ k: '時薪', v: hr }, { k: '當月工時', v: p.workHours }]
                : isProrated
                  ? [{ k: '月薪', v: Math.round(p.base_salary / _p) }, { k: '在職比例', v: `${p.salary_actual_wd}/${p.salary_total_wd} 工作日` }]
                  : [{ k: '月薪', v: p.base_salary }]
              }
            />

            {(p.role_allowance > 0 || p._raw_role_allowance > 0 || p._supervisor_allowance > 0) && (
              <FormulaRow
                label="主管/職務津貼"
                value={p.role_allowance}
                formula="主管津貼 + 職務津貼（舊資料 fallback）"
                vars={[
                  { k: '主管', v: p._supervisor_allowance },
                  { k: '職務', v: p._raw_role_allowance },
                  ...(isProrated ? [{ k: '在職比例', v: _p }] : []),
                ]}
              />
            )}

            {p.meal_allowance > 0 && (
              <FormulaRow label="伙食津貼" value={p.meal_allowance}
                formula={`設定值${isProrated ? ' × 在職比例' : ''}`} />
            )}
            {p.transport_allowance > 0 && (
              <FormulaRow label="交通津貼" value={p.transport_allowance}
                formula={`設定值${isProrated ? ' × 在職比例' : ''}`} />
            )}
            {p.night_allowance > 0 && (
              <FormulaRow label="夜間津貼" value={p.night_allowance}
                formula={`設定值${isProrated ? ' × 在職比例' : ''}`} />
            )}
            {p.cross_store_allowance > 0 && (
              <FormulaRow label="跨店津貼" value={p.cross_store_allowance}
                formula={`設定值${isProrated ? ' × 在職比例' : ''}`} />
            )}
            {p.other_custom_total > 0 && (
              <FormulaRow label="其他自訂津貼" value={p.other_custom_total}
                formula="自訂津貼加總（排除已歸類的夜班/跨店）" />
            )}
            <FormulaRow
              label="全勤獎金"
              value={p.attendance_bonus}
              formula="若整月無遲到、無無薪缺勤 → 給設定值，否則 0"
              vars={[
                { k: '遲到分鐘', v: p.lateMins },
                { k: '無薪缺勤天數', v: p.absenceDays },
              ]}
              hint={p.attendance_bonus === 0 && (p.lateMins > 0 || p.absenceDays > 0)
                ? '有遲到或無薪缺勤 → 不發' : null}
            />

            {p.regular_overtime_pay > 0 && (
              <FormulaRow
                label="加班費"
                value={p.regular_overtime_pay}
                formula={[
                  '三桶階梯倍率：',
                  p.otWeekday > 0 ? '・平日：前 2 小時 × 1.34；超過 2 小時部分 × 1.67' : null,
                  p.otRestday > 0 ? '・休息日：前 2 小時 × 1.34；第 3~8 小時 × 1.67；第 9~12 小時 × 2.67' : null,
                  p.otHoliday > 0 ? '・國定/例假加班：加班時數 × 時薪 × 2.0' : null,
                  isHourly && p.holidayBonus > 0 ? '・時薪制國定打卡加給：國定打卡時數 × 時薪 × 1.0' : null,
                ].filter(Boolean).join('\n')}
                vars={[
                  { k: '時薪', v: hr },
                  ...(p.otWeekday > 0 ? [{ k: '平日加班時數', v: p.otWeekday }, { k: '平日加班費', v: p.otPayWeekday }] : []),
                  ...(p.otRestday > 0 ? [{ k: '休息日加班時數', v: p.otRestday }, { k: '休息日加班費', v: p.otPayRestday }] : []),
                  ...(p.otHoliday > 0 ? [{ k: '國定/例假加班時數', v: p.otHoliday }, { k: '國定/例假加班費', v: p.otPayHoliday }] : []),
                  ...(isHourly && p.holidayBonus > 0 ? [{ k: '國定打卡時數', v: p.holidayHours || 0 }, { k: '國定打卡加給', v: p.holidayBonus }] : []),
                ]}
              />
            )}
            {p.extra_overtime_pay > 0 && (
              <FormulaRow
                label="額外加班費"
                value={p.extra_overtime_pay}
                formula="倍率算法與「加班費」相同（同三桶階梯）"
                vars={[
                  ...(p._ot_exc_weekday > 0 ? [{ k: '平日加班時數', v: p._ot_exc_weekday }, { k: '平日加班費', v: p._ot_exc_weekday_pay }] : []),
                  ...(p._ot_exc_restday > 0 ? [{ k: '休息日加班時數', v: p._ot_exc_restday }, { k: '休息日加班費', v: p._ot_exc_restday_pay }] : []),
                  ...(p._ot_exc_holiday > 0 ? [{ k: '國定/例假加班時數', v: p._ot_exc_holiday }, { k: '國定/例假加班費', v: p._ot_exc_holiday_pay }] : []),
                ]}
              />
            )}
            {p.policyBonus > 0 && (
              <FormulaRow label="政策獎金" value={p.policyBonus}
                formula="依業績/出勤獎金規則計算（業績與出勤率目前帶 0 / 1 stub）" />
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
                { k: '驗算', v: grossCheck },
              ]}
            />
          </Section>

          {/* ── 加班明細 ── */}
          {(otRows.length > 0) && (
            <Section title="📅 加班明細" color="var(--accent-cyan)">
              <OvertimeDetailTable rows={otRows} hourlyRate={hr} />
            </Section>
          )}

          {/* ── 額外加班明細 ── */}
          {((p._ot_exception_rows || []).length > 0) && (
            <Section title="📅 額外加班明細" color="var(--accent-cyan)">
              <OvertimeDetailTable rows={p._ot_exception_rows} hourlyRate={hr} />
            </Section>
          )}

          {/* ── 遲到明細 ── */}
          {(lateRows.length > 0) && (
            <Section title="⏰ 遲到明細" color="var(--accent-orange)">
              <LateDetailTable rows={lateRows} hourlyRate={hr} lateDeduction={p.lateDeduction} />
            </Section>
          )}

          {/* ── 扣項 ── */}
          <Section title="② 扣項" color="var(--accent-orange)">
            <FormulaRow
              label="投保金額"
              value={p.insuredLabor === p.insuredHealth ? p.insuredLabor : 0}
              formula="員工檔的「投保金額」設定值；若沒設定 → 本薪 + 所有經常性津貼"
              vars={p.insuredLabor === p.insuredHealth
                ? [{ k: '投保金額', v: p.insuredLabor }]
                : [{ k: '勞保上限', v: p.insuredLabor }, { k: '健保上限', v: p.insuredHealth }]
              }
              hint={p.insuredLabor !== p.insuredHealth ? '高薪：勞保最高 45,800 / 健保最高 313,000，故兩者不同' : null}
            />
            <FormulaRow
              label="勞保（員工自付）"
              value={-p.laborInsurance}
              formula="級距表查表 × 員工分擔比例 20%"
              hint={isProrated ? `在職曆日比例 ${p.in_service_days}/${p.month_days} 已套用` : null}
            />
            <FormulaRow
              label="健保（員工自付）"
              value={-p.healthInsurance}
              formula="級距表查表 × 員工分擔比例 30% ×（1 + 眷屬數）"
              vars={[{ k: '眷屬', v: p.health_ins_dependents }]}
              hint="健保不打在職比例（月初有保就全月收）"
            />
            {p.pension > 0 && (
              <FormulaRow
                label="勞退（員工自提）"
                value={-p.pension}
                formula="投保金額 × 員工自提%"
                vars={[{ k: '自提%', v: p.pension_self_pct }]}
                hint={isProrated ? '已套在職比例' : null}
              />
            )}
            {leaveDeduction > 0 && (
              <FormulaRow
                label="請假扣款"
                value={-leaveDeduction}
                formula={'無薪假（事假/無薪假）：時數 × 時薪 × 1.0\n半薪假（病假/生理假）：時數 × 時薪 × 0.5'}
                vars={[
                  { k: '無薪時數', v: p.unpaidHours },
                  { k: '半薪時數', v: p.halfPayHours },
                  { k: '時薪', v: hr },
                  { k: '無薪扣款', v: p.unpaidDeduction },
                  { k: '半薪扣款', v: p.halfPayDeduction },
                ]}
                hint={isHourly ? '時薪制 PT 請假不扣（沒上班→沒工時→自然不算薪）' : null}
              />
            )}
            {p.lateDeduction > 0 && (
              <FormulaRow
                label="遲到扣款"
                value={-p.lateDeduction}
                formula="合計遲到分鐘 ÷ 30（無條件捨去）× 時薪 × 0.5"
                vars={[{ k: '合計遲到分鐘', v: p.lateMins }, { k: '時薪', v: hr }]}
                hint="每滿 30 分鐘扣半小時薪；上方有逐筆遲到日明細"
              />
            )}
            {p.legal_deduction > 0 && (
              <FormulaRow
                label="法扣（民事執行/養育費/債務）"
                value={-p.legal_deduction}
                formula="進行中且開始月份 ≤ 當月的法扣設定加總"
                hint="目前只算固定金額；百分比型尚未支援"
              />
            )}

            <FormulaRow
              label="減項合計"
              value={-p.totalDeductions}
              color="var(--accent-red)"
              formula="勞保 + 健保 + 勞退自提 + 請假扣 + 遲到扣 + 法扣"
              vars={[{ k: '驗算', v: totalDedCheck }]}
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
            <FormulaRow label="勞保（公司負擔）" value={p.laborEmployer}
              formula="級距 × 公司分擔比例 70%" />
            <FormulaRow label="健保（公司負擔）" value={p.healthEmployer}
              formula="級距 × 公司分擔比例 60%" />
            <FormulaRow label="勞退（公司提撥）" value={p.pensionEmployer}
              formula="投保金額 × 6%（勞退條例強制提撥）" />
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
