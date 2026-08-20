import type {
  ConversationSnapshot, SessionBinding, SessionFace, SettingsScope,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageFoldSettings } from '../../settings-contract.ts'
import { toolPreparationEnabled } from '../settings/message-fold-settings.ts'
import {
  buildToolPreparationPresentation, sameToolPreparation,
  type ToolPreparationPresentation,
} from './tool-preparation.ts'

type Listener = () => void

/**
 * 每个 Session 只有一个上游订阅。参数流仍会触发轻量派生，但展示摘要不变时
 * 不通知 React，从而避免每个参数 token 重绘会话消息。
 */
export class ToolPreparationSource implements HostObservable<ToolPreparationPresentation | null> {
  private snapshot: ToolPreparationPresentation | null
  private readonly listeners = new Set<Listener>()
  private stopSession: (() => void) | undefined
  private stopSettings: (() => void) | undefined

  constructor(
    private readonly session: SessionFace,
    private readonly settings: SettingsScope<MessageFoldSettings>,
  ) {
    this.snapshot = this.read(null)
  }

  readonly getSnapshot = (): ToolPreparationPresentation | null => {
    // 无订阅者时没有上游监听；首次挂载前同步追上最新值。
    if (this.listeners.size === 0) this.adopt(this.read(this.snapshot), false)
    return this.snapshot
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  dispose(): void {
    this.stop()
    this.listeners.clear()
  }

  private read(previous: ToolPreparationPresentation | null): ToolPreparationPresentation | null {
    if (!toolPreparationEnabled(this.settings.getSnapshot())) return null
    return buildToolPreparationPresentation(this.session.getSnapshot(), previous)
  }

  private recompute = (): void => { this.adopt(this.read(this.snapshot), true) }

  private adopt(next: ToolPreparationPresentation | null, notify: boolean): void {
    if (sameToolPreparation(this.snapshot, next)) return
    this.snapshot = next
    if (!notify) return
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-message-fold] preparation subscriber failed:', error)
      }
    }
  }

  private start(): void {
    this.adopt(this.read(this.snapshot), false)
    this.stopSession = this.session.subscribe(this.recompute)
    this.stopSettings = this.settings.subscribe(this.recompute)
  }

  private stop(): void {
    this.stopSession?.()
    this.stopSettings?.()
    this.stopSession = undefined
    this.stopSettings = undefined
  }
}

/** 同一 Session scope 在 standard-kit 重物化时继续复用同一个派生源。 */
export class ToolPreparationSourceRegistry {
  private readonly sources = new WeakMap<SessionFace, ToolPreparationSource>()

  constructor(private readonly settings: SettingsScope<MessageFoldSettings>) {}

  sourceFor(binding: SessionBinding): ToolPreparationSource {
    const existing = this.sources.get(binding.session)
    if (existing !== undefined) return existing
    const source = new ToolPreparationSource(binding.session, this.settings)
    this.sources.set(binding.session, source)
    return source
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** dsh-message-fold 派生的当前工具准备提示。 */
    useMessageFoldPreparation: import('@deepseek-ai/dsh-client-ui-slots').SnapshotSelectorHook<
      ToolPreparationPresentation | null
    >
  }
}
