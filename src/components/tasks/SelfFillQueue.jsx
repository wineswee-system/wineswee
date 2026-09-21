import { useState } from 'react'
import FillFormModal from './FillFormModal'

/**
 * SelfFillQueue — 建立任務後，把「自己填」的綁定表單依序自動跳出來填。
 *
 * 使用者要求：選「自己填」→ 建立任務當下就直接填。任務建立後叫出此佇列，
 * 一張填完（或關閉跳過）自動換下一張，全部處理完 onDone()。
 *
 * props:
 *  - bindings:    Array<binding row>  要填的綁定（已過濾為當下可填的 self 綁定）
 *  - allBindings: Array<binding row>  同任務全部綁定（重型驗收段判斷申請段是否完成用）
 *  - onDone():    全部處理完 / 中途全關閉時呼叫（caller 通常 reload）
 */
export default function SelfFillQueue({ bindings = [], allBindings = [], onDone }) {
  const [idx, setIdx] = useState(0)

  if (!bindings.length || idx >= bindings.length) return null

  const advance = () => {
    if (idx + 1 >= bindings.length) {
      onDone?.()
    } else {
      setIdx(idx + 1)
    }
  }

  return (
    <FillFormModal
      key={bindings[idx].id}
      binding={bindings[idx]}
      bindings={allBindings}
      onClose={advance}   // 關閉(跳過) → 下一張
      onDone={() => {}}   // 送出成功也走 onClose(FillFormModal 內送出成功會呼叫 onClose)
    />
  )
}
