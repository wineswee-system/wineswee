import { useState, useEffect, useCallback } from 'react'
import { Shield, CheckCircle, XCircle, AlertTriangle, Download, Printer, FileText, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { exportToCSV, exportToPDF } from '../../lib/exportUtils'
import Modal from '../../components/Modal'
import {
  INSPECTION_ITEMS, validateCompliance,
  generateEmployeeRoster, generateAttendanceReport, generatePayrollRegister,
  generateOvertimeReport, generateLeaveReport, generateLaborInsuranceReport,
  generateNHIReport, generatePensionReport, generateScheduleReport,
  generateSafetyReport, generateWorkRulesChecklist, generateMeetingReport,
  generateHarassmentPolicy, generateAccidentStats, generateSelfInspection,
} from '../../lib/laborInspection'

const currentMonth = () => new Date().toISOString().slice(0, 7)

const statusBadge = (status) => {
  if (status === '通過') return <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>✅ 通過</span>
  if (status === '未通過') return <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>❌ 未通過</span>
  return <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>⚠️ 待確認</span>
}

export default function LaborInspection() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [month, setMonth] = useState(currentMonth())
  const [generating, setGenerating] = useState(false)

  // Data sources
  const [employees, setEmployees] = useState([])
  const [attendance, setAttendance] = useState([])
  const [overtimeRecords, setOvertimeRecords] = useState([])
  const [leaveRecords, setLeaveRecords] = useState([])
  const [salaryRecords, setSalaryRecords] = useState([])
  const [schedules, setSchedules] = useState([])

  // Reports
  const [reports, setReports] = useState({})
  const [compliance, setCompliance] = useState({ score: 0, passed: [], failed: [], warnings: [] })
  const [detailModal, setDetailModal] = useState(null)

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    // ★ 加 org_id filter + 限縮日期範圍到 90 天，避免一次載 2000+ 筆全公司資料
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    Promise.all([
      supabase.from('employees').select('*').eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('attendance_records').select('*').eq('organization_id', orgId).gte('date', since90).order('date', { ascending: false }).limit(2000),
      supabase.from('overtime_records').select('*').eq('organization_id', orgId).gte('date', since90).order('date', { ascending: false }).limit(1000),
      supabase.from('leave_records').select('*').eq('organization_id', orgId).gte('start_date', since90).order('start_date', { ascending: false }).limit(1000),
      supabase.from('salary_records').select('*').eq('organization_id', orgId).order('month', { ascending: false }).limit(1000),
      supabase.from('schedules').select('*').eq('organization_id', orgId).gte('date', since90).order('date', { ascending: false }).limit(1000),
    ]).then(([emp, att, ot, lv, sal, sch]) => {
      setEmployees(emp.data || [])
      setAttendance(att.data || [])
      setOvertimeRecords(ot.data || [])
      setLeaveRecords(lv.data || [])
      setSalaryRecords(sal.data || [])
      setSchedules(sch.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [profile?.organization_id])

  const generateReport = useCallback((id) => {
    const generators = {
      1:  () => generateEmployeeRoster(employees),
      2:  () => generateAttendanceReport(attendance, employees, month),
      3:  () => generatePayrollRegister(salaryRecords, employees, month),
      4:  () => generateOvertimeReport(overtimeRecords, employees, month),
      5:  () => generateLeaveReport(leaveRecords, employees, month),
      6:  () => generateLaborInsuranceReport(employees),
      7:  () => generateNHIReport(employees),
      8:  () => generatePensionReport(employees, salaryRecords, month),
      9:  () => generateScheduleReport(schedules, employees, month),
      10: () => generateSafetyReport([]),
      11: () => generateWorkRulesChecklist(),
      12: () => generateMeetingReport([]),
      13: () => generateHarassmentPolicy(),
      14: () => generateAccidentStats([]),
      15: () => generateSelfInspection({}),
    }
    const gen = generators[id]
    if (gen) {
      const result = gen()
      setReports(prev => {
        const next = { ...prev, [id]: result }
        const allReports = Object.values(next)
        setCompliance(validateCompliance(allReports))
        return next
      })
    }
  }, [employees, attendance, salaryRecords, overtimeRecords, leaveRecords, schedules, month])

  const generateAll = useCallback(() => {
    setGenerating(true)
    setTimeout(() => {
      INSPECTION_ITEMS.forEach(item => generateReport(item.id))
      setGenerating(false)
    }, 300)
  }, [generateReport])

  const getItemStatus = (id) => {
    const report = reports[id]
    if (!report) return null
    const failCount = report.items.filter(i => i.status === '未通過').length
    const warnCount = report.items.filter(i => i.status === '待確認').length
    if (failCount > 0) return '未通過'
    if (warnCount > report.items.length * 0.5) return '待確認'
    return '通過'
  }

  const handleExportCSV = () => {
    const data = INSPECTION_ITEMS.map(item => ({
      id: item.id,
      name: item.name,
      status: reports[item.id] ? getItemStatus(item.id) : '未產生',
      generatedAt: reports[item.id]?.generatedAt || '',
      summary: reports[item.id]?.summary || '',
    }))
    exportToCSV(data, [
      { key: 'id', label: '編號' },
      { key: 'name', label: '報表名稱' },
      { key: 'status', label: '狀態' },
      { key: 'generatedAt', label: '產生時間' },
      { key: 'summary', label: '摘要' },
    ], `勞檢報表_${month}`)
  }

  const handlePrint = () => exportToPDF('labor-inspection-content', `勞檢報表_${month}`)

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const passedCount = compliance.passed.length
  const failedCount = compliance.failed.length
  const warnCount = compliance.warnings.length

  return (
    <div className="fade-in" id="labor-inspection-content">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          🛡️ 勞檢報表
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="month" className="form-input" value={month} onChange={e => setMonth(e.target.value)}
            style={{ padding: '6px 12px', fontSize: 14 }} />
          <button className="btn btn-primary" onClick={generateAll} disabled={generating}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={15} className={generating ? 'spin' : ''} />
            {generating ? '產生中...' : '產生報表'}
          </button>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent-green)' }}>
            <Download size={15} /> CSV
          </button>
          <button className="btn btn-primary" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent-purple, #8b5cf6)' }}>
            <Printer size={15} /> 列印
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 20 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>合規分數</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: compliance.score >= 80 ? 'var(--accent-green)' : compliance.score >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>
            {compliance.score}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>滿分 100</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>通過項目</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent-green)' }}>{passedCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><CheckCircle size={12} /> 合規</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未通過項目</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent-red)' }}>{failedCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><XCircle size={12} /> 需改善</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>待確認項目</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent-amber)' }}>{warnCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><AlertTriangle size={12} /> 需確認</div>
        </div>
      </div>

      {/* Checklist Table */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} /> 勞檢15項檢查清單
          </h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            報表月份：{month}　|　員工人數：{employees.length}
          </span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>報表名稱</th>
                <th>說明</th>
                <th style={{ width: 100, textAlign: 'center' }}>狀態</th>
                <th style={{ width: 160 }}>產生時間</th>
                <th style={{ width: 120, textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {INSPECTION_ITEMS.map(item => {
                const report = reports[item.id]
                const status = getItemStatus(item.id)
                return (
                  <tr key={item.id} style={{ cursor: report ? 'pointer' : 'default' }}
                    onClick={() => report && setDetailModal(item.id)}>
                    <td style={{ fontWeight: 600 }}>{item.id}</td>
                    <td style={{ fontWeight: 500 }}>{item.name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.description}</td>
                    <td style={{ textAlign: 'center' }}>
                      {status ? statusBadge(status) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未產生</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {report?.generatedAt ? new Date(report.generatedAt).toLocaleString('zh-TW') : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                        onClick={() => generateReport(item.id)}>
                        {report ? '重新產生' : '產生'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      {detailModal && reports[detailModal] && (
        <Modal title={reports[detailModal].title} onClose={() => setDetailModal(null)}
          onSubmit={() => setDetailModal(null)} submitLabel="關閉">
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div style={{ padding: '8px 0', marginBottom: 12, borderBottom: '1px solid var(--border-light)', fontSize: 13, color: 'var(--text-secondary)' }}>
              {reports[detailModal].summary}
            </div>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>內容</th>
                    <th style={{ width: 80, textAlign: 'center' }}>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {reports[detailModal].items.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 500 }}>{item.label}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{item.value}</td>
                      <td style={{ textAlign: 'center' }}>{statusBadge(item.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => {
                  const report = reports[detailModal]
                  exportToCSV(report.items, [
                    { key: 'label', label: '項目' },
                    { key: 'value', label: '內容' },
                    { key: 'status', label: '狀態' },
                  ], `${report.title}_${month}`)
                }}>
                <Download size={13} /> 匯出 CSV
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
