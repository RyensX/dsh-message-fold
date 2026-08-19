import { createElement, type ComponentType } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshSlotRendererDecorator } from '../src/client/adapter/dsh-slot-renderer-decorator.ts'
import type {
  ChatRenderer, ChatRendererProps,
} from '../src/client/adapter/renderer-decorator-port.ts'

afterEach(cleanup)

interface FakeEntry {
  component: unknown
  readonly options: { readonly key?: string; readonly priority?: number }
}

function fakeEntry(key: string, component: unknown, priority = 0): FakeEntry {
  return { component, options: { key, priority } }
}

class FakeSlots {
  readonly ledger: FakeEntry[]
  readonly listeners = new Set<() => void>()
  registerCalls = 0
  failRegister = false
  private scheduled = false

  constructor(entries: readonly FakeEntry[] = []) {
    this.ledger = [...entries]
  }

  entriesOfSlot(): readonly FakeEntry[] {
    const seen = new Set<string | undefined>()
    return [...this.ledger]
      .sort((left, right) => (left.options.priority ?? 0) - (right.options.priority ?? 0))
      .filter((entry) => {
        if (seen.has(entry.options.key)) return false
        seen.add(entry.options.key)
        return true
      })
  }

  subscribe(_key: string, listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  register(options: { readonly key: string }, component: unknown): () => void {
    this.registerCalls += 1
    if (this.failRegister) throw new Error('sentinel failed')
    const entry = fakeEntry(options.key, component)
    this.ledger.push(entry)
    this.schedule()
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = this.ledger.indexOf(entry)
      if (index >= 0) this.ledger.splice(index, 1)
      this.schedule()
    }
  }

  add(entry: FakeEntry): void {
    this.ledger.push(entry)
    this.schedule()
  }

  remove(entry: FakeEntry): void {
    const index = this.ledger.indexOf(entry)
    if (index >= 0) this.ledger.splice(index, 1)
    this.schedule()
  }

  async flush(): Promise<void> {
    for (let index = 0; index < 6; index += 1) await Promise.resolve()
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      for (const listener of this.listeners) listener()
    })
  }
}

const Original: ComponentType<ChatRendererProps> = () => <span>original</span>
const Alternative: ComponentType<ChatRendererProps> = () => <span>alternative</span>
const decorate = (): ChatRenderer => () => <span>decorated</span>

function adapterFor(slots: FakeSlots, report = vi.fn()): DshSlotRendererDecorator {
  return new DshSlotRendererDecorator(slots as never, report)
}

