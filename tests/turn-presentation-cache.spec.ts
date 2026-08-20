import { describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { buildTurnPresentation } from '../src/client/presentation/build-turn-presentation.ts'
import { TurnPresentationCache } from '../src/client/presentation/turn-presentation-cache.ts'
import { makeAssistant, makeChat, makeNode, makeTail, makeTurn } from './fixtures.ts'

describe('TurnPresentationCache', () => {
  it('同一 turn 发布只构建一次，并在成员或 timeline 引用变化时失效', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const initial = makeChat([context, closing, tail])
    let currentKeys = initial.locations.getTurn(1)
    const locations = {
      ...initial.locations,
      getTurn: (turn: number) => turn === 1 ? currentKeys : [],
    }
    const stableInitial = { ...initial, locations } satisfies ChatSnapshot
    const build = vi.fn(buildTurnPresentation)
    const cache = new TurnPresentationCache(build)

    const first = cache.get(stableInitial, 1)
    expect(cache.get({ ...stableInitial }, 1)).toBe(first)
    expect(build).toHaveBeenCalledTimes(1)

    // DSH 的 content-only 发布会保留 reader，但刷新所属 turn 的 key 数组引用。
    currentKeys = [...currentKeys]
    const contentChanged = { ...stableInitial } satisfies ChatSnapshot
    const second = cache.get(contentChanged, 1)
    expect(second).not.toBe(first)
    expect(build).toHaveBeenCalledTimes(2)

    const nextTurn = makeTurn(1, { status: 'open' })
    const timelineChanged = {
      ...contentChanged,
      timeline: {
        turnOrder: [1],
        turns: new Map([[1, nextTurn]]),
      },
    } satisfies ChatSnapshot
    expect(cache.get(timelineChanged, 1)).not.toBe(second)
    expect(build).toHaveBeenCalledTimes(3)
  })

  it('不同 Chat reader 与 turn 之间不会串用规划', () => {
    const firstChat = makeChat([makeNode('first', 'context')])
    const secondChat = makeChat([makeNode('second', 'context')])
    const build = vi.fn(buildTurnPresentation)
    const cache = new TurnPresentationCache(build)

    expect(cache.get(firstChat, 1)).toBe(cache.get(firstChat, 1))
    expect(cache.get(secondChat, 1)).not.toBe(cache.get(firstChat, 1))
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('缓存令牌读取异常时保持原规划器的 fail-open 行为', () => {
    const chat = makeChat([makeNode('context', 'context')])
    const broken = {
      ...chat,
      locations: {
        ...chat.locations,
        getTurn: () => { throw new Error('broken location index') },
      },
    } satisfies ChatSnapshot
    const cache = new TurnPresentationCache()

    expect(cache.get(broken, 1)).toMatchObject({
      canCollapse: false,
      nodes: new Map(),
    })
  })
})
