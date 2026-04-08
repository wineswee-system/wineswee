import React, { lazy, Suspense, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { TenantProvider } from './contexts/TenantContext'
import Sidebar from './components/Sidebar'
import OnboardingWizard from './components/OnboardingWizard'
import LoadingSpinner from './components/LoadingSpinner'

// Lazy load all page components
const DemoLanding = lazy(() => import('./pages/DemoLanding'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Analytics = lazy(() => import('./pages/Analytics'))
const HRReport = lazy(() => import('./pages/hr/HRReport'))
const Attendance = lazy(() => import('./pages/hr/Attendance'))
const Leave = lazy(() => import('./pages/hr/Leave'))
const Overtime = lazy(() => import('./pages/hr/Overtime'))
const Salary = lazy(() => import('./pages/hr/Salary'))
const Schedule = lazy(() => import('./pages/hr/Schedule'))
const Holidays = lazy(() => import('./pages/hr/Holidays'))
const ScheduleRules = lazy(() => import('./pages/hr/ScheduleRules'))
const Performance = lazy(() => import('./pages/hr/Performance'))
const Recruitment = lazy(() => import('./pages/hr/Recruitment'))
const Documents = lazy(() => import('./pages/hr/Documents'))
const Transfer = lazy(() => import('./pages/hr/Transfer'))
const Bonus = lazy(() => import('./pages/hr/Bonus'))
const BusinessTravel = lazy(() => import('./pages/hr/BusinessTravel'))
const Expenses = lazy(() => import('./pages/hr/Expenses'))
const ProcessOverview = lazy(() => import('./pages/process/Overview'))
const Workflows = lazy(() => import('./pages/process/Workflows'))
const Tasks = lazy(() => import('./pages/process/Tasks'))
const Checklists = lazy(() => import('./pages/process/Checklists'))
const SOPTemplates = lazy(() => import('./pages/process/SOPTemplates'))
const OrgOverview = lazy(() => import('./pages/org/Overview'))
const OrgChart = lazy(() => import('./pages/org/OrgChart'))
const Companies = lazy(() => import('./pages/org/Companies'))
const Locations = lazy(() => import('./pages/org/Locations'))
const Departments = lazy(() => import('./pages/org/Departments'))
const Employees = lazy(() => import('./pages/org/Employees'))
const LineIntegration = lazy(() => import('./pages/org/LineIntegration'))
const Templates = lazy(() => import('./pages/org/Templates'))
const Triggers = lazy(() => import('./pages/system/Triggers'))
const Notifications = lazy(() => import('./pages/system/Notifications'))
const Users = lazy(() => import('./pages/system/Users'))
const AuditLog = lazy(() => import('./pages/system/AuditLog'))
const PerformanceMgmt = lazy(() => import('./pages/system/PerformanceMgmt'))
const SystemSettings = lazy(() => import('./pages/system/Settings'))
const HelpCenter = lazy(() => import('./pages/ai/HelpCenter'))
const AgentConsole = lazy(() => import('./pages/ai/AgentConsole'))
const CRMOverview = lazy(() => import('./pages/crm/Overview'))
const Customers = lazy(() => import('./pages/crm/Customers'))
const Pipeline = lazy(() => import('./pages/crm/Pipeline'))
const CRMMarketing = lazy(() => import('./pages/crm/Marketing'))
const CRMService = lazy(() => import('./pages/crm/Service'))
const WMSOverview = lazy(() => import('./pages/wms/Overview'))
const SKUs = lazy(() => import('./pages/wms/SKUs'))
const Inbound = lazy(() => import('./pages/wms/Inbound'))
const Inventory = lazy(() => import('./pages/wms/Inventory'))
const Outbound = lazy(() => import('./pages/wms/Outbound'))
const WMSReports = lazy(() => import('./pages/wms/Reports'))
const PortalLayout = lazy(() => import('./pages/portal/PortalLayout'))
const PortalHome = lazy(() => import('./pages/portal/PortalHome'))
const Suppliers = lazy(() => import('./pages/purchase/Suppliers'))
const PurchaseRequests = lazy(() => import('./pages/purchase/PurchaseRequests'))
const PurchaseOrders = lazy(() => import('./pages/purchase/PurchaseOrders'))
const GoodsReceipts = lazy(() => import('./pages/purchase/GoodsReceipts'))
const ProcurementPipeline = lazy(() => import('./pages/purchase/ProcurementPipeline'))
const ProcurementWorkflow = lazy(() => import('./pages/purchase/ProcurementWorkflow'))
const ThreeWayMatch = lazy(() => import('./pages/purchase/ThreeWayMatch'))
const FinanceOverview = lazy(() => import('./pages/finance/Overview'))
const JournalEntries = lazy(() => import('./pages/finance/JournalEntries'))
const AccountsReceivable = lazy(() => import('./pages/finance/AccountsReceivable'))
const AccountsPayable = lazy(() => import('./pages/finance/AccountsPayable'))
const BOM = lazy(() => import('./pages/manufacturing/BOM'))
const MRP = lazy(() => import('./pages/manufacturing/MRP'))
const QualityInspection = lazy(() => import('./pages/manufacturing/QualityInspection'))
const Contracts = lazy(() => import('./pages/purchase/Contracts'))
const VendorCategories = lazy(() => import('./pages/purchase/VendorCategories'))
const VendorPerformance = lazy(() => import('./pages/purchase/VendorPerformance'))
const VendorOnboarding = lazy(() => import('./pages/purchase/VendorOnboarding'))
const Budgets = lazy(() => import('./pages/finance/Budgets'))
const BankReconciliation = lazy(() => import('./pages/finance/BankReconciliation'))
const ManufacturingOrders = lazy(() => import('./pages/manufacturing/ManufacturingOrders'))
const Valuation = lazy(() => import('./pages/wms/Valuation'))
const Lots = lazy(() => import('./pages/wms/Lots'))
const StockCount = lazy(() => import('./pages/wms/StockCount'))
const SalesOverview = lazy(() => import('./pages/sales/Overview'))
const Quotations = lazy(() => import('./pages/sales/Quotations'))
const SalesOrders = lazy(() => import('./pages/sales/SalesOrders'))
const Promotions = lazy(() => import('./pages/sales/Promotions'))
const Returns = lazy(() => import('./pages/sales/Returns'))
const POSOverview = lazy(() => import('./pages/pos/Overview'))
const POSTerminal = lazy(() => import('./pages/pos/POSTerminal'))
const POSShifts = lazy(() => import('./pages/pos/POSShifts'))
const Shipments = lazy(() => import('./pages/sales/Shipments'))
const Members = lazy(() => import('./pages/crm/Members'))
const Invoices = lazy(() => import('./pages/finance/Invoices'))
const TrialBalance = lazy(() => import('./pages/finance/TrialBalance'))
const BalanceSheet = lazy(() => import('./pages/finance/BalanceSheet'))
const ProfitLoss = lazy(() => import('./pages/finance/ProfitLoss'))
const TaxReports = lazy(() => import('./pages/finance/TaxReports'))
const FixedAssets = lazy(() => import('./pages/finance/FixedAssets'))
const MessageLog = lazy(() => import('./pages/crm/MessageLog'))
const DripCampaigns = lazy(() => import('./pages/crm/DripCampaigns'))
const FormBuilder = lazy(() => import('./pages/crm/FormBuilder'))
const WorkflowBuilder = lazy(() => import('./pages/crm/WorkflowBuilder'))
const SalesForecast = lazy(() => import('./pages/analytics/SalesForecast'))
const FinanceAnalytics = lazy(() => import('./pages/analytics/FinanceAnalytics'))
const HRAnalytics = lazy(() => import('./pages/analytics/HRAnalytics'))
const InventoryAnalytics = lazy(() => import('./pages/analytics/InventoryAnalytics'))
const POSAnalytics = lazy(() => import('./pages/analytics/POSAnalytics'))
const ManufacturingAnalytics = lazy(() => import('./pages/analytics/ManufacturingAnalytics'))
const SalesPerformance = lazy(() => import('./pages/analytics/SalesPerformance'))
const ScheduledReports = lazy(() => import('./pages/analytics/ScheduledReports'))
const DashboardBuilder = lazy(() => import('./pages/analytics/DashboardBuilder'))
const AnomalyDetection = lazy(() => import('./pages/analytics/AnomalyDetection'))
const EmbeddableCharts = lazy(() => import('./pages/analytics/EmbeddableCharts'))
const ProcessAnalytics = lazy(() => import('./pages/analytics/ProcessAnalytics'))
const CrossSystemAnalytics = lazy(() => import('./pages/analytics/CrossSystemAnalytics'))
const LaborInspection = lazy(() => import('./pages/hr/LaborInspection'))
const TaxFiling = lazy(() => import('./pages/finance/TaxFiling'))
const TaxReport = lazy(() => import('./pages/finance/TaxReport'))
const ExchangeRates = lazy(() => import('./pages/finance/ExchangeRates'))
const CostCenters = lazy(() => import('./pages/finance/CostCenters'))
const CashFlow = lazy(() => import('./pages/finance/CashFlow'))
const ShopFloor = lazy(() => import('./pages/manufacturing/ShopFloor'))
const WorkCenters = lazy(() => import('./pages/manufacturing/WorkCenters'))
const Scheduling = lazy(() => import('./pages/manufacturing/Scheduling'))
const PricingRules = lazy(() => import('./pages/sales/PricingRules'))
const BlanketOrders = lazy(() => import('./pages/purchase/BlanketOrders'))
const Segments = lazy(() => import('./pages/crm/Segments'))
const Bins = lazy(() => import('./pages/wms/Bins'))
const PickPackShip = lazy(() => import('./pages/wms/PickPackShip'))
const ApprovalRules = lazy(() => import('./pages/system/ApprovalRules'))
const ApprovalChains = lazy(() => import('./pages/system/ApprovalChains'))
const Subcontracting = lazy(() => import('./pages/manufacturing/Subcontracting'))
const PeriodClose = lazy(() => import('./pages/finance/PeriodClose'))
const Training = lazy(() => import('./pages/hr/Training'))
const Transfers = lazy(() => import('./pages/wms/Transfers'))
const Commission = lazy(() => import('./pages/sales/Commission'))
const Customer360 = lazy(() => import('./pages/crm/Customer360'))
const CarrierIntegration = lazy(() => import('./pages/integration/CarrierIntegration'))
const TenantAdmin = lazy(() => import('./pages/system/TenantAdmin'))
const DataImportExport = lazy(() => import('./pages/system/DataImportExport'))
const DatabaseAdmin = lazy(() => import('./pages/system/DatabaseAdmin'))
const Ecommerce = lazy(() => import('./pages/integration/Ecommerce'))
const APIDocumentation = lazy(() => import('./pages/integration/APIDocumentation'))
const WenzhongImport = lazy(() => import('./pages/integration/WenzhongImport'))
const Tutorial = lazy(() => import('./pages/ai/Tutorial'))
const SuperAdminOrg = lazy(() => import('./pages/super-admin/OrgManagement'))
const SuperAdminUsers = lazy(() => import('./pages/super-admin/UserConfig'))
const SuperAdminModules = lazy(() => import('./pages/super-admin/ModuleConfig'))
const LiffClockIn = lazy(() => import('./pages/liff/LiffClockIn'))

function AdminApp() {
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('sme_onboarded'))

  return (
    <div className="app-layout">
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <Sidebar />
      <main className="main-content">
        <div className="page-container">
          <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/forecast" element={<SalesForecast />} />
            <Route path="/analytics/finance" element={<Suspense fallback={<LoadingSpinner />}><FinanceAnalytics /></Suspense>} />
            <Route path="/analytics/hr" element={<Suspense fallback={<LoadingSpinner />}><HRAnalytics /></Suspense>} />
            <Route path="/analytics/inventory" element={<Suspense fallback={<LoadingSpinner />}><InventoryAnalytics /></Suspense>} />
            <Route path="/analytics/pos" element={<Suspense fallback={<LoadingSpinner />}><POSAnalytics /></Suspense>} />
            <Route path="/analytics/manufacturing" element={<Suspense fallback={<LoadingSpinner />}><ManufacturingAnalytics /></Suspense>} />
            <Route path="/analytics/sales" element={<Suspense fallback={<LoadingSpinner />}><SalesPerformance /></Suspense>} />
            <Route path="/analytics/reports" element={<Suspense fallback={<LoadingSpinner />}><ScheduledReports /></Suspense>} />
            <Route path="/analytics/builder" element={<Suspense fallback={<LoadingSpinner />}><DashboardBuilder /></Suspense>} />
            <Route path="/analytics/anomaly" element={<Suspense fallback={<LoadingSpinner />}><AnomalyDetection /></Suspense>} />
            <Route path="/analytics/embed" element={<Suspense fallback={<LoadingSpinner />}><EmbeddableCharts /></Suspense>} />
            <Route path="/analytics/process" element={<Suspense fallback={<LoadingSpinner />}><ProcessAnalytics /></Suspense>} />
            <Route path="/analytics/cross-system" element={<Suspense fallback={<LoadingSpinner />}><CrossSystemAnalytics /></Suspense>} />
            {/* HR */}
            <Route path="/hr/report" element={<HRReport />} />
            <Route path="/hr/attendance" element={<Attendance />} />
            <Route path="/hr/leave" element={<Leave />} />
            <Route path="/hr/overtime" element={<Overtime />} />
            <Route path="/hr/salary" element={<Salary />} />
            <Route path="/hr/schedule" element={<Schedule />} />
            <Route path="/hr/holidays" element={<Holidays />} />
            <Route path="/hr/schedule-rules" element={<ScheduleRules />} />
            <Route path="/hr/performance" element={<Performance />} />
            <Route path="/hr/recruitment" element={<Recruitment />} />
            <Route path="/hr/documents" element={<Documents />} />
            <Route path="/hr/transfer" element={<Transfer />} />
            <Route path="/hr/travel" element={<BusinessTravel />} />
            <Route path="/hr/expenses" element={<Expenses />} />
            <Route path="/hr/bonus" element={<Bonus />} />
            <Route path="/hr/labor-inspection" element={<Suspense fallback={<LoadingSpinner />}><LaborInspection /></Suspense>} />
            <Route path="/hr/training" element={<Suspense fallback={<LoadingSpinner />}><Training /></Suspense>} />
            {/* Process */}
            <Route path="/process/overview" element={<ProcessOverview />} />
            <Route path="/process/workflows" element={<Workflows />} />
            <Route path="/process/tasks" element={<Tasks />} />
            <Route path="/process/checklists" element={<Checklists />} />
            <Route path="/process/sop" element={<SOPTemplates />} />
            {/* Organization */}
            <Route path="/org/overview" element={<OrgOverview />} />
            <Route path="/org/chart" element={<OrgChart />} />
            <Route path="/org/companies" element={<Companies />} />
            <Route path="/org/locations" element={<Locations />} />
            <Route path="/org/departments" element={<Departments />} />
            <Route path="/org/employees" element={<Employees />} />
            <Route path="/org/line" element={<LineIntegration />} />
            <Route path="/org/templates" element={<Templates />} />
            {/* System */}
            <Route path="/system/triggers" element={<Triggers />} />
            <Route path="/system/notifications" element={<Notifications />} />
            <Route path="/system/users" element={<Users />} />
            <Route path="/system/audit" element={<AuditLog />} />
            <Route path="/system/performance" element={<PerformanceMgmt />} />
            <Route path="/system/settings" element={<SystemSettings />} />
            <Route path="/system/import-export" element={<DataImportExport />} />
            <Route path="/system/database" element={<DatabaseAdmin />} />
            <Route path="/system/tenants" element={<Suspense fallback={<LoadingSpinner />}><TenantAdmin /></Suspense>} />
            <Route path="/system/approval-rules" element={<Suspense fallback={<LoadingSpinner />}><ApprovalRules /></Suspense>} />
            <Route path="/system/approval-chains" element={<Suspense fallback={<LoadingSpinner />}><ApprovalChains /></Suspense>} />
            {/* AI */}
            <Route path="/ai/help" element={<HelpCenter />} />
            <Route path="/ai/agent" element={<AgentConsole />} />
            <Route path="/ai/tutorial" element={<Tutorial />} />
            {/* Integration */}
            <Route path="/integration/ecommerce" element={<Ecommerce />} />
            <Route path="/integration/wenzhong" element={<WenzhongImport />} />
            <Route path="/integration/api" element={<APIDocumentation />} />
            <Route path="/integration/carriers" element={<Suspense fallback={<LoadingSpinner />}><CarrierIntegration /></Suspense>} />
            {/* CRM */}
            <Route path="/crm/overview" element={<CRMOverview />} />
            <Route path="/crm/customers" element={<Customers />} />
            <Route path="/crm/pipeline" element={<Pipeline />} />
            <Route path="/crm/marketing" element={<CRMMarketing />} />
            <Route path="/crm/drip-campaigns" element={<Suspense fallback={<LoadingSpinner />}><DripCampaigns /></Suspense>} />
            <Route path="/crm/service" element={<CRMService />} />
            <Route path="/crm/members" element={<Members />} />
            <Route path="/crm/forms" element={<Suspense fallback={<LoadingSpinner />}><FormBuilder /></Suspense>} />
            <Route path="/crm/workflows" element={<Suspense fallback={<LoadingSpinner />}><WorkflowBuilder /></Suspense>} />
            <Route path="/crm/messages" element={<Suspense fallback={<LoadingSpinner />}><MessageLog /></Suspense>} />
            <Route path="/crm/segments" element={<Suspense fallback={<LoadingSpinner />}><Segments /></Suspense>} />
            <Route path="/crm/customer-360" element={<Suspense fallback={<LoadingSpinner />}><Customer360 /></Suspense>} />
            {/* WMS */}
            <Route path="/wms/overview" element={<WMSOverview />} />
            <Route path="/wms/skus" element={<SKUs />} />
            <Route path="/wms/inbound" element={<Inbound />} />
            <Route path="/wms/inventory" element={<Inventory />} />
            <Route path="/wms/outbound" element={<Outbound />} />
            <Route path="/wms/reports" element={<WMSReports />} />
            <Route path="/wms/lots" element={<Lots />} />
            <Route path="/wms/stock-count" element={<StockCount />} />
            <Route path="/wms/valuation" element={<Valuation />} />
            <Route path="/wms/bins" element={<Suspense fallback={<LoadingSpinner />}><Bins /></Suspense>} />
            <Route path="/wms/pick-pack-ship" element={<Suspense fallback={<LoadingSpinner />}><PickPackShip /></Suspense>} />
            <Route path="/wms/transfers" element={<Suspense fallback={<LoadingSpinner />}><Transfers /></Suspense>} />
            {/* Sales */}
            <Route path="/sales" element={<Suspense fallback={<LoadingSpinner />}><SalesOverview /></Suspense>} />
            <Route path="/sales/quotations" element={<Quotations />} />
            <Route path="/sales/orders" element={<SalesOrders />} />
            <Route path="/sales/promotions" element={<Promotions />} />
            <Route path="/sales/returns" element={<Returns />} />
            <Route path="/sales/shipments" element={<Shipments />} />
            <Route path="/sales/pricing" element={<Suspense fallback={<LoadingSpinner />}><PricingRules /></Suspense>} />
            <Route path="/sales/commission" element={<Suspense fallback={<LoadingSpinner />}><Commission /></Suspense>} />
            {/* POS */}
            <Route path="/pos" element={<Suspense fallback={<LoadingSpinner />}><POSOverview /></Suspense>} />
            <Route path="/pos/terminal" element={<POSTerminal />} />
            <Route path="/pos/shifts" element={<POSShifts />} />
            {/* Purchase */}
            <Route path="/purchase/suppliers" element={<Suppliers />} />
            <Route path="/purchase/categories" element={<VendorCategories />} />
            <Route path="/purchase/performance" element={<VendorPerformance />} />
            <Route path="/purchase/onboarding" element={<VendorOnboarding />} />
            <Route path="/purchase/requests" element={<PurchaseRequests />} />
            <Route path="/purchase/orders" element={<PurchaseOrders />} />
            <Route path="/purchase/receipts" element={<GoodsReceipts />} />
            <Route path="/purchase/contracts" element={<Contracts />} />
            <Route path="/purchase/pipeline" element={<ProcurementPipeline />} />
            <Route path="/purchase/workflow" element={<ProcurementWorkflow />} />
            <Route path="/purchase/matching" element={<ThreeWayMatch />} />
            <Route path="/purchase/blanket" element={<Suspense fallback={<LoadingSpinner />}><BlanketOrders /></Suspense>} />
            {/* Finance */}
            <Route path="/finance/overview" element={<FinanceOverview />} />
            <Route path="/finance/journal" element={<JournalEntries />} />
            <Route path="/finance/ar" element={<AccountsReceivable />} />
            <Route path="/finance/ap" element={<AccountsPayable />} />
            <Route path="/finance/budgets" element={<Budgets />} />
            <Route path="/finance/bank" element={<BankReconciliation />} />
            <Route path="/finance/invoices" element={<Invoices />} />
            <Route path="/finance/trial-balance" element={<Suspense fallback={<LoadingSpinner />}><TrialBalance /></Suspense>} />
            <Route path="/finance/balance-sheet" element={<Suspense fallback={<LoadingSpinner />}><BalanceSheet /></Suspense>} />
            <Route path="/finance/profit-loss" element={<Suspense fallback={<LoadingSpinner />}><ProfitLoss /></Suspense>} />
            <Route path="/finance/tax-reports" element={<Suspense fallback={<LoadingSpinner />}><TaxReports /></Suspense>} />
            <Route path="/finance/fixed-assets" element={<Suspense fallback={<LoadingSpinner />}><FixedAssets /></Suspense>} />
            <Route path="/finance/tax-filing" element={<Suspense fallback={<LoadingSpinner />}><TaxFiling /></Suspense>} />
            <Route path="/finance/tax-report" element={<Suspense fallback={<LoadingSpinner />}><TaxReport /></Suspense>} />
            <Route path="/finance/exchange-rates" element={<Suspense fallback={<LoadingSpinner />}><ExchangeRates /></Suspense>} />
            <Route path="/finance/cost-centers" element={<Suspense fallback={<LoadingSpinner />}><CostCenters /></Suspense>} />
            <Route path="/finance/cash-flow" element={<Suspense fallback={<LoadingSpinner />}><CashFlow /></Suspense>} />
            <Route path="/finance/period-close" element={<Suspense fallback={<LoadingSpinner />}><PeriodClose /></Suspense>} />
            {/* Manufacturing & QM */}
            <Route path="/manufacturing/bom" element={<BOM />} />
            <Route path="/manufacturing/mrp" element={<MRP />} />
            <Route path="/manufacturing/qm" element={<QualityInspection />} />
            <Route path="/manufacturing/orders" element={<ManufacturingOrders />} />
            <Route path="/manufacturing/shop-floor" element={<Suspense fallback={<LoadingSpinner />}><ShopFloor /></Suspense>} />
            <Route path="/manufacturing/work-centers" element={<Suspense fallback={<LoadingSpinner />}><WorkCenters /></Suspense>} />
            <Route path="/manufacturing/scheduling" element={<Suspense fallback={<LoadingSpinner />}><Scheduling /></Suspense>} />
            <Route path="/manufacturing/subcontracting" element={<Suspense fallback={<LoadingSpinner />}><Subcontracting /></Suspense>} />
            {/* Super Admin */}
            <Route path="/super-admin/orgs" element={<Suspense fallback={<LoadingSpinner />}><SuperAdminOrg /></Suspense>} />
            <Route path="/super-admin/users" element={<Suspense fallback={<LoadingSpinner />}><SuperAdminUsers /></Suspense>} />
            <Route path="/super-admin/modules" element={<Suspense fallback={<LoadingSpinner />}><SuperAdminModules /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/demo" element={<DemoLanding />} />
          <Route path="/liff/clock" element={<LiffClockIn />} />
          <Route path="/portal" element={<PortalLayout />}>
            <Route index element={<PortalHome />} />
          </Route>
          <Route path="/*" element={<AdminApp />} />
        </Routes>
        </Suspense>
      </TenantProvider>
    </AuthProvider>
  )
}
