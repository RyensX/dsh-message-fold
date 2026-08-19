import type { ChatConversationViewNode, ChatSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  NodePresentation, NodeZone, ToolGroupPlan, ToolSummary, TurnPresentation,
} from './model.ts'
import { summarizeToolNodes } from './tool-summary.ts'

type UnknownRecord = Record<string, unknown>

const PERSISTENT_KINDS = new Set([
  'user', 'steering', 'command-input', 'turn-tail', 'turn-error', 'turn-max-tokens',
])
const INPUT_KINDS = new Set(['user', 'steering', 'command-input'])
const COLLAPSIBLE_KINDS = new Set([
  'assistant-step', 'context', 'command', 'manual-compaction', 'compaction', 'model-retry', 'tool-call', 'workflow-run',
])
const ALLOWED_END_REASONS = new Set(['completed', 'blocked', 'error', 'max-tokens'])
const ASSISTANT_STATUSES = new Set(['running', 'settled', 'interrupted'])
const WORKFLOW_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled', 'interrupted'])

interface MaterializedTurn {
  readonly all: readonly ChatConversationViewNode[]
  readonly visible: readonly ChatConversationViewNode[]
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null
}

function materializeTurn(chat: ChatSnapshot, turn: number): MaterializedTurn | null {
  const keys = chat.locations.getTurn(turn)
  if (!Array.isArray(keys)) return null
  const seen = new Set<string>()
  const all: ChatConversationViewNode[] = []
  for (const key of keys) {
    if (typeof key !== 'string' || seen.has(key)) return null
    seen.add(key)
    const node = chat.nodes.get(key)
    if (node === undefined
      || node.key !== key
      || node.target !== 'chat'
      || (node.visibility !== 'visible' && node.visibility !== 'hidden')) return null
    all.push(node)
  }
  return { all, visible: all.filter(node => node.visibility === 'visible') }
}

function blocksOf(node: ChatConversationViewNode): readonly UnknownRecord[] {
  const blocks = record(node.data)?.blocks
  return Array.isArray(blocks)
    ? blocks.map(record).filter((block): block is UnknownRecord => block !== null)
    : []
}

function finalNodeOf(node: ChatConversationViewNode): UnknownRecord | null {
  return record(record(node.data)?.finalNode)
}

function assistantIsWellFormed(node: ChatConversationViewNode): boolean {
  const data = record(node.data)
  if (data === null
    || !ASSISTANT_STATUSES.has(String(data.status))
    || typeof data.turn !== 'number'
    || typeof data.step !== 'number'
    || !Array.isArray(data.blocks)
    || data.blocks.some(block => record(block) === null)) return false
  const finalNode = data.finalNode
  return finalNode === undefined || (record(finalNode) !== null && typeof record(finalNode)?.seq === 'number')
}

