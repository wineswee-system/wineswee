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

const TYPE = { STEP: 'step', FAN_OUT: 'fanOut', FAN_IN: 'fanIn', WAIT_GATE: 'waitGate' }

// ── Gate registry ──
const _gates = new Map()

// Scoped gate IDs must follow the pattern produced by makeGateId: "wf_<ts>_<rand>:<rawGateId>".
// includes(':') alone is insufficient — 'approval:v2' or ':approval' also contain ':' but are
// not scoped IDs. Validate the full prefix so callers get an early throw instead of a silent hang.
const _SCOPED_GATE_RE = /^(?:wf|prj)_\d+_[a-z0-9]+:.+$/

/**
 * Send a signal to a named gate. When the gate accumulates `expects` signals
 * the suspended workflow step resumes. Signals are stored in
 * ctx.gateSignals[rawGateId] so each gate's payloads are independently accessible.
 * @param {string} gateId
 * @param {object} payload  - Arbitrary data from the signalling party
 */
export function signalGate(gateId, payload = {}) {
  // Scoped IDs follow "wf_<ts>_<rand>:<rawGateId>" (produced by makeGateId).
  // A bare name or one that merely contains ':' (e.g. 'approval:v2') would silently miss
  // _gates.get and let the workflow hang forever — throw early instead.
  if (typeof gateId !== 'string' || !_SCOPED_GATE_RE.test(gateId)) {
    throw new Error(`signalGate: "${gateId}" is not a scoped gate ID — use the gate_id from the 'workflow.gate.opened' event or call makeGateId(runId, rawGateId)`)
  }
  const gate = _gates.get(gateId)
  if (!gate) {
    // Gate already resolved, cancelled, or timed out — late signals are benign (at-least-once delivery)
    log.warn('signalGate: gate not found (already resolved, cancelled, or timed out)', { gateId })
    return
  }
  gate.signals.push(payload)
  log.info('Gate signalled', { gateId, received: gate.signals.length, expects: gate.expects })
  try {
    _bus().publish('workflow.gate.signalled', {
      gate_id: gateId, received: gate.signals.length, expects: gate.expects,
    })
  } catch (busErr) {
    log.warn('Gate signalled event publish failed (signal itself counted)', { gateId, error: busErr })
  }
  if (gate.signals.length >= gate.expects) {
    _gates.delete(gateId)   // delete synchronously before resolve — prevents double-signal corruption
    gate.resolve(gate.signals)
  }
}

/**
 * Cancel (reject) a waiting gate — e.g. an approver rejected the request.
 * @param {string} gateId
 * @param {string} reason
 */
export function cancelGate(gateId, reason = 'cancelled') {
  if (typeof gateId !== 'string' || !_SCOPED_GATE_RE.test(gateId)) {
    throw new Error(`cancelGate: "${gateId}" is not a scoped gate ID — use the gate_id from the 'workflow.gate.opened' event or call makeGateId(runId, rawGateId)`)
  }
  const gate = _gates.get(gateId)
  if (!gate) {
    // Gate already resolved or timed out — treat as no-op rather than throwing
    log.warn('cancelGate: gate not found (already resolved or timed out)', { gateId, reason })
    return
  }
  log.info('Gate cancelled', { gateId, reason })
  try {
    _bus().publish('workflow.gate.cancelled', { gate_id: gateId, reason })
  } catch (busErr) {
    log.warn('Gate cancelled event publish failed (cancellation itself proceeds)', { gateId, error: busErr })
  }
  _gates.delete(gateId)   // mirror signalGate — delete before reject to close double-cancel window
  const cancelErr = new Error(`Gate "${gateId}" cancelled: ${reason}`)
  cancelErr.isCancelled = true
  cancelErr.cancellationReason = reason  // plain reason without the gate-ID prefix
  gate.reject(cancelErr)
}

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
 *
 * @param {object} [options.implicitFanIn]  - Fan-in descriptor used when a workflow ends with
 *   an open fanOut without an explicit fanIn() descriptor. Defaults to { strategy:'all', onFail:'abort' }.
 *   Pass { strategy:'all', onFail:'continue' } to absorb branch failures non-fatally.
 */
export function defineWorkflow(name, steps, options = {}) {
  _workflows.set(name, { steps, implicitFanIn: options.implicitFanIn ?? null })
}

