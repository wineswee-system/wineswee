import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/process/Overview'
import Workflows from '../pages/process/Workflows'
import Tasks from '../pages/process/Tasks'
import Checklists from '../pages/process/Checklists'
import SOPTemplates from '../pages/process/SOPTemplates'
import Approvals from '../pages/process/Approvals'
import Projects from '../pages/process/Projects'
import Categories from '../pages/process/settings/Categories'
import Tags from '../pages/process/settings/Tags'

// 老頁面已下架（2026-05-08）：
//   /process/approval-chains  → ApprovalChains.jsx (deleted)
//   /process/expense-approval → ExpenseApprovalSettings.jsx (deleted)
// 替代入口：各表單頁面右上「⚙ 簽核設定」按鈕（透過 ChainConfigModal）

export default function ProcessModule() {
  return (
    <Routes>
      <Route path="overview" element={<Overview />} />
      <Route path="projects" element={<Projects />} />
      <Route path="workflows" element={<Workflows />} />
      <Route path="tasks" element={<Tasks />} />
      <Route path="checklists" element={<Checklists />} />
      <Route path="sop" element={<SOPTemplates />} />
      <Route path="approvals" element={<Approvals />} />
      <Route path="settings/categories" element={<Categories />} />
      <Route path="settings/tags" element={<Tags />} />
    </Routes>
  )
}
