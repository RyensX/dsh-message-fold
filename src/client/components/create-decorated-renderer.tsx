import {
  createElement, useCallback, useSyncExternalStore, type ReactNode,
} from 'react'
import type { ChatConversationViewNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatRenderer, ChatRendererProps } from '../adapter/renderer-decorator-port.ts'
import {
  toolSummaryText, turnSummaryText, type MessageFoldTranslate,
} from '../locales.ts'
import {
  PresentationStateStore, toolGroupStateKey, turnStateKey,
} from '../presentation/state-store.ts'
import type { NodeProjectionCache } from '../presentation/node-projection-cache.ts'
import type { ToolPreparationPresentation } from '../presentation/tool-preparation.ts'
import type { TurnPresentationCache } from '../presentation/turn-presentation-cache.ts'
import { DisclosureButton } from './DisclosureButton.tsx'
import { ToolPreparationStatus } from './ToolPreparationStatus.tsx'

type UnknownRecord = Record<string, unknown>
type UseSession = <Selected>(selector: (snapshot: ConversationSnapshot) => Selected) => Selected
type UseToolPreparation = <Selected>(
  selector: (snapshot: ToolPreparationPresentation | null) => Selected,
) => Selected

export interface LocaleSnapshotSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

export interface DecoratedRendererDependencies {
  readonly state: PresentationStateStore
  readonly presentations: TurnPresentationCache
  readonly projections: NodeProjectionCache
  readonly locale: LocaleSnapshotSource
  readonly t: MessageFoldTranslate
}

interface DecoratableProps extends ChatRendererProps {
  readonly node: ChatConversationViewNode
  readonly sessionId: string
  readonly useSession: UseSession
  readonly useMessageFoldPreparation: UseToolPreparation
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
    && typeof props.useMessageFoldPreparation === 'function'
    ? props as DecoratableProps
    : null
}

function turnOf(node: ChatConversationViewNode): number | null {
  const location = record(node.location)
  if (location?.kind !== 'turn' && location?.kind !== 'step') return null
  const turn = record(location.turn)?.turn
  return typeof turn === 'number' ? turn : null
}

/** 让样式层只移除插件明确隐藏的 DSH flow 行，避免空行继续占用 column gap。 */
function hiddenFlowItem(): ReactNode {
  return <span hidden data-dsh-message-fold-hidden="" />
}

const disabledSubscribe = (_listener: () => void): (() => void) => () => {}
const disabledSnapshot = (): undefined => undefined

function useStoredFlag(
  store: PresentationStateStore,
  key: string,
  read: (key: string) => boolean | undefined,
  enabled: boolean,
): boolean | undefined {
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [key, store])
  const getSnapshot = useCallback(() => read(key), [key, read])
  return useSyncExternalStore(
    enabled ? subscribe : disabledSubscribe,
    enabled ? getSnapshot : disabledSnapshot,
    enabled ? getSnapshot : disabledSnapshot,
  )
}

function originalNode(original: ChatRenderer, props: DecoratableProps, node = props.node): ReactNode {
  return createElement(original, node === props.node ? props : { ...props, node })
}

function useLocaleRevision(
  dependencies: DecoratedRendererDependencies,
  enabled: boolean,
): void {
  useSyncExternalStore(
    enabled ? dependencies.locale.subscribe : disabledSubscribe,
    enabled ? dependencies.locale.getSnapshot : disabledSnapshot,
    enabled ? dependencies.locale.getSnapshot : disabledSnapshot,
  )
}