// ── Active run store (in-memory) ──
const _runs = new Map()
// Secondary index of terminal (COMPLETED/FAILED) run IDs, maintained alongside _runs.
// Allows _pruneRuns to iterate only evictable candidates — O(terminal) instead of O(all) —
// so 500 concurrent RUNNING runs don't cause a fruitless full-scan on every startWorkflow.
const _terminalRunIds = new Set()
// Evict oldest terminal runs when the store exceeds this size.
// Only completed/failed runs are evicted — running runs are never pruned.
const _RUN_STORE_MAX = 500

function _pruneRuns() {
  if (_runs.size <= _RUN_STORE_MAX) return
  if (_terminalRunIds.size === 0) {
    log.warn('_pruneRuns: store at capacity with no terminal runs to evict', { size: _runs.size })
    return
  }
  for (const id of _terminalRunIds) {
    _terminalRunIds.delete(id)
    _runs.delete(id)
    if (_runs.size <= _RUN_STORE_MAX) break
  }
}

/**
 * Start a workflow run.
 * @param {string} workflowName
 * @param {object} initialContext  - Seed data available to all steps as `ctx`
 * @returns {Promise<string>}      runId
 */
export async function startWorkflow(workflowName, initialContext = {}) {
  const def = _workflows.get(workflowName)
  if (!def) throw new Error(`Workflow "${workflowName}" not defined`)
  const { steps, implicitFanIn } = def

  const rand  = Math.random().toString(36).padEnd(6, '0').slice(2, 6)
  const runId = `wf_${Date.now()}_${rand}`
  const run = {
    id: runId,
    workflow: workflowName,
    status: RUN_STATUS.RUNNING,
    context: { ...initialContext, gateSignals: { ...(initialContext.gateSignals ?? {}) } },
    stepResults: {},
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  }

  _runs.set(runId, run)
  _pruneRuns()
  log.info('Workflow started', { runId, workflow: workflowName })
  try {
    _bus().publish('workflow.run.started', { run_id: runId, workflow: workflowName })
  } catch (busErr) {
    log.warn('workflow.run.started publish failed', { runId, error: busErr })
  }

  try {
    await _executeSequence(run, steps, null, implicitFanIn)
    run.status = RUN_STATUS.COMPLETED
    run.completedAt = new Date().toISOString()
    _terminalRunIds.add(runId)
    // Skip runId so the just-completed run stays queryable by event subscribers
    if (_runs.size > _RUN_STORE_MAX) {
      for (const id of _terminalRunIds) {
        if (id === runId) continue
        _terminalRunIds.delete(id)
        _runs.delete(id)
        if (_runs.size <= _RUN_STORE_MAX) break
      }
      if (_runs.size > _RUN_STORE_MAX) {
        log.warn('_runs store over capacity with no other terminal runs to evict', { size: _runs.size, runId })
      }
    }
    const duration_ms = Date.now() - new Date(run.startedAt).getTime()
    log.info('Workflow completed', { runId, workflow: workflowName })
    try {
      _bus().publish('workflow.run.completed', { run_id: runId, workflow: workflowName, duration_ms })
    } catch (busErr) {
      log.warn('workflow.run.completed publish failed', { runId, error: busErr })
    }
  } catch (err) {
    run.status = err.isCancelled ? RUN_STATUS.CANCELLED : RUN_STATUS.FAILED
    run.completedAt = new Date().toISOString()
    if (err.isCancelled) {
      run.cancellationReason = err.cancellationReason ?? err.message
    } else {
      run.error = err.message
    }
    _terminalRunIds.add(runId)
    if (_runs.size > _RUN_STORE_MAX) {
      for (const id of _terminalRunIds) {
        if (id === runId) continue
        _terminalRunIds.delete(id)
        _runs.delete(id)
        if (_runs.size <= _RUN_STORE_MAX) break
      }
      if (_runs.size > _RUN_STORE_MAX) {
        log.warn('_runs store over capacity with no other terminal runs to evict', { size: _runs.size, runId })
      }
    }
    if (err.isCancelled) {
      log.info('Workflow cancelled', { runId, workflow: workflowName, reason: run.cancellationReason })
      try {
        _bus().publish('workflow.run.cancelled', { run_id: runId, workflow: workflowName, reason: run.cancellationReason })
      } catch (busErr) {
        log.warn('workflow.run.cancelled publish failed', { runId, error: busErr })
      }
    } else {
      log.error('Workflow failed', { runId, workflow: workflowName, error: err })
      try {
        _bus().publish('workflow.run.failed', { run_id: runId, workflow: workflowName, error: err.message })
      } catch (busErr) {
        log.warn('workflow.run.failed publish failed', { runId, error: busErr })
      }
    }
    throw err
  }

  return runId
}

