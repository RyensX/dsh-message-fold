const CSS = `
/*
 * DSH 的 flow column 会给零高度节点保留 gap。这个选择器只识别插件自己的
 * 隐藏标记；若上游 DOM 契约变化，兼容改动集中在这里。
 */
[data-chat-flow-key]:has(
  > [data-slot="conversation.chat.node"] > [data-dsh-message-fold-hidden]
) {
  display: none;
}

.dsh-message-fold-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}

.dsh-message-fold-disclosure {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  min-height: 26px;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  margin: 0;
  padding: 2px 0;
  border: 0;
  border-radius: 4px;
  color: var(--dsw-alias-label-secondary, #5f6670);
  background: transparent;
  font: var(--dsw-font-s-14, 400 14px/22px system-ui, sans-serif);
  letter-spacing: 0;
  text-align: left;
  cursor: pointer;
}

.dsh-message-fold-disclosure:hover {
  color: var(--dsw-alias-label-primary, #20242a);
}

.dsh-message-fold-disclosure:focus-visible {
  outline: 2px solid var(--dsw-alias-interactive-focus, #4b75ff);
  outline-offset: 2px;
}

.dsh-message-fold-chevron {
  display: inline-flex;
  flex: 0 0 auto;
  transition: transform 140ms ease;
}

.dsh-message-fold-chevron[data-open="true"] {
  transform: rotate(90deg);
}

.dsh-message-fold-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-message-fold-chevron {
    transition: none;
  }
}
`

/** 只安装插件自有样式，释放函数也只移除这一枚标签。 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-message-fold'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
