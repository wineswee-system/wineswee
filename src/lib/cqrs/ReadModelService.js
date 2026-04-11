import { supabase } from '../supabase.js'
import { logger } from '../logger.js'

const log = logger.forModule('cqrs')

/**
 * CQRS Read Model Service
 *
 * Separates read (query) operations from write (command) operations.
 * Read models are optimized for specific query patterns and can be:
 * - Materialized views in PostgreSQL (refreshed periodically)
 * - In-memory caches for hot data
 * - Denormalized projections built from events
 *
 * Write operations continue through the normal event bus → handler → DB path.
 * Read operations use this service for fast, pre-computed data.
 */

// In-memory cache with TTL
const _cache = new Map()

function getCached(key, ttlMs) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > ttlMs) {
    _cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data) {
  _cache.set(key, { data, timestamp: Date.now() })
}

/**
 * Dashboard KPIs — pre-aggregated metrics.
 * Cache TTL: 30 seconds (hot path, called on every dashboard load).
 */
export async function getDashboardKPIs() {
  const cacheKey = 'dashboard-kpis'
  const cached = getCached(cacheKey, 30_000)
  if (cached) return cached

  const [sales, ar, ap, inventory, orders, employees] = await Promise.all([
    supabase.from('pos_transactions').select('total', { count: 'exact' })
      .gte('date', new Date().toISOString().slice(0, 10)),
    supabase.from('accounts_receivable').select('amount, paid_amount')
      .eq('status', '未收款'),
    supabase.from('accounts_payable').select('amount, paid_amount')
      .eq('status', '未付款'),
    supabase.from('stock_levels').select('quantity, sku_name'),
    supabase.from('sales_orders').select('total_amount, status')
      .eq('status', '處理中'),
    supabase.from('employees').select('id', { count: 'exact' })
      .eq('status', '在職'),
  ])

  const result = {
    todaySales: sales.data?.reduce((sum, t) => sum + (t.total || 0), 0) || 0,
    todayTransactions: sales.count || 0,
    outstandingAR: ar.data?.reduce((sum, r) => sum + (r.amount - r.paid_amount), 0) || 0,
    outstandingAP: ap.data?.reduce((sum, r) => sum + (r.amount - r.paid_amount), 0) || 0,
    lowStockItems: inventory.data?.filter(s => (s.quantity || 0) < 10).length || 0,
    totalSKUs: inventory.data?.length || 0,
    pendingOrders: orders.data?.length || 0,
    pendingOrderValue: orders.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0,
    activeEmployees: employees.count || 0,
    timestamp: new Date().toISOString(),
  }

  setCache(cacheKey, result)
  return result
}

/**
 * Sales analytics — daily/weekly/monthly aggregations.
 * Uses materialized view if available, falls back to live query.
 * Cache TTL: 5 minutes.
 */
export async function getSalesAnalytics(period = 'daily', days = 30) {
  const cacheKey = `sales-analytics-${period}-${days}`
  const cached = getCached(cacheKey, 300_000)
  if (cached) return cached

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  // Try materialized view first
  let { data, error } = await supabase
    .from('mv_daily_sales')
    .select('*')
    .gte('date', sinceStr)
    .order('date', { ascending: true })

  // Fallback to live query if MV doesn't exist
  if (error) {
    log.debug('MV not available, using live query', { view: 'mv_daily_sales' })
    const { data: txns } = await supabase
      .from('pos_transactions')
      .select('date, store, total, payment_method')
      .gte('date', sinceStr)
      .order('date', { ascending: true })

    if (txns) {
      // Aggregate in-memory
      const grouped = {}
      for (const t of txns) {
        const key = `${t.date}|${t.store}`
        if (!grouped[key]) {
          grouped[key] = { date: t.date, store: t.store, transaction_count: 0, total_sales: 0, cash_sales: 0, card_sales: 0 }
        }
        grouped[key].transaction_count++
        grouped[key].total_sales += t.total || 0
        if (t.payment_method === '現金') grouped[key].cash_sales += t.total || 0
        else grouped[key].card_sales += t.total || 0
      }
      data = Object.values(grouped)
    }
  }

  const result = data || []
  setCache(cacheKey, result)
  return result
}

/**
 * Customer revenue analytics.
 * Uses materialized view, falls back to AR table.
 * Cache TTL: 10 minutes.
 */
export async function getCustomerRevenue(months = 12) {
  const cacheKey = `customer-revenue-${months}`
  const cached = getCached(cacheKey, 600_000)
  if (cached) return cached

  const since = new Date()
  since.setMonth(since.getMonth() - months)

  let { data, error } = await supabase
    .from('mv_customer_revenue')
    .select('*')
    .gte('month', since.toISOString())
    .order('total_revenue', { ascending: false })

  if (error) {
    log.debug('MV not available, using live query', { view: 'mv_customer_revenue' })
    const { data: arData } = await supabase
      .from('accounts_receivable')
      .select('customer, amount, paid_amount, created_at')
      .gte('created_at', since.toISOString())

    if (arData) {
      const grouped = {}
      for (const r of arData) {
        if (!grouped[r.customer]) {
          grouped[r.customer] = { customer: r.customer, order_count: 0, total_revenue: 0, total_collected: 0 }
        }
        grouped[r.customer].order_count++
        grouped[r.customer].total_revenue += r.amount || 0
        grouped[r.customer].total_collected += r.paid_amount || 0
      }
      data = Object.values(grouped).sort((a, b) => b.total_revenue - a.total_revenue)
    }
  }

  const result = data || []
  setCache(cacheKey, result)
  return result
}

/**
 * Inventory health snapshot.
 * Cache TTL: 1 minute.
 */
export async function getInventoryHealth() {
  const cacheKey = 'inventory-health'
  const cached = getCached(cacheKey, 60_000)
  if (cached) return cached

  const { data: stocks } = await supabase
    .from('stock_levels')
    .select('*')

  if (!stocks) return { items: [], summary: {} }

  const items = stocks.map(s => ({
    sku_name: s.sku_name,
    quantity: s.quantity || 0,
    reserved: s.reserved_qty || 0,
    available: (s.quantity || 0) - (s.reserved_qty || 0),
    status: (s.quantity || 0) <= 0 ? 'out_of_stock'
      : (s.quantity || 0) < 10 ? 'low_stock'
      : 'healthy',
  }))

  const result = {
    items,
    summary: {
      total: items.length,
      healthy: items.filter(i => i.status === 'healthy').length,
      low_stock: items.filter(i => i.status === 'low_stock').length,
      out_of_stock: items.filter(i => i.status === 'out_of_stock').length,
    },
  }

  setCache(cacheKey, result)
  return result
}

/**
 * Refresh all materialized views (call from cron/edge function).
 */
export async function refreshMaterializedViews() {
  const { error } = await supabase.rpc('refresh_materialized_views')
  if (error) {
    log.error('Failed to refresh materialized views', { error })
  } else {
    log.info('Materialized views refreshed')
  }
  // Clear cache to force fresh reads
  _cache.clear()
}

/** Clear read model cache (for testing) */
export function clearReadModelCache() {
  _cache.clear()
}
