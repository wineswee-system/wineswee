import PermissionFeatureRow from './PermissionFeatureRow'

// Props: module (string), features (array of feature objects),
//        empPerms (permByCode map: code → perm object),
//        onToggle(feature, kind), onReset(feature), savingIds (Set),
//        onModuleSelectAll(features, action), batchSaving (bool)
export default function PermissionModuleSection({
  module,
  features,
  empPerms,
  onToggle,
  onReset,
  savingIds,
  onModuleSelectAll,
  batchSaving,
}) {
  return (
    <div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)',
        letterSpacing: 1, marginBottom: 8, paddingBottom: 6,
        borderBottom: '1px dashed var(--border-medium)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span>{module}</span>
        <button onClick={() => onModuleSelectAll(features, 'grant')}
          disabled={batchSaving}
          title="對此區塊所有功能 一次全部開啟"
          style={{
            fontSize: 12, fontWeight: 500,
            background: 'transparent', border: 'none',
            color: 'var(--text-primary)',
            cursor: batchSaving ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 4px',
            letterSpacing: 'normal',
          }}>
          <span style={{
            width: 14, height: 14, borderRadius: 3,
            border: '1.5px solid var(--text-secondary)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent',
          }} />
          全選
        </button>
        <button onClick={() => onModuleSelectAll(features, 'revoke')}
          disabled={batchSaving}
          title="對此區塊所有功能 一次全部關閉"
          style={{
            fontSize: 12, fontWeight: 500,
            background: 'transparent', border: 'none',
            color: 'var(--text-primary)',
            cursor: batchSaving ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 4px',
            letterSpacing: 'normal',
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
          <PermissionFeatureRow
            key={(f.view || '') + (f.edit || '') + f.label}
            feature={f}
            empPerms={empPerms}
            onToggle={onToggle}
            onReset={onReset}
            savingIds={savingIds}
          />
        ))}
      </div>
    </div>
  )
}
