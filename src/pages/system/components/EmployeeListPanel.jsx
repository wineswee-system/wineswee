/**
 * EmployeeListPanel — 員工個別權限頁：左側員工列表與搜尋面板
 * Props: filteredEmployees, search, setSearch, selectedEmp, batchSelectedIds,
 *        onSelectEmp, onToggleBatchSelect, onClearBatch, ROLE_LABEL, roleColor
 */
import { Search } from 'lucide-react'

export default function EmployeeListPanel({
  filteredEmployees,
  search,
  setSearch,
  selectedEmp,
  batchSelectedIds,
  onSelectEmp,
  onToggleBatchSelect,
  onClearBatch,
  ROLE_LABEL,
  roleColor,
}) {
  return (
    <div className="card" style={{
      padding: 0,
      flex: '1 1 280px',
      minWidth: 0,
      maxWidth: 360,
      maxHeight: 'calc(100vh - 220px)',
      overflow: 'auto',
    }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            placeholder="搜尋姓名 (中/英) / 部門 / 職稱"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, fontSize: 13 }}
          />
        </div>
      </div>

      {/* 批次模式提示 + 清空 */}
      {batchSelectedIds.size > 0 && (
        <div style={{
          padding: '8px 12px', background: 'var(--accent-cyan-dim)',
          fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>已勾選 {batchSelectedIds.size} 位（批次操作）</span>
          <button
            onClick={onClearBatch}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent-cyan)', padding: 2 }}>
            清空
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {filteredEmployees.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無員工</div>
        ) : filteredEmployees.map(e => {
          const roleLbl = ROLE_LABEL[e.role] || e.role || '—'
          const isSelected = selectedEmp?.id === e.id
          const isBatchChecked = batchSelectedIds.has(e.id)
          return (
            <div key={e.id}
              style={{
                padding: '10px 14px',
                background: isBatchChecked ? 'var(--accent-cyan-dim)'
                          : isSelected ? 'var(--glass-light)' : 'transparent',
                borderLeft: isSelected || isBatchChecked
                  ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
              {/* checkbox 加入批次 */}
              <input
                type="checkbox"
                checked={isBatchChecked}
                onChange={() => onToggleBatchSelect(e.id)}
                onClick={(ev) => ev.stopPropagation()}
                style={{ cursor: 'pointer', width: 14, height: 14 }}
                title="勾選加入批次操作"
              />
              {/* 點 row 進入單選編輯 */}
              <button
                onClick={() => onSelectEmp(e)}
                style={{
                  flex: 1, textAlign: 'left', border: 'none', cursor: 'pointer',
                  background: 'transparent', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {[e.dept, e.position].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className={`badge ${roleColor[e.role] || 'badge-neutral'}`} style={{ fontSize: 10 }}>{roleLbl}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
