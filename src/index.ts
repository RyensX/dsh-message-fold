import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MESSAGE_FOLD_SETTINGS_NAMESPACE } from './settings-contract.ts'
import { MessageFoldSettingsSchema } from './settings-schema.ts'

export {
  DEFAULT_SHOW_TOOL_PREPARATION, MESSAGE_FOLD_SETTINGS_NAMESPACE,
  SHOW_TOOL_PREPARATION_FIELD, type MessageFoldSettings,
} from './settings-contract.ts'

/** 注册插件自有设置；没有 settings provider 的组合仍可加载浏览器展示层。 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(MESSAGE_FOLD_SETTINGS_NAMESPACE),
      MessageFoldSettingsSchema,
    )
  })
}
