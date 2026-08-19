import { describe, expect, it, vi } from 'vitest'
import {
  PresentationStateStore, toolGroupStateKey, turnStateKey,
} from '../src/client/presentation/state-store.ts'

describe('PresentationStateStore', () => {
  it('按 session、turn 和工具组身份隔离状态', () => {
    const store = new PresentationStateStore()
    const turnA = turnStateKey('session-a', 1)
    const turnB = turnStateKey('session-a', 2)
    const group = toolGroupStateKey('session-a', 1, 'tool')

    store.setTurn(turnA, 'session-a', true)
    store.setTurn(turnB, 'session-a', false)
    store.setToolGroup(group, 'session-a', true)

    expect(store.getTurn(turnA)).toBe(true)
    expect(store.getTurn(turnB)).toBe(false)
    expect(store.getToolGroup(group)).toBe(true)
    expect(store.getTurn(group)).toBeUndefined()
  })

  it('只通知发生变化的 key', () => {
    const store = new PresentationStateStore()
    const key = turnStateKey('session-a', 1)
    const listener = vi.fn()
    const dispose = store.subscribe(key, listener)

    store.setTurn(key, 'session-a', true)
    store.setTurn(key, 'session-a', true)
    store.setTurn(key, 'session-a', false)
    dispose()
    store.setTurn(key, 'session-a', true)

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('ready session 清理与插件卸载清理不会影响仍存活的会话', () => {
    const store = new PresentationStateStore()
    const live = turnStateKey('live', 1)
    const removed = turnStateKey('removed', 1)
    const removedGroup = toolGroupStateKey('removed', 1, 'tool')
    store.setTurn(live, 'live', true)
    store.setTurn(removed, 'removed', true)
    store.setToolGroup(removedGroup, 'removed', true)

    store.pruneSessions(new Set(['live']))
    expect(store.getTurn(live)).toBe(true)
    expect(store.getTurn(removed)).toBeUndefined()
    expect(store.getToolGroup(removedGroup)).toBeUndefined()

    store.clear()
    expect(store.getTurn(live)).toBeUndefined()
  })
})
