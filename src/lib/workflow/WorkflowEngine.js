import { logger } from '../logger.js'
import { getEventBus } from '../events/EventBus.js'

const log = logger.forModule('workflow')

// Lazy helper — avoids calling getEventBus() at module load time (before app init)
function _bus() { return getEventBus() }

// ── Step status constants ──
export const STEP_STATUS = {
  PENDING:   'pending',
  RUNNING:   'running',
  COMPLETED: 'completed',
  FAILED:    'failed',
  SKIPPED:   'skipped',
}

export const RUN_STATUS = {
  PENDING:   'pending',
  RUNNING:   'running',
  COMPLETED: 'completed',
  FAILED:    'failed',
  CANCELLED: 'cancelled',
}

const TYPE = { STEP: 'step', FAN_OUT: 'fanOut', FAN_IN: 'fanIn' }

// ── Step handler registry ──
const _stepHandlers = new Map()

/**
 * Register an executable step handler.
 * @param {string}   name - Step type name, e.g. 'payroll.calculate'
 * @param {Function} fn   - async (ctx, payload) => result
 */
export function registerStep(name, fn) {
  _stepHandlers.set(name, fn)
}

// ── Workflow definition registry ──
const _workflows = new Map()

/**
 * Define a reusable workflow as an ordered array of step descriptors.
 *
 * Step descriptor shapes:
 *   step('handler.name', { payload?, condition? })
 *   fanOut([ [step, ...], [step, ...] ])
 *   fanIn({ strategy?: 'all'|'any', onFail?: 'abort'|'continue' })
 *
 * payload can be a static object or a function (ctx) => object.
 * condition is an async (ctx) => bool; if false the step is skipped.
 */
export function defineWorkflow(name, steps) {
  _workflows.set(name, steps)
}

// ── Active run store (in-memory) ──
const _runs = new Map()

/**
 * Start a workflow run.
 * @param {string} workflowName
 * @param {object} initialContext  - Seed data available to all steps as `ctx`
 * @returns {Promise<string>}      runId
 */
export async function startWorkflow(workflowName, initialContext = {}) {
  const steps = _workflows.get(workflowName)
  if (!steps) throw new Error(`Workflow "${workflowName}" not defined`)

  const runId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const run = {
    id: runId,
    workflow: workflowName,
    status: RUN_STATUS.RUNNING,
    context: { ...initialContext },
    stepResults: {},
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  }

  _runs.set(runId, run)
  log.info('Workflow started', { runId, workflow: workflowName })
  _bus().publish('workflow.run.started', { run_id: runId, workflow: workflowName })

  try {
    await _executeSequence(run, steps)
    run.status = RUN_STATUS.COMPLETED
    run.completedAt = new Date().toISOString()
    const duration_ms = Date.now() - new Date(run.startedAt).getTime()
    log.info('Workflow completed', { runId, workflow: workflowName })
    _bus().publish('workflow.run.completed', { run_id: runId, workflow: workflowName, duration_ms })
  } catch (err) {
    run.status = RUN_STATUS.FAILED
    run.completedAt = new Date().toISOString()
    run.error = err.message
    log.error('Workflow failed', { runId, workflow: workflowName, error: err })
    _bus().publish('workflow.run.failed', { run_id: runId, workflow: workflowName, error: err.message })
    throw err
  }

  return runId
}

// ── Internal: execute a sequence of descriptors ──
async function _executeSequence(run, descriptors) {
  let pendingBranchResults = null

  for (const descriptor of descriptors) {
    if (descriptor.type === TYPE.FAN_OUT) {
      pendingBranchResults = await _executeFanOut(run, descriptor.branches)

    } else if (descriptor.type === TYPE.FAN_IN) {
      if (!pendingBranchResults) throw new Error('fanIn without a preceding fanOut')
      await _executeFanIn(run, pendingBranchResults, descriptor)
      pendingBranchResults = null

    } else {
      await _executeStep(run, descriptor)
    }
  }

  // Implicit fan-in if workflow ends with an open fan-out
  if (pendingBranchResults) {
    await _executeFanIn(run, pendingBranchResults, { strategy: 'all', onFail: 'abort' })
  }
}

// ── Fan-out: spawn all branches in parallel ──
async function _executeFanOut(run, branches) {
  log.info('Fan-out started', { runId: run.id, branches: branches.length })
  _bus().publish('workflow.fanout.started', {
    run_id: run.id, workflow: run.workflow, branch_count: branches.length,
  })

  const settled = await Promise.allSettled(
    branches.map((branchSteps, i) => _runBranch(run, branchSteps, i))
  )

  log.info('Fan-out finished', {
    runId: run.id,
    succeeded: settled.filter(r => r.status === 'fulfilled').length,
    failed:    settled.filter(r => r.status === 'rejected').length,
  })

  return settled
}

