import {
  Fragment, createElement, useState, type ComponentType,
} from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatRendererProps,
} from '../src/client/adapter/renderer-decorator-port.ts'
import {
  createDecoratedChatRenderer,
} from '../src/client/components/create-decorated-renderer.tsx'
import { buildTurnPresentation } from '../src/client/presentation/build-turn-presentation.ts'
import { NodeProjectionCache } from '../src/client/presentation/node-projection-cache.ts'
import {
  en, zh, type MessageFoldKey, type MessageFoldTranslate,
} from '../src/client/locales.ts'
import { PresentationStateStore } from '../src/client/presentation/state-store.ts'
import {
  deepFreeze, makeAssistant, makeChat, makeNode, makeTail, makeToolNode, settledTool,
} from './fixtures.ts'
import type { ToolPreparationPresentation } from '../src/client/presentation/tool-preparation.ts'
import { TurnPresentationCache } from '../src/client/presentation/turn-presentation-cache.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronRightOutline14: () => null,
}))

afterEach(cleanup)

class TestLocale {
  private active: 'zh' | 'en' = 'zh'
  private revision = 0
  private snapshot: { readonly active: string; readonly revision: number } = {
    active: this.active,
    revision: this.revision,
  }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly t = ((key: MessageFoldKey, params: Record<string, unknown> = {}) => {
    const template = (this.active === 'zh' ? zh : en)[key]
    return template.replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  }) as MessageFoldTranslate

