import { memo } from 'react'
import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/finance/Overview'
import JournalEntries from '../pages/finance/JournalEntries'
import AccountsReceivable from '../pages/finance/AccountsReceivable'
import AccountsPayable from '../pages/finance/AccountsPayable'
import Budgets from '../pages/finance/Budgets'
import BankReconciliation from '../pages/finance/BankReconciliation'
import Invoices from '../pages/finance/Invoices'
import TrialBalance from '../pages/finance/TrialBalance'
import BalanceSheet from '../pages/finance/BalanceSheet'
import ProfitLoss from '../pages/finance/ProfitLoss'
import TaxReports from '../pages/finance/TaxReports'
import FixedAssets from '../pages/finance/FixedAssets'
import TaxFiling from '../pages/finance/TaxFiling'
import TaxReport from '../pages/finance/TaxReport'
import ExchangeRates from '../pages/finance/ExchangeRates'
import CostCenters from '../pages/finance/CostCenters'
import CashFlow from '../pages/finance/CashFlow'
import PeriodClose from '../pages/finance/PeriodClose'
import ChartOfAccounts from '../pages/finance/ChartOfAccounts'
import ExpenseRequests from '../pages/finance/ExpenseRequests'
import ExpenseApprovalSettings from '../pages/finance/ExpenseApprovalSettings'

export default memo(function FinanceModule() {
  return (
    <Routes>
      <Route path="overview" element={<Overview />} />
      <Route path="chart-of-accounts" element={<ChartOfAccounts />} />
      <Route path="expense-requests" element={<ExpenseRequests />} />
      <Route path="expense-approval" element={<ExpenseApprovalSettings />} />
      <Route path="journal" element={<JournalEntries />} />
      <Route path="ar" element={<AccountsReceivable />} />
      <Route path="ap" element={<AccountsPayable />} />
      <Route path="budgets" element={<Budgets />} />
      <Route path="bank" element={<BankReconciliation />} />
      <Route path="invoices" element={<Invoices />} />
      <Route path="trial-balance" element={<TrialBalance />} />
      <Route path="balance-sheet" element={<BalanceSheet />} />
      <Route path="profit-loss" element={<ProfitLoss />} />
      <Route path="tax-reports" element={<TaxReports />} />
      <Route path="fixed-assets" element={<FixedAssets />} />
      <Route path="tax-filing" element={<TaxFiling />} />
      <Route path="tax-report" element={<TaxReport />} />
      <Route path="exchange-rates" element={<ExchangeRates />} />
      <Route path="cost-centers" element={<CostCenters />} />
      <Route path="cash-flow" element={<CashFlow />} />
      <Route path="period-close" element={<PeriodClose />} />
    </Routes>
  )
})
