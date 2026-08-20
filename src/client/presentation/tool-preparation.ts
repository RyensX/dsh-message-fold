import {
  conversationContextKey, type ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-conversation/client'

type UnknownRecord = Record<string, unknown>

/** 当前尚未由 DSH 正式工具行接管的展示摘要。 */
export interface ToolPreparationPresentation {
  readonly anchorKey: string
  readonly turn: number
  readonly step: number
  readonly count: number
  /** 单项且名称已经明确时保留 wire 原值；不做任何格式化。 */
  readonly name: string | null
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null
}

function assistantData(value: unknown): AssistantChatData | null {
  const data = record(value)
  if (data === null
    || (data.status !== 'running' && data.status !== 'settled' && data.status !== 'interrupted')
    || typeof data.turn !== 'number'
    || typeof data.step !== 'number'
    || !Array.isArray(data.blocks)) return null
  return data as unknown as AssistantChatData
}

function formalToolExists(snapshot: ConversationSnapshot, callId: string): boolean {
  const key = conversationContextKey('tool-call', callId)
  const node = snapshot.chat.nodes.get(key)
  if (node?.kind !== 'tool-call' || node.target !== 'chat') return false
  const root = record(record(node.data)?.root)
  return root?.callId === callId
}

/**
 * 从 DSH 已有的 Step Location data 派生准备提示，不扫描 ChatNodeStore。
 * 任一结构无法确认时宁可不加提示，DSH 原展示仍然保持原样。
 */
export function buildToolPreparationPresentation(
  snapshot: ConversationSnapshot,
  previous: ToolPreparationPresentation | null = null,
): ToolPreparationPresentation | null {
  try {
    if (!snapshot.running || snapshot.openState !== 'open') return null
    const { chat } = snapshot
    const turnNumber = chat.timeline.turnOrder.at(-1)
    if (turnNumber === undefined) return null
    const turn = chat.timeline.turns.get(turnNumber)
    if (turn?.status !== 'open') return null
    const step = turn.steps.at(-1)
    if (step?.status !== 'open') return null
    const assistant = assistantData(step.data.get('assistant-step'))
    if (assistant === null
      || assistant.status === 'interrupted'
      || assistant.turn !== turnNumber
      || assistant.step !== step.step) return null

    let pendingCount = 0
    let pendingName: string | null = null
    for (const block of assistant.blocks) {
      const value = record(block)
      if (value === null) return null
      if (value.kind !== 'tool-call') continue
      if (typeof value.callId !== 'string' || typeof value.name !== 'string') return null
      if (value.callId !== '' && formalToolExists(snapshot, value.callId)) continue
      pendingCount += 1
      pendingName = pendingCount === 1 && value.name !== '' ? value.name : null
    }
    if (pendingCount === 0) return null

    const turnKeys = chat.locations.getTurn(turnNumber)
    const anchorKey = turnKeys.at(-1)
    if (typeof anchorKey !== 'string') return null
    const anchor = chat.nodes.get(anchorKey)
    if (anchor?.target !== 'chat' || anchor.visibility !== 'visible') return null

    if (previous !== null
      && previous.anchorKey === anchorKey
      && previous.turn === turnNumber
      && previous.step === step.step
      && previous.count === pendingCount
      && previous.name === pendingName) return previous

    return {
      anchorKey,
      turn: turnNumber,
      step: step.step,
      count: pendingCount,
      name: pendingName,
    }
  } catch {
    return null
  }
}

export function sameToolPreparation(
  left: ToolPreparationPresentation | null,
  right: ToolPreparationPresentation | null,
): boolean {
  return left === right || (left !== null && right !== null
    && left.anchorKey === right.anchorKey
    && left.turn === right.turn
    && left.step === right.step
    && left.count === right.count
    && left.name === right.name)
}
