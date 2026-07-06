import { useState, useEffect, useCallback, useMemo } from 'react'
import { Calculator, Plus, Download, Trash2, Building2, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Modal, { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { logger } from '../../lib/logger'
import { fmtNT as fmt } from '../../lib/currency'
import {
  calculateNhiSupplement,
  calculateNhiEmployer,
  addNhiManualRecord,
  calcSinglePaymentSupplement,
  loadNhiParams,
  NHI_MANUAL_CATEGORIES,
} from '../../lib/nhiSupplement'
import {
  getNhiRecordsByPeriod,
  getNhiRecordsByYear,
  getNhiEmployerRecord,
  deleteNhiManualRecord,
} from '../../lib/db/nhiSupplement'

const ALL_CATEGORIES = ['高額獎金', ...NHI_MANUAL_CATEGORIES]

/**
 * F-B4 二代健保補充保費（掛 HR Track）
 *
 * 期別選擇 → 計算本期（RPC secure_calculate_nhi_supplement / _employer）
 * → 高額獎金逐員工明細（累計獎金/投保薪資/超額/保費）
 * → 其餘 5 類手動登錄（門檻提示）→ 雇主負擔卡 → 年度彙總 + CSV。
 *
 * 路由：需在 HrModule 註冊（本檔不自行註冊）。
 */
export default function NhiSupplement() {
  const now = new Date()
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [period, setPeriod] = useState(defaultPeriod)
  const year = Number(period.slice(0, 4))

  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
  const [records, setRecords] = useState([])
  const [yearRecords, setYearRecords] = useState([])
  const [employerRow, setEmployerRow] = useState(null)
  const [params, setParams] = useState(null)
  const [employees, setEmployees] = useState([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState({ employeeId: '', category: '兼職所得', amount: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, yearRows, employer, p, empRes] = await Promise.all([
        getNhiRecordsByPeriod(period),
        getNhiRecordsByYear(year),
        getNhiEmployerRecord(period),
        loadNhiParams(year),
        supabase.from('employees').select('id, name, status').order('name'),
      ])
      setRecords(rows)
      setYearRecords(yearRows)
      setEmployerRow(employer)
      setParams(p)
      setEmployees(empRes.data || [])
    } catch (err) {
      logger.error('NHI supplement load failed', { module: 'hr', period, error: err?.message })
      toast.error(err?.message || '資料載入失敗')
    } finally {
      setLoading(false)
    }
  }, [period, year])

  useEffect(() => { load() }, [load])

  // ── 計算本期（高額獎金 + 雇主負擔，皆 server-side）──
  const handleCompute = async () => {
    setComputing(true)
    try {
      const [supp, employer] = await Promise.all([
        calculateNhiSupplement(period),
        calculateNhiEmployer(period),
      ])
      toast.success(
        `已計算 ${supp?.calculated ?? 0} 筆高額獎金（保費合計 ${fmt(supp?.total_premium ?? 0)}）、雇主負擔 ${fmt(employer?.premium ?? 0)}`
      )
      await load()
    } catch (err) {
      logger.error('NHI supplement compute failed', { module: 'hr', period, error: err?.message })
      toast.error(err?.message || '計算失敗')
    } finally {
      setComputing(false)
    }
  }

  // ── 手動登錄 ──
  const thresholdFor = useCallback((category) => {
    if (!params) return 0
    return category === '兼職所得'
      ? Number(params.single_payment_threshold)
      : Number(params.other_income_threshold)
  }, [params])

  const preview = useMemo(() => {
    if (!params || !form.amount) return null
    return calcSinglePaymentSupplement({
      amount: Number(form.amount),
      threshold: thresholdFor(form.category),
      rate: Number(params.rate),
      cap: Number(params.payment_cap),
      category: form.category,
    })
  }, [form.amount, form.category, params, thresholdFor])

  const handleAdd = async () => {
    if (!form.employeeId) return toast.error('請選擇所得人')
    if (!(Number(form.amount) > 0)) return toast.error('請輸入給付金額')
    try {
      await addNhiManualRecord({
        period,
        employeeId: Number(form.employeeId),
        category: form.category,
        amount: Number(form.amount),
      })
      toast.success('已登錄')
      setShowAddModal(false)
      setForm({ employeeId: '', category: '兼職所得', amount: '' })
      await load()
    } catch (err) {
      logger.error('NHI manual record add failed', { module: 'hr', period, error: err?.message })
      toast.error(err?.message || '登錄失敗')
    }
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: `刪除 ${row.employees?.name || ''} 的「${row.category}」登錄？` }))) return
    try {
      await deleteNhiManualRecord(row.id)
      toast.success('已刪除')
      await load()
    } catch (err) {
      toast.error(err?.message || '刪除失敗')
    }
  }

  // ── 年度彙總（依類別）──
  const yearSummary = useMemo(() => {
    const byCat = {}
    for (const r of yearRecords) {
      if (!byCat[r.category]) byCat[r.category] = { category: r.category, count: 0, taxable: 0, premium: 0 }
      byCat[r.category].count += 1
      byCat[r.category].taxable += Number(r.taxable_base) || 0
      byCat[r.category].premium += Number(r.premium) || 0
    }
    return ALL_CATEGORIES.filter(c => byCat[c]).map(c => byCat[c])
  }, [yearRecords])

  const yearTotalPremium = yearSummary.reduce((s, r) => s + r.premium, 0)

  const handleExportCSV = () => {
    const headers = ['期別', '所得人', '類別', '給付金額', '投保薪資', '累計獎金', '計費基礎', '補充保費', '來源']
    const rows = yearRecords.map(r => [
      r.period, r.employees?.name || r.employee_id, r.category,
      r.payment_amount, r.insured_salary ?? '', r.cumulative_bonus ?? '',
      r.taxable_base, r.premium, r.source_type === 'payroll' ? '薪資推導' : '手動',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `二代健保補充保費_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const bonusRows = records.filter(r => r.category === '高額獎金')
  const manualRows = records.filter(r => r.category !== '高額獎金')
  const periodTotal = records.reduce((s, r) => s + (Number(r.premium) || 0), 0)

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏥</span> 二代健保補充保費</h2>
            <p>高額獎金自動推導 + 兼職/執行業務/股利/利息/租金手動登錄 + 雇主負擔</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="month"
              className="form-input"
              style={{ width: 150 }}
              value={period}
              onChange={e => e.target.value && setPeriod(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新整理</button>
            <button className="btn btn-secondary" onClick={() => setShowAddModal(true)}>
              <Plus size={14} /> 手動登錄
            </button>
            <button className="btn btn-secondary" onClick={handleExportCSV} disabled={!yearRecords.length}>
              <Download size={14} /> 年度 CSV
            </button>
            <button className="btn btn-primary" onClick={handleCompute} disabled={computing}>
              <Calculator size={14} /> {computing ? '計算中…' : '計算本期'}
            </button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-card-label">本期代扣（員工）</div>
          <div className="stat-card-value">{fmt(periodTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">本期雇主負擔</div>
          <div className="stat-card-value">{fmt(employerRow?.premium || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">年度保費累計</div>
          <div className="stat-card-value">{fmt(yearTotalPremium)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">費率</div>
          <div className="stat-card-value">{params ? `${(Number(params.rate) * 100).toFixed(2)}%` : '—'}</div>
        </div>
      </div>

      {/* 雇主負擔卡 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><Building2 size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />雇主（投保單位）負擔 — {period}</div>
        </div>
        <div style={{ padding: 16 }}>
          {employerRow ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <tbody>
                  <tr><td>薪資支出總額</td><td style={{ textAlign: 'right' }}>{fmt(employerRow.salary_total)}</td></tr>
                  <tr><td>健保投保金額總額</td><td style={{ textAlign: 'right' }}>{fmt(employerRow.insured_total)}</td></tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td>雇主補充保費（差額 × {params ? (Number(params.rate) * 100).toFixed(2) : '2.11'}%，下限 0）</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-orange)' }}>{fmt(employerRow.premium)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>本期尚未計算 — 請點「計算本期」。</p>
          )}
        </div>
      </div>

      {/* 高額獎金明細 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">高額獎金（累計超 {params ? Number(params.bonus_multiple) : 4} 倍投保薪資）— {period}</div></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th style={{ textAlign: 'right' }}>本月獎金</th>
                <th style={{ textAlign: 'right' }}>累計獎金</th>
                <th style={{ textAlign: 'right' }}>投保薪資</th>
                <th style={{ textAlign: 'right' }}>超額（計費基礎）</th>
                <th style={{ textAlign: 'right' }}>補充保費</th>
              </tr>
            </thead>
            <tbody>
              {bonusRows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>本期無高額獎金代扣（無獎金或未達 4 倍門檻）</td></tr>
              ) : bonusRows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.employees?.name || r.employee_id}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.payment_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.cumulative_bonus)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.insured_salary)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.taxable_base)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: Number(r.premium) > 0 ? 'var(--accent-orange)' : undefined }}>{fmt(r.premium)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 手動登錄明細（其餘 5 類） */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">其他類別代扣（手動登錄）— {period}</div></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>所得人</th><th>類別</th>
                <th style={{ textAlign: 'right' }}>給付金額</th>
                <th style={{ textAlign: 'right' }}>計費基礎</th>
                <th style={{ textAlign: 'right' }}>補充保費</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {manualRows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>本期無手動登錄（兼職/執行業務/股利/利息/租金）</td></tr>
              ) : manualRows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.employees?.name || r.employee_id}</td>
                  <td><Badge color="purple" size="sm">{r.category}</Badge></td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.payment_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.taxable_base)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-orange)' }}>{fmt(r.premium)}</td>
                  <td>
                    {r.source_type === 'manual' && (
                      <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleDelete(r)}>
                        <Trash2 size={11} /> 刪除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 年度彙總 */}
      <div className="card">
        <div className="card-header"><div className="card-title">年度彙總 — {year}（民國 {year - 1911}）</div></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>類別</th><th style={{ textAlign: 'right' }}>筆數</th><th style={{ textAlign: 'right' }}>計費基礎合計</th><th style={{ textAlign: 'right' }}>保費合計</th></tr>
            </thead>
            <tbody>
              {yearSummary.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>本年度尚無代扣紀錄</td></tr>
              ) : yearSummary.map(s => (
                <tr key={s.category}>
                  <td>{s.category}</td>
                  <td style={{ textAlign: 'right' }}>{s.count}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(s.taxable)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(s.premium)}</td>
                </tr>
              ))}
              {yearSummary.length > 0 && (
                <tr style={{ fontWeight: 700 }}>
                  <td>合計</td>
                  <td style={{ textAlign: 'right' }}>{yearSummary.reduce((s, r) => s + r.count, 0)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(yearSummary.reduce((s, r) => s + r.taxable, 0))}</td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-orange)' }}>{fmt(yearTotalPremium)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 手動登錄 Modal */}
      {showAddModal && (
        <Modal title={`手動登錄補充保費代扣 — ${period}`} onClose={() => setShowAddModal(false)} onSubmit={handleAdd} submitLabel="登錄">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
            高額獎金由「計算本期」自動推導，此處僅登錄其餘 5 類。未達門檻的給付免扣、無需登錄。
          </div>
          <Field label="類別" required>
            <select className="form-input" style={{ width: '100%' }} value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {NHI_MANUAL_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}（單次 ≥ {fmt(thresholdFor(c))} 起扣）
                </option>
              ))}
            </select>
          </Field>
          <Field label="所得人" required>
            <select className="form-input" style={{ width: '100%' }} value={form.employeeId}
              onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">— 請選擇 —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="單次給付金額" required>
            <input type="number" min="0" className="form-input" style={{ width: '100%' }} value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder={`門檻 ${fmt(thresholdFor(form.category))}；計費上限 ${fmt(params?.payment_cap || 10000000)}`} />
          </Field>
          {preview && (
            <div style={{
              fontSize: 13, padding: 10, borderRadius: 6, marginTop: 4,
              background: preview.belowThreshold ? 'var(--accent-orange-dim)' : 'var(--accent-cyan-dim)',
              color: preview.belowThreshold ? 'var(--accent-orange)' : 'var(--accent-cyan)',
            }}>
              {preview.belowThreshold
                ? `未達 ${form.category} 起扣門檻 ${fmt(thresholdFor(form.category))} — 免扣補充保費，無需登錄`
                : `試算：計費基礎 ${fmt(preview.taxableBase)} × ${(Number(params?.rate || 0.0211) * 100).toFixed(2)}% = 保費 ${fmt(preview.premium)}（正式以伺服器計算為準）`}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
