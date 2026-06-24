import FormBindingsPicker from '../FormBindingsPicker'
import SearchableSelect, { empOptions } from '../SearchableSelect'

/**
 * BoundFormsField — 新增任務時「綁定表單 + 每張表單誰來填」的共用欄位
 *
 * 各新增任務入口（Tasks 獨立任務頁 / TaskQuickCreateModal 等）共用，
 * 確保「自己填 / 他人填(指派)」一律在建立任務當下就能設定。
 *
 * value: Array<{ form_type, form_template_id, label, fill_mode?, assignee_id? }>
 *   - fill_mode 預設 'self'；'other' 時 assignee_id 指定填寫人
 * onChange(next)
 * employees: 員工清單（他人填選人用）
 */
const norm = (arr) => (arr || []).map(it => ({
  ...it,
  fill_mode: it.fill_mode === 'other' ? 'other' : 'self',
  assignee_id: it.fill_mode === 'other' ? (it.assignee_id ?? null) : null,
}))

export default function BoundFormsField({ value = [], onChange, employees = [] }) {
  const items = norm(value)
  const keyOf = (o) => `${o.form_type}-${o.form_template_id ?? 'null'}`

  const setItem = (idx, patch) => {
    const next = items.map((it, i) => i === idx ? { ...it, ...patch } : it)
    onChange?.(next)
  }

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

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📋 綁定表單（選填）</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        需填完選定的表單，全部完成才能完成此任務。可指定每張表單由「自己填」或「他人填」。
      </div>

      <FormBindingsPicker
        value={items}
        onChange={(next) => onChange?.(norm(next))}
      />

      {/* 每張表單：誰來填 */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {items.map((f, i) => {
            const isOther = f.fill_mode === 'other'
            return (
              <div key={`${keyOf(f)}-${i}`}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  padding: '10px 12px', borderRadius: 6,
                  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>📄 {f.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>誰來填：</span>
                  <ModePill active={!isOther} onClick={() => setItem(i, { fill_mode: 'self', assignee_id: null })}>自己填</ModePill>
                  <ModePill active={isOther} onClick={() => setItem(i, { fill_mode: 'other' })}>他人填</ModePill>
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
                  {!isOther && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>建立後立即填寫</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