// ── Run one branch (sub-sequence of steps) ──
async function _runBranch(run, steps, branchIndex) {
  const results = []
  for (const descriptor of steps) {
    results.push(await _executeStep(run, descriptor, `branch${branchIndex}`))
  }
  return results
}

// ── Fan-in: merge branch results into shared context ──
async function _executeFanIn(run, settledResults, descriptor) {
  const strategy = descriptor.strategy ?? 'all'
  const onFail   = descriptor.onFail   ?? 'abort'

  const failures  = settledResults.filter(r => r.status === 'rejected')
  const successes = settledResults.filter(r => r.status === 'fulfilled')

  log.info('Fan-in', {
    runId: run.id, strategy,
    total: settledResults.length,
    succeeded: successes.length,
    failed: failures.length,
  })

  if (strategy === 'all' && failures.length > 0 && onFail === 'abort') {
    const msg = failures.map(f => f.reason?.message ?? String(f.reason)).join('; ')
    throw new Error(`Fan-in (all): ${failures.length} branch(es) failed — ${msg}`)
  }

  if (strategy === 'any' && successes.length === 0) {
    throw new Error('Fan-in (any): all branches failed')
  }

  // Merge successful branch outputs into context.fanInResults
  run.context.fanInResults = successes.map(r => r.value).flat()

  _bus().publish('workflow.fanin.completed', {
    run_id: run.id, workflow: run.workflow, strategy,
    succeeded: successes.length, failed: failures.length,
  })
}

// ── Execute a single step ──
async function _executeStep(run, descriptor, branchTag = null) {
  const key = branchTag ? `${branchTag}:${descriptor.name}` : descriptor.name
  const entry = {
    name: descriptor.name,
    status: STEP_STATUS.PENDING,
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  }
  run.stepResults[key] = entry

  // Conditional skip
  if (typeof descriptor.condition === 'function') {
    const shouldRun = await descriptor.condition(run.context)
    if (!shouldRun) {
      entry.status = STEP_STATUS.SKIPPED
      log.info('Step skipped', { runId: run.id, step: key })
      _bus().publish('workflow.step.skipped', {
        run_id: run.id, workflow: run.workflow, step: descriptor.name, branch: branchTag ?? undefined,
      })
      return null
    }
  }

  const handler = _stepHandlers.get(descriptor.name)
  if (!handler) {
    entry.status = STEP_STATUS.FAILED
    entry.error = `No handler for step "${descriptor.name}"`
    throw new Error(entry.error)
  }

  entry.status = STEP_STATUS.RUNNING
  entry.startedAt = new Date().toISOString()
  log.info('Step started', { runId: run.id, step: key })

  const payload = typeof descriptor.payload === 'function'
    ? descriptor.payload(run.context)
    : (descriptor.payload ?? {})

  try {
    const result = await handler(run.context, payload)
    entry.status = STEP_STATUS.COMPLETED
    entry.result = result
    entry.completedAt = new Date().toISOString()

    // Write result into shared context keyed by step name
    if (result != null) run.context[descriptor.name] = result

    log.info('Step completed', { runId: run.id, step: key })
    _bus().publish('workflow.step.completed', {
      run_id: run.id, workflow: run.workflow, step: descriptor.name, branch: branchTag ?? undefined,
    })
    return result
  } catch (err) {
    entry.status = STEP_STATUS.FAILED
    entry.error = err.message
    entry.completedAt = new Date().toISOString()
    log.error('Step failed', { runId: run.id, step: key, error: err })
    _bus().publish('workflow.step.failed', {
      run_id: run.id, workflow: run.workflow, step: descriptor.name, error: err.message, branch: branchTag ?? undefined,
    })
    throw err
  }
}

// ── Query ──
export function getRunStatus(runId) {
  return _runs.get(runId) ?? null
}

export function listRuns(filter = {}) {
  const all = Array.from(_runs.values())
  if (filter.workflow) return all.filter(r => r.workflow === filter.workflow)
  if (filter.status)   return all.filter(r => r.status   === filter.status)
  return all
}

// ── Descriptor builders ──
export const step = (name, options = {}) => ({ type: TYPE.STEP, name, ...options })
export const fanOut = (branches) => ({ type: TYPE.FAN_OUT, branches })
export const fanIn  = (options = {}) => ({ type: TYPE.FAN_IN, ...options })

// ── Convenience facade ──
export const workflow = {
  define:       defineWorkflow,
  start:        startWorkflow,
  registerStep,
  status:       getRunStatus,
  list:         listRuns,
}
