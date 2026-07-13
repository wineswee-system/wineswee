import { lazy, Suspense } from 'react'
import { Routes, Route, useSearchParams } from 'react-router-dom'
import Overview from '../pages/process/Overview'
import Workflows from '../pages/process/Workflows'
import Tasks from '../pages/process/Tasks'
import Checklists from '../pages/process/Checklists'
import SOPTemplates from '../pages/process/SOPTemplates'
import TemplateLibrary from '../pages/process/TemplateLibrary'
import TemplateStudio from '../pages/process/TemplateStudio'
import ProjectTemplateStudio from '../pages/process/ProjectTemplateStudio'
import Approvals from '../pages/process/Approvals'
import TaskConfirmations from '../pages/process/TaskConfirmations'
import Projects from '../pages/process/Projects'
import Categories from '../pages/process/settings/Categories'
import Tags from '../pages/process/settings/Tags'
import Chains from '../pages/process/settings/Chains'
import ExpenseChains from '../pages/process/settings/ExpenseChains'
import TransferApplyChains from '../pages/process/settings/TransferApplyChains'
import TransferReceiptChains from '../pages/process/settings/TransferReceiptChains'
import ChainEdit from '../pages/process/settings/ChainEdit'
import DelegationRules from '../pages/process/settings/DelegationRules'
import BusinessApplications from '../pages/process/BusinessApplications'
import TransferRequests from '../pages/process/TransferRequests'
import WorkOrders from '../pages/process/WorkOrders'
import StoreAudits from '../pages/workflow/StoreAudits'
import ExpenseRequests from '../pages/workflow/ExpenseRequests'
import Expenses from '../pages/workflow/Expenses'
import CustomFormFill from '../pages/workflow/CustomFormFill'
import FormSubmissions from '../pages/workflow/FormSubmissions'
import LoadingSpinner from '../components/LoadingSpinner'

const ListTemplateStudio = lazy(() => import('../pages/process/ListTemplateStudio'))
const FormTemplateStudio = lazy(() => import('../pages/process/FormTemplateStudio'))

/**
 * SopStudioRouter — dispatches to the correct Studio based on ?type= query param.
 *   ?type=project  → ProjectTemplateStudio
 *   (default)      → TemplateStudio (workflow)
 */
function SopStudioRouter() {
  const [searchParams] = useSearchParams()
  if (searchParams.get('type') === 'project') return <ProjectTemplateStudio />
  return <TemplateStudio />
}

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
      {/* ── SOP範本庫（重設計）── */}
      <Route path="sop" element={<TemplateLibrary />} />
      {/* ?type=project → ProjectTemplateStudio; default → TemplateStudio */}
      <Route path="sop/new" element={<SopStudioRouter />} />
      <Route path="sop/:id/edit" element={<SopStudioRouter />} />
      {/* ── 清單範本 Studio ── */}
      <Route path="sop/list/new"      element={<Suspense fallback={<LoadingSpinner />}><ListTemplateStudio /></Suspense>} />
      <Route path="sop/list/:id/edit" element={<Suspense fallback={<LoadingSpinner />}><ListTemplateStudio /></Suspense>} />
      {/* ── 表單範本 Studio ── */}
      <Route path="sop/form/new"      element={<Suspense fallback={<LoadingSpinner />}><FormTemplateStudio /></Suspense>} />
      <Route path="sop/form/:id/edit" element={<Suspense fallback={<LoadingSpinner />}><FormTemplateStudio /></Suspense>} />
      {/* 保留舊頁備用 */}
      <Route path="sop/legacy" element={<SOPTemplates />} />
      <Route path="approvals" element={<Approvals />} />
      <Route path="applications" element={<BusinessApplications />} />
      <Route path="transfer-requests" element={<TransferRequests />} />
      <Route path="work-orders" element={<WorkOrders />} />
      <Route path="store-audits" element={<StoreAudits />} />
      {/* 業務表單 alias 路由 — 讓頂部 tab 維持「專案流程」 */}
      <Route path="expense-requests" element={<ExpenseRequests />} />
      <Route path="order-requests" element={<ExpenseRequests docType="order" />} />
      <Route path="expenses" element={<Expenses />} />
      <Route path="forms/custom/:templateId" element={<CustomFormFill />} />
      <Route path="forms/submissions" element={<FormSubmissions />} />
      <Route path="task-confirmations" element={<TaskConfirmations />} />
      <Route path="settings/categories" element={<Categories />} />
      <Route path="settings/tags" element={<Tags />} />
      <Route path="settings/chains" element={<Chains />} />
      <Route path="settings/chains/edit" element={<ChainEdit />} />
      <Route path="settings/expense-chains" element={<ExpenseChains />} />
      <Route path="settings/transfer-apply-chains" element={<TransferApplyChains />} />
      <Route path="settings/transfer-receipt-chains" element={<TransferReceiptChains />} />
      <Route path="settings/delegation" element={<DelegationRules />} />
    </Routes>
  )
}
