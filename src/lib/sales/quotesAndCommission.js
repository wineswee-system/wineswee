function round2(x) {
  return Math.round(x * 100) / 100;
}

export const QUOTE_VALIDITY_DAYS = 30;

export function checkQuoteExpiry(quote, currentDate) {
  const validity = quote.validityDays || QUOTE_VALIDITY_DAYS;
  const created = new Date(quote.createdAt);
  const expiry = quote.expiryDate
    ? new Date(quote.expiryDate)
    : new Date(created.getTime() + validity * 24 * 60 * 60 * 1000);
  const expiryStr = expiry.toISOString().slice(0, 10);

  const current = new Date(currentDate);
  const diffMs = expiry.getTime() - current.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  let status;
  if (daysRemaining < 0) {
    status = '已過期';
  } else if (daysRemaining <= 7) {
    status = '即將到期';
  } else {
    status = '有效';
  }

  return {
    status,
    quoteId: quote.quoteId,
    expiryDate: expiryStr,
    daysRemaining: Math.max(daysRemaining, 0),
  };
}

export function getExpiringQuotes(quotes, currentDate, daysAhead = 7) {
  return (quotes || [])
    .map(q => checkQuoteExpiry(q, currentDate))
    .filter(r => r.status === '已過期' || (r.status === '即將到期' && r.daysRemaining <= daysAhead))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export const COMMISSION_RULES = {
  tiers: [
    { minMarginPct: 0,    commissionPct: 0.02 },
    { minMarginPct: 0.10, commissionPct: 0.04 },
    { minMarginPct: 0.20, commissionPct: 0.06 },
    { minMarginPct: 0.30, commissionPct: 0.08 },
  ],
  levelMultiplier: {
    junior:  1.0,
    senior:  1.15,
    manager: 1.25,
  },
};

export function calculateCommission(salesAmount, costAmount, repLevel, rules) {
  const r = rules || COMMISSION_RULES;
  const margin = salesAmount - costAmount;
  const marginPct = salesAmount > 0 ? margin / salesAmount : 0;

  const sortedTiers = [...(r.tiers || [])].sort((a, b) => b.minMarginPct - a.minMarginPct);
  const tier = sortedTiers.find(t => marginPct >= t.minMarginPct) || { commissionPct: 0 };

  const multiplier = (r.levelMultiplier && r.levelMultiplier[repLevel]) || 1.0;
  const effectivePct = tier.commissionPct * multiplier;
  const commission = round2(salesAmount * effectivePct);

  return {
    commission,
    marginPct: round2(marginPct * 100) / 100,
    commissionPct: round2(effectivePct * 100) / 100,
    basePct: tier.commissionPct,
    level: repLevel || 'junior',
    multiplier,
    salesAmount,
    costAmount,
    margin: round2(margin),
  };
}

export function generateCommissionReport(reps, sales, period) {
  const filteredSales = (sales || []).filter(s => {
    if (period && period.start && s.date < period.start) return false;
    if (period && period.end && s.date > period.end) return false;
    return true;
  });

  const repMap = {};
  for (const rep of (reps || [])) {
    repMap[rep.repId] = rep;
  }

  const byRep = {};
  for (const sale of filteredSales) {
    if (!byRep[sale.repId]) {
      const rep = repMap[sale.repId] || { repId: sale.repId, name: '未知', level: 'junior' };
      byRep[sale.repId] = {
        repId: sale.repId,
        name: rep.name,
        level: rep.level,
        totalSales: 0,
        totalCost: 0,
        totalCommission: 0,
        dealCount: 0,
        details: [],
      };
    }
    const entry = byRep[sale.repId];
    const comm = calculateCommission(
      sale.salesAmount, sale.costAmount, entry.level
    );

    entry.totalSales = round2(entry.totalSales + sale.salesAmount);
    entry.totalCost = round2(entry.totalCost + sale.costAmount);
    entry.totalCommission = round2(entry.totalCommission + comm.commission);
    entry.dealCount += 1;
    entry.details.push({
      date: sale.date,
      salesAmount: sale.salesAmount,
      costAmount: sale.costAmount,
      commission: comm.commission,
      marginPct: comm.marginPct,
    });
  }

  const summary = Object.values(byRep).sort((a, b) => b.totalCommission - a.totalCommission);
  const grandTotalCommission = round2(summary.reduce((s, r) => s + r.totalCommission, 0));
  const grandTotalSales = round2(summary.reduce((s, r) => s + r.totalSales, 0));

  return {
    period: period || { start: null, end: null },
    grandTotalSales,
    grandTotalCommission,
    repCount: summary.length,
    summary,
  };
}
