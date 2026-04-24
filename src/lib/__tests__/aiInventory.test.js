/**
 * AI Inventory & CRM AI — test suite
 *
 * Tests that AI module functions export correctly and validate
 * input/output contracts. Gemini calls are now proxied through the
 * gemini-proxy Edge Function — mock supabase.functions.invoke instead.
 */

// Mock supabase so aiInventory.js and crmAI.js don't make real network calls
vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: {
          data: {
            text: JSON.stringify({
              intent: 'stock_query',
              answer: '庫存查詢結果',
              data: [],
              suggestions: ['建議1'],
              actionable: null,
            }),
          },
        },
        error: null,
      }),
    },
  },
}))

// ═══════════════════════════════════════════════
// AI Inventory module
// ═══════════════════════════════════════════════

describe('AI-INV-01: Module Exports', () => {
  test('aiInventory exports all 12 functions', async () => {
    const mod = await import('../aiInventory')
    const expectedFns = [
      'queryInventoryNL',
      'aiForecastDemand',
      'smartReorderPlan',
      'wasteReductionPlan',
      'assessSupplierRisk',
      'deadStockAdvisor',
      'optimizeSlotting',
      'dynamicSafetyStock',
      'crossStoreBalancing',
      'parseReceiptOCR',
      'predictQuality',
      'inventoryHealthReport',
    ]
    for (const fn of expectedFns) {
      expect(typeof mod[fn]).toBe('function')
    }
  })

  test('isAIConfigured always returns true (key is server-side)', async () => {
    const mod = await import('../aiInventory')
    expect(typeof mod.isAIConfigured).toBe('function')
    expect(mod.isAIConfigured()).toBe(true)
  })
})

// ═══════════════════════════════════════════════
// CRM AI module
// ═══════════════════════════════════════════════

describe('AI-CRM-01: CRM AI Module Exports', () => {
  test('crmAI exports expected functions', async () => {
    const mod = await import('../ai/crmAI')
    expect(typeof mod.generateCampaignCopy).toBe('function')
    expect(typeof mod.generateTicketReply).toBe('function')
    expect(typeof mod.aiLeadScore).toBe('function')
    expect(typeof mod.nlToSegmentRules).toBe('function')
    expect(typeof mod.isConfigured).toBe('function')
  })

  test('isConfigured returns boolean', async () => {
    const mod = await import('../ai/crmAI')
    expect(typeof mod.isConfigured()).toBe('boolean')
  })
})

// ═══════════════════════════════════════════════
// Demand Forecast AI wrapper
// ═══════════════════════════════════════════════

describe('AI-INV-02: Demand Forecast Pure Functions', () => {
  test('aggregateDemand + autoForecast integration', async () => {
    const { aggregateDemand, autoForecast } = await import('../demandForecast')
    const txns = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(2025, 0, i + 1).toISOString(),
      qty: 10 + Math.floor(Math.random() * 5),
      type: 'OUT',
    }))
    const demand = aggregateDemand(txns, 'daily')
    expect(demand.length).toBeGreaterThan(0)

    const data = demand.map(d => d.demand)
    const result = autoForecast(data, 12, 3)
    expect(result.forecast).toHaveLength(3)
    expect(result.method).toBeTruthy()
  })
})
