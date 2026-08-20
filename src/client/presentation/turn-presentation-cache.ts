import type { ChatLocationNodeIndex, ChatSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import { buildTurnPresentation } from './build-turn-presentation.ts'
import type { TurnPresentation } from './model.ts'

type BuildTurnPresentation = (chat: ChatSnapshot, turn: number) => TurnPresentation

interface CachedTurnPresentation {
  readonly locations: ChatLocationNodeIndex
  readonly turnNumber: number
  readonly turn: TurnLocation | undefined
  readonly value: TurnPresentation
}

/**
 * 复用同一次 turn 发布对应的展示规划。DSH 会在 turn 成员内容变化时刷新
 * getTurn() 的数组引用，timeline 变化则刷新 TurnLocation 引用；任一变化都会失效。
 */
export class TurnPresentationCache {
  private readonly entries = new WeakMap<readonly string[], CachedTurnPresentation>()

  constructor(private readonly build: BuildTurnPresentation = buildTurnPresentation) {}

  get(chat: ChatSnapshot, turnNumber: number): TurnPresentation {
    let keys: readonly string[]
    let turn: TurnLocation | undefined
    try {
      keys = chat.locations.getTurn(turnNumber)
      turn = chat.timeline.turns.get(turnNumber)
    } catch {
      // 缓存令牌异常时仍交给原规划器按既有 fail-open 语义处理。
      return this.build(chat, turnNumber)
    }
    if (!Array.isArray(keys)) return this.build(chat, turnNumber)

    const cached = this.entries.get(keys)
    if (cached?.locations === chat.locations
      && cached.turnNumber === turnNumber
      && cached.turn === turn) return cached.value

    const value = this.build(chat, turnNumber)
    this.entries.set(keys, { locations: chat.locations, turnNumber, turn, value })
    return value
  }
}
