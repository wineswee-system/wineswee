function round2(x) {
  return Math.round(x * 100) / 100;
}

export function processReturn(returnRequest, originalSO) {
  const soLineMap = {};
  for (const line of (originalSO.lines || [])) {
    soLineMap[line.lineId] = line;
  }

  const validatedLines = [];
  const rejectedLines = [];
  let totalRefund = 0;

  for (const rl of (returnRequest.lines || [])) {
    const soLine = soLineMap[rl.lineId];
    if (!soLine) {
      rejectedLines.push({ ...rl, rejectReason: '行項目不存在於原訂單' });
      continue;
    }
    if (rl.sku !== soLine.sku) {
      rejectedLines.push({ ...rl, rejectReason: '料號不符' });
      continue;
    }
    if (rl.qty > soLine.qty) {
      rejectedLines.push({ ...rl, rejectReason: `退貨數量 ${rl.qty} 超過原訂單數量 ${soLine.qty}` });
      continue;
    }

    const refundAmount = round2(rl.qty * (soLine.unitPrice || 0));
    totalRefund = round2(totalRefund + refundAmount);

    validatedLines.push({
      lineId: rl.lineId,
      sku: rl.sku,
      qty: rl.qty,
      unitPrice: soLine.unitPrice || 0,
      refundAmount,
      reason: rl.reason || '未指定',
    });
  }

  return {
    valid: rejectedLines.length === 0,
    returnId: returnRequest.returnId || `RET-${Date.now()}`,
    soId: originalSO.soId,
    validatedLines,
    rejectedLines,
    totalRefund,
  };
}

export function createCreditNoteFromReturn(returnRequest, originalInvoice) {
  const taxRate = originalInvoice.taxRate || 0.05;
  const lines = (returnRequest.validatedLines || []).map(vl => ({
    lineId: vl.lineId,
    sku: vl.sku,
    qty: vl.qty,
    unitPrice: vl.unitPrice,
    amount: vl.refundAmount || round2(vl.qty * vl.unitPrice),
    reason: vl.reason,
  }));

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2(subtotal * taxRate);
  const total = round2(subtotal + tax);

  return {
    creditNoteId: `CN-${returnRequest.returnId || Date.now()}`,
    returnId: returnRequest.returnId,
    invoiceId: originalInvoice.invoiceId,
    lines,
    subtotal,
    tax,
    taxRate,
    total,
    createdAt: new Date().toISOString(),
  };
}

export function restockReturnedItems(returnItems) {
  const adjustments = [];
  let restocked = 0;
  let scrapped = 0;

  for (const item of (returnItems || [])) {
    const condition = item.condition || '良品';

    if (condition === '報廢') {
      adjustments.push({
        sku: item.sku,
        qty: item.qty,
        type: '報廢',
        reason: item.reason || '退貨報廢',
        adjustedAt: new Date().toISOString(),
      });
      scrapped += item.qty;
    } else if (condition === '不良品') {
      adjustments.push({
        sku: item.sku,
        qty: item.qty,
        type: '不良品入庫',
        reason: item.reason || '退貨不良品',
        location: '不良品區',
        adjustedAt: new Date().toISOString(),
      });
      restocked += item.qty;
    } else {
      adjustments.push({
        sku: item.sku,
        qty: item.qty,
        type: '良品入庫',
        reason: item.reason || '退貨入庫',
        location: '良品倉',
        adjustedAt: new Date().toISOString(),
      });
      restocked += item.qty;
    }
  }

  return { adjustments, restocked, scrapped };
}
