/**
 * CRM — CSV Import/Export, Email Tracking, Form Builder, Workflow Builder, RBAC
 */

import { CUSTOMER_FIELDS } from './scoring'

// ============================================================
// CSV Import/Export
// ============================================================

/**
 * Parse CSV string to array of objects
 */
export function parseCSV(csvString) {
  const lines = csvString.trim().split('\n')
  if (lines.length < 2) return { headers: [], rows: [], errors: [] }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    if (values.length !== headers.length) {
      errors.push(`第 ${i + 1} 行：欄位數量不符（預期 ${headers.length}，實際 ${values.length}）`)
      continue
    }
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] })
    rows.push(row)
  }

  return { headers, rows, errors }
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV(data, columns) {
  if (!data.length) return ''
  const headers = columns || Object.keys(data[0])
  const headerLabels = headers.map(h => {
    const field = CUSTOMER_FIELDS.find(f => f.value === h)
    return field ? field.label : h
  })

  const rows = data.map(row =>
    headers.map(h => {
      let val = row[h]
      if (val === null || val === undefined) val = ''
      if (Array.isArray(val)) val = val.join(';')
      val = String(val).replace(/"/g, '""')
      return `"${val}"`
    }).join(',')
  )

  return [headerLabels.map(h => `"${h}"`).join(','), ...rows].join('\n')
}

/**
 * Download CSV as file
 */
export function downloadCSV(csvString, filename = 'export.csv') {
  const BOM = '﻿' // UTF-8 BOM for Excel
  const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Map CSV headers to customer fields
 */
export const CSV_FIELD_MAP = {
  '客戶姓名': 'name', '姓名': 'name', 'name': 'name',
  '公司': 'company', '公司名稱': 'company', 'company': 'company',
  '電話': 'phone', 'phone': 'phone', '手機': 'phone',
  'Email': 'email', 'email': 'email', '信箱': 'email',
  '狀態': 'status', 'status': 'status',
  '標籤': 'tags', 'tags': 'tags',
  '來源': 'source', 'source': 'source',
  '負責業務': 'assigned_to', '業務': 'assigned_to',
  '備註': 'notes', 'notes': 'notes',
  '信用額度': 'credit_limit', 'credit_limit': 'credit_limit',
}

// ============================================================
// Email Tracking (Open/Click)
// ============================================================

/**
 * Generate tracking pixel URL (simulated)
 */
export function generateTrackingPixel(campaignId, recipientId) {
  return `https://track.smeops.local/pixel/${campaignId}/${recipientId}.gif`
}

/**
 * Generate tracked link
 */
export function generateTrackedLink(originalUrl, campaignId, recipientId) {
  return `https://track.smeops.local/click/${campaignId}/${recipientId}?url=${encodeURIComponent(originalUrl)}`
}

/**
 * Calculate email tracking metrics
 */
export function calculateEmailMetrics(events) {
  const sent = events.filter(e => e.type === 'sent').length
  const delivered = events.filter(e => e.type === 'delivered').length
  const opened = new Set(events.filter(e => e.type === 'opened').map(e => e.recipient_id)).size
  const clicked = new Set(events.filter(e => e.type === 'clicked').map(e => e.recipient_id)).size
  const bounced = events.filter(e => e.type === 'bounced').length
  const unsubscribed = events.filter(e => e.type === 'unsubscribed').length

  return {
    sent, delivered, opened, clicked, bounced, unsubscribed,
    deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
    openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
    clickRate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
    bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
    unsubRate: delivered > 0 ? Math.round((unsubscribed / delivered) * 100) : 0,
  }
}

// ============================================================
// Form Builder Model
// ============================================================

export function createFormDefinition(data) {
  return {
    id: data.id || `FORM-${Date.now()}`,
    name: data.name || '新表單',
    description: data.description || '',
    fields: data.fields || [
      { id: 'f1', type: 'text', label: '姓名', required: true, placeholder: '請輸入姓名' },
      { id: 'f2', type: 'email', label: 'Email', required: true, placeholder: '請輸入Email' },
      { id: 'f3', type: 'tel', label: '電話', required: false, placeholder: '0912-345-678' },
      { id: 'f4', type: 'textarea', label: '需求說明', required: false, placeholder: '請描述您的需求...' },
    ],
    settings: {
      submitButtonText: data.submitButtonText || '送出',
      successMessage: data.successMessage || '感謝您的填寫！我們會盡快與您聯繫。',
      assignTo: data.assignTo || '',
      createDeal: data.createDeal || false,
      dealPipeline: data.dealPipeline || 'default',
      notifyEmail: data.notifyEmail || '',
      redirectUrl: data.redirectUrl || '',
    },
    style: {
      theme: data.theme || 'default', // default, minimal, modern
      primaryColor: data.primaryColor || '#22d3ee',
      borderRadius: data.borderRadius || 8,
    },
    status: data.status || 'draft', // draft, active, archived
    submissions: 0,
    created_at: new Date().toISOString(),
  }
}

export const FORM_FIELD_TYPES = [
  { value: 'text', label: '文字' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: '電話' },
  { value: 'number', label: '數字' },
  { value: 'textarea', label: '多行文字' },
  { value: 'select', label: '下拉選單' },
  { value: 'radio', label: '單選' },
  { value: 'checkbox', label: '多選' },
  { value: 'date', label: '日期' },
  { value: 'hidden', label: '隱藏欄位' },
]

// ============================================================
// Workflow Builder Model
// ============================================================

export const WORKFLOW_TRIGGERS = [
  { value: 'deal_stage_changed', label: '商機階段變更' },
  { value: 'deal_won', label: '商機贏單' },
  { value: 'deal_lost', label: '商機輸單' },
  { value: 'contact_created', label: '新聯絡人建立' },
  { value: 'ticket_created', label: '新工單建立' },
  { value: 'ticket_sla_warning', label: '工單 SLA 即將逾期' },
  { value: 'ticket_sla_breached', label: '工單 SLA 已逾期' },
  { value: 'form_submitted', label: '表單提交' },
  { value: 'customer_inactive', label: '客戶不活躍' },
  { value: 'member_tier_changed', label: '會員等級變更' },
]

export const WORKFLOW_ACTIONS = [
  { value: 'send_email', label: '發送 Email', icon: '📧' },
  { value: 'send_line', label: '發送 LINE', icon: '💬' },
  { value: 'send_sms', label: '發送 SMS', icon: '📱' },
  { value: 'create_task', label: '建立任務', icon: '📋' },
  { value: 'assign_to', label: '指派負責人', icon: '👤' },
  { value: 'update_field', label: '更新欄位', icon: '✏️' },
  { value: 'add_tag', label: '新增標籤', icon: '🏷️' },
  { value: 'create_deal', label: '建立商機', icon: '💰' },
  { value: 'create_ticket', label: '建立工單', icon: '🎫' },
  { value: 'add_points', label: '新增點數', icon: '⭐' },
  { value: 'wait', label: '等待', icon: '⏳' },
  { value: 'condition', label: '條件分支', icon: '🔀' },
  { value: 'webhook', label: 'Webhook', icon: '🔗' },
  { value: 'notify', label: '系統通知', icon: '🔔' },
]

export function createWorkflow(data) {
  return {
    id: data.id || `WF-${Date.now()}`,
    name: data.name || '新工作流程',
    description: data.description || '',
    trigger: data.trigger || 'contact_created',
    triggerConfig: data.triggerConfig || {},
    steps: data.steps || [],
    status: data.status || 'draft', // draft, active, paused
    executions: 0,
    created_at: new Date().toISOString(),
  }
}

// ============================================================
// Role-Based CRM Permissions
// ============================================================

export const CRM_ROLES = [
  {
    id: 'admin', name: 'CRM 管理員',
    permissions: {
      customers: ['read', 'create', 'edit', 'delete', 'export', 'import'],
      deals: ['read', 'create', 'edit', 'delete', 'export'],
      tickets: ['read', 'create', 'edit', 'delete', 'assign'],
      campaigns: ['read', 'create', 'edit', 'delete', 'send'],
      members: ['read', 'create', 'edit', 'delete'],
      reports: ['read', 'export'],
      settings: ['read', 'edit'],
    }
  },
  {
    id: 'manager', name: '業務主管',
    permissions: {
      customers: ['read', 'create', 'edit', 'export'],
      deals: ['read', 'create', 'edit', 'export'],
      tickets: ['read', 'edit', 'assign'],
      campaigns: ['read', 'create', 'send'],
      members: ['read', 'edit'],
      reports: ['read', 'export'],
      settings: ['read'],
    }
  },
  {
    id: 'sales', name: '業務人員',
    permissions: {
      customers: ['read', 'create', 'edit'],
      deals: ['read', 'create', 'edit'],
      tickets: ['read', 'create'],
      campaigns: ['read'],
      members: ['read'],
      reports: ['read'],
      settings: [],
    }
  },
  {
    id: 'support', name: '客服人員',
    permissions: {
      customers: ['read'],
      deals: ['read'],
      tickets: ['read', 'create', 'edit'],
      campaigns: [],
      members: ['read'],
      reports: [],
      settings: [],
    }
  },
]

/**
 * Check if a role has a specific permission
 */
export function hasPermission(roleId, module, action) {
  const role = CRM_ROLES.find(r => r.id === roleId)
  if (!role) return false
  return role.permissions[module]?.includes(action) || false
}
