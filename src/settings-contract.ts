/** 插件自有的 Host settings 命名空间。 */
export const MESSAGE_FOLD_SETTINGS_NAMESPACE = 'dsh-message-fold'

/** 控制流式工具准备提示的字段。 */
export const SHOW_TOOL_PREPARATION_FIELD = 'showToolPreparation'

/** 工具准备提示默认开启。 */
export const DEFAULT_SHOW_TOOL_PREPARATION = true

/** Host 与 Web client 共享的持久化设置形状。 */
export interface MessageFoldSettings {
  readonly showToolPreparation: boolean
}
