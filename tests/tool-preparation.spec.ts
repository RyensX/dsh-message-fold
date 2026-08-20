import { describe, expect, it, vi } from 'vitest'
import {
  conversationContextKey, type ConversationSnapshot, type SessionFace,
  type SettingsScope, type SettingsScopeSnapshot, type StepLocation, type TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageFoldSettings } from '../src/settings-contract.ts'
import {
  buildToolPreparationPresentation,
} from '../src/client/presentation/tool-preparation.ts'
import { ToolPreparationSource } from '../src/client/presentation/tool-preparation-source.ts'
import { makeChat, makeNode, makeToolNode, makeTurn, runningTool } from './fixtures.ts'

// 发布包的 /client 是 DSH loader handoff；纯逻辑测试只替换所用的公开 key 函数。
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  conversationContextKey: (kind: string, id: string) => `${kind.length}:${kind}${id}`,
}))

type AssistantStatus = 'running' | 'settled' | 'interrupted'

interface SnapshotOptions {
  readonly blocks?: readonly Record<string, unknown>[]
  readonly assistantStatus?: AssistantStatus
  readonly formalCallIds?: readonly string[]
  readonly running?: boolean
  readonly openState?: ConversationSnapshot['openState']
  readonly stepStatus?: StepLocation['status']
  readonly turnStatus?: TurnLocation['status']
}

function preparationSnapshot(options: SnapshotOptions = {}): ConversationSnapshot {
  const blocks = options.blocks ?? [{ kind: 'tool-call', callId: '', name: '', argsRaw: '' }]
  const assistant = {
    status: options.assistantStatus ?? 'running',
    turn: 1,
    step: 1,
    blocks,
    time: 2_000,
    ...(options.assistantStatus === 'settled'
      ? { finalNode: { kind: 'assistant', seq: 3, time: 2_000, turn: 1, step: 1 } }
      : {}),
  }
  const stepStatus = options.stepStatus ?? 'open'
  const step = {
    turn: 1,
    step: 1,
    status: stepStatus,
    start: { type: 'step/start', seq: 2, time: 1_100, data: { turn: 1, step: 1 } },
    end: stepStatus === 'closed'
      ? { type: 'step/end', seq: 9, time: 3_000, data: { turn: 1, step: 1 } }
      : undefined,
    data: { get: (key: string) => key === 'assistant-step' ? assistant : undefined },
  } as unknown as StepLocation
  const turnStatus = options.turnStatus ?? 'open'
  const turn = {
    ...makeTurn(1, { status: turnStatus }),
    steps: [step],
  } as TurnLocation
  const user = makeNode('user', 'user')
  const tools = (options.formalCallIds ?? []).map(callId => makeToolNode(
    conversationContextKey('tool-call', callId),
    runningTool(callId, { name: 'native' }),
  ))
  const nodes = [user, ...tools]
  const base = makeChat(nodes, turn, nodes.map(node => node.key))
  const chat = {
    ...base,
    nodes: {
      get: base.nodes.get.bind(base.nodes),
      values: () => { throw new Error('full node scan is forbidden') },
    },
  }
  return {
    chat,
    running: options.running ?? true,
    openState: options.openState ?? 'open',
  } as unknown as ConversationSnapshot
}

class MutableObservable<T> implements HostObservable<T> {
  private readonly listeners = new Set<() => void>()

  constructor(protected value: T) {}

