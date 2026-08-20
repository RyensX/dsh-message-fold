import { describe, expect, it } from 'vitest'
import { NodeProjectionCache } from '../src/client/presentation/node-projection-cache.ts'
import { deepFreeze, makeAssistant } from './fixtures.ts'

describe('NodeProjectionCache', () => {
  it('按 node 身份复用投影且不修改原始 blocks', () => {
    const node = deepFreeze(makeAssistant('answer', {
      blocks: [
        { kind: 'reasoning', text: 'visible think' },
        { kind: 'reasoning', text: '   ' },
        { kind: 'text', text: 'answer' },
      ],
    }))
    const before = JSON.stringify(node)
    const cache = new NodeProjectionCache()

    const withoutEmpty = cache.withoutEmptyReasoning(node)
    const withoutAny = cache.withoutReasoning(node)

    expect(cache.withoutEmptyReasoning(node)).toBe(withoutEmpty)
    expect(cache.withoutReasoning(node)).toBe(withoutAny)
    expect((withoutEmpty.data as { blocks: unknown[] }).blocks).toHaveLength(2)
    expect((withoutAny.data as { blocks: unknown[] }).blocks).toHaveLength(1)
    expect(JSON.stringify(node)).toBe(before)
  })

  it('无需过滤时返回原 node，新 node 身份使用独立投影', () => {
    const first = makeAssistant('answer', {
      blocks: [{ kind: 'text', text: 'first' }],
    })
    const second = makeAssistant('answer', {
      blocks: [{ kind: 'reasoning', text: '' }, { kind: 'text', text: 'second' }],
    })
    const cache = new NodeProjectionCache()

    expect(cache.withoutEmptyReasoning(first)).toBe(first)
    expect(cache.withoutEmptyReasoning(second)).not.toBe(first)
    expect(cache.withoutEmptyReasoning(second)).not.toBe(second)
  })

  it('保持旧过滤逻辑对稀疏 blocks 的压实行为', () => {
    const blocks = new Array<Record<string, unknown>>(2)
    blocks[1] = { kind: 'text', text: 'answer' }
    const node = makeAssistant('answer', { blocks })
    const cache = new NodeProjectionCache()

    const projected = cache.withoutEmptyReasoning(node)

    expect(projected).not.toBe(node)
    expect((projected.data as { blocks: unknown[] }).blocks).toEqual([
      { kind: 'text', text: 'answer' },
    ])
  })
})