// ── Internal: execute a sequence of descriptors ──
// branchTag namespaces step keys in run.stepResults (e.g. 'branch0:payroll.calculate')
// and is returned as the fulfilled value of each branch in Promise.allSettled.
// implicitFanIn is the per-workflow override for the fan-in used when a fanOut has no
// matching fanIn() descriptor; null means use the built-in default.
async function _executeSequence(run, descriptors, branchTag = null, implicitFanIn = null) {
  const results = []
  let pendingBranchResults = null

  for (const descriptor of descriptors) {
    if (descriptor.type === TYPE.FAN_OUT) {
      if (pendingBranchResults) throw new Error('fanOut encountered before previous fanOut was consumed by a fanIn descriptor')
      pendingBranchResults = await _executeFanOut(run, descriptor.branches, branchTag, implicitFanIn)

    } else if (descriptor.type === TYPE.FAN_IN) {
      if (!pendingBranchResults) throw new Error('fanIn without a preceding fanOut')
      await _executeFanIn(run, pendingBranchResults, descriptor)
      pendingBranchResults = null

    } else if (descriptor.type === TYPE.WAIT_GATE) {
      await _executeWaitGate(run, descriptor)

    } else {
      const result = await _executeStep(run, descriptor, branchTag)
      // null (skipped step) is preserved so ctx.fanInResults positions match step indices.
      // Callers must not rely on filtering — use result != null checks in step handlers instead.
      results.push(result)
    }
  }

  // Implicit fan-in if workflow ends with an open fan-out.
  // Use per-workflow implicitFanIn if provided; warn so developers know defaults are in play.
  if (pendingBranchResults) {
    const fanInOpts = implicitFanIn ?? { strategy: 'all', onFail: 'abort' }
    if (!implicitFanIn) {
      log.warn('Implicit fan-in using defaults (strategy:all, onFail:abort) — pass implicitFanIn option to defineWorkflow() to override', { runId: run.id })
    }
    await _executeFanIn(run, pendingBranchResults, fanInOpts)
  }

  return results
}

