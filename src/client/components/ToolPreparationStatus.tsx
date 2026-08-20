import type { ToolPreparationPresentation } from '../presentation/tool-preparation.ts'
import type { MessageFoldTranslate } from '../locales.ts'
import { toolPreparationText } from '../locales.ts'

/** 不创建消息节点的临时工具准备状态行。 */
export function ToolPreparationStatus({
  presentation, t,
}: {
  readonly presentation: ToolPreparationPresentation
  readonly t: MessageFoldTranslate
}) {
  return (
    <div
      className="dsh-message-fold-preparation"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-dsh-message-fold-preparation=""
    >
      <span className="dsh-message-fold-preparation-dot" aria-hidden />
      <span>{toolPreparationText(presentation, t)}</span>
    </div>
  )
}