  setActive(active: 'zh' | 'en'): void {
    this.active = active
    this.revision += 1
    this.snapshot = { active, revision: this.revision }
    for (const listener of this.listeners) listener()
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

function dataOf(node: ChatConversationViewNode): Record<string, unknown> {
  return node.data as Record<string, unknown>
}

function renderNodes(
  nodes: readonly ChatConversationViewNode[],
  Original: ComponentType<ChatRendererProps>,
  options: {
    readonly state?: PresentationStateStore
    readonly presentations?: TurnPresentationCache
    readonly projections?: NodeProjectionCache
    readonly locale?: TestLocale
    readonly preparation?: ToolPreparationPresentation | null
  } = {},
) {
  const chat = makeChat(nodes)
  const snapshot = { chat } as ConversationSnapshot
  const useSession = <Selected,>(selector: (value: ConversationSnapshot) => Selected): Selected =>
    selector(snapshot)
  const state = options.state ?? new PresentationStateStore()
  const presentations = options.presentations ?? new TurnPresentationCache()
  const projections = options.projections ?? new NodeProjectionCache()
  const locale = options.locale ?? new TestLocale()
  const preparation = options.preparation ?? null
  const useMessageFoldPreparation = <Selected,>(
    selector: (value: ToolPreparationPresentation | null) => Selected,
  ): Selected => selector(preparation)
  const Decorated = createDecoratedChatRenderer('test', Original, {
    state,
    presentations,
    projections,
    locale,
    t: locale.t,
  }) as ComponentType<ChatRendererProps>
  const result = render(
    <Fragment>
      {nodes.map(node => createElement(Decorated, {
        key: node.key,
        node,
        sessionId: 'session-a',
        useSession,
        useMessageFoldPreparation,
      }))}
    </Fragment>,
  )
  return { ...result, state, presentations, projections, locale }
}

describe('decorated chat renderer', () => {
  it('同一 turn 的多个 renderer 共享一次展示规划构建', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const build = vi.fn(buildTurnPresentation)
    const presentations = new TurnPresentationCache(build)
    const Original = ({ node }: ChatRendererProps) => (
      <div>{(node as ChatConversationViewNode).key}</div>
    )

    renderNodes([context, closing, tail], Original, { presentations })

    expect(build).toHaveBeenCalledTimes(1)
  })

  it('只让实际展示插件文案的节点订阅 locale', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const locale = new TestLocale()
    const Original = ({ node }: ChatRendererProps) => (
      <div>{(node as ChatConversationViewNode).key}</div>
    )
    const folded = renderNodes([context, closing, tail], Original, { locale })

    expect(locale.listenerCount()).toBe(1)
    folded.unmount()
    expect(locale.listenerCount()).toBe(0)

    const persistent = renderNodes([makeNode('user', 'user')], Original, { locale })
    expect(locale.listenerCount()).toBe(0)
    persistent.unmount()
  })

  it('turn 收起时不挂载工具组状态订阅，展开后再按需订阅', async () => {
    const context = makeNode('context', 'context')
    const first = makeToolNode('tool-a', settledTool('a'))
    const second = makeToolNode('tool-b', settledTool('b'))
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const state = new PresentationStateStore()
    const subscribedKeys: string[] = []
    const subscribe = state.subscribe.bind(state)
    vi.spyOn(state, 'subscribe').mockImplementation((key, listener) => {
      subscribedKeys.push(key)
      return subscribe(key, listener)
    })
    const Original = ({ node }: ChatRendererProps) => (
      <div>{(node as ChatConversationViewNode).key}</div>
    )
    const user = userEvent.setup()
    renderNodes([context, first, second, closing, tail], Original, { state })

    expect(subscribedKeys.some(key => key.includes('tool-group'))).toBe(false)
    await user.click(screen.getByRole('button', { name: /展开中间活动/ }))
    expect(subscribedKeys.some(key => key.includes('tool-group'))).toBe(true)
  })

  it('支持键盘与 ARIA，并只用浅展示投影隐藏最终回答中的 reasoning', async () => {
    const context = deepFreeze(makeNode('context', 'context'))
    const closing = deepFreeze(makeAssistant('closing', {
      blocks: [
        { kind: 'reasoning', text: 'private reasoning' },
        { kind: 'text', text: 'public answer' },
      ],
    }))
    const tail = deepFreeze(makeTail('tail', closing))
    const before = JSON.stringify(closing)
    const received: ChatConversationViewNode[] = []
    const Original = ({ node }: ChatRendererProps) => {
      const value = node as ChatConversationViewNode
      received.push(value)
      const blocks = dataOf(value).blocks
      return (
        <div data-testid={`original-${value.key}`}>
          {Array.isArray(blocks) && blocks.map((block, index) => {
            const item = block as Record<string, unknown>
            return <span key={index} data-block-kind={String(item.kind)}>{String(item.text ?? '')}</span>
          })}
        </div>
      )
    }
    const user = userEvent.setup()
    renderNodes([context, closing, tail], Original)

    const disclosure = screen.getByRole('button', { name: /展开中间活动/ })
    expect(disclosure.getAttribute('type')).toBe('button')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.children[0]?.classList.contains('dsh-message-fold-label')).toBe(true)
    expect(disclosure.children[1]?.classList.contains('dsh-message-fold-chevron')).toBe(true)
    expect(screen.queryByTestId('original-context')).toBeNull()
    expect(screen.queryByText('private reasoning')).toBeNull()
    expect(screen.getByText('public answer')).toBeTruthy()

    const projectedClosing = received.filter(node => node.key === 'closing').at(-1)
    expect(projectedClosing).not.toBe(closing)
    expect(projectedClosing?.data).not.toBe(closing.data)
    expect(JSON.stringify(closing)).toBe(before)

    await user.tab()
    expect(document.activeElement).toBe(disclosure)
    await user.keyboard('{Enter}')

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('original-context')).toBeTruthy()
    expect(screen.getByText('private reasoning')).toBeTruthy()
    expect(received.filter(node => node.key === 'closing').at(-1)).toBe(closing)
    expect(JSON.stringify(closing)).toBe(before)
  })

  it('locale 切换会立即刷新摘要文案', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const locale = new TestLocale()
    const Original = ({ node }: ChatRendererProps) => (
      <div>{(node as ChatConversationViewNode).key}</div>
    )
    renderNodes([context, closing, tail], Original, { locale })

    expect(screen.getByText('耗时 3秒')).toBeTruthy()
    act(() => { locale.setActive('en') })
    expect(screen.getByText('Worked for 3s')).toBeTruthy()
  })

  it('重复渲染时复用最终回答的 reasoning 展示投影', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing', {
      blocks: [
        { kind: 'reasoning', text: 'private reasoning' },
        { kind: 'text', text: 'public answer' },
      ],
    })
    const tail = makeTail('tail', closing)
    const locale = new TestLocale()
    const received: ChatConversationViewNode[] = []
    const Original = ({ node }: ChatRendererProps) => {
      const value = node as ChatConversationViewNode
      if (value.key === 'closing') received.push(value)
      return <div>{value.key}</div>
    }
    renderNodes([context, closing, tail], Original, { locale })
    const first = received.at(-1)

    act(() => { locale.setActive('en') })

    expect(first).not.toBe(closing)
    expect(received.at(-1)).toBe(first)
  })

  it('前置 context 存在时仍把 turn 摘要渲染在 user 与工具之间', () => {
    const preContext = makeNode('pre-context', 'context')
    const userNode = makeNode('user', 'user')
    const postContext = makeNode('post-context', 'context')
    const tool = makeToolNode('tool', settledTool('tool', { isError: true }))
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const Original = ({ node }: ChatRendererProps) => {
      const value = node as ChatConversationViewNode
      return <div data-testid={`original-${value.key}`}>{value.key}</div>
    }
    renderNodes([preContext, userNode, postContext, tool, closing, tail], Original)

    const userElement = screen.getByTestId('original-user')
    const turnButton = screen.getByRole('button', { name: /展开中间活动/ })
    const closingElement = screen.getByTestId('original-closing')
    expect(screen.queryByTestId('original-pre-context')).toBeNull()
    expect(screen.queryByTestId('original-tool')).toBeNull()
    expect(userElement.compareDocumentPosition(turnButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(turnButton.compareDocumentPosition(closingElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('成功和失败工具都进入 turn 折叠，展开后显示组摘要且不显示空 Think', async () => {
    const context = deepFreeze(makeNode('context', 'context'))
    const first = deepFreeze(makeToolNode('tool-a', settledTool('a', { isError: true })))
    const second = deepFreeze(makeToolNode('tool-b', settledTool('b')))
    const closing = deepFreeze(makeAssistant('closing', {
      blocks: [
        { kind: 'reasoning', text: '' },
        { kind: 'text', text: 'public answer' },
      ],
    }))
    const tail = makeTail('tail', closing)
    const before = JSON.stringify([context, first, second, closing])
    const Original = ({ node }: ChatRendererProps) => {
      const value = node as ChatConversationViewNode
      const blocks = dataOf(value).blocks
      return (
        <div data-testid={`original-${value.key}`}>
          {Array.isArray(blocks) && blocks.map((block, index) => {
            const item = block as Record<string, unknown>
            return item.kind === 'reasoning'
              ? <span key={index} data-testid="think-row">Think:{String(item.text ?? '')}</span>
              : <span key={index}>{String(item.text ?? '')}</span>
          })}
        </div>
      )
    }
    const user = userEvent.setup()
    const { container } = renderNodes([context, first, second, closing, tail], Original)

    const turnButton = screen.getByRole('button', { name: /展开中间活动/ })
    expect(screen.queryByRole('button', { name: /工具调用/ })).toBeNull()
    expect(container.querySelector('[data-dsh-message-fold-hidden]')).toBeTruthy()
    expect(screen.queryByTestId('original-context')).toBeNull()
    expect(screen.queryByTestId('original-tool-a')).toBeNull()
    expect(screen.queryByTestId('think-row')).toBeNull()
    expect(screen.getByText('public answer')).toBeTruthy()

    await user.click(turnButton)
    expect(screen.getByRole('button', { name: /展开工具调用: 2 次工具调用.*失败 1/ })).toBeTruthy()
    expect(screen.getByTestId('original-context')).toBeTruthy()
    expect(screen.queryByTestId('think-row')).toBeNull()
    expect(JSON.stringify([context, first, second, closing])).toBe(before)
  })

  it('turn 与工具组的两层状态互相独立', async () => {
    const context = makeNode('context', 'context')
    const first = makeToolNode('tool-a', settledTool('a'))
    const second = makeToolNode('tool-b', settledTool('b'))
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const Original = ({ node }: ChatRendererProps) => {
      const value = node as ChatConversationViewNode
      return <div data-testid={`original-${value.key}`}>{value.key}</div>
    }
    const user = userEvent.setup()
    renderNodes([context, first, second, closing, tail], Original)

    const turnButton = screen.getByRole('button', { name: /展开中间活动/ })
    expect(screen.queryByRole('button', { name: /工具调用/ })).toBeNull()
    await user.click(turnButton)

    const toolsButton = screen.getByRole('button', { name: /展开工具调用/ })
    expect(toolsButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('original-context')).toBeTruthy()
    expect(screen.queryByTestId('original-tool-a')).toBeNull()
    await user.click(toolsButton)

    expect(screen.getByTestId('original-tool-a')).toBeTruthy()
    expect(screen.getByTestId('original-tool-b')).toBeTruthy()
    expect(screen.getByTestId('original-context')).toBeTruthy()
    await user.click(turnButton)

    expect(screen.queryByTestId('original-context')).toBeNull()
    expect(screen.queryByRole('button', { name: /工具调用/ })).toBeNull()
    expect(screen.queryByTestId('original-tool-a')).toBeNull()
    await user.click(turnButton)

    expect(screen.getByRole('button', { name: /折叠工具调用/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('original-tool-a')).toBeTruthy()
    expect(screen.getByTestId('original-tool-b')).toBeTruthy()
  })

  it('隐藏内容重新展开时会重建原 renderer 的局部 UI 状态', async () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const StatefulOriginal = ({ node }: ChatRendererProps) => {
      const value = node as ChatConversationViewNode
      const [count, setCount] = useState(0)
      if (value.key !== 'context') return <div>{value.key}</div>
      return <button type="button" onClick={() => { setCount(current => current + 1) }}>count:{count}</button>
    }
    const user = userEvent.setup()
    renderNodes([context, closing, tail], StatefulOriginal)

    const turnButton = screen.getByRole('button', { name: /展开中间活动/ })
    await user.click(turnButton)
    await user.click(screen.getByRole('button', { name: 'count:0' }))
    expect(screen.getByRole('button', { name: 'count:1' })).toBeTruthy()

    await user.click(turnButton)
    await user.click(turnButton)
    expect(screen.getByRole('button', { name: 'count:0' })).toBeTruthy()
  })

  it('在唯一锚点展示原始工具名，并提供 live status 语义', () => {
    const userNode = makeNode('user', 'user')
    const Original = ({ node }: ChatRendererProps) => (
      <div data-testid="original">{(node as ChatConversationViewNode).key}</div>
    )
    renderNodes([userNode], Original, {
      preparation: {
        anchorKey: 'user', turn: 1, step: 1, count: 1, name: 'web_search',
      },
    })

    const status = screen.getByRole('status')
    expect(status.textContent).toBe('正在准备 web_search 工具调用…')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(screen.getByTestId('original')).toBeTruthy()
  })

  it('工具组尾项被折叠时仍让准备提示占据该流位置', () => {
    const first = makeToolNode('tool-a', settledTool('a'))
    const second = makeToolNode('tool-b', settledTool('b'))
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const Original = ({ node }: ChatRendererProps) => (
      <div data-testid={`original-${(node as ChatConversationViewNode).key}`} />
    )
    renderNodes([first, second, closing, tail], Original, {
      preparation: {
        anchorKey: 'tool-b', turn: 1, step: 1, count: 2, name: null,
      },
    })

    expect(screen.getByRole('status').textContent).toBe('正在准备 2 个工具调用…')
    expect(screen.queryByTestId('original-tool-b')).toBeNull()
  })
})
