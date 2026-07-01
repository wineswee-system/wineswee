import { registerFinanceHandlers } from './financeHandlers.js'
import { registerPurchaseHandlers } from './purchaseHandlers.js'
import { registerWMSHandlers } from './wmsHandlers.js'
import { registerCRMHandlers } from './crmHandlers.js'
import { registerPOSHandlers } from './posHandlers.js'
import { registerHRHandlers } from './hrHandlers.js'
import { registerManufacturingHandlers } from './manufacturingHandlers.js'
import { registerSalesHandlers } from './salesHandlers.js'
import { registerLMSHandlers } from './lmsHandlers.js'
import { registerDispatchHandlers } from './dispatchHandlers.js'
// registerWorkflowExecutors 需要 crm_workflows 表；目前環境沒有，先停用避免啟動 404。
// 日後要啟用 CRM 自動化，把下面的 import/call 取消註解，並建好 crm_workflows。
// import { registerWorkflowExecutors } from '../../workflowExecutor.js'

/**
 * Wire up all event handlers on the bus.
 * Call once during app initialization (e.g., in main.jsx).
 *
 * Each domain handler subscribes to cross-module events and produces
 * downstream events, forming event chains that span the entire system.
 *
 * When migrating to Kafka, these handlers become Kafka consumers.
 * The handler code itself does not change — only the transport layer.
 */
export function registerAllHandlers(bus) {
  registerFinanceHandlers(bus)
  registerPurchaseHandlers(bus)
  registerWMSHandlers(bus)
  registerCRMHandlers(bus)
  registerPOSHandlers(bus)
  registerHRHandlers(bus)
  registerManufacturingHandlers(bus)
  registerSalesHandlers(bus)
  registerLMSHandlers(bus)
  registerDispatchHandlers(bus)

  // CRM Workflow Automation — 暫停（依賴不存在的 crm_workflows 表）
  // registerWorkflowExecutors(bus)
}
