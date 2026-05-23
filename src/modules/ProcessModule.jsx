import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/process/Overview'
import Workflows from '../pages/process/Workflows'
import Tasks from '../pages/process/Tasks'
import Checklists from '../pages/process/Checklists'
import SOPTemplates from '../pages/process/SOPTemplates'
import Approvals from '../pages/process/Approvals'
import TaskConfirmations from '../pages/process/TaskConfirmations'
import Projects from '../pages/process/Projects'
import Categories from '../pages/process/settings/Categories'
import Tags from '../pages/process/settings/Tags'
import Chains from '../pages/process/settings/Chains'
import ExpenseChains from '../pages/process/settings/ExpenseChains'
import ChainEdit from '../pages/process/settings/ChainEdit'
import BusinessApplications from '../pages/process/BusinessApplications'

// 老頁面已下架（2026-05-08），但 2026-05-11 重做為中央 library 管理：
//   /process/settings/chains         → 全 chain library（取代舊 /process/approval-chains）
//   /process/settings/expense-chains → 費用金額分流（取代舊 /process/expense-approval）
//   /process/settings/chains/edit    → 2026-05-13 per-form 簽核設定改頁面（不再 modal）

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
      <Route path="applications" element={<BusinessApplications />} />
      <Route path="task-confirmations" element={<TaskConfirmations />} />
      <Route path="settings/categories" element={<Categories />} />
      <Route path="settings/tags" element={<Tags />} />
      <Route path="settings/chains" element={<Chains />} />
      <Route path="settings/chains/edit" element={<ChainEdit />} />
      <Route path="settings/expense-chains" element={<ExpenseChains />} />
    </Routes>
  )
}
