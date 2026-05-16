import { RotateCcw } from 'lucide-react'

// source → 顯示文字 & 顏色（exported for use in EmployeePermissions legend）
export const SOURCE_BADGE = {
  role:        { label: '角色預設', color: 'var(--text-muted)',    bg: 'var(--glass-light)' },
  grant:       { label: '手動調整', color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)' },
  role_revoke: { label: '手動調整', color: 'var(--accent-red)',    bg: 'var(--accent-red-dim)' },
  none:        { label: '無',       color: 'var(--text-muted)',    bg: 'transparent' },
}

// Props: feature, empPerms (permByCode map: code → perm object),
//        onToggle(feature, kind), onReset(feature), savingIds (Set of permission_id)
export default function PermissionFeatureRow({ feature: f, empPerms: permByCode, onToggle, onReset, savingIds }) {
  const viewPerm = f.view ? permByCode[f.view] : null
  const editPerm = f.edit ? permByCode[f.edit] : null

  // 任一個 perm 是 override，整個 feature 就標 override 樣式
  const viewIsOverride = viewPerm && (viewPerm.source === 'grant' || viewPerm.source === 'role_revoke')
  const editIsOverride = editPerm && (editPerm.source === 'grant' || editPerm.source === 'role_revoke')
  const isOverride = viewIsOverride || editIsOverride

  // 整 feature 的「主 badge」優先採 edit；沒 edit 就用 view
  const primaryPerm = editPerm || viewPerm
  const badge = SOURCE_BADGE[primaryPerm?.source] || SOURCE_BADGE.none
  const saving = (viewPerm && savingIds.has(viewPerm.permission_id))
              || (editPerm && savingIds.has(editPerm.permission_id))

  const featureKey = (viewPerm?.permission_id || editPerm?.permission_id) + '-' + (f.label || '')

  return (
    <div key={featureKey} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 8,
      background: isOverride ? badge.bg : 'transparent',
      border: `1px solid ${isOverride ? badge.color : 'var(--border-subtle)'}`,
    }}>
      {/* feature label + 對應 perm code */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
      </div>

      {/* 查詢 button（只有 view perm 才顯示）*/}
      {viewPerm && (
        <button onClick={() => onToggle(f, 'view')} disabled={saving}
          style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
            border: `1.5px solid ${viewPerm.effective ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
            background: viewPerm.effective ? 'var(--accent-cyan)' : 'transparent',
            color: viewPerm.effective ? '#fff' : 'var(--text-muted)',
            minWidth: 56,
          }}>
          {viewPerm.effective ? '✓ 查詢' : '查詢'}
        </button>
      )}

      {/* 修改 button（只有 edit perm 才顯示，跟查詢同色系青色）*/}
      {editPerm && (
        <button onClick={() => onToggle(f, 'edit')} disabled={saving}
          style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
            border: `1.5px solid ${editPerm.effective ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
            background: editPerm.effective ? 'var(--accent-cyan)' : 'transparent',
            color: editPerm.effective ? '#fff' : 'var(--text-muted)',
            minWidth: 56,
          }}>
          {editPerm.effective ? '✓ 修改' : '修改'}
        </button>
      )}

      {/* badge：override 顯示「日期 手動調整」；非 override 顯示「角色預設」「無」*/}
      {(() => {
        const overridePerm = [viewPerm, editPerm].find(p =>
          p && (p.source === 'grant' || p.source === 'role_revoke')
        )
        if (overridePerm) {
          let dateText = ''
          if (overridePerm.override_at) {
            const d = new Date(overridePerm.override_at)
            const pad = n => String(n).padStart(2, '0')
            dateText = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} `
          }
          return (
            <span style={{
              fontSize: 10, fontWeight: 600,
              padding: '2px 8px', borderRadius: 4,
              color: badge.color, background: badge.bg,
              border: `1px solid ${badge.color}`,
              whiteSpace: 'nowrap',
            }}>
              {dateText}手動調整
            </span>
          )
        }
        // 非 override：顯示「角色預設」/「無」
        return (
          <span style={{
            fontSize: 10, fontWeight: 600,
            padding: '2px 8px', borderRadius: 4,
            color: badge.color, background: badge.bg,
            border: `1px solid ${badge.color}`,
            whiteSpace: 'nowrap',
          }}>
            {badge.label}
          </span>
        )
      })()}

      {/* reset button */}
      {isOverride && (
        <button onClick={() => onReset(f)}
          title="重置為角色預設"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 2,
          }}>
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  )
}
