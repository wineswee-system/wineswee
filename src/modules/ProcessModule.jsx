import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/process/Overview'
import Workflows from '../pages/process/Workflows'
import Tasks from '../pages/process/Tasks'
import Checklists from '../pages/process/Checklists'
import SOPTemplates from '../pages/process/SOPTemplates'
import ApprovalChains from '../pages/system/ApprovalChains'
import Projects from '../pages/process/Projects'
import ExpenseApprovalSettings from '../pages/finance/ExpenseApprovalSettings'

export default function ProcessModule() {
  return (
    <Routes>
      <Route path="overview" element={<Overview />} />
      <Route path="projects" element={<Projects />} />
      <Route path="workflows" element={<Workflows />} />
      <Route path="tasks" element={<Tasks />} />
      <Route path="checklists" element={<Checklists />} />
      <Route path="sop" element={<SOPTemplates />} />
      <Route path="approval-chains" element={<ApprovalChains />} />
      <Route path="expense-approval" element={<ExpenseApprovalSettings />} />
    </Routes>
  )
}
