function round2(x) {
  return Math.round(x * 100) / 100;
}

export const PRICING_RULES = {
  basePrice: {
    // 'SKU-001': 1200,
  },

  volumeDiscountTiers: {
    // 'SKU-001': [
    //   { minQty: 1,   discount: 0 },
    //   { minQty: 10,  discount: 0.05 },
    //   { minQty: 50,  discount: 0.10 },
    //   { minQty: 100, discount: 0.15 },
    // ],
  },

  customerSpecificPrice: {
    // 'CUST-001': { 'SKU-001': 1100 },
  },

  promotions: [
    // {
    //   id: 'PROMO-001',
    //   name: '年終特惠',
    //   sku: 'SKU-001',
    //   startDate: '2026-01-01',
    //   endDate: '2026-01-31',
    //   type: 'percentage',
    //   value: 0.1,
    // },
  ],
};

export function calculateLinePrice(sku, qty, customer, date, pricingRules) {
  const rules = pricingRules || PRICING_RULES;
  const basePrice = (rules.basePrice && rules.basePrice[sku]) || 0;
  const candidates = [];

  candidates.push({ unitPrice: basePrice, rule: '基本售價' });

  const tiers = rules.volumeDiscountTiers && rules.volumeDiscountTiers[sku];
  if (tiers && tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => b.minQty - a.minQty);
    const tier = sorted.find(t => qty >= t.minQty);
    if (tier && tier.discount > 0) {
      candidates.push({
        unitPrice: round2(basePrice * (1 - tier.discount)),
        rule: `數量折扣 ${(tier.discount * 100)}%（≥${tier.minQty}）`,
      });
    }
  }

  if (customer && customer.id && rules.customerSpecificPrice) {
    const custPrices = rules.customerSpecificPrice[customer.id];
    if (custPrices && custPrices[sku] != null) {
      candidates.push({ unitPrice: custPrices[sku], rule: '客戶專屬價' });
    }
  }

  if (date && rules.promotions) {
    for (const promo of rules.promotions) {
      if (promo.sku && promo.sku !== sku) continue;
      if (promo.startDate && date < promo.startDate) continue;
      if (promo.endDate && date > promo.endDate) continue;

      let promoPrice = basePrice;
      if (promo.type === 'percentage') {
        promoPrice = round2(basePrice * (1 - (promo.value || 0)));
      } else if (promo.type === 'fixed') {
        promoPrice = round2(basePrice - (promo.value || 0));
      } else if (promo.type === 'price_override') {
        promoPrice = promo.value || 0;
      }
      candidates.push({ unitPrice: promoPrice, rule: `促銷：${promo.name || promo.id}` });
    }
  }

  const best = candidates.reduce((min, c) => c.unitPrice < min.unitPrice ? c : min, candidates[0]);

  return {
    sku,
    qty,
    unitPrice: round2(best.unitPrice),
    lineTotal: round2(best.unitPrice * qty),
    appliedRule: best.rule,
    originalPrice: basePrice,
    discount: round2(basePrice - best.unitPrice),
  };
}

export function calculateOrderTotal(lines, taxRate = 0.05, discountRules = null) {
  const subtotal = round2((lines || []).reduce((s, l) => s + (l.lineTotal || 0), 0));

  let orderDiscount = 0;
  if (discountRules) {
    if (discountRules.type === 'percentage') {
      orderDiscount = round2(subtotal * (discountRules.value || 0));
    } else if (discountRules.type === 'fixed') {
      orderDiscount = round2(Math.min(discountRules.value || 0, subtotal));
    }
  }

  const taxableAmount = round2(subtotal - orderDiscount);
  const tax = round2(taxableAmount * taxRate);
  const total = round2(taxableAmount + tax);

  return {
    subtotal,
    orderDiscount,
    taxableAmount,
    tax,
    taxRate,
    total,
    lines: lines || [],
  };
}

export function applyPromotionCode(order, code, promotions) {
  if (!code || !promotions) {
    return { valid: false, message: '無效的促銷代碼', discount: 0, updatedOrder: order };
  }

  const promo = promotions.find(p => p.code === code);
  if (!promo) {
    return { valid: false, message: '促銷代碼不存在', discount: 0, updatedOrder: order };
  }

  const now = new Date().toISOString().slice(0, 10);
  if (promo.startDate && now < promo.startDate) {
    return { valid: false, message: '促銷活動尚未開始', discount: 0, updatedOrder: order };
  }
  if (promo.endDate && now > promo.endDate) {
    return { valid: false, message: '促銷活動已結束', discount: 0, updatedOrder: order };
  }
  if (promo.maxUses != null && (promo.currentUses || 0) >= promo.maxUses) {
    return { valid: false, message: '促銷代碼已達使用上限', discount: 0, updatedOrder: order };
  }

  const subtotal = order.subtotal || 0;
  if (promo.minOrderAmount && subtotal < promo.minOrderAmount) {
    return {
      valid: false,
      message: `訂單金額未達最低門檻 ${promo.minOrderAmount}`,
      discount: 0,
      updatedOrder: order,
    };
  }

  let discount = 0;
  if (promo.type === 'percentage') {
    discount = round2(subtotal * (promo.value || 0));
  } else if (promo.type === 'fixed') {
    discount = round2(Math.min(promo.value || 0, subtotal));
  }

  return {
    valid: true,
    message: `已套用促銷：${promo.name || promo.code}`,
    discount,
    promoCode: code,
    updatedOrder: {
      ...order,
      promoCode: code,
      promoDiscount: discount,
      total: round2((order.total || subtotal) - discount),
    },
  };
}
