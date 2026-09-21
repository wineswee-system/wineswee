import { useRef } from 'react'
import { Upload, X } from 'lucide-react'
import { toast } from '../../lib/toast'
import { validateTaskFile } from '../../lib/taskAttachmentUpload'

/**
 * 新增任務時預選「發起附件」的欄位（檔案先存在記憶體，任務建立後由父層 uploadInitiatorAttachments 上傳）。
 * Props: files (File[]) / setFiles (File[]=>void) / disabled
 */
export default function InitiatorAttachmentField({ files = [], setFiles, disabled }) {
  const ref = useRef(null)

  const add = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateTaskFile(file)
    if (err) { toast.error(err); return }
    setFiles([...files, file])
  }
  const remove = (i) => setFiles(files.filter((_, idx) => idx !== i))

  return (
    <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📎 發起附件（選填）</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        任務建立後自動上傳，單檔上限 10 MB，不支援執行檔
      </div>
      <input ref={ref} type="file" style={{ display: 'none' }} onChange={add} />
      <button type="button" className="btn btn-sm btn-secondary"
        style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => ref.current?.click()} disabled={disabled}>
        <Upload size={11} /> 選擇檔案
      </button>
      {files.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 10px', borderRadius: 6, fontSize: 12,
              background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name}</span>
              <button type="button" onClick={() => remove(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, marginLeft: 8 }}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
