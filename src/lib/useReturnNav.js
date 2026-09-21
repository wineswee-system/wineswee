import { useSearchParams, useNavigate } from 'react-router-dom'

/**
 * 讀取 URL 的 ?returnTo 參數，回傳一個 navigate-back function。
 * 在 ApprovalCenter 跳過來的業務頁面使用：審核完成後呼叫，自動回儀表板。
 * 若無 returnTo 參數（使用者直接進該頁），回傳 no-op。
 */
export function useReturnNav() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const returnTo = searchParams.get('returnTo')
  return returnTo ? () => navigate(returnTo) : () => {}
}
