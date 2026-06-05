import { describe, it, expect, vi, beforeEach } from 'vitest'

// Singleton mock bus — WorkflowEngine and test share the same publish fn
const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('../../events/EventBus.js', () => ({
  getEventBus: () => ({ publish: mockPublish }),
}))

vi.mock('../../logger.js', () => ({
  logger: { forModule: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import {
  defineWorkflow,
  startWorkflow,
  registerStep,
  getRunStatus,
  listRuns,
  waitForGate,
  signalGate,
  cancelGate,
  makeGateId,
  step,
  fanOut,
  fanIn,
  RUN_STATUS,
} from '../WorkflowEngine.js'

// ── Helpers ──

/** Sets up mockPublish to capture the gate_id from workflow.gate.opened */
function captureGateId() {
  let gateId = null
  mockPublish.mockImplementation((event, payload) => {
    if (event === 'workflow.gate.opened') gateId = payload.gate_id
  })
  return () => gateId
}

function tick() { return new Promise(r => setTimeout(r, 0)) }

beforeEach(() => {
  vi.clearAllMocks()
})

// Register shared step handlers (idempotent)
registerStep('noop', async () => 'ok')

// ── Tests ──

describe('waitForGate — N signals resume workflow', () => {
  it('resumes after 2 signals and stores both payloads in ctx.gateSignals', async () => {
    const getGateId = captureGateId()

    defineWorkflow('gate.multi', [
      waitForGate('dual-approval', 2),
      step('noop'),
    ])

    const runPromise = startWorkflow('gate.multi', {})
    await tick()

    const gateId = getGateId()
    expect(gateId).toBeTruthy()

    signalGate(gateId, { approver: 'manager', decision: 'approved' })
    signalGate(gateId, { approver: 'finance', decision: 'approved' })

    const runId = await runPromise
    const run = getRunStatus(runId)

    expect(run.status).toBe(RUN_STATUS.COMPLETED)
    expect(run.context.gateSignals['dual-approval']).toHaveLength(2)
    expect(run.context.gateSignals['dual-approval'][0]).toMatchObject({ approver: 'manager' })
    expect(run.context.gateSignals['dual-approval'][1]).toMatchObject({ approver: 'finance' })
  })
})

describe('waitForGate — cancelGate sets CANCELLED status', () => {
  it('sets run.status to CANCELLED (not FAILED) when the gate is cancelled', async () => {
    const getGateId = captureGateId()

    defineWorkflow('gate.cancel', [
      waitForGate('manager-gate', 1),
      step('noop'),
    ])

    const runPromise = startWorkflow('gate.cancel', {}).catch(e => e)
    await tick()

    const gateId = getGateId()
    expect(gateId).toBeTruthy()

    cancelGate(gateId, 'manager rejected')

    const err = await runPromise
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/cancelled/)

    const runs = listRuns({ workflow: 'gate.cancel' })
    expect(runs[runs.length - 1].status).toBe(RUN_STATUS.CANCELLED)
  })
})

describe('waitForGate — timeout', () => {
  it('rejects with a timeout error after the specified ms', async () => {
    defineWorkflow('gate.timeout', [
      waitForGate('slow', 1, { timeout: 30 }),
    ])

    const start = Date.now()
    await expect(startWorkflow('gate.timeout', {})).rejects.toThrow(/timed out after 30ms/)
    expect(Date.now() - start).toBeGreaterThanOrEqual(30)
  })
})

describe('waitForGate — late signal is a no-op', () => {
  it('does not throw when signalGate is called after the gate has already resolved', async () => {
    const getGateId = captureGateId()

    defineWorkflow('gate.late', [
      waitForGate('one-shot', 1),
      step('noop'),
    ])

    const runPromise = startWorkflow('gate.late', {})
    await tick()

    const gateId = getGateId()
    signalGate(gateId, { result: 'ok' })
    await runPromise

    // Gate is gone — second signal must be silent (no throw)
    expect(() => signalGate(gateId, { result: 'late' })).not.toThrow()
  })
})

describe('waitForGate — duplicate gate guard', () => {
  it('rejects with a "duplicate gate" message when two branches open the same rawGateId', async () => {
    defineWorkflow('gate.duplicate', [
      // Branch 0: short timeout so it eventually settles; branch 1: throws immediately (duplicate)
      fanOut([
        [waitForGate('same-name', 1, { timeout: 80 })],
        [waitForGate('same-name', 1)],
      ]),
      fanIn({ strategy: 'all', onFail: 'abort' }),
    ])

    // Fan-in wraps both rejections — error message contains the duplicate gate message
    await expect(startWorkflow('gate.duplicate', {})).rejects.toThrow(/duplicate gate/)
  }, 500)
})

describe('signalGate / cancelGate — unscoped ID validation', () => {
  it('throws for a bare ID without the wf_ prefix', () => {
    expect(() => signalGate('bare-id', {})).toThrow(/not a scoped gate ID/)
  })

  it('throws for an ID that contains ":" but lacks the wf_ prefix', () => {
    expect(() => signalGate('approval:v2', {})).toThrow(/not a scoped gate ID/)
  })

  it('cancelGate throws for a bare ID', () => {
    expect(() => cancelGate('bare-id')).toThrow(/not a scoped gate ID/)
  })
})

describe('makeGateId', () => {
  it('produces a scoped ID in the format accepted by signalGate', () => {
    const fakeRunId = 'wf_1234567890_abc1'
    const gateId = makeGateId(fakeRunId, 'approval')
    expect(gateId).toBe('wf_1234567890_abc1:approval')
    // Gate doesn't exist — but it must NOT throw the "not a scoped gate ID" error
    expect(() => signalGate(gateId, {})).not.toThrow()
  })
})
