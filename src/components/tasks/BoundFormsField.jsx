import { useState } from 'react'
import { Pencil, CheckCircle2 } from 'lucide-react'
import FormBindingsPicker from '../FormBindingsPicker'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import { ModalOverlay } from '../Modal'
import CustomFormFill from '../../pages/workflow/CustomFormFill'
import ExpenseFormDraft from '../../pages/workflow/components/ExpenseFormDraft'
import ExpenseSimpleDraft from '../../pages/workflow/components/ExpenseSimpleDraft'
import { isDraftableType } from '../../lib/commitBindingDraft'

/**
 * BoundFormsField — 新增任務時「綁定表單 + 每張誰來填 + 自己填當場填寫(暫存)」
 *
 * 自己填(A 暫存式)：點「填寫」當場跳出表單填 → 內容暫存在 item._draft（不寫 DB）→
 *   任務「儲存」時由 lib/commitBindingDraft 落地。
 * 他人填：選一個人 → 任務儲存時指派 + 推 LINE。
 *
 * value: Array<{ form_type, form_template_id, label, fill_mode?, assignee_id?, _draft? }>
 * onChange(next) / employees
 */
const norm = (arr) => (arr || []).map(it => ({
  ...it,
  fill_mode: it.fill_mode === 'other' ? 'other' : 'self',
  assignee_id: it.fill_mode === 'other' ? (it.assignee_id ?? null) : null,
  _draft: it.fill_mode === 'other' ? null : (it._draft ?? null),
}))

// templateMode：範本/步驟定義用 — 只選「自己填 / 他人填(指定人)」，不提供當場填寫
//   （範本是定義，不是當下填表；實際填寫在部署成任務後）
export default function BoundFormsField({ value = [], onChange, employees = [], templateMode = false, defaultAssigneeId = null }) {
  const items = norm(value)
  const [capturingIdx, setCapturingIdx] = useState(null)
  const keyOf = (o) => `${o.form_type}-${o.form_template_id ?? 'null'}`

  const setItem = (idx, patch) => onChange?.(items.map((it, i) => i === idx ? { ...it, ...patch } : it))

  const ModePill = ({ active, onClick, children }) => (
    <button type="button" onClick={onClick}
      style={{
        padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
        border: '1px solid ' + (active ? 'var(--accent-cyan)' : 'var(--border-subtle)'),
        background: active ? 'var(--accent-cyan-dim)' : 'transparent',
        color: active ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer',
      }}>
      {children}
    </button>
  )

  const cap = capturingIdx != null ? items[capturingIdx] : null

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📋 綁定表單（選填）</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        需填完選定的表單，全部完成才能完成此任務。可指定每張由「自己填」或「他人填」；自己填可當場填寫。
      </div>

      <FormBindingsPicker value={items} onChange={(next) => onChange?.(norm(next))} />

      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {items.map((f, i) => {
            const isOther = f.fill_mode === 'other'
            const draftable = isDraftableType(f.form_type)
            const filled = !!f._draft
            return (
              <div key={`${keyOf(f)}-${i}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>📄 {f.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>誰來填：</span>
                  <ModePill active={!isOther} onClick={() => setItem(i, { fill_mode: 'self', assignee_id: null })}>自己填</ModePill>
                  <ModePill active={isOther} onClick={() => setItem(i, { fill_mode: 'other', _draft: null, assignee_id: f.assignee_id || defaultAssigneeId })}>他人填</ModePill>

                  {/* 他人填 → 選人 */}
                  {isOther && (
                    <div style={{ minWidth: 200, flex: 1 }}>
                      <SearchableSelect
                        value={f.assignee_id || ''}
                        onChange={(v) => setItem(i, { fill_mode: 'other', assignee_id: v ? Number(v) : null })}
                        options={empOptions(employees)}
                        placeholder="搜尋要指派的員工…"
                      />
                    </div>
                  )}

                  {/* 範本模式:自己填不當場填，部署成任務後由執行人填 */}
                  {!isOther && templateMode && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>部署後由執行人填寫</span>
                  )}

                  {/* 自己填 + 可暫存 → 當場填寫 */}
                  {!isOther && !templateMode && draftable && (
                    filled ? (
                      <button type="button" onClick={() => setCapturingIdx(i)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: '1px solid var(--accent-green)', background: 'var(--accent-green-dim)', color: 'var(--accent-green)', cursor: 'pointer' }}>
                        <CheckCircle2 size={12} /> 已填寫・點此重填
                      </button>
                    ) : (
                      <button type="button" onClick={() => setCapturingIdx(i)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: '1px solid var(--accent-cyan)', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', cursor: 'pointer' }}>
                        <Pencil size={12} /> 填寫
                      </button>
                    )
                  )}

                  {/* 自己填 + 不可暫存(重型) → 建立後填；驗收段是「選單核銷」不是跳表單 */}
                  {!isOther && !templateMode && !draftable && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {f.form_type === 'expense_settle' ? '建立後到任務內選單核銷'
                        : f.form_type === 'goods_transfer_receipt' ? '建立後到任務內驗收'
                        : '建立任務後跳出填寫'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 擷取視窗：自訂表單(需外層 ModalOverlay) / 費用申請(自帶 ModalOverlay) */}
      {cap && cap.form_type === 'form_submission' && (
        <ModalOverlay onClose={() => setCapturingIdx(null)}>
          <div className="modal-shell modal-lg" style={{ animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-shell-header">
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>填寫表單：{cap.label || '表單'}</h3>
              <button onClick={() => setCapturingIdx(null)} aria-label="Close"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 18, lineHeight: 1 }}>✕</button>
            </div>
            <div className="modal-shell-body" style={{ padding: 20 }}>
              <CustomFormFill
                templateId={cap.form_template_id}
                embedded
                onCapture={(d) => { setItem(capturingIdx, { _draft: d }); setCapturingIdx(null) }}
                onClose={() => setCapturingIdx(null)}
              />
            </div>
          </div>
        </ModalOverlay>
      )}
      {cap && (cap.form_type === 'expense_request' || cap.form_type === 'expense_apply'
              || cap.form_type === 'order_request' || cap.form_type === 'order_apply') && (
        <ExpenseFormDraft
          initialDraft={cap._draft}
          docType={(cap.form_type === 'order_request' || cap.form_type === 'order_apply') ? 'order' : 'expense'}
          onCapture={(draft) => { setItem(capturingIdx, { _draft: draft }); setCapturingIdx(null) }}
          onClose={() => setCapturingIdx(null)}
        />
      )}
      {cap && cap.form_type === 'expense' && (
        <ExpenseSimpleDraft
          initialDraft={cap._draft}
          onCapture={(draft) => { setItem(capturingIdx, { _draft: draft }); setCapturingIdx(null) }}
          onClose={() => setCapturingIdx(null)}
        />
      )}
    </div>
  )
}
