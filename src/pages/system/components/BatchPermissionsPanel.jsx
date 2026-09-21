/**
 * BatchPermissionsPanel — 員工個別權限頁：批次操作右側面板
 * Props: batchSelectedIds, employees, groupedFeatures, batchSaving,
 *        onBatchResetAll, onModuleSelectAll, onBatchFeatureAction, onBatchFeatureReset
 */
import { RotateCcw, Plus, Minus } from 'lucide-react'

/**
 * 批次模式單一動作的 pill：label + 開/關兩個圓形 icon button
 * 預設淡背景，hover 顯示完整顏色
 */
function BatchActionPill({ label, accent, onOpen, onClose, disabled }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 6px 3px 10px', borderRadius: 14,
      background: 'var(--glass-light)',
      border: `1px solid ${accent}`,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
      <button onClick={onOpen} disabled={disabled}
        title={`對選中員工開啟「${label}」（grant）`}
        style={{
          width: 22, height: 22, borderRadius: '50%', padding: 0,
          border: 'none', background: 'transparent',
          color: 'var(--accent-green)', cursor: disabled ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .12s',
        }}
        onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--accent-green)'; e.currentTarget.style.color = '#fff' } }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent-green)' }}>
        <Plus size={14} strokeWidth={3} />
      </button>
      <button onClick={onClose} disabled={disabled}
        title={`對選中員工關閉「${label}」（revoke）`}
        style={{
          width: 22, height: 22, borderRadius: '50%', padding: 0,
          border: 'none', background: 'transparent',
          color: 'var(--accent-red)', cursor: disabled ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .12s',
        }}
        onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--accent-red)'; e.currentTarget.style.color = '#fff' } }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent-red)' }}>
        <Minus size={14} strokeWidth={3} />
      </button>
    </div>
  )
}

export default function BatchPermissionsPanel({
  batchSelectedIds,
  employees,
  groupedFeatures,
  batchSaving,
  onBatchResetAll,
  onModuleSelectAll,
  onBatchFeatureAction,
  onBatchFeatureReset,
}) {
  return (
    <>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--accent-cyan-dim)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              🔧 批次操作 · 已選 {batchSelectedIds.size} 位員工
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, maxWidth: 600 }}>
              {employees.filter(e => batchSelectedIds.has(e.id)).map(e => e.name).join('、')}
            </div>
          </div>
          <button
            onClick={onBatchResetAll}
            disabled={batchSaving}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: 'transparent', color: 'var(--accent-red)',
              border: '1px solid var(--accent-red)',
              cursor: batchSaving ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
            <RotateCcw size={12} /> 全部恢復角色預設
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
          · 點 <b style={{ color: 'var(--accent-green)' }}>+開</b> 一次對選中員工開啟該權限 · 點 <b style={{ color: 'var(--accent-red)' }}>−關</b> 一次關閉<br />
          · 連動規則同單一模式：開修改自動帶查詢、關查詢自動帶關修改
        </div>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Object.entries(groupedFeatures).map(([module, features]) => (
          <div key={module}>
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)',
              letterSpacing: 1, marginBottom: 8, paddingBottom: 6,
              borderBottom: '1px dashed var(--border-medium)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span>{module}</span>
              <button
                onClick={() => onModuleSelectAll(features, 'grant')}
                disabled={batchSaving}
                title="對此區塊所有功能 一次全部開啟"
                style={{
                  fontSize: 12, fontWeight: 500,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-primary)',
                  cursor: batchSaving ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 4px', letterSpacing: 'normal',
                }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  border: '1.5px solid var(--text-secondary)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                }} />
                全選
              </button>
              <button
                onClick={() => onModuleSelectAll(features, 'revoke')}
                disabled={batchSaving}
                title="對此區塊所有功能 一次全部關閉"
                style={{
                  fontSize: 12, fontWeight: 500,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-primary)',
                  cursor: batchSaving ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 4px', letterSpacing: 'normal',
                }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  border: '1.5px solid var(--text-secondary)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                }} />
                全不選
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {features.map(f => (
                <div key={(f.view || '') + (f.edit || '') + f.label} style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  </div>
                  {f.view && (
                    <BatchActionPill label="查詢" accent="var(--accent-cyan)"
                      onOpen={() => onBatchFeatureAction(f, 'view', 'grant')}
                      onClose={() => onBatchFeatureAction(f, 'view', 'revoke')}
                      disabled={batchSaving} />
                  )}
                  {f.edit && (
                    <BatchActionPill label="修改" accent="var(--accent-orange)"
                      onOpen={() => onBatchFeatureAction(f, 'edit', 'grant')}
                      onClose={() => onBatchFeatureAction(f, 'edit', 'revoke')}
                      disabled={batchSaving} />
                  )}
                  <button
                    onClick={() => onBatchFeatureReset(f)}
                    disabled={batchSaving}
                    title="重置此功能的 override（恢復角色預設）"
                    style={{
                      width: 26, height: 26, borderRadius: '50%', padding: 0,
                      background: 'transparent', border: '1px solid var(--border-medium)',
                      color: 'var(--text-muted)', cursor: batchSaving ? 'wait' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                    <RotateCcw size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
