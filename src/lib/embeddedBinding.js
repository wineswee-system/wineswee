// 任務綁定表單「自己填」inline iframe 模式的小工具。
// 重型表單頁（費用 / 調撥 / 稽核）被任務面板用 iframe 以 ?embedded=1 載入時，
// 送出成功後 postMessage 通知父視窗（FillFormModal）關閉 + reload。

export function isEmbeddedBindingFill() {
  try {
    return new URLSearchParams(window.location.search).get('embedded') === '1'
  } catch {
    return false
  }
}

// 在重型表單頁送出成功處呼叫；非 embedded 模式為 no-op。
// bindingId 可不傳，會 fallback 抓 URL 的 binding_id（settle/receipt 段沒帶則為 null）。
export function postBindingFillDone(bindingId) {
  if (!isEmbeddedBindingFill()) return
  try {
    let bid = bindingId
    if (bid == null) {
      const fromUrl = new URLSearchParams(window.location.search).get('binding_id')
      bid = fromUrl != null ? Number(fromUrl) : null
    }
    window.parent?.postMessage(
      { type: 'binding_fill_done', binding_id: bid != null ? Number(bid) : null },
      window.location.origin
    )
  } catch {
    /* noop */
  }
}