// ── Wait-gate: suspend until N external signals arrive ──
async function _executeWaitGate(run, descriptor) {
  const rawGateId = typeof descriptor.gateId === 'function'
    ? descriptor.gateId(run.context)
    : descriptor.gateId
  // Scope by run ID — prevents two concurrent runs from colliding on the same raw gate name
  const scopedId = makeGateId(run.id, rawGateId)
  const expects  = descriptor.expects ?? 1
  const timeout  = descriptor.timeout ?? 0

  if (expects <= 0) {
    throw new Error(`waitForGate: expects must be >= 1 (got ${expects}) for gate "${rawGateId}"`)
  }

  // Reject a negative timeout early — a computed deadline already elapsed would silently
  // disable the timer (because `timeout > 0` is false for negatives), leaving the gate open forever.
  if (timeout < 0) {
    throw new Error(`waitForGate: timeout must be >= 0 ms (got ${timeout}) for gate "${rawGateId}"`)
  }

  // Guard before constructing the Promise — avoids a live-but-never-registered gateEntry
  // and ensures the error is a clean throw rather than a Promise rejection wrapping.
  if (_gates.has(scopedId)) {
    throw new Error(`waitForGate: duplicate gate "${rawGateId}" is already open in run "${run.id}" — each concurrent waitForGate must use a unique gateId`)
  }

  // Capture the entry object so the timeout can use an identity check instead of a key lookup,
  // preventing a stale timer from corrupting a new gate registered under the same raw name.
  const gateEntry = { expects, signals: [], resolve: null, reject: null }
  let timerId = null

  let signals
  try {
    signals = await new Promise((resolve, reject) => {
      gateEntry.resolve = resolve
      gateEntry.reject  = reject
      _gates.set(scopedId, gateEntry)

      // Publish AFTER _gates.set so any subscriber reacting synchronously to the event
      // can immediately call signalGate and find the gate registered.
      log.info('Gate opened', { runId: run.id, scopedGateId: scopedId, expects, timeout })
      try {
        _bus().publish('workflow.gate.opened', {
          run_id: run.id, workflow: run.workflow, gate_id: scopedId, expects,
        })
      } catch (busErr) {
        // If the event can't be delivered, no external party will know the gate exists.
        // Reject immediately — an open-but-undeliverable gate would hang forever.
        _gates.delete(scopedId)
        reject(new Error(`Gate "${rawGateId}" could not open: event publish failed — ${busErr.message}`))
        return
      }

      if (timeout > 0) {
        timerId = setTimeout(() => {
          if (_gates.get(scopedId) === gateEntry) {  // identity — not just key existence
            _gates.delete(scopedId)
            try {
              _bus().publish('workflow.gate.timedout', { run_id: run.id, gate_id: scopedId })
            } catch (busErr) {
              log.warn('Gate timedout event publish failed (timeout itself proceeds)', { runId: run.id, scopedGateId: scopedId, error: busErr })
            }
            reject(new Error(`Gate "${rawGateId}" timed out after ${timeout}ms`))
          }
        }, timeout)
      }
    })
  } catch (err) {
    // All rejection paths (bus-fail, timeout, cancelGate) already delete scopedId before rejecting,
    // so this delete is always a no-op. Kept as a cheap defensive guard against future code paths.
    _gates.delete(scopedId)
    throw err
  } finally {
    // Runs on both success and error — disarms the timer so its closure can be GC'd immediately.
    if (timerId !== null) clearTimeout(timerId)
  }

  // Sequential reuse of the same rawGateId accumulates signals rather than overwriting.
  if (Array.isArray(run.context.gateSignals[rawGateId])) {
    log.warn('waitForGate: rawGateId reused sequentially in same run — signals appended', { runId: run.id, scopedGateId: scopedId })
    run.context.gateSignals[rawGateId] = run.context.gateSignals[rawGateId].concat(signals)
  } else {
    run.context.gateSignals[rawGateId] = signals
  }

  log.info('Gate closed', { runId: run.id, scopedGateId: scopedId, signals: signals.length })
  try {
    _bus().publish('workflow.gate.closed', {
      run_id: run.id, workflow: run.workflow, gate_id: scopedId, signal_count: signals.length,
    })
  } catch (busErr) {
    log.warn('Gate closed event publish failed (gate itself succeeded)', { runId: run.id, scopedGateId: scopedId, error: busErr })
  }
}

/**
 * Build the scoped gate ID that external callers must pass to signalGate() / cancelGate().
 * The gate ID published in the 'workflow.gate.opened' event is already in this format.
 */
export function makeGateId(runId, rawGateId) {
  return `${runId}:${rawGateId}`
}

// ── Fan-out: spawn all branches in parallel ──
async function _executeFanOut(run, branches, outerBranchTag = null, implicitFanIn = null) {
  log.info('Fan-out started', { runId: run.id, branches: branches.length })
  try {
    _bus().publish('workflow.fanout.started', {
      run_id: run.id, workflow: run.workflow, branch_count: branches.length,
    })
  } catch (busErr) {
    log.warn('workflow.fanout.started publish failed', { runId: run.id, error: busErr })
  }

  const settled = await Promise.allSettled(
    branches.map((branchSteps, i) => _runBranch(run, branchSteps, i, outerBranchTag, implicitFanIn))
  )

  log.info('Fan-out finished', {
    runId: run.id,
    succeeded: settled.filter(r => r.status === 'fulfilled').length,
    failed:    settled.filter(r => r.status === 'rejected').length,
  })

  return settled
}

