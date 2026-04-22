/**
 * CRM Workflow Execution Engine
 *
 * Listens to EventBus events and executes matching CRM workflows.
 * Each workflow has a trigger_event (maps to an event bus pattern) and
 * a list of steps with actions + config.
 *
 * Supported actions: send_email, send_line, send_sms, create_task,
 * assign_to, update_field, add_tag, create_deal, create_ticket,
 * add_points, wait, condition, webhook, notify
 */

import { supabase } from './supabase'
import { sendMessage } from './messaging'

// ── Trigger → EventBus pattern mapping ────────────────────
const TRIGGER_EVENT_MAP = {
  deal_stage_changed: 'crm.opportunity.stage_changed',
  deal_won: 'crm.opportunity.won',
  deal_lost: 'crm.opportunity.lost',
  contact_created: 'crm.lead.created',
  ticket_created: 'service.ticket.created',
  ticket_sla_warning: 'service.ticket.sla_warning',
  ticket_sla_breached: 'service.ticket.sla_breached',
  form_submitted: 'crm.form.submitted',
  customer_inactive: 'crm.segment.changed',
  member_tier_changed: 'pos.member.tier_changed',
}

// ── Action executors ──────────────────────────────────────

function resolveTemplate(template, context) {
  if (!template) return ''
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const parts = path.split('.')
    let val = context
    for (const p of parts) {
      val = val?.[p]
      if (val === undefined) return `{{${path}}}`
    }
    return String(val)
  })
}

async function executeAction(action, config, context) {
  const resolve = (key) => resolveTemplate(config[key] || '', context)

  switch (action) {
    case 'send_email':
      await sendMessage('email', resolve('to'), resolve('subject'), resolve('body'))
      return { sent_to: config.to }

    case 'send_line':
      await sendMessage('line', resolve('to'), '', resolve('message'))
      return { sent_to: config.to }

    case 'send_sms':
      await sendMessage('sms', resolve('to'), '', resolve('message'))
      return { sent_to: config.to }

    case 'create_task': {
      const dueDate = config.due_days
        ? new Date(Date.now() + Number(config.due_days) * 86400000).toISOString()
        : null
      const { data } = await supabase.from('crm_activities').insert({
        type: 'task',
        subject: resolve('title'),
        assignee: resolve('assignee'),
        due_date: dueDate,
        status: 'planned',
        entity_type: context.entity_type || null,
        entity_id: context.entity_id || null,
      }).select().single()
      return { task_id: data?.id }
    }

    case 'assign_to': {
      if (context.entity_type === 'service_ticket' && context.entity_id) {
        await supabase.from('service_tickets').update({ assignee: config.person }).eq('id', context.entity_id)
      }
      return { assigned_to: config.person }
    }

    case 'update_field': {
      if (context.entity_type === 'customer' && context.entity_id) {
        await supabase.from('customers').update({ [config.field]: config.value }).eq('id', context.entity_id)
      }
      return { field: config.field, value: config.value }
    }

    case 'add_tag': {
      if (context.entity_type === 'customer' && context.entity_id) {
        const { data: cust } = await supabase.from('customers').select('tags').eq('id', context.entity_id).maybeSingle()
        const existing = cust?.tags ? cust.tags.split(',').map(t => t.trim()) : []
        if (!existing.includes(config.tag)) {
          existing.push(config.tag)
          await supabase.from('customers').update({ tags: existing.join(',') }).eq('id', context.entity_id)
        }
      }
      return { tag: config.tag }
    }

    case 'create_deal': {
      const { data } = await supabase.from('opportunities').insert({
        title: resolve('name'),
        amount: Number(config.amount) || 0,
        stage: config.stage || '初步接觸',
        customer_name: context.customer_name || context.name || '',
        pipeline_id: 'default',
      }).select().single()
      return { deal_id: data?.id }
    }

    case 'create_ticket': {
      const { data } = await supabase.from('service_tickets').insert({
        subject: resolve('subject'),
        priority: config.priority || '一般',
        customer_name: context.customer_name || context.name || '',
        status: '待處理',
      }).select().single()
      return { ticket_id: data?.id }
    }

    case 'add_points': {
      const points = Number(config.points) || 0
      if (context.member_id && points > 0) {
        const { data: member } = await supabase.from('members').select('available_points, total_points').eq('id', context.member_id).maybeSingle()
        if (member) {
          await supabase.from('members').update({
            available_points: (member.available_points || 0) + points,
            total_points: (member.total_points || 0) + points,
          }).eq('id', context.member_id)
          await supabase.from('point_transactions').insert({
            member_id: context.member_id,
            type: '工作流程獎勵',
            points,
            balance: (member.available_points || 0) + points,
            description: config.reason || '自動化流程',
          })
        }
      }
      return { points }
    }

    case 'wait':
      // In a real system this would schedule a delayed execution.
      // For now, log the wait and continue (non-blocking placeholder).
      return { wait: `${config.duration} ${config.unit}`, note: 'wait step recorded, no actual delay in current implementation' }

    case 'condition': {
      const fieldVal = context[config.field]
      let match = false
      switch (config.operator) {
        case '等於': match = String(fieldVal) === String(config.value); break
        case '不等於': match = String(fieldVal) !== String(config.value); break
        case '大於': match = Number(fieldVal) > Number(config.value); break
        case '小於': match = Number(fieldVal) < Number(config.value); break
        case '包含': match = String(fieldVal || '').includes(config.value); break
        default: match = false
      }
      return { condition: config.field, result: match }
    }

    case 'webhook': {
      try {
        const res = await fetch(config.url, {
          method: config.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: config.method !== 'GET' ? JSON.stringify(context) : undefined,
        })
        return { status: res.status, ok: res.ok }
      } catch (err) {
        return { error: err.message }
      }
    }

    case 'notify':
      // Log a notification (in a real system, push to notification service)
      console.log(`[Workflow Notify] ${resolve('message')} → ${config.recipients}`)
      return { message: config.message, recipients: config.recipients }

    default:
      return { skipped: true, reason: `Unknown action: ${action}` }
  }
}

