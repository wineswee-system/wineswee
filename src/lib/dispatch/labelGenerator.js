// Browser-side thermal label generator using native window.print().
// Replace printLabel() with WebSocket/USB HID call for ZPL thermal printers.

export function generateLabelHTML(job) {
  const carrierName = job.carrier_configs?.name ?? '—'
  const destination = job.shipments?.destination ?? ''
  const recipient = job.shipments?.recipient ?? ''
  const recipientPhone = job.shipments?.recipient_phone ?? ''
  const code = job.tracking_number ?? job.job_number

  return `<!DOCTYPE html><html><head><style>
    body{margin:0;font-family:monospace;font-size:12px}
    .label{width:100mm;height:150mm;border:2px solid #000;padding:8px;box-sizing:border-box}
    .carrier{font-size:20px;font-weight:bold;text-align:center;border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:8px}
    .field{margin-bottom:4px}.field label{font-size:10px;color:#555;display:block}
    .barcode{text-align:center;margin:12px 0;font-size:18px;letter-spacing:4px;font-weight:bold}
    .sub{font-size:10px;color:#555;text-align:center}
  </style></head><body>
  <div class="label">
    <div class="carrier">${carrierName}</div>
    <div class="field"><label>收件人</label><strong>${recipient}</strong></div>
    <div class="field"><label>電話</label>${recipientPhone}</div>
    <div class="field"><label>地址</label>${destination}</div>
    <div class="barcode">${code}</div>
    <div class="sub">${job.job_number}</div>
  </div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}<\/script>
  </body></html>`
}

export function printLabel(job) {
  const win = window.open('', '_blank', 'width=420,height=620')
  if (!win) return
  win.document.write(generateLabelHTML(job))
  win.document.close()
}

export function printBatchLabels(jobs) {
  jobs.forEach(j => printLabel(j))
}
