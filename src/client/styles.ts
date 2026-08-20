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

.dsh-message-fold-preparation {
  display: inline-flex;
  min-width: 0;
  min-height: 26px;
  align-items: center;
  align-self: flex-start;
  gap: 8px;
  color: var(--dsw-alias-label-secondary, #5f6670);
  font: var(--dsw-font-s-14, 400 14px/22px system-ui, sans-serif);
  overflow-wrap: anywhere;
}

.dsh-message-fold-preparation-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary, #4b75ff);
  animation: dsh-message-fold-pulse 1.2s ease-in-out infinite;
}

@keyframes dsh-message-fold-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.dsh-message-fold-settings {
  display: flex;
  max-width: 720px;
  flex-direction: column;
  gap: 12px;
  color: var(--dsw-alias-label-primary, #20242a);
}

.dsh-message-fold-settings-title {
  margin: 0;
  color: inherit;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}

.dsh-message-fold-settings-intro,
.dsh-message-fold-settings-status {
  margin: 0;
  color: var(--dsw-alias-label-tertiary, #7d848e);
  font-size: 12px;
  line-height: 18px;
}

.dsh-message-fold-settings-row {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
}

.dsh-message-fold-settings-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.dsh-message-fold-settings-label {
  font-size: 14px;
  line-height: 22px;
}

.dsh-message-fold-settings-description {
  color: var(--dsw-alias-label-tertiary, #7d848e);
  font-size: 12px;
  line-height: 18px;
}

.dsh-message-fold-switch {
  position: relative;
  width: 42px;
  height: 24px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: var(--dsw-alias-fill-secondary, #c8cdd4);
  cursor: pointer;
  transition: background-color 140ms ease;
}

.dsh-message-fold-switch[data-checked="true"] {
  background: var(--dsw-alias-brand-primary, #4b75ff);
}

.dsh-message-fold-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-interactive-focus, #4b75ff);
  outline-offset: 2px;
}

.dsh-message-fold-switch:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.dsh-message-fold-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 24%);
  transition: transform 140ms ease;
}

.dsh-message-fold-switch[data-checked="true"] .dsh-message-fold-switch-thumb {
  transform: translateX(18px);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-message-fold-chevron,
  .dsh-message-fold-switch,
  .dsh-message-fold-switch-thumb {
    transition: none;
  }

  .dsh-message-fold-preparation-dot {
    animation: none;
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
