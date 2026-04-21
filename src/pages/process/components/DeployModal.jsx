import { Rocket } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'

// 步驟角色 → 部門名稱的對應表（支援模糊匹配）
const ROLE_DEPT_MAP = {
  '人資部': ['人力資源部', '人資部'],
  'HR': ['人力資源部', '人資部'],
  '管理部': ['總務部', '管理部'],
  'IT': ['總務部', '管理部'],
  '財務部': ['財務部'],
  '倉儲物流部': ['倉儲物流部'],
  '採購部': ['採購部'],
  '營運部': ['營運部'],
  '品牌行銷部': ['品牌行銷部'],
  '行銷部': ['品牌行銷部'],
  '展店事業部': ['加盟展店事業部'],
  '加盟展店事業部': ['加盟展店事業部'],
  '總經理室': ['總經理室'],
}

function getMatchingEmployees(role, employees, departments) {
  if (!role) return { matched: [], others: employees }

  // 1. 直接查 ROLE_DEPT_MAP
  const deptNames = ROLE_DEPT_MAP[role] || []

  // 2. 找匹配的部門 ID
  const matchDeptIds = departments
    .filter(d => deptNames.includes(d.name) || d.name.includes(role) || role.includes(d.name))
    .map(d => d.id)

  // 3. 角色是「主管」「店長」「督導」→ 找 is_manager 或 position 含對應字
  const isManagerRole = ['主管', '店長', '督導', '組長'].some(k => role.includes(k))

  const matched = []
  const others = []

  for (const emp of employees) {
    const deptMatch = matchDeptIds.length > 0 && (
      matchDeptIds.includes(emp.department_id) ||
      deptNames.some(n => n === emp.dept)
    )
    const posMatch = isManagerRole && (
      emp.is_manager ||
      emp.position?.includes('主管') ||
      emp.position?.includes('店長') ||
      emp.position?.includes('督導') ||
      emp.position?.includes('組長') ||
      emp.position?.includes('經理')
    )

    if (deptMatch || posMatch) {
      matched.push(emp)
    } else {
      others.push(emp)
    }
  }

  return { matched, others }
}

export default function DeployModal({
  deployTemplate, deployForm, setDeployForm, deployResult, deploying,
  stores, employees, departments,
  onDeploy, onClose,
}) {
  const getDeptName = (emp) => {
    return departments.find(d => d.id === emp.department_id)?.name || emp.dept || ''
  }

  const renderOption = (emp) => {
    const dept = getDeptName(emp)
    return (
      <option key={emp.id} value={emp.name}>
        {emp.name}｜{emp.position}{dept ? `（${dept}）` : ''}
      </option>
    )
  }

  return (
    <Modal title={`🚀 部署「${deployTemplate.name}」`} onClose={onClose}
      onSubmit={deployResult ? onClose : onDeploy}
      submitLabel={deployResult ? '完成' : deploying ? '部署中...' : '確認部署'}>
      {deployResult ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            已為 <strong>{deployResult.location}</strong> 建立 <strong>{deployResult.count}</strong> 個任務
          </div>
        </div>
      ) : (
        <>
          <Field label="部署到哪個分店 *">
            <select className="form-input" style={{ width: '100%' }} value={deployForm.location} onChange={e => setDeployForm(f => ({ ...f, location: e.target.value }))}>
              <option value="">請選擇分店</option>
              {stores.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </Field>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>指派負責人</div>
          {(deployTemplate.steps || []).map((step, i) => {
            const { matched, others } = getMatchingEmployees(step.role, employees, departments)
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}：{step.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>預設角色：{step.role || '-'}</div>
                </div>
                <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={deployForm.assignees[i] || ''}
                  onChange={e => setDeployForm(f => ({ ...f, assignees: { ...f.assignees, [i]: e.target.value } }))}>
                  <option value="">請選擇</option>
                  {matched.length > 0 && (
                    <optgroup label={`✦ 建議（${step.role}）`}>
                      {matched.map(renderOption)}
                    </optgroup>
                  )}
                  {others.length > 0 && (
                    <optgroup label="其他員工">
                      {others.map(renderOption)}
                    </optgroup>
                  )}
                </select>
              </div>
            )
          })}
        </>
      )}
    </Modal>
  )
}