  readonly getSnapshot = (): T => this.value
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setValue(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

function settingsSnapshot(
  enabled: boolean,
  status: SettingsScopeSnapshot<MessageFoldSettings>['status'] = 'ready',
): SettingsScopeSnapshot<MessageFoldSettings> {
  return {
    status,
    value: status === 'ready' ? { showToolPreparation: enabled } : undefined,
    base: undefined,
    user: undefined,
    revision: status === 'ready' ? 1 : undefined,
    writable: status === 'ready',
    mode: 'host',
  }
}

class FakeSettingsScope extends MutableObservable<SettingsScopeSnapshot<MessageFoldSettings>>
  implements SettingsScope<MessageFoldSettings> {
  readonly set = vi.fn(async (field: string, value: unknown) => {
    if (field === 'showToolPreparation' && typeof value === 'boolean') {
      this.setValue(settingsSnapshot(value))
    }
  })
  readonly unset = vi.fn(async () => {})
}

describe('工具调用准备展示派生', () => {
  it('从 block-start 空 block 立即生成通用提示', () => {
    expect(buildToolPreparationPresentation(preparationSnapshot())).toEqual({
      anchorKey: 'user', turn: 1, step: 1, count: 1, name: null,
    })
  })

  it('名称明确后原样保留 wire name，不读取参数内容', () => {
    const result = buildToolPreparationPresentation(preparationSnapshot({
      blocks: [{
        kind: 'tool-call', callId: 'call-1', name: 'web_search',
        argsRaw: '{"secret":"partial"}',
      }],
    }))
    expect(result).toMatchObject({ count: 1, name: 'web_search' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('纯参数 delta 复用上一份展示对象', () => {
    const first = buildToolPreparationPresentation(preparationSnapshot({
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{' }],
    }))
    const next = buildToolPreparationPresentation(preparationSnapshot({
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{"x":1}' }],
    }), first)

    expect(first).not.toBeNull()
    expect(next).toBe(first)
  })

  it('assistant settled 后保留提示，正式 tool/call 节点出现后按 callId 接管', () => {
    const blocks = [{ kind: 'tool-call', callId: 'call-1', name: 'bash', argsRaw: '{}' }]
    expect(buildToolPreparationPresentation(preparationSnapshot({
      blocks, assistantStatus: 'settled',
    }))).toMatchObject({ name: 'bash' })
    expect(buildToolPreparationPresentation(preparationSnapshot({
      blocks, assistantStatus: 'settled', formalCallIds: ['call-1'],
    }))).toBeNull()
  })

  it('多个调用逐项接管，剩余单项恢复显示其原始名称', () => {
    const blocks = [
      { kind: 'tool-call', callId: 'call-1', name: 'bash', argsRaw: '{}' },
      { kind: 'tool-call', callId: 'call-2', name: 'read', argsRaw: '{}' },
    ]
    expect(buildToolPreparationPresentation(preparationSnapshot({ blocks })))
      .toMatchObject({ count: 2, name: null })
    expect(buildToolPreparationPresentation(preparationSnapshot({
      blocks, formalCallIds: ['call-1'],
    }))).toMatchObject({
      anchorKey: conversationContextKey('tool-call', 'call-1'),
      count: 1,
      name: 'read',
    })
  })

  it('取消、关闭、非运行 Session 和异常结构都不增加提示', () => {
    expect(buildToolPreparationPresentation(preparationSnapshot({ assistantStatus: 'interrupted' }))).toBeNull()
    expect(buildToolPreparationPresentation(preparationSnapshot({ stepStatus: 'closed' }))).toBeNull()
    expect(buildToolPreparationPresentation(preparationSnapshot({ turnStatus: 'closed' }))).toBeNull()
    expect(buildToolPreparationPresentation(preparationSnapshot({ running: false }))).toBeNull()
    expect(buildToolPreparationPresentation(preparationSnapshot({ openState: 'loading' }))).toBeNull()
    expect(buildToolPreparationPresentation(preparationSnapshot({
      blocks: [{ kind: 'tool-call', callId: 1, name: 'bad' }],
    }))).toBeNull()
  })
})

describe('ToolPreparationSource', () => {
  it('每 Session 只订阅一次上游，并抑制纯参数 delta 的 React 通知', () => {
    const first = preparationSnapshot({
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{' }],
    })
    const session = new MutableObservable(first)
    const settings = new FakeSettingsScope(settingsSnapshot(true))
    const source = new ToolPreparationSource(session as unknown as SessionFace, settings)
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const offA = source.subscribe(listenerA)
    const offB = source.subscribe(listenerB)
    const beforeDelta = source.getSnapshot()

    expect(session.listenerCount()).toBe(1)
    expect(settings.listenerCount()).toBe(1)

    session.setValue(preparationSnapshot({
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{"x":1}' }],
    }))
    expect(listenerA).not.toHaveBeenCalled()
    expect(source.getSnapshot()).toBe(beforeDelta)

    session.setValue(preparationSnapshot({
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'bash_new', argsRaw: '{"x":1}' }],
    }))
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(1)
    expect(source.getSnapshot()).toMatchObject({ name: 'bash_new' })

    settings.setValue(settingsSnapshot(false))
    expect(source.getSnapshot()).toBeNull()
    expect(listenerA).toHaveBeenCalledTimes(2)

    offA()
    offB()
    expect(session.listenerCount()).toBe(0)
    expect(settings.listenerCount()).toBe(0)
  })

  it('设置未加载时按默认开启处理', () => {
    const session = new MutableObservable(preparationSnapshot())
    const settings = new FakeSettingsScope(settingsSnapshot(false, 'loading'))
    const source = new ToolPreparationSource(session as unknown as SessionFace, settings)
    expect(source.getSnapshot()).toMatchObject({ count: 1 })
  })
})
