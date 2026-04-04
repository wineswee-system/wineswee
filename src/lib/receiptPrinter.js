/**
 * Receipt Printer — Browser print dialog & ESC/POS thermal printer support
 */

// Generate receipt HTML for browser print
export function generateReceiptHTML(transaction, options = {}) {
  const { companyName = '商店', companyAddress = '', companyTaxId = '', cashierName = '' } = options;

  const items = (transaction.items || []).map(item => `
    <tr>
      <td style="text-align:left">${item.name}</td>
      <td style="text-align:center">${item.quantity || item.qty}</td>
      <td style="text-align:right">${item.price}</td>
      <td style="text-align:right">${(item.quantity || item.qty) * item.price}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { size: 80mm auto; margin: 0; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          width: 72mm;
          margin: 4mm;
          color: #000;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 1px 0; font-size: 11px; }
        .store-name { font-size: 16px; font-weight: bold; }
        .total-line { font-size: 14px; font-weight: bold; }
        .footer { font-size: 10px; color: #666; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="center">
        <div class="store-name">${companyName}</div>
        ${companyAddress ? `<div>${companyAddress}</div>` : ''}
        ${companyTaxId ? `<div>統編: ${companyTaxId}</div>` : ''}
      </div>
      <div class="divider"></div>
      <div>交易編號: ${transaction.transactionNumber || ''}</div>
      <div>日期: ${new Date(transaction.date || Date.now()).toLocaleString('zh-TW')}</div>
      ${cashierName ? `<div>收銀員: ${cashierName}</div>` : ''}
      <div class="divider"></div>
      <table>
        <thead>
          <tr>
            <td><b>品名</b></td>
            <td class="center"><b>數量</b></td>
            <td class="right"><b>單價</b></td>
            <td class="right"><b>小計</b></td>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
      <div class="divider"></div>
      <div class="right total-line">
        合計: NT$ ${(transaction.totalAmount || 0).toLocaleString()}
      </div>
      <div class="right">
        付款方式: ${transaction.paymentMethod || '現金'}
      </div>
      ${transaction.cashReceived ? `
        <div class="right">收款: NT$ ${transaction.cashReceived.toLocaleString()}</div>
        <div class="right">找零: NT$ ${(transaction.cashReceived - transaction.totalAmount).toLocaleString()}</div>
      ` : ''}
      <div class="divider"></div>
      ${transaction.invoiceNumber ? `
        <div class="center">
          <div>電子發票</div>
          <div class="bold">${transaction.invoiceNumber}</div>
        </div>
        <div class="divider"></div>
      ` : ''}
      <div class="center footer">
        <div>感謝惠顧</div>
        <div>${new Date().toLocaleDateString('zh-TW')}</div>
      </div>
    </body>
    </html>
  `;
}

// Print receipt via browser print dialog
export function printReceipt(transaction, options = {}) {
  try {
    const html = generateReceiptHTML(transaction, options);
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    if (!printWindow) {
      alert('無法開啟列印視窗，請確認瀏覽器未封鎖彈出視窗。');
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    // Auto-print after content loads
    printWindow.onload = () => {
      printWindow.print();
      // Close after print dialog (with delay for the dialog)
      setTimeout(() => printWindow.close(), 1000);
    };
  } catch (err) {
    console.error('列印收據失敗:', err);
    alert('列印收據失敗：' + (err.message || '未知錯誤'));
  }
}

// Generate shift report HTML for browser print
export function generateShiftReportHTML(shift, transactions = [], options = {}) {
  const { companyName = '商店' } = options;

  // Aggregate payment method totals from transactions
  const paymentTotals = {};
  let totalSales = 0;
  transactions.forEach(t => {
    const method = t.payment_method || '現金';
    paymentTotals[method] = (paymentTotals[method] || 0) + (t.total || 0);
    totalSales += (t.total || 0);
  });

  // If no transactions, fall back to shift summary data
  if (transactions.length === 0) {
    totalSales = shift.total_sales || 0;
  }

  const paymentRows = Object.entries(paymentTotals).map(([method, amount]) => `
    <tr>
      <td style="text-align:left">${method}</td>
      <td style="text-align:right">NT$ ${amount.toLocaleString()}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { size: 80mm auto; margin: 0; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          width: 72mm;
          margin: 4mm;
          color: #000;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; font-size: 11px; }
        .title { font-size: 16px; font-weight: bold; }
        .total-line { font-size: 14px; font-weight: bold; }
        .footer { font-size: 10px; color: #666; margin-top: 8px; }
        .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
      </style>
    </head>
    <body>
      <div class="center">
        <div class="title">${companyName}</div>
        <div style="font-size:14px; font-weight:bold; margin-top:4px;">日結報表</div>
      </div>
      <div class="divider"></div>
      <div class="row"><span>門市:</span><span class="bold">${shift.store || '-'}</span></div>
      <div class="row"><span>收銀員:</span><span class="bold">${shift.cashier || '-'}</span></div>
      <div class="row"><span>開始時間:</span><span>${shift.shift_start || '-'}</span></div>
      <div class="row"><span>結束時間:</span><span>${shift.shift_end || new Date().toLocaleString('zh-TW')}</span></div>
      <div class="divider"></div>
      <div class="center bold" style="margin-bottom:4px;">交易統計</div>
      <div class="row"><span>交易筆數:</span><span class="bold">${transactions.length || shift.total_transactions || 0}</span></div>
      <div class="row"><span>總營業額:</span><span class="bold">NT$ ${totalSales.toLocaleString()}</span></div>
      <div class="divider"></div>
      <div class="center bold" style="margin-bottom:4px;">付款方式明細</div>
      ${paymentRows || '<div class="center" style="color:#666;">無明細資料</div>'}
      <div class="divider"></div>
      <div class="row total-line"><span>總計:</span><span>NT$ ${totalSales.toLocaleString()}</span></div>
      ${shift.cash_difference !== undefined && shift.cash_difference !== null ? `
        <div class="divider"></div>
        <div class="center bold" style="margin-bottom:4px;">現金結算</div>
        <div class="row"><span>現金差異:</span><span style="font-weight:bold; ${shift.cash_difference !== 0 ? 'color:red;' : ''}">${
          shift.cash_difference === 0 ? '無差異' : `NT$ ${shift.cash_difference.toLocaleString()}${shift.cash_difference > 0 ? ' (溢收)' : ' (短收)'}`
        }</span></div>
      ` : ''}
      <div class="divider"></div>
      <div class="center footer">
        <div>列印時間: ${new Date().toLocaleString('zh-TW')}</div>
      </div>
    </body>
    </html>
  `;
}

// Print shift report via browser print dialog
export function printShiftReport(shift, transactions = [], options = {}) {
  try {
    const html = generateShiftReportHTML(shift, transactions, options);
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    if (!printWindow) {
      alert('無法開啟列印視窗，請確認瀏覽器未封鎖彈出視窗。');
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
      setTimeout(() => printWindow.close(), 1000);
    };
  } catch (err) {
    console.error('列印日結報表失敗:', err);
    alert('列印日結報表失敗：' + (err.message || '未知錯誤'));
  }
}

// Generate ESC/POS commands for thermal printers (for future USB/network printer support)
export function generateESCPOS(transaction, options = {}) {
  // ESC/POS is a binary protocol for thermal printers
  // This generates a text representation that could be sent to a printer via Web Serial API
  const lines = [];
  const { companyName = '商店', companyTaxId = '' } = options;

  // ESC @ = Initialize printer
  // ESC a 1 = Center align
  lines.push('\x1B\x40'); // Initialize
  lines.push('\x1B\x61\x01'); // Center
  lines.push('\x1D\x21\x11'); // Double height+width
  lines.push(companyName + '\n');
  lines.push('\x1D\x21\x00'); // Normal size
  if (companyTaxId) lines.push(`統編: ${companyTaxId}\n`);
  lines.push('\x1B\x61\x00'); // Left align
  lines.push('--------------------------------\n');
  lines.push(`交易: ${transaction.transactionNumber || ''}\n`);
  lines.push(`日期: ${new Date(transaction.date || Date.now()).toLocaleString('zh-TW')}\n`);
  lines.push('--------------------------------\n');

  (transaction.items || []).forEach(item => {
    const qty = item.quantity || item.qty;
    const name = (item.name || '').padEnd(12);
    const qtyStr = String(qty).padStart(3);
    const price = String(item.price).padStart(6);
    const total = String(qty * item.price).padStart(7);
    lines.push(`${name} ${qtyStr} ${price} ${total}\n`);
  });

  lines.push('--------------------------------\n');
  lines.push('\x1D\x21\x01'); // Double height
  lines.push(`合計: NT$ ${(transaction.totalAmount || 0).toLocaleString()}\n`);
  lines.push('\x1D\x21\x00'); // Normal
  lines.push(`付款: ${transaction.paymentMethod || '現金'}\n`);

  if (transaction.cashReceived) {
    lines.push(`收款: NT$ ${transaction.cashReceived.toLocaleString()}\n`);
    lines.push(`找零: NT$ ${(transaction.cashReceived - transaction.totalAmount).toLocaleString()}\n`);
  }

  lines.push('--------------------------------\n');

  if (transaction.invoiceNumber) {
    lines.push('\x1B\x61\x01'); // Center
    lines.push(`電子發票: ${transaction.invoiceNumber}\n`);
  }

  lines.push('\x1B\x61\x01'); // Center
  lines.push('感謝惠顧\n\n\n');
  lines.push('\x1D\x56\x00'); // Cut paper

  return lines.join('');
}

// Connect to thermal printer via Web Serial API (Chrome only)
export async function connectThermalPrinter() {
  if (!('serial' in navigator)) {
    return { connected: false, error: '瀏覽器不支援 Web Serial API' };
  }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    return { connected: true, port };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

// Send ESC/POS data to connected printer
export async function printToThermal(port, escposData) {
  if (!port?.writable) throw new Error('Printer not connected');
  const writer = port.writable.getWriter();
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(escposData));
  writer.releaseLock();
}