// ── Run one branch (sub-sequence of steps) ──
async function _runBranch(run, steps, branchIndex, outerBranchTag = null, implicitFanIn = null) {
  const tag = outerBranchTag ? `${outerBranchTag}:branch${branchIndex}` : `branch${branchIndex}`
  return _executeSequence(run, steps, tag, implicitFanIn)
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

  // onFail has no effect for strategy:'any' — any succeeding branch continues regardless.
  // Warn so callers don't silently think abort is in force.
  if (strategy === 'any' && failures.length > 0 && onFail === 'abort') {
    log.warn('fanIn: onFail:"abort" is not supported with strategy:"any" — branch failures are absorbed; use strategy:"all" for strict all-or-nothing', { runId: run.id })
  }

  if (strategy === 'any' && successes.length === 0) {
    throw new Error('Fan-in (any): all branches failed')
  }

  // Merge successful branch outputs into context.fanInResults
  run.context.fanInResults = successes.map(r => r.value).flat()

  try {
    _bus().publish('workflow.fanin.completed', {
      run_id: run.id, workflow: run.workflow, strategy,
      succeeded: successes.length, failed: failures.length,
    })
  } catch (busErr) {
    log.warn('workflow.fanin.completed publish failed', { runId: run.id, error: busErr })
  }
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
      try {
        _bus().publish('workflow.step.skipped', {
          run_id: run.id, workflow: run.workflow, step: descriptor.name, branch: branchTag ?? undefined,
        })
      } catch (busErr) {
        log.warn('workflow.step.skipped publish failed', { runId: run.id, step: key, error: busErr })
      }
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

    // Only top-level (non-branch) steps write into shared context — branch steps from parallel
    // fan-out branches must not, because two branches running the same step name would race on
    // the same key (last writer wins, non-deterministic). Branch results are accessible via
    // ctx.fanInResults after fan-in.
    if (result != null && !branchTag) run.context[descriptor.name] = result

    log.info('Step completed', { runId: run.id, step: key })
    try {
      _bus().publish('workflow.step.completed', {
        run_id: run.id, workflow: run.workflow, step: descriptor.name, branch: branchTag ?? undefined,
      })
    } catch (busErr) {
      log.warn('workflow.step.completed publish failed', { runId: run.id, step: key, error: busErr })
    }
    return result
  } catch (err) {
    entry.status = STEP_STATUS.FAILED
    entry.error = err.message
    entry.completedAt = new Date().toISOString()
    log.error('Step failed', { runId: run.id, step: key, error: err })
    try {
      _bus().publish('workflow.step.failed', {
        run_id: run.id, workflow: run.workflow, step: descriptor.name, error: err.message, branch: branchTag ?? undefined,
      })
    } catch (busErr) {
      log.warn('workflow.step.failed publish failed', { runId: run.id, step: key, error: busErr })
    }
    throw err
  }
}

// ── Query ──
export function getRunStatus(runId) {
  return _runs.get(runId) ?? null
}

export function deleteRun(runId) {
  const run = _runs.get(runId) ?? null
  if (run?.status === RUN_STATUS.RUNNING) {
    throw new Error(`deleteRun: run "${runId}" is still RUNNING — wait for completion or cancel it first`)
  }
  _runs.delete(runId)
  _terminalRunIds.delete(runId)
  return run
}

export function listRuns(filter = {}) {
  const all = Array.from(_runs.values())
  if (filter.workflow) return all.filter(r => r.workflow === filter.workflow)
  if (filter.status)   return all.filter(r => r.status   === filter.status)
  return all
}

// ── Descriptor builders ──
export const step        = (name, options = {}) => ({ ...options, type: TYPE.STEP, name })
export const fanOut      = (branches) => ({ type: TYPE.FAN_OUT, branches })
export const fanIn       = (options = {}) => ({ ...options, type: TYPE.FAN_IN })
/**
 * Suspend the workflow at this point until `expects` external calls to signalGate(gateId).
 * @param {string|Function} gateId   - Static ID or (ctx) => string for per-run IDs.
 *   **Must be unique among all concurrently-open gates within the same run.**
 *   Two fan-out branches waiting on the same rawGateId simultaneously will throw (deadlock guard).
 *   Sequential reuse of the same rawGateId across multiple steps is allowed but appends signals
 *   into the existing ctx.gateSignals[rawGateId] array rather than replacing it.
 * @param {number}          expects  - Number of signals required to resume (default 1)
 * @param {object}          options  - { timeout?: number (ms, 0 = none) }
 */
export const waitForGate = (gateId, expects = 1, options = {}) =>
  ({ ...options, type: TYPE.WAIT_GATE, gateId, expects })

// ── Convenience facade ──
export const workflow = {
  define:       defineWorkflow,
  start:        startWorkflow,
  registerStep,
  status:       getRunStatus,
  deleteRun,
  list:         listRuns,
  waitForGate,
  signalGate,
  cancelGate,
  makeGateId,
}
