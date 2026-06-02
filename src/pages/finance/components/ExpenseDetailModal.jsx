import { supabase } from '../../../lib/supabase'
import { exportExpenseRequestPdf } from '../../../lib/exportPdf'
import ApprovalDetailModal from '../../../components/ApprovalDetailModal'
import { toast } from '../../../lib/toast'
import { formatCurrency } from '../../../lib/currency'

/**
 * ExpenseDetailModal — read-only detail view for an expense request,
 * showing fields, line items, amounts, attachments, and approval chain steps.
 *
 * Props:
 *   request           object | null    the expense_request row
 *   employees         array            full employee list (for empRow lookup + signatures)
 *   attachments       object           map { [requestId]: attachment[] }
 *   organization      object | null    { name, logo_url }
 *   detailChainSteps  array
 *   loadingChain      boolean
 *   onClose           () => void
 */
export default function ExpenseDetailModal({
  request, employees, attachments, organization,
  detailChainSteps, loadingChain,
  onClose,
}) {
  if (!request) return null

  const showDetail = request
  const fmtAmt = (n) => n != null ? formatCurrency(n, showDetail.currency || 'TWD') : '-'
  const empRow = employees.find(e => e.name === showDetail.employee)
  const isNonExpense = showDetail.is_expense === false

  const fields = isNonExpense
    ? [
        { label: '類型', value: '非費用申請' },
        { label: '部門', value: showDetail.department || '—' },
        { label: '主旨', value: showDetail.title || '—' },
        ...(showDetail.description ? [{ label: '說明', value: showDetail.description, multiline: true }] : []),
      ]
    : [
        { label: '部門', value: showDetail.department || '—' },
        { label: '科目', value: `${showDetail.account_code || ''} ${showDetail.account_name || ''}`.trim() || '—' },
        { label: '門市', value: showDetail.store || '—' },
        { label: '供應商', value: showDetail.supplier || '—' },
        { label: '項目', value: showDetail.title || '—' },
        ...(showDetail.description ? [{ label: '說明', value: showDetail.description, multiline: true }] : []),
      ]

  // Line items table (expense only)
  if (!isNonExpense) fields.push({
    label: '品項明細',
    value: (
      <div style={{ border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>品名</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>數量</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>單價</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>小計</th>
            </tr>
          </thead>
          <tbody>
            {showDetail.items?.length > 0
              ? showDetail.items.map((li, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '4px 8px' }}>{li.name}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{li.qty}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtAmt(li.unit_price)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtAmt(li.subtotal)}</td>
                  </tr>
                ))
              : (
                  <tr>
                    <td colSpan={4} style={{ padding: '8px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>無品項明細</td>
                  </tr>
                )
            }
          </tbody>
        </table>
      </div>
    ),
  })

  // Amount cards (expense only)
  if (!isNonExpense) fields.push({
    label: '金額',
    value: (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            預估金額
            {showDetail.currency && showDetail.currency !== 'TWD' && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)' }}>{showDetail.currency}</span>
            )}
          </div>
          <div style={{ fontWeight: 700 }}>{fmtAmt(showDetail.estimated_amount)}</div>
        </div>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>實際金額</div><div style={{ fontWeight: 700 }}>{showDetail.actual_amount != null ? fmtAmt(showDetail.actual_amount) : '—'}</div></div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>差異</div>
          <div style={{ fontWeight: 700, color: showDetail.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            {showDetail.difference != null ? fmtAmt(showDetail.difference) : '—'}
          </div>
        </div>
      </div>
    ),
  })

  if (showDetail.reject_reason) fields.push({ label: '駁回原因', value: showDetail.reject_reason, multiline: true })
  if (showDetail.notes) fields.push({ label: '核銷備註', value: showDetail.notes, multiline: true })

  const atts = (attachments[showDetail.id] || []).map(a => ({
    url: supabase.storage.from('attachments').getPublicUrl(a.storage_path).data?.publicUrl,
    name: `${a.file_name}${a.stage === 'settlement' ? '（核銷）' : '（申請）'}`,
    type: a.file_type,
  }))

  const handlePrintSignOff = async () => {
    if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const { data: rawAtts } = await supabase.from('expense_request_attachments')
        .select('file_name, storage_path, file_type')
        .eq('request_id', showDetail.id)
        .order('created_at')
      const pdfAtts = (rawAtts || []).map(a => ({
        url: supabase.storage.from('attachments').getPublicUrl(a.storage_path).data?.publicUrl,
        name: a.file_name,
        type: a.file_type,
      }))
      const signatures = Object.fromEntries(
        employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])
      )
      const approverMap = {}
      detailChainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      exportExpenseRequestPdf(showDetail, {
        companyName: organization?.name,
        logoUrl: organization?.logo_url,
        attachments: pdfAtts,
        signatures,
        chainSteps: detailChainSteps.filter(s => s.kind !== 'settle_divider'),
        approverMap,
        _win: win,
      })
    } catch (e) {
      win.close()
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  return (
    <ApprovalDetailModal
      open={!!showDetail}
      onClose={onClose}
      docTitle={`費用申請 #${showDetail.id}`}
      docNo={showDetail.id}
      status={showDetail.status}
      applicant={{
        name: showDetail.employee,
        name_en: empRow?.name_en,
        position: empRow?.position,
        dept: showDetail.department,
        status: empRow?.status,
        employee_no: empRow?.employee_number,
      }}
      fields={fields}
      attachments={atts}
      createdAt={showDetail.created_at}
      chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
      onPrint={handlePrintSignOff}
    />
  )
}
