import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_SHOW_TOOL_PREPARATION, SHOW_TOOL_PREPARATION_FIELD,
  type MessageFoldSettings,
} from './settings-contract.ts'

/** 由 Host 注册的持久化设置 schema。 */
export const MessageFoldSettingsSchema: z<MessageFoldSettings> = z.object({
  [SHOW_TOOL_PREPARATION_FIELD]: z.boolean().default(DEFAULT_SHOW_TOOL_PREPARATION),
})
