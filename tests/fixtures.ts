import type {
  ChatConversationViewNode, ChatSnapshot, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'

type UnknownRecord = Record<string, unknown>

export interface TurnOptions {
  readonly status?: 'open' | 'closed' | 'unknown'
  readonly reason?: string | null
  readonly startTime?: number
  readonly endTime?: number
}

export function makeTurn(turn = 1, options: TurnOptions = {}): TurnLocation {
  const status = options.status ?? 'closed'
  const startTime = options.startTime ?? 1_000
  const reason = options.reason === undefined ? 'completed' : options.reason
  const endTime = options.endTime ?? 4_000
  return {
    turn,
    status,
    start: {
      type: 'turn/start',
      seq: 1,
      time: startTime,
      data: { turn },
    },
    end: status === 'closed'
      ? {
          type: 'turn/end',
          seq: 99,
          time: endTime,
          data: reason === null ? { turn } : { turn, reason: { kind: reason } },
        }
      : undefined,
    steps: [],
    data: { get: () => undefined },
  } as unknown as TurnLocation
}

export function makeNode(
  key: string,
  kind: string,
  data: unknown = {},
  options: {
    readonly turn?: number
    readonly visibility?: 'visible' | 'hidden'
    readonly anchorSeq?: number
  } = {},
): ChatConversationViewNode {
  const turn = options.turn ?? 1
  return {
    key,
    kind,
    id: key,
    target: 'chat',
    anchorSeq: options.anchorSeq ?? 1,
    visibility: options.visibility ?? 'visible',
    location: { kind: 'turn', turn: makeTurn(turn, { status: 'open' }) },
    data,
  }
}

export function makeAssistant(
  key: string,
  options: {
    readonly turn?: number
    readonly step?: number
    readonly seq?: number
    readonly time?: number
    readonly status?: 'running' | 'settled' | 'interrupted'
    readonly blocks?: readonly UnknownRecord[]
    readonly finalized?: boolean
    readonly visibility?: 'visible' | 'hidden'
  } = {},
): ChatConversationViewNode {
  const turn = options.turn ?? 1
  const step = options.step ?? 1
  const seq = options.seq ?? 20
  const time = options.time ?? 3_000
  const finalized = options.finalized ?? options.status !== 'running'
  const data = {
    status: options.status ?? 'settled',
    turn,
    step,
    blocks: options.blocks ?? [{ kind: 'text', text: key }],
    time,
    ...(finalized ? { finalNode: { kind: 'assistant', seq, time, turn, step } } : {}),
  }
  return makeNode(key, 'assistant-step', data, {
    turn,
    anchorSeq: seq,
    ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
  })
}

export function makeTail(
  key: string,
  closing: ChatConversationViewNode | null,
  turn = 1,
): ChatConversationViewNode {
  return makeNode(key, 'turn-tail', {
    turn,
    seq: 99,
    time: 4_000,
    closing: closing?.data ?? null,
    branchUnavailable: false,
  }, { turn, anchorSeq: 99 })
}

export function runningTool(
  callId: string,
  overrides: UnknownRecord = {},
): UnknownRecord {
  return {
    callId,
    name: 'read',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 2_000,
    callView: { card: 'generic', title: callId, kind: 'read' },
    subCalls: [],
    ...overrides,
  }
}

export function settledTool(
  callId: string,
  overrides: UnknownRecord = {},
): UnknownRecord {
  return {
    kind: 'tool-result',
    seq: 30,
    time: 2_500,
    callId,
    call: { name: 'read', argsRaw: '{}' },
    callTime: 2_000,
    content: [],
    isError: false,
    callView: { card: 'generic', title: callId, kind: 'read' },
    resultView: null,
    subCalls: [],
    ...overrides,
  }
}

export function makeToolNode(key: string, root: unknown): ChatConversationViewNode {
  return makeNode(key, 'tool-call', { root })
}

export function makeChat(
  nodes: readonly ChatConversationViewNode[],
  turn: TurnLocation = makeTurn(),
  keys: readonly string[] = nodes.map(node => node.key),
): ChatSnapshot {
  const byKey = new Map(nodes.map(node => [node.key, node]))
  return {
    order: nodes.filter(node => node.visibility === 'visible').map(node => node.key),
    nodes: {
      get: key => byKey.get(key),
      values: () => [...byKey.values()],
    },
    locations: {
      getTurn: requested => requested === turn.turn ? keys : [],
      getStep: () => [],
    },
    timeline: {
      turnOrder: [turn.turn],
      turns: new Map([[turn.turn, turn]]),
    },
    legacy: {
      nodes: [],
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: null,
      runningCalls: [],
    },
  }
}

export function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen)
  }
  return Object.freeze(value)
}
