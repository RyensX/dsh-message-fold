import { IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

export interface DisclosureButtonProps {
  readonly open: boolean
  readonly label: string
  readonly actionLabel: string
  readonly kind: 'turn' | 'tools'
  readonly onToggle: () => void
}

/** 使用原生按钮保留键盘、焦点和无障碍语义。 */
export function DisclosureButton({ open, label, actionLabel, kind, onToggle }: DisclosureButtonProps) {
  return (
    <button
      type="button"
      className="dsh-message-fold-disclosure"
      data-kind={kind}
      aria-expanded={open}
      aria-label={`${actionLabel}: ${label}`}
      onClick={onToggle}
    >
      <span className="dsh-message-fold-label">{label}</span>
      <span className="dsh-message-fold-chevron" data-open={open} aria-hidden="true">
        <IconChevronRightOutline14 />
      </span>
    </button>
  )
}
