import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { SHOW_TOOL_PREPARATION_FIELD } from '../../settings-contract.ts'
import type { MessageFoldSettingsScope } from '../settings/message-fold-settings.ts'
import { toolPreparationEnabled } from '../settings/message-fold-settings.ts'

/** 设置页从注册侧取得的持久化 scope。 */
export interface MessageFoldSettingsSectionInjected {
  readonly settings: MessageFoldSettingsScope
}

export type MessageFoldSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'messageFold'>
  & InjectFace<MessageFoldSettingsSectionInjected>

/** 独立的“消息折叠”设置页。 */
export function MessageFoldSettingsSection({
  settings, t,
}: MessageFoldSettingsSectionProps) {
  const subscribe = useCallback(
    (listener: () => void) => settings.subscribe(listener),
    [settings],
  )
  const getSnapshot = useCallback(() => settings.getSnapshot(), [settings])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const enabled = toolPreparationEnabled(snapshot)
  const writable = snapshot.status === 'ready' && snapshot.writable
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const toggle = async (): Promise<void> => {
    if (!writable || saving) return
    setSaving(true)
    try {
      await settings.set(SHOW_TOOL_PREPARATION_FIELD, !enabled)
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const status = snapshot.status === 'loading'
    ? t('settings.loading')
    : snapshot.status === 'unavailable'
      ? t('settings.unavailable')
      : snapshot.writable ? null : t('settings.readOnly')

  return (
    <section className="dsh-message-fold-settings">
      <h2 className="dsh-message-fold-settings-title">{t('settings.title')}</h2>
      <p className="dsh-message-fold-settings-intro">{t('settings.intro')}</p>
      <div className="dsh-message-fold-settings-row">
        <div className="dsh-message-fold-settings-copy">
          <span className="dsh-message-fold-settings-label">{t('settings.preparation.title')}</span>
          <span className="dsh-message-fold-settings-description">
            {t('settings.preparation.description')}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-message-fold-switch"
          aria-checked={enabled}
          aria-label={t('settings.preparation.title')}
          aria-busy={saving || undefined}
          data-checked={enabled ? 'true' : 'false'}
          disabled={!writable || saving}
          onClick={() => { void toggle() }}
        >
          <span className="dsh-message-fold-switch-thumb" aria-hidden />
        </button>
      </div>
      {status === null ? null : <p className="dsh-message-fold-settings-status">{status}</p>}
    </section>
  )
}
