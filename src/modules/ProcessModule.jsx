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
import Chains from '../pages/process/settings/Chains'
import ExpenseChains from '../pages/process/settings/ExpenseChains'

// 老頁面已下架（2026-05-08），但 2026-05-11 重做為中央 library 管理：
//   /process/settings/chains         → 全 chain library（取代舊 /process/approval-chains）
//   /process/settings/expense-chains → 費用金額分流（取代舊 /process/expense-approval）
// 各表單頁右上「⚙ 簽核設定」按鈕仍可用（per-form 快捷入口）。

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
      <Route path="settings/chains" element={<Chains />} />
      <Route path="settings/expense-chains" element={<ExpenseChains />} />
    </Routes>
  )
}