function ActiveDecoratedRenderer({
  original, props, dependencies,
}: {
  readonly original: ChatRenderer
  readonly props: DecoratableProps
  readonly dependencies: DecoratedRendererDependencies
}) {
  const turn = turnOf(props.node)
  const selectPlan = useCallback(
    (snapshot: ConversationSnapshot) => turn === null
      ? null
      : dependencies.presentations.get(snapshot.chat, turn),
    [dependencies.presentations, turn],
  )
  const plan = props.useSession(selectPlan)
  const preparation = props.useMessageFoldPreparation(value =>
    value?.anchorKey === props.node.key ? value : null)
  const nodePlan = plan?.nodes.get(props.node.key)
  const observesTurnState = plan?.canCollapse === true && nodePlan !== undefined && (
    nodePlan.zone === 'collapsible'
    || (nodePlan.zone === 'closing'
      && (nodePlan.stripReasoningWhenCollapsed === true || plan.anchorKey === props.node.key))
  )
  const turnKey = turnStateKey(props.sessionId, turn ?? -1)
  const readTurn = useCallback((key: string) => dependencies.state.getTurn(key), [dependencies.state])
  const turnOverride = useStoredFlag(dependencies.state, turnKey, readTurn, observesTurnState)
  const collapsed = plan?.canCollapse === true ? turnOverride ?? plan.defaultCollapsed : false
  const isAnchor = plan?.canCollapse === true && plan.anchorKey === props.node.key
  const groupVisible = nodePlan?.toolGroup !== undefined
    && !(nodePlan.zone === 'collapsible' && collapsed)
  const groupKey = toolGroupStateKey(
    props.sessionId,
    turn ?? -1,
    nodePlan?.toolGroup?.firstKey ?? props.node.key,
  )
  const readGroup = useCallback((key: string) => dependencies.state.getToolGroup(key), [dependencies.state])
  const groupOverride = useStoredFlag(dependencies.state, groupKey, readGroup, groupVisible)
  const groupExpanded = groupOverride ?? false
  const showsToolDisclosure = groupVisible && nodePlan?.toolGroupRole === 'leader'
  useLocaleRevision(dependencies, preparation !== null || isAnchor || showsToolDisclosure)

  if (plan === null || nodePlan === undefined || turn === null) {
    const originalBody = originalNode(original, props)
    return preparation === null ? originalBody : (
      <div className="dsh-message-fold-stack">
        {originalBody}
        <ToolPreparationStatus presentation={preparation} t={dependencies.t} />
      </div>
    )
  }

  const turnButton = isAnchor ? (
    <DisclosureButton
      open={!collapsed}
      kind="turn"
      label={turnSummaryText(plan, dependencies.t)}
      actionLabel={dependencies.t(collapsed ? 'turn.expand' : 'turn.collapse')}
      onToggle={() => { dependencies.state.setTurn(turnKey, props.sessionId, !collapsed) }}
    />
  ) : null

  const displayNode = dependencies.projections.withoutEmptyReasoning(props.node)
  let body: ReactNode
  let bodyIsOnlyHiddenMarker = false
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
      bodyIsOnlyHiddenMarker = !groupExpanded
      body = groupExpanded ? originalNode(original, props, displayNode) : hiddenFlowItem()
    }
  } else {
    body = originalNode(original, props, displayNode)
  }

  let rendered: ReactNode
  let renderedIsOnlyHiddenMarker = false
  if (nodePlan.zone === 'collapsible') {
    if (turnButton !== null) {
      rendered = <div className="dsh-message-fold-stack">{turnButton}{collapsed ? null : body}</div>
    } else if (collapsed) {
      rendered = hiddenFlowItem()
      renderedIsOnlyHiddenMarker = true
    } else {
      rendered = body
      renderedIsOnlyHiddenMarker = bodyIsOnlyHiddenMarker
    }
  } else if (nodePlan.zone === 'closing') {
    const closing = collapsed && nodePlan.stripReasoningWhenCollapsed === true
      ? originalNode(original, props, dependencies.projections.withoutReasoning(props.node))
      : body
    rendered = turnButton === null
      ? closing
      : <div className="dsh-message-fold-stack">{turnButton}{closing}</div>
  } else {
    rendered = body
    renderedIsOnlyHiddenMarker = bodyIsOnlyHiddenMarker
  }

  if (preparation === null) return rendered
  return (
    <div className="dsh-message-fold-stack">
      {renderedIsOnlyHiddenMarker ? null : rendered}
      <ToolPreparationStatus presentation={preparation} t={dependencies.t} />
    </div>
  )
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
    return <ActiveDecoratedRenderer original={original} props={props} dependencies={dependencies} />
  }
}
