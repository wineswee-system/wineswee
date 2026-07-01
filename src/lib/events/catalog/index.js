import { SALES_EVENTS } from './sales.events.js'
import { PURCHASE_EVENTS } from './purchase.events.js'
import { WMS_EVENTS } from './wms.events.js'
import { FINANCE_EVENTS } from './finance.events.js'
import { MANUFACTURING_EVENTS } from './manufacturing.events.js'
import { HR_EVENTS } from './hr.events.js'
import { CRM_EVENTS } from './crm.events.js'
import { POS_EVENTS } from './pos.events.js'
import { LMS_EVENTS } from './lms.events.js'
import { WORKFLOW_EVENTS } from './workflow.events.js'
import { APPROVAL_EVENTS } from './approval.events.js'
import { DISPATCH_EVENTS } from './dispatch.events.js'

export const EVENT_CATALOG = {
  ...SALES_EVENTS,
  ...PURCHASE_EVENTS,
  ...WMS_EVENTS,
  ...FINANCE_EVENTS,
  ...MANUFACTURING_EVENTS,
  ...HR_EVENTS,
  ...CRM_EVENTS,
  ...POS_EVENTS,
  ...LMS_EVENTS,
  ...WORKFLOW_EVENTS,
  ...APPROVAL_EVENTS,
  ...DISPATCH_EVENTS,
}
