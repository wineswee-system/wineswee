import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import SettleModal from '../../pages/workflow/components/SettleModal'
import { validateRequired } from '../../lib/formValidation'
import { safeStorageName } from '../../lib/storageSanitize'
import { toast } from '../../lib/toast'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
  'text/csv', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
const MAX_SIZE = 10 * 1024 * 1024

/**
 * EmbeddedSettleModal
 * 在任務面板內 inline 開啟費用驗收 modal，不開新分頁。
 * 取 binding.form_id → 撈 expense_request → 顯示 SettleModal → 送出。
 */
export default function EmbeddedSettleModal({ binding, onClose, onDone }) {
  const { profile } = useAuth()
  const [request, setRequest] = useState(null)
  const [settleForm, setSettleForm] = useState({ actual_amount: '', notes: '' })
  const [settleFiles, setSettleFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!binding?.form_id) return
    supabase.from('expense_requests')
      .select('*')
      .eq('id', binding.form_id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { toast.error('找不到對應的費用申請單'); onClose?.(); return }
        setRequest(data)
        setSettleForm({
          actual_amount: data.actual_amount ?? data.estimated_amount ?? '',
          notes: data.notes || '',
        })
      })
  }, [binding?.form_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!validateRequired(settleForm, ['actual_amount'], setErrors)) return
    setSaving(true)
    const isResubmit = request.status === '核銷已退回'
    const { error } = await supabase.from('expense_requests')
      .update({
        actual_amount: Number(settleForm.actual_amount),
        notes: settleForm.notes || null,
        status: '待核銷',
        ...(isResubmit && {
          settle_chain_id: null,
          settle_current_step: 0,
          settle_reject_reason: null,
          settled_by: null,
          settled_at: null,
        }),
      }).eq('id', request.id)
    if (error) { toast.error(error.message); setSaving(false); return }

    for (const file of settleFiles) {
      if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_SIZE) continue
      const path = `expense-requests/${request.id}/settlement/${Date.now()}_${safeStorageName(file.name)}`
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
      if (!upErr) {
        await supabase.from('expense_request_attachments').insert({
          request_id: request.id,
          file_name: file.name,
          storage_path: path,
          file_size: file.size,
          file_type: file.type,
          stage: 'settlement',
          uploaded_by: profile?.name || '系統',
        })
      }
    }

    setSaving(false)
    toast.success('驗收已送出')
    onDone?.()
  }

  return (
    <SettleModal
      open={!!request}
      onClose={onClose}
      request={request}
      settleForm={settleForm}
      setSettleForm={setSettleForm}
      settleFiles={settleFiles}
      setSettleFiles={setSettleFiles}
      onSubmit={handleSubmit}
      saving={saving}
      errors={errors}
      setErrors={setErrors}
    />
  )
}
