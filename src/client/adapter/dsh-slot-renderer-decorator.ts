import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatRenderer, ChatRendererDecorator, ChatRendererProps, RendererDecoratorPort,
} from './renderer-decorator-port.ts'

const SLOT = 'conversation.chat.node'
const PLUGIN_ID = 'dsh-message-fold'
const MARKER = Symbol.for('dsh-message-fold.renderer-decoration')

interface SlotRegistryPort {
  entriesOfSlot(key: typeof SLOT): readonly StoredEntry[]
  subscribe(key: typeof SLOT, listener: () => void): () => void
  register: unknown
}

interface DecorationMarker {
  readonly pluginId: typeof PLUGIN_ID
  readonly original: ChatRenderer
  readonly lease: DecorationLease
}

type MarkedRenderer = ChatRenderer & { [MARKER]?: DecorationMarker }

interface ManagedEntry {
  readonly entry: StoredEntry
  readonly original: ChatRenderer
  readonly wrapper: ChatRenderer
  readonly lease: DecorationLease
}

class DecorationLease {
  private active = true
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): boolean => this.active
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  revoke(): void {
    if (!this.active) return
    this.active = false
    for (const listener of this.listeners) listener()
  }
}

function markerOf(component: unknown): DecorationMarker | undefined {
  if ((typeof component !== 'function' && (typeof component !== 'object' || component === null))) return undefined
  return (component as MarkedRenderer)[MARKER]
}

function isRenderer(component: unknown): component is ChatRenderer {
  return typeof component === 'function'
    || (typeof component === 'object' && component !== null && '$$typeof' in component)
}

function leasedRenderer(
  original: ChatRenderer,
  decorated: ChatRenderer,
  lease: DecorationLease,
): ChatRenderer {
  const LeasedRenderer: ComponentType<ChatRendererProps> = (props) => {
    const active = useSyncExternalStore(lease.subscribe, lease.getSnapshot, lease.getSnapshot)
    return createElement(active ? decorated : original, props)
  }
  Object.defineProperty(LeasedRenderer, MARKER, {
    configurable: false,
    enumerable: false,
    value: { pluginId: PLUGIN_ID, original, lease } satisfies DecorationMarker,
    writable: false,
  })
  return LeasedRenderer
}

function randomSentinelKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `__dsh_message_fold_registry_bump__:${uuid}`
}

/**
 * 当前 DSH 兼容适配器。对 StoredEntry 的直接访问只允许留在本文件，
 * 上游提供稳定装饰 API 后可以整体替换这里。
 */
export class DshSlotRendererDecorator implements RendererDecoratorPort {
  private readonly managed = new Map<StoredEntry, ManagedEntry>()
  private readonly sentinelKey = randomSentinelKey()
  private unsubscribe = (): void => {}
  private decorate: ChatRendererDecorator | undefined
  private installed = false
  private disabled = false
  private disposed = false
  private errorReported = false

  constructor(
    private readonly slots: SlotRegistryPort,
    private readonly reportError: (error: unknown) => void = error => {
      console.error('[dsh-message-fold] renderer decoration disabled:', error)
    },
  ) {}

  install(decorate: ChatRendererDecorator): () => void {
    if (this.installed) return () => {}
    this.installed = true
    this.decorate = decorate
    this.unsubscribe = this.slots.subscribe(SLOT, () => { this.reconcileSafely() })
    this.reconcileSafely()
    return () => { this.dispose() }
  }

  private reconcileSafely(): void {
    if (this.disabled || this.disposed || this.decorate === undefined) return
    try {
      let changed = false
      const entries = this.slots.entriesOfSlot(SLOT)
      const winners = new Set(entries)
      for (const [entry, managed] of this.managed) {
        if (winners.has(entry)) continue
        managed.lease.revoke()
        if (entry.component === managed.wrapper) {
          if (!Reflect.set(entry, 'component', managed.original) || entry.component !== managed.original) {
            throw new Error(`StoredEntry.component is not writable for ${String(entry.options.key)}`)
          }
          changed = true
        }
        this.managed.delete(entry)
      }

      for (const entry of entries) {
        if (this.managed.has(entry)) continue
        const existingMarker = markerOf(entry.component)
        if (existingMarker?.pluginId === PLUGIN_ID && existingMarker.lease.getSnapshot()) continue
        const original = existingMarker?.pluginId === PLUGIN_ID ? existingMarker.original : entry.component
        const entryKey = entry.options.key
        if (typeof entryKey !== 'string' || !isRenderer(original)) {
          throw new Error(`unsupported ${SLOT} entry for key ${String(entryKey)}`)
        }
        const decorated = this.decorate(entryKey, original)
        if (!isRenderer(decorated)) throw new Error(`decorator returned an invalid renderer for ${entryKey}`)
        const lease = new DecorationLease()
        const wrapper = leasedRenderer(original, decorated, lease)
        const managed = { entry, original, wrapper, lease }
        this.managed.set(entry, managed)
        if (!Reflect.set(entry, 'component', wrapper) || entry.component !== wrapper) {
          throw new Error(`StoredEntry.component is not writable for ${entryKey}`)
        }
        changed = true
      }
      if (changed) this.bumpVersion()
    } catch (error) {
      this.disable(error)
    }
  }

  private bumpVersion(): void {
    if (typeof this.slots.register !== 'function') {
      throw new Error('slot registry register() is unavailable')
    }
    const register = this.slots.register as (
      options: { name: typeof SLOT; key: string }, component: ChatRenderer,
    ) => () => void
    const dispose = register.call(this.slots, { name: SLOT, key: this.sentinelKey }, () => null)
    if (typeof dispose !== 'function') throw new Error('slot registry register() returned no disposer')
    dispose()
  }

  private disable(error: unknown): void {
    if (this.disabled) return
    this.disabled = true
    this.unsubscribe()
    this.restoreManaged()
    this.reportOnce(error)
  }

  private restoreManaged(): boolean {
    let directlyRestored = false
    for (const managed of this.managed.values()) {
      managed.lease.revoke()
      if (managed.entry.component !== managed.wrapper) continue
      try {
        const restored = Reflect.set(managed.entry, 'component', managed.original)
          && managed.entry.component === managed.original
        directlyRestored = restored || directlyRestored
      } catch {
        // 即使迟到的冻结阻止直接恢复，已撤销的 lease 仍会透明透传原 renderer。
      }
    }
    this.managed.clear()
    return directlyRestored
  }

  private reportOnce(error: unknown): void {
    if (this.errorReported) return
    this.errorReported = true
    this.reportError(error)
  }

  private dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    const directlyRestored = this.restoreManaged()
    if (directlyRestored && !this.disabled) {
      try {
        this.bumpVersion()
      } catch (error) {
        // 已撤销的 wrapper 仍然透明；这里只报告 registry 通知能力不兼容。
        this.reportOnce(error)
      }
    }
  }
}
