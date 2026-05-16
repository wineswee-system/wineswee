import { Plus, Edit2, Trash2, DollarSign } from 'lucide-react'

const fmtAmount = (n) => n == null ? '無上限' : `$${Number(n).toLocaleString()}`

/**
 * ChainListView — shows all chains for a formType/library, with new/edit/delete buttons.
 *
 * Props:
 *   chainsList        - array of chain objects (with .steps pre-loaded)
 *   mode              - 'amount_grouped' | 'library'
 *   shortStepDesc     - fn(step) => string   (passed from parent, needs employees/roles/depts/etc.)
 *   onNew             - () => void
 *   onEdit            - (chainId) => void
 *   onDelete          - (chainId, name) => void
 */
export default function ChainListView({ chainsList, mode, shortStepDesc, onNew, onEdit, onDelete }) {
  const isLibrary = mode === 'library'
  return (
    <div>
      {/* 提示卡 */}
      <div style={{
        padding: 12, marginBottom: 16, borderRadius: 8,
        background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan-dim)',
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
          <DollarSign size={14} /> {isLibrary ? '簽核鏈中央管理' : '金額分流自動指派'}
        </div>
        {isLibrary
          ? '這裡是整個組織的簽核鏈池子。流程任務、HR 表單、自訂表單會從這裡選 chain 來用。同一條 chain 可被多處引用，編輯後立即生效。'
          : '員工送出申請時，系統依「預估金額」自動找符合區間的簽核鏈並套用。最精準（min_amount 最大）的區間會優先被選中。'}
      </div>

      {/* 新增按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={onNew} style={{ fontSize: 13 }}>
          <Plus size={14} /> {isLibrary ? '新增簽核鏈' : '新增金額區間'}
        </button>
      </div>

      {/* Chain list */}
      {chainsList.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 13,
          border: '2px dashed var(--border-medium)', borderRadius: 10,
        }}>
          {isLibrary ? '尚未建立任何簽核鏈' : '尚未設定任何金額區間'} <br />
          <span style={{ fontSize: 11 }}>點擊上方「{isLibrary ? '新增簽核鏈' : '新增金額區間'}」建立第一條</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {chainsList.map(c => (
            <div key={c.id}
              onClick={() => onEdit(c.id)}
              style={{
                padding: 16, borderRadius: 10,
                background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)',
                cursor: 'pointer', transition: 'transform .12s, border-color .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = 'var(--accent-cyan)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.borderColor = 'var(--border-medium)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                    {c.is_active === false && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontWeight: 700 }}>停用</span>
                    )}
                  </div>
                  {c.description && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{c.description}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {isLibrary ? (
                      c.category && (
                        <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-purple-dim, rgba(167,139,250,0.15))', color: 'var(--accent-purple)', fontWeight: 600 }}>
                          {c.category}
                        </span>
                      )
                    ) : (
                      <span style={{ fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                        {fmtAmount(c.min_amount)} ~ {fmtAmount(c.max_amount)}
                      </span>
                    )}
                    <span>{c.steps.length} 關</span>
                  </div>
                  {/* 流程預覽 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 600 }}>申請人</span>
                    {c.steps.length === 0 ? (
                      <span style={{ color: 'var(--accent-orange)', fontStyle: 'italic' }}>→ 尚未設定關卡</span>
                    ) : (
                      c.steps.map(s => (
                        <span key={s.step_order} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: 'var(--text-muted)' }}>→</span>
                          <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}>
                            {s.label || shortStepDesc(s)}
                          </span>
                        </span>
                      ))
                    )}
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <span style={{ color: 'var(--accent-green)' }}>✓</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={(e) => { e.stopPropagation(); onEdit(c.id) }} title="編輯"
                    style={{ background: 'transparent', border: '1px solid var(--border-medium)', borderRadius: 6, padding: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    <Edit2 size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(c.id, c.name) }} title="刪除"
                    style={{ background: 'transparent', border: '1px solid var(--accent-red-dim)', borderRadius: 6, padding: 6, cursor: 'pointer', color: 'var(--accent-red)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
