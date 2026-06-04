export const WORKFLOW_EVENTS = {
  // ── Run lifecycle ──

  'workflow.run.started': {
    domain: 'workflow',
    action: 'run.started',
    version: 1,
    description: '工作流程執行啟動',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
    },
  },

  'workflow.run.completed': {
    domain: 'workflow',
    action: 'run.completed',
    version: 1,
    description: '工作流程執行完成',
    payload: {
      run_id:      { type: 'string', required: true },
      workflow:    { type: 'string', required: true },
      duration_ms: { type: 'number', required: false },
    },
  },

  'workflow.run.failed': {
    domain: 'workflow',
    action: 'run.failed',
    version: 1,
    description: '工作流程執行失敗',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      error:    { type: 'string', required: true },
    },
  },

  // ── Step lifecycle ──

  'workflow.step.completed': {
    domain: 'workflow',
    action: 'step.completed',
    version: 1,
    description: '工作流程步驟完成',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      step:     { type: 'string', required: true },
      branch:   { type: 'string', required: false },
    },
  },

  'workflow.step.failed': {
    domain: 'workflow',
    action: 'step.failed',
    version: 1,
    description: '工作流程步驟失敗',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      step:     { type: 'string', required: true },
      error:    { type: 'string', required: true },
      branch:   { type: 'string', required: false },
    },
  },

  'workflow.step.skipped': {
    domain: 'workflow',
    action: 'step.skipped',
    version: 1,
    description: '工作流程步驟因條件不符略過',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      step:     { type: 'string', required: true },
      branch:   { type: 'string', required: false },
    },
  },

  // ── Fan-out / fan-in ──

  'workflow.fanout.started': {
    domain: 'workflow',
    action: 'fanout.started',
    version: 1,
    description: 'Fan-out 平行分支啟動',
    payload: {
      run_id:       { type: 'string', required: true },
      workflow:     { type: 'string', required: true },
      branch_count: { type: 'number', required: true },
    },
  },

  'workflow.fanin.completed': {
    domain: 'workflow',
    action: 'fanin.completed',
    version: 1,
    description: 'Fan-in 合流完成',
    payload: {
      run_id:    { type: 'string', required: true },
      workflow:  { type: 'string', required: true },
      strategy:  { type: 'string', required: true },
      succeeded: { type: 'number', required: true },
      failed:    { type: 'number', required: true },
    },
  },
}