// ── Core executor ─────────────────────────────────────────

async function executeWorkflow(workflow, context) {
  const steps = workflow.steps || []
  const results = []
  let skipRemaining = false

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (skipRemaining) {
      results.push({ step_index: i, action: step.action, status: 'skipped' })
      continue
    }

    try {
      const result = await executeAction(step.action, step.config || {}, context)
      results.push({ step_index: i, action: step.action, status: 'success', result })

      // If condition evaluated to false, skip remaining steps
      if (step.action === 'condition' && result.result === false) {
        skipRemaining = true
      }
    } catch (err) {
      results.push({ step_index: i, action: step.action, status: 'failed', error: err.message })
      // Continue on error (don't break the chain)
    }
  }

  // Update execution count
  await supabase.from('crm_workflows')
    .update({ executions: (workflow.executions || 0) + 1 })
    .eq('id', workflow.id)

  return results
}

// ── Registration: subscribe to EventBus ───────────────────

/**
 * Register all active CRM workflows on the event bus.
 * Call once at app startup after the event bus is initialized.
 */
export async function registerWorkflowExecutors(bus) {
  // crm_workflows 表可能尚未建立（schema 有定義但這個環境的 DB 還沒 apply）→ 優雅跳過
  const { data: workflows, error } = await supabase
    .from('crm_workflows')
    .select('*')
    .eq('status', 'active')

  if (error) {
    if (error.code !== 'PGRST116' && !/does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[workflowExecutor] Failed to load crm_workflows:', error.message)
    }
    return
  }
  if (!workflows || workflows.length === 0) return

  for (const wf of workflows) {
    const eventPattern = TRIGGER_EVENT_MAP[wf.trigger_event]
    if (!eventPattern) continue

    bus.subscribe(eventPattern, async function workflowHandler(event) {
      const context = {
        ...event.payload,
        event_type: event.type,
        event_id: event.id,
        triggered_at: new Date().toISOString(),
      }

      console.log(`[WorkflowExecutor] Triggering "${wf.name}" (${wf.id}) on ${eventPattern}`)

      const results = await executeWorkflow(wf, context)

      const successCount = results.filter(r => r.status === 'success').length
      const failedCount = results.filter(r => r.status === 'failed').length
      const overallStatus = failedCount === 0 ? '成功' : successCount > 0 ? '部分失敗' : '失敗'

      console.log(`[WorkflowExecutor] "${wf.name}" completed: ${overallStatus} (${successCount}/${results.length} steps)`)
    })
  }

  console.log(`[WorkflowExecutor] Registered ${workflows.length} active workflow(s)`)
}
