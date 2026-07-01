export const DISPATCH_EVENTS = {
  'dispatch.job.created': {
    domain: 'dispatch', action: 'job.created', version: 1,
    description: '派送任務建立',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      org_id: { type: 'string', required: true },
      shipment_id: { type: 'string', required: false },
      priority: { type: 'string', required: true },
      sla_deadline: { type: 'string', required: false },
    },
  },
  'dispatch.job.assigned': {
    domain: 'dispatch', action: 'job.assigned', version: 1,
    description: '派送任務指派物流商或司機',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      carrier_id: { type: 'string', required: false },
      driver_id: { type: 'string', required: false },
      route_id: { type: 'string', required: false },
    },
  },
  'dispatch.job.label_printed': {
    domain: 'dispatch', action: 'job.label_printed', version: 1,
    description: '派送標籤列印完成',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      carrier_label_url: { type: 'string', required: false },
    },
  },
  'dispatch.job.picked_up': {
    domain: 'dispatch', action: 'job.picked_up', version: 1,
    description: '貨物已攬收/從倉庫出發',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      tracking_number: { type: 'string', required: false },
      picked_up_at: { type: 'string', required: true },
    },
  },
  'dispatch.job.delivered': {
    domain: 'dispatch', action: 'job.delivered', version: 1,
    description: '貨物已送達收件人',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      shipment_id: { type: 'string', required: false },
      delivered_at: { type: 'string', required: true },
      recipient_name: { type: 'string', required: false },
    },
  },
  'dispatch.job.failed': {
    domain: 'dispatch', action: 'job.failed', version: 1,
    description: '派送失敗',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      failed_attempts: { type: 'number', required: true },
      reason: { type: 'string', required: false },
    },
  },
  'dispatch.job.exception': {
    domain: 'dispatch', action: 'job.exception', version: 1,
    description: '派送異常（物流商回報）',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      event_code: { type: 'string', required: true },
      description: { type: 'string', required: false },
    },
  },
  'dispatch.sla.at_risk': {
    domain: 'dispatch', action: 'sla.at_risk', version: 1,
    description: 'SLA 即將逾期（提前 2 小時警告）',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      sla_deadline: { type: 'string', required: true },
    },
  },
  'dispatch.sla.breached': {
    domain: 'dispatch', action: 'sla.breached', version: 1,
    description: 'SLA 逾期',
    payload: {
      job_id: { type: 'string', required: true },
      job_number: { type: 'string', required: true },
      sla_deadline: { type: 'string', required: true },
      breached_at: { type: 'string', required: true },
    },
  },
  'dispatch.route.started': {
    domain: 'dispatch', action: 'route.started', version: 1,
    description: '配送路線開始（司機出發）',
    payload: {
      route_id: { type: 'string', required: true },
      route_number: { type: 'string', required: true },
      driver_id: { type: 'string', required: true },
      stop_count: { type: 'number', required: true },
    },
  },
  'dispatch.route.completed': {
    domain: 'dispatch', action: 'route.completed', version: 1,
    description: '配送路線完成',
    payload: {
      route_id: { type: 'string', required: true },
      route_number: { type: 'string', required: true },
      driver_id: { type: 'string', required: true },
    },
  },
  'wms.picklist.created': {
    domain: 'wms', action: 'picklist.created', version: 1,
    description: '揀貨單建立',
    payload: {
      list_id: { type: 'string', required: true },
      list_number: { type: 'string', required: true },
      org_id: { type: 'string', required: true },
      item_count: { type: 'number', required: true },
    },
  },
  'wms.picklist.completed': {
    domain: 'wms', action: 'picklist.completed', version: 1,
    description: '揀貨完成，進入包裝流程',
    payload: {
      list_id: { type: 'string', required: true },
      list_number: { type: 'string', required: true },
      picker_id: { type: 'string', required: false },
    },
  },
  'wms.pack.completed': {
    domain: 'wms', action: 'pack.completed', version: 1,
    description: '包裝完成，等待出貨',
    payload: {
      job_id: { type: 'string', required: true },
      pack_record_id: { type: 'string', required: true },
      box_count: { type: 'number', required: true },
    },
  },
  'wms.dock.handoff': {
    domain: 'wms', action: 'dock.handoff', version: 1,
    description: '貨物移交物流商（出貨口掃描）',
    payload: {
      handoff_id: { type: 'string', required: true },
      carrier_id: { type: 'string', required: true },
      parcel_count: { type: 'number', required: true },
    },
  },
}
