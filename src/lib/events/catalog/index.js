import { FINANCE_EVENTS } from './finance.events.js'
import { HR_EVENTS } from './hr.events.js'
import { LMS_EVENTS } from './lms.events.js'
import { WORKFLOW_EVENTS } from './workflow.events.js'
import { APPROVAL_EVENTS } from './approval.events.js'

export const EVENT_CATALOG = {
  ...FINANCE_EVENTS,
  ...HR_EVENTS,
  ...LMS_EVENTS,
  ...WORKFLOW_EVENTS,
  ...APPROVAL_EVENTS,
}
