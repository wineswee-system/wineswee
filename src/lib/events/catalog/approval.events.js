// Type-agnostic approval chain events.
// These cover the mechanics of multi-step sign-off chains regardless of
// which HR/purchase form is being approved.
//
// Concrete domain outcomes (hr.leave.approved, purchase.po.approved, etc.)
// live in their respective domain catalog files.
export const APPROVAL_EVENTS = {
  'approval.step.approved': {
    domain: 'approval',
    action: 'step.approved',
    version: 1,
    description: '簽核鏈某一關核准',
    payload: {
      instance_id:   { type: 'string', required: true },
      step_id:       { type: 'string', required: true },
      step_order:    { type: 'number', required: true },
      template_name: { type: 'string', required: true },
      approver_id:   { type: 'string', required: true },
      approver:      { type: 'string', required: true },
      comment:       { type: 'string', required: false },
    },
  },

  'approval.step.rejected': {
    domain: 'approval',
    action: 'step.rejected',
    version: 1,
    description: '簽核鏈某一關退回',
    payload: {
      instance_id:   { type: 'string', required: true },
      step_id:       { type: 'string', required: true },
      step_order:    { type: 'number', required: true },
      template_name: { type: 'string', required: true },
      approver_id:   { type: 'string', required: true },
      approver:      { type: 'string', required: true },
      reason:        { type: 'string', required: false },
    },
  },

  'approval.chain.advanced': {
    domain: 'approval',
    action: 'chain.advanced',
    version: 1,
    description: '簽核鏈推進到下一關',
    payload: {
      instance_id:     { type: 'string', required: true },
      template_name:   { type: 'string', required: true },
      next_step_id:    { type: 'string', required: true },
      next_step_order: { type: 'number', required: true },
      next_approver_id: { type: 'string', required: false },
      next_approver:   { type: 'string', required: false },
    },
  },

  'approval.completed': {
    domain: 'approval',
    action: 'completed',
    version: 1,
    description: '簽核鏈全數核准完成',
    payload: {
      instance_id:   { type: 'string', required: true },
      template_name: { type: 'string', required: true },
      requester_id:  { type: 'string', required: true },
      requester:     { type: 'string', required: true },
    },
  },

  'approval.rejected': {
    domain: 'approval',
    action: 'rejected',
    version: 1,
    description: '簽核鏈退回（整體駁回）',
    payload: {
      instance_id:   { type: 'string', required: true },
      template_name: { type: 'string', required: true },
      requester_id:  { type: 'string', required: true },
      requester:     { type: 'string', required: true },
      reason:        { type: 'string', required: false },
    },
  },
}
