// 把使用者上傳的檔名清成 Supabase Storage 接受的 ASCII 安全格式。
// Storage path 不能含中文、空格、全形符號等 → 整段過濾為 [a-zA-Z0-9_-]+ext。
// DB 內仍存原檔名（供 UI 顯示），這只影響 storage 內部 key。
export function safeStorageName(name) {
  if (!name) return `file_${Date.now()}.bin`
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '') : 'bin'
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'file'
  return `${safe}.${ext || 'bin'}`
}