function hasText(node: ChatConversationViewNode): boolean {
  return blocksOf(node).some(block => block.kind === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
}

function hasToolCallBlock(node: ChatConversationViewNode): boolean {
  return blocksOf(node).some(block => block.kind === 'tool-call')
}

function hasReasoningBlock(node: ChatConversationViewNode): boolean {
  return blocksOf(node).some(block => block.kind === 'reasoning' && typeof block.text === 'string')
}

function hasVisibleReasoning(node: ChatConversationViewNode): boolean {
  return blocksOf(node).some(block => block.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '')
}

function matchingAssistant(
  nodes: readonly ChatConversationViewNode[],
  candidate: UnknownRecord,
  expectedTurn: number,
): ChatConversationViewNode | null {
  const candidateFinal = record(candidate.finalNode)
  const seq = candidateFinal?.seq
  const turn = candidate.turn
  const step = candidate.step
  if (typeof seq !== 'number' || turn !== expectedTurn || typeof step !== 'number') return null
  return nodes.find((node) => {
    if (node.kind !== 'assistant-step' || !assistantIsWellFormed(node)) return false
    const data = record(node.data)
    return data?.turn === turn && data.step === step && finalNodeOf(node)?.seq === seq
  }) ?? null
}

function closedClosing(
  nodes: readonly ChatConversationViewNode[],
  expectedTurn: number,
): ChatConversationViewNode | null {
  const tail = nodes.findLast(node => node.kind === 'turn-tail')
  const closing = record(record(tail?.data)?.closing)
  return closing === null ? null : matchingAssistant(nodes, closing, expectedTurn)
}

function provisionalClosing(
  allNodes: readonly ChatConversationViewNode[],
  expectedTurn: number,
): ChatConversationViewNode | null {
  const candidate = allNodes.at(-1)
  if (candidate?.kind !== 'assistant-step'
    || candidate.visibility !== 'visible'
    || !assistantIsWellFormed(candidate)) return null
  const data = record(candidate.data)
  if (data?.status !== 'settled' || data.turn !== expectedTurn || finalNodeOf(candidate) === null) return null
  return hasText(candidate) && !hasToolCallBlock(candidate) ? candidate : null
}

function workflowStatus(node: ChatConversationViewNode): string | null {
  const value = record(node.data)?.status
  return typeof value === 'string' && WORKFLOW_STATUSES.has(value) ? value : null
}

function endReason(turn: TurnLocation): string | null {
  const reason = record(turn.end?.data.reason)?.kind
  return typeof reason === 'string' ? reason : null
}

function nodeTime(node: ChatConversationViewNode): number | null {
  const finalTime = finalNodeOf(node)?.time
  if (typeof finalTime === 'number') return finalTime
  const time = record(node.data)?.time
  return typeof time === 'number' ? time : null
}

function durationOf(turn: TurnLocation, closing: ChatConversationViewNode | null): number | null {
  const start = turn.start?.time
  const end = turn.end?.time ?? (closing === null ? undefined : nodeTime(closing) ?? undefined)
  return typeof start === 'number'
    && typeof end === 'number'
    && Number.isFinite(start)
    && Number.isFinite(end)
    && end >= start
    ? end - start
    : null
}

function structurallySafe(node: ChatConversationViewNode): boolean {
  if (node.kind === 'assistant-step') return assistantIsWellFormed(node)
  if (node.kind === 'tool-call') return summarizeToolNodes([node]) !== null
  if (node.kind === 'workflow-run') return workflowStatus(node) !== null
  return record(node.data) !== null
}

function emptyPresentation(turn: number): TurnPresentation {
  return {
    turn,
    canCollapse: false,
    defaultCollapsed: false,
    anchorKey: null,
    closingKey: null,
    collapsibleCount: 0,
    durationMs: null,
    nodes: new Map(),
  }
}

/** 为一个 turn 构建完整展示规划；无法确认的内容一律保留原样。 */
export function buildTurnPresentation(chat: ChatSnapshot, turnNumber: number): TurnPresentation {
  try {
    const materialized = materializeTurn(chat, turnNumber)
    const turn = chat.timeline.turns.get(turnNumber)
    if (materialized === null || turn === undefined || materialized.visible.length === 0) {
      return emptyPresentation(turnNumber)
    }

    const nodes = materialized.visible
    const closing = turn.status === 'closed'
      ? closedClosing(nodes, turnNumber)
      : turn.status === 'open' ? provisionalClosing(materialized.all, turnNumber) : null
    const closingIndex = closing === null ? -1 : nodes.indexOf(closing)
    const plans = new Map<string, NodePresentation>()
    const activeKeys = new Set<string>()

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      if (node === undefined) continue
      let zone: NodeZone
      if (node === closing) zone = 'closing'
      else if (closingIndex >= 0 && index > closingIndex) zone = 'persistent'
      else if (PERSISTENT_KINDS.has(node.kind) || !COLLAPSIBLE_KINDS.has(node.kind)) zone = 'persistent'
      else if (!structurallySafe(node)) zone = 'persistent'
      else if (node.kind === 'workflow-run') {
        const status = workflowStatus(node)
        zone = status === 'failed' || status === 'cancelled' || status === 'interrupted'
          ? 'persistent'
          : 'collapsible'
        if (status === 'running') activeKeys.add(node.key)
      } else {
        zone = 'collapsible'
      }
      plans.set(node.key, { zone })
    }

    // 工具组独立于整个 turn 的折叠；无效工具会成为边界，不会拖累相邻有效组。
    const validTools = new Map<string, ToolSummary>()
    for (const node of nodes) {
      if (node.kind !== 'tool-call') continue
      const summary = summarizeToolNodes([node])
      if (summary !== null) validTools.set(node.key, summary)
    }
    for (let index = 0; index < nodes.length;) {
      const first = nodes[index]
      if (first?.kind !== 'tool-call' || !validTools.has(first.key)) {
        index += 1
        continue
      }
      let end = index + 1
      while (nodes[end]?.kind === 'tool-call' && validTools.has(nodes[end]?.key ?? '')) end += 1
      const groupNodes = nodes.slice(index, end)
      const summary = summarizeToolNodes(groupNodes)
      if (summary === null) {
        for (const node of groupNodes) plans.set(node.key, { zone: 'persistent' })
        index = end
        continue
      }
      // 成功和失败工具使用相同的 turn 折叠语义；最终回答之后的调用例外，
      // 它们必须留在原位置，不能被前面的收尾摘要遮住。
      const persistent = closingIndex >= 0 && index > closingIndex
      if (summary.running > 0) for (const node of groupNodes) activeKeys.add(node.key)
      const group: ToolGroupPlan | undefined = groupNodes.length >= 2
        ? { firstKey: first.key, memberKeys: groupNodes.map(node => node.key), summary }
        : undefined
      for (let member = 0; member < groupNodes.length; member += 1) {
        const node = groupNodes[member]
        if (node === undefined) continue
        const current = plans.get(node.key)
        const zone = persistent ? 'persistent' : current?.zone ?? 'collapsible'
        plans.set(node.key, group === undefined
          ? { zone }
          : { zone, toolGroup: group, toolGroupRole: member === 0 ? 'leader' : 'member' })
      }
      index = end
    }

    const closingHasReasoningBlock = closing !== null && hasReasoningBlock(closing)
    const closingHasVisibleReasoning = closing !== null && hasVisibleReasoning(closing)
    if (closing !== null) {
      plans.set(closing.key, {
        zone: 'closing',
        ...(closingHasReasoningBlock ? { stripReasoningWhenCollapsed: true as const } : {}),
      })
    }

    const collapsibleKeys = nodes
      .filter(node => plans.get(node.key)?.zone === 'collapsible')
      .map(node => node.key)
    // 空 reasoning 会在 renderer 中静默过滤，不应单独制造一条 turn 折叠摘要。
    const collapsibleCount = collapsibleKeys.length + (closingHasVisibleReasoning ? 1 : 0)
    const reason = endReason(turn)
    const endAllowsCollapse = turn.status === 'open'
      || (turn.status === 'closed' && reason !== null && ALLOWED_END_REASONS.has(reason))
    const canCollapse = closing !== null && collapsibleCount > 0 && endAllowsCollapse
    const lastInputIndex = closingIndex < 0
      ? -1
      : nodes.findLastIndex((node, index) => index < closingIndex && INPUT_KINDS.has(node.kind))
    // 前置 context 可能排在 user 之前。摘要必须锚定在最后一条输入之后，
    // 否则本轮工具被隐藏后，入口会看起来属于上一轮。
    const postInputAnchor = lastInputIndex < 0
      ? undefined
      : nodes.find((node, index) =>
          index > lastInputIndex && plans.get(node.key)?.zone === 'collapsible')?.key
    const anchorKey = canCollapse ? postInputAnchor ?? (lastInputIndex >= 0 ? closing.key : collapsibleKeys[0] ?? closing.key) : null
    const hasActive = [...activeKeys].some(key => plans.get(key)?.zone === 'collapsible')

    return {
      turn: turnNumber,
      canCollapse,
      defaultCollapsed: canCollapse && !hasActive,
      anchorKey,
      closingKey: closing?.key ?? null,
      collapsibleCount,
      durationMs: durationOf(turn, closing),
      nodes: plans,
    }
  } catch {
    return emptyPresentation(turnNumber)
  }
}
