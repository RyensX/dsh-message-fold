import type {
  SettingsScope, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_SHOW_TOOL_PREPARATION, type MessageFoldSettings,
} from '../../settings-contract.ts'

export type MessageFoldSettingsScope = SettingsScope<MessageFoldSettings>

/** 设置尚未加载或 Host 不提供持久化时保持产品默认开启。 */
export function toolPreparationEnabled(
  snapshot: SettingsScopeSnapshot<MessageFoldSettings>,
): boolean {
  return snapshot.status === 'ready'
    ? snapshot.value?.showToolPreparation ?? DEFAULT_SHOW_TOOL_PREPARATION
    : DEFAULT_SHOW_TOOL_PREPARATION
}
