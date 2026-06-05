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

  'workflow.run.cancelled': {
    domain: 'workflow',
    action: 'run.cancelled',
    version: 1,
    description: '工作流程執行被取消（例如 wait-gate 被拒絕）',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      reason:   { type: 'string', required: true },
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

  // ── Wait-gate ──

  'workflow.gate.opened': {
    domain: 'workflow',
    action: 'gate.opened',
    version: 1,
    description: 'Wait-gate 開啟，等待外部訊號',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      gate_id:  { type: 'string', required: true },
      expects:  { type: 'number', required: true },
    },
  },

  'workflow.gate.signalled': {
    domain: 'workflow',
    action: 'gate.signalled',
    version: 1,
    description: 'Wait-gate 收到一筆外部訊號',
    payload: {
      gate_id:  { type: 'string', required: true },
      received: { type: 'number', required: true },
      expects:  { type: 'number', required: true },
    },
  },

  'workflow.gate.closed': {
    domain: 'workflow',
    action: 'gate.closed',
    version: 1,
    description: 'Wait-gate 收集完所有訊號，工作流程繼續',
    payload: {
      run_id:       { type: 'string', required: true },
      workflow:     { type: 'string', required: true },
      gate_id:      { type: 'string', required: true },
      signal_count: { type: 'number', required: true },
    },
  },

  'workflow.gate.cancelled': {
    domain: 'workflow',
    action: 'gate.cancelled',
    version: 1,
    description: 'Wait-gate 被取消（例如審核拒絕）',
    payload: {
      gate_id: { type: 'string', required: true },
      reason:  { type: 'string', required: true },
    },
  },

  'workflow.gate.timedout': {
    domain: 'workflow',
    action: 'gate.timedout',
    version: 1,
    description: 'Wait-gate 等待逾時',
    payload: {
      run_id:  { type: 'string', required: true },
      gate_id: { type: 'string', required: true },
    },
  },

  // ── Task-graph (project / task-workflow) lifecycle ──

  'project.started': {
    domain: 'project',
    action: 'started',
    version: 1,
    description: '專案或任務圖工作流程執行啟動',
    payload: {
      run_id:   { type: 'string', required: true  },
      project:  { type: 'string', required: false },  // set for startProject runs; null for standalone
      workflow: { type: 'string', required: false },  // set for startTaskWorkflow runs; null for project runs
    },
  },

  'project.task.scheduled': {
    domain: 'project',
    action: 'task.scheduled',
    version: 1,
    description: '任務因 startTime 設定而延後執行',
    payload: {
      run_id:     { type: 'string', required: true },
      workflow:   { type: 'string', required: true },
      task:       { type: 'string', required: true },
      start_time: { type: 'string', required: true },
    },
  },

  'project.task.started': {
    domain: 'project',
    action: 'task.started',
    version: 1,
    description: '任務開始執行',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      task:     { type: 'string', required: true },
    },
  },

  'project.task.completed': {
    domain: 'project',
    action: 'task.completed',
    version: 1,
    description: '任務執行完成',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      task:     { type: 'string', required: true },
    },
  },

  'project.task.failed': {
    domain: 'project',
    action: 'task.failed',
    version: 1,
    description: '任務執行失敗',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      task:     { type: 'string', required: true },
    },
  },

  'project.task.skipped': {
    domain: 'project',
    action: 'task.skipped',
    version: 1,
    description: '任務因條件不符而略過',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      task:     { type: 'string', required: true },
    },
  },

  'project.task.cancelled': {
    domain: 'project',
    action: 'task.cancelled',
    version: 1,
    description: '任務因子工作流程 wait-gate 被取消而終止',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
      task:     { type: 'string', required: true },
    },
  },

  'project.workflow.completed': {
    domain: 'project',
    action: 'workflow.completed',
    version: 1,
    description: '任務圖工作流程完成',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
    },
  },

  'project.workflow.failed': {
    domain: 'project',
    action: 'workflow.failed',
    version: 1,
    description: '任務圖工作流程失敗',
    payload: {
      run_id:   { type: 'string', required: true },
      workflow: { type: 'string', required: true },
    },
  },

  // ── Project run terminal ──

  'project.completed': {
    domain: 'project',
    action: 'completed',
    version: 1,
    description: '專案執行全部完成（所有工作流程均完成）',
    payload: {
      run_id:  { type: 'string', required: true  },
      project: { type: 'string', required: false },
    },
  },

  'project.failed': {
    domain: 'project',
    action: 'failed',
    version: 1,
    description: '專案執行失敗（至少一個工作流程失敗）',
    payload: {
      run_id:  { type: 'string', required: true  },
      project: { type: 'string', required: false },
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