describe('DshSlotRendererDecorator', () => {
  it('包装初始与迟到 winner，并在 HMR entry 替换时恢复旧项', async () => {
    const initial = fakeEntry('assistant-step', Original)
    const slots = new FakeSlots([initial])
    const adapter = adapterFor(slots)
    const dispose = adapter.install(decorate)
    const initialWrapper = initial.component

    expect(initialWrapper).not.toBe(Original)
    await slots.flush()

    const late = fakeEntry('tool-call', Alternative)
    slots.add(late)
    await slots.flush()
    expect(late.component).not.toBe(Alternative)

    const replacement = fakeEntry('assistant-step', Alternative)
    slots.remove(initial)
    slots.add(replacement)
    await slots.flush()
    expect(initial.component).toBe(Original)
    expect(replacement.component).not.toBe(Alternative)

    dispose()
    expect(late.component).toBe(Alternative)
    expect(replacement.component).toBe(Alternative)
  })

  it('优先级切换时只装饰当前 winner', async () => {
    const fallback = fakeEntry('assistant-step', Original, 10)
    const slots = new FakeSlots([fallback])
    const adapter = adapterFor(slots)
    const dispose = adapter.install(decorate)
    expect(fallback.component).not.toBe(Original)

    const preferred = fakeEntry('assistant-step', Alternative, 0)
    slots.add(preferred)
    await slots.flush()
    expect(fallback.component).toBe(Original)
    expect(preferred.component).not.toBe(Alternative)

    slots.remove(preferred)
    await slots.flush()
    expect(preferred.component).toBe(Alternative)
    expect(fallback.component).not.toBe(Original)
    dispose()
  })

  it('同一实例重复安装不会重复包装', () => {
    const entry = fakeEntry('assistant-step', Original)
    const slots = new FakeSlots([entry])
    const adapter = adapterFor(slots)
    const dispose = adapter.install(decorate)
    const wrapper = entry.component
    const disposeDuplicate = adapter.install(decorate)

    expect(entry.component).toBe(wrapper)
    disposeDuplicate()
    expect(entry.component).toBe(wrapper)
    dispose()
    expect(entry.component).toBe(Original)
  })

  it('并存实例通过全局标记避免双层包装，并可在旧实例卸载后接管', async () => {
    const entry = fakeEntry('assistant-step', Original)
    const slots = new FakeSlots([entry])
    const first = adapterFor(slots)
    const second = adapterFor(slots)
    const disposeFirst = first.install(decorate)
    const firstWrapper = entry.component
    const disposeSecond = second.install(decorate)

    expect(entry.component).toBe(firstWrapper)
    disposeFirst()
    await slots.flush()
    expect(entry.component).not.toBe(Original)
    expect(entry.component).not.toBe(firstWrapper)

    disposeSecond()
    expect(entry.component).toBe(Original)
  })

  it('外部装饰者位于外层时不覆盖它，撤销 lease 后内部立即透明', () => {
    const entry = fakeEntry('assistant-step', Original)
    const slots = new FakeSlots([entry])
    const adapter = adapterFor(slots)
    const dispose = adapter.install(decorate)
    const pluginWrapper = entry.component as ComponentType<ChatRendererProps>
    const External: ComponentType<ChatRendererProps> = props => createElement(pluginWrapper, props)
    entry.component = External

    dispose()
    expect(entry.component).toBe(External)
    render(createElement(entry.component as ComponentType<ChatRendererProps>, {}))
    expect(screen.getByText('original')).toBeTruthy()
    expect(screen.queryByText('decorated')).toBeNull()
  })

  it('多个 component 变更只通过一组 sentinel 注册/释放产生一次通知', async () => {
    const first = fakeEntry('assistant-step', Original)
    const second = fakeEntry('tool-call', Alternative)
    const slots = new FakeSlots([first, second])
    const notified = vi.fn()
    slots.subscribe('conversation.chat.node', notified)
    const adapter = adapterFor(slots)
    const dispose = adapter.install(decorate)

    expect(slots.registerCalls).toBe(1)
    await slots.flush()
    expect(notified).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('entry 冻结时回滚全部可恢复项并整体 fail-open', async () => {
    const writable = fakeEntry('assistant-step', Original)
    const frozen = Object.freeze(fakeEntry('tool-call', Alternative))
    const slots = new FakeSlots([writable, frozen])
    const report = vi.fn()
    const adapter = adapterFor(slots, report)
    const dispose = adapter.install(decorate)

    expect(writable.component).toBe(Original)
    expect(frozen.component).toBe(Alternative)
    expect(report).toHaveBeenCalledTimes(1)

    const late = fakeEntry('context', Original)
    slots.add(late)
    await slots.flush()
    expect(late.component).toBe(Original)
    dispose()
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('sentinel 失败或 renderer 形态不支持时回滚并只报告一次', () => {
    const entry = fakeEntry('assistant-step', Original)
    const slots = new FakeSlots([entry])
    slots.failRegister = true
    const report = vi.fn()
    const adapter = adapterFor(slots, report)
    adapter.install(decorate)

    expect(entry.component).toBe(Original)
    expect(report).toHaveBeenCalledTimes(1)

    const invalid = fakeEntry('invalid', {})
    const invalidSlots = new FakeSlots([invalid])
    const invalidReport = vi.fn()
    adapterFor(invalidSlots, invalidReport).install(decorate)
    expect(invalid.component).toEqual({})
    expect(invalidReport).toHaveBeenCalledTimes(1)
  })
})
