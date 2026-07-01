import { supabase } from '../../supabase.js'

export function registerDispatchHandlers(bus) {
  bus.subscribe('dispatch.job.delivered', async function onDeliveredUpdateJob(event) {
    const { job_id, delivered_at } = event.payload
    if (!job_id) return
    await supabase.from('dispatch_jobs')
      .update({ status: 'delivered', delivered_at, sla_status: 'on_track', updated_at: new Date().toISOString() })
      .eq('id', job_id)
      .then(() => {}).catch(err => console.warn('[dispatchHandlers] delivered update failed:', err.message))
  })

  bus.subscribe('dispatch.job.failed', async function onFailedNotify(event) {
    const { job_number, failed_attempts, reason } = event.payload
    await supabase.from('notifications').insert({
      type: '派送失敗',
      title: `派送任務 ${job_number} 失敗（第 ${failed_attempts} 次），原因：${reason || '未知'}`,
      read: false,
    }).then(() => {}).catch(err => console.warn('[dispatchHandlers] fail notify error:', err.message))
  })

  bus.subscribe('dispatch.sla.at_risk', async function onSLAAtRisk(event) {
    const { job_id, job_number, sla_deadline } = event.payload
    if (!job_id) return
    await Promise.all([
      supabase.from('dispatch_sla_events').insert({
        job_id, event_type: 'at_risk', notified_to: ['manager'],
        notes: `SLA 截止：${sla_deadline}`,
      }),
      supabase.from('notifications').insert({
        type: 'SLA風險',
        title: `派送任務 ${job_number} SLA 即將逾期，截止：${sla_deadline}`,
        read: false,
      }),
    ]).catch(err => console.warn('[dispatchHandlers] sla at_risk error:', err.message))
  })

  bus.subscribe('dispatch.sla.breached', async function onSLABreached(event) {
    const { job_id, job_number, sla_deadline, breached_at } = event.payload
    if (!job_id) return
    await Promise.all([
      supabase.from('dispatch_jobs').update({ sla_status: 'breached', updated_at: new Date().toISOString() }).eq('id', job_id),
      supabase.from('dispatch_sla_events').insert({
        job_id, event_type: 'breached', notified_to: ['manager', 'customer'],
        notes: `逾期：${breached_at}，截止：${sla_deadline}`,
      }),
      supabase.from('notifications').insert({
        type: 'SLA逾期',
        title: `派送任務 ${job_number} SLA 已逾期！截止：${sla_deadline}`,
        read: false,
      }),
    ]).catch(err => console.warn('[dispatchHandlers] sla breach error:', err.message))
  })

  bus.subscribe('wms.picklist.created', async function onPicklistCreatedNotify(event) {
    const { list_number, item_count } = event.payload
    await supabase.from('notifications').insert({
      type: '新揀貨單',
      title: `揀貨單 ${list_number} 已建立，共 ${item_count} 項商品待揀`,
      read: false,
    }).then(() => {}).catch(err => console.warn('[dispatchHandlers] picklist notify error:', err.message))
  })

  bus.subscribe('wms.pack.completed', async function onPackCompletedUpdateJob(event) {
    const { job_id } = event.payload
    if (!job_id) return
    await supabase.from('dispatch_jobs')
      .update({ status: 'label_printed', updated_at: new Date().toISOString() })
      .eq('id', job_id).eq('status', 'assigned')
      .then(() => {}).catch(err => console.warn('[dispatchHandlers] pack complete job update error:', err.message))
  })

  bus.subscribe('dispatch.route.started', async function onRouteStartedUpdateJobs(event) {
    const { route_id } = event.payload
    if (!route_id) return
    const now = new Date().toISOString()
    await supabase.from('dispatch_jobs')
      .update({ status: 'in_transit', picked_up_at: now, updated_at: now })
      .eq('route_id', route_id).in('status', ['label_printed', 'assigned'])
      .then(() => {}).catch(err => console.warn('[dispatchHandlers] route started job update error:', err.message))
  })
}
