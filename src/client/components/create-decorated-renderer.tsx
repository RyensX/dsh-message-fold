import {
  Fragment, createElement, useCallback, useSyncExternalStore, type ReactNode,
} from 'react'
import type { ChatConversationViewNode, ChatSnapshot, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatRenderer, ChatRendererProps } from '../adapter/renderer-decorator-port.ts'
import {
  toolSummaryText, turnSummaryText, type MessageFoldTranslate,
} from '../locales.ts'
import { buildTurnPresentation } from '../presentation/build-turn-presentation.ts'
import {
  PresentationStateStore, toolGroupStateKey, turnStateKey,
} from '../presentation/state-store.ts'
import { DisclosureButton } from './DisclosureButton.tsx'

type UnknownRecord = Record<string, unknown>
type UseSession = <Selected>(selector: (snapshot: ConversationSnapshot) => Selected) => Selected

export interface LocaleSnapshotSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

export interface DecoratedRendererDependencies {
  readonly state: PresentationStateStore
  readonly locale: LocaleSnapshotSource
  readonly t: MessageFoldTranslate
}

interface DecoratableProps extends ChatRendererProps {
  readonly node: ChatConversationViewNode
  readonly sessionId: string
  readonly useSession: UseSession
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null
}

function decoratableProps(props: ChatRendererProps): DecoratableProps | null {
  const node = record(props.node)
  return node !== null
    && typeof node.key === 'string'
    && typeof node.kind === 'string'
    && typeof props.sessionId === 'string'
    && typeof props.useSession === 'function'
    ? props as DecoratableProps
    : null
}

function turnOf(node: ChatConversationViewNode): number | null {
  const location = record(node.location)
  if (location?.kind !== 'turn' && location?.kind !== 'step') return null
  const turn = record(location.turn)?.turn
  return typeof turn === 'number' ? turn : null
}

function withoutReasoning(node: ChatConversationViewNode): ChatConversationViewNode {
  const data = record(node.data)
  if (data === null || !Array.isArray(data.blocks)) return node
  const blocks = data.blocks.filter(block => record(block)?.kind !== 'reasoning')
  return blocks.length === data.blocks.length ? node : { ...node, data: { ...data, blocks } }
}

function withoutEmptyReasoning(node: ChatConversationViewNode): ChatConversationViewNode {
  const data = record(node.data)
  if (data === null || !Array.isArray(data.blocks)) return node
  const blocks = data.blocks.filter((block) => {
    const value = record(block)
    return value?.kind !== 'reasoning'
      || typeof value.text !== 'string'
      || value.text.trim() !== ''
  })
  return blocks.length === data.blocks.length ? node : { ...node, data: { ...data, blocks } }
}

/** 让样式层只移除插件明确隐藏的 DSH flow 行，避免空行继续占用 column gap。 */
function hiddenFlowItem(): ReactNode {
  return <span hidden data-dsh-message-fold-hidden="" />
}

function useStoredFlag(
  store: PresentationStateStore,
  key: string,
  read: (key: string) => boolean | undefined,
): boolean | undefined {
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [key, store])
  const getSnapshot = useCallback(() => read(key), [key, read])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function originalNode(original: ChatRenderer, props: DecoratableProps, node = props.node): ReactNode {
  return createElement(original, node === props.node ? props : { ...props, node })
}

function ActiveDecoratedRenderer({
  original, props, dependencies,
}: {
  readonly original: ChatRenderer
  readonly props: DecoratableProps
  readonly dependencies: DecoratedRendererDependencies
}) {
  const chat = props.useSession(snapshot => snapshot.chat) as ChatSnapshot
  const turn = turnOf(props.node)
  useSyncExternalStore(dependencies.locale.subscribe, dependencies.locale.getSnapshot, dependencies.locale.getSnapshot)

  // ChatSnapshot 内部 reader 会原地接收迟到节点，不能按 snapshot 身份永久缓存规划。
  const plan = turn === null ? null : buildTurnPresentation(chat, turn)
  const nodePlan = plan?.nodes.get(props.node.key)
  const turnKey = turnStateKey(props.sessionId, turn ?? -1)
  const groupKey = toolGroupStateKey(props.sessionId, turn ?? -1, nodePlan?.toolGroup?.firstKey ?? props.node.key)
  const readTurn = useCallback((key: string) => dependencies.state.getTurn(key), [dependencies.state])
  const readGroup = useCallback((key: string) => dependencies.state.getToolGroup(key), [dependencies.state])
  const turnOverride = useStoredFlag(dependencies.state, turnKey, readTurn)
  const groupOverride = useStoredFlag(dependencies.state, groupKey, readGroup)

  if (plan === null || nodePlan === undefined || turn === null) return originalNode(original, props)
  const collapsed = plan.canCollapse ? turnOverride ?? plan.defaultCollapsed : false
  const groupExpanded = groupOverride ?? false
  const isAnchor = plan.canCollapse && plan.anchorKey === props.node.key

  const turnButton = isAnchor ? (
    <DisclosureButton
      open={!collapsed}
      kind="turn"
      label={turnSummaryText(plan, dependencies.t)}
      actionLabel={dependencies.t(collapsed ? 'turn.expand' : 'turn.collapse')}
      onToggle={() => { dependencies.state.setTurn(turnKey, props.sessionId, !collapsed) }}
    />
  ) : null

  const displayNode = withoutEmptyReasoning(props.node)
  let body: ReactNode
  if (nodePlan.toolGroup !== undefined) {
    if (nodePlan.toolGroupRole === 'leader') {
      body = (
        <div className="dsh-message-fold-stack">
          <DisclosureButton
            open={groupExpanded}
            kind="tools"
            label={toolSummaryText(nodePlan.toolGroup.summary, dependencies.t)}
            actionLabel={dependencies.t(groupExpanded ? 'tools.collapse' : 'tools.expand')}
            onToggle={() => { dependencies.state.setToolGroup(groupKey, props.sessionId, !groupExpanded) }}
          />
          {groupExpanded ? originalNode(original, props, displayNode) : null}
        </div>
      )
    } else {
      body = groupExpanded ? originalNode(original, props, displayNode) : hiddenFlowItem()
    }
  } else {
    body = originalNode(original, props, displayNode)
  }

  if (nodePlan.zone === 'collapsible') {
    if (turnButton !== null) {
      return <div className="dsh-message-fold-stack">{turnButton}{collapsed ? null : body}</div>
    }
    return collapsed ? hiddenFlowItem() : body
  }

  if (nodePlan.zone === 'closing') {
    const closing = collapsed && nodePlan.stripReasoningWhenCollapsed === true
      ? originalNode(original, props, withoutReasoning(props.node))
      : body
    return turnButton === null ? closing : <div className="dsh-message-fold-stack">{turnButton}{closing}</div>
  }

  return body
}

/** 创建一个 renderer wrapper，展示层不需要知道 DSH entry 的内部结构。 */
export function createDecoratedChatRenderer(
  _entryKey: string,
  original: ChatRenderer,
  dependencies: DecoratedRendererDependencies,
): ChatRenderer {
  return function DecoratedChatRenderer(rawProps: ChatRendererProps) {
    const props = decoratableProps(rawProps)
    if (props === null) return createElement(original, rawProps)
    return (
      <Fragment>
        <ActiveDecoratedRenderer original={original} props={props} dependencies={dependencies} />
      </Fragment>
    )
  }
}
