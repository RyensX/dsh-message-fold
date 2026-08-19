import { describe, expect, it } from 'vitest'
import { buildTurnPresentation } from '../src/client/presentation/build-turn-presentation.ts'
import { summarizeToolNodes } from '../src/client/presentation/tool-summary.ts'
import {
  deepFreeze, makeAssistant, makeChat, makeNode, makeTail, makeToolNode, makeTurn,
  runningTool, settledTool,
} from './fixtures.ts'

describe('summarizeToolNodes', () => {
  it('递归统计子调用，并按 resultView 到 callView 的顺序分类', () => {
    const runningChild = runningTool('child-running', {
      callView: { card: 'terminal', title: 'pnpm test' },
    })
    const failedChild = settledTool('child-failed', {
      isError: true,
      resultView: { card: 'web' },
      callView: { card: 'diff', title: 'fallback should not win', diffs: [] },
    })
    const root = deepFreeze(settledTool('root', {
      resultView: { card: 'generic' },
      callView: { card: 'generic', title: 'read', kind: 'read' },
      subCalls: [runningChild, failedChild],
    }))
    const node = deepFreeze(makeToolNode('tool', root))

    expect(summarizeToolNodes([node])).toEqual({
      total: 3,
      running: 1,
      failed: 1,
      categories: {
        read: 1,
        search: 0,
        modify: 0,
        command: 1,
        web: 1,
        other: 0,
      },
    })
  })

  it('遇到未知 block、缺失 subCalls 或非对象子调用时返回 null', () => {
    expect(summarizeToolNodes([
      makeToolNode('unknown', { ...runningTool('x'), kind: 'future-result' }),
    ])).toBeNull()
    expect(summarizeToolNodes([
      makeToolNode('missing-children', { callId: 'x' }),
    ])).toBeNull()
    expect(summarizeToolNodes([
      makeToolNode('bad-child', { ...runningTool('x'), subCalls: [null] }),
    ])).toBeNull()
  })
})

describe('工具分组规划', () => {
  it('只聚合连续的两个及以上有效根调用', () => {
    const first = makeToolNode('tool-a', settledTool('a'))
    const second = makeToolNode('tool-b', settledTool('b'))
    const boundary = makeNode('context', 'context')
    const single = makeToolNode('tool-c', settledTool('c'))
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const plan = buildTurnPresentation(
      makeChat([first, second, boundary, single, closing, tail]),
      1,
    )

    expect(plan.nodes.get('tool-a')?.toolGroupRole).toBe('leader')
    expect(plan.nodes.get('tool-b')?.toolGroupRole).toBe('member')
    expect(plan.nodes.get('tool-a')?.toolGroup?.memberKeys).toEqual(['tool-a', 'tool-b'])
    expect(plan.nodes.get('tool-a')?.zone).toBe('collapsible')
    expect(plan.nodes.get('tool-b')?.zone).toBe('collapsible')
    expect(plan.nodes.get('tool-c')?.toolGroup).toBeUndefined()
    expect(plan.nodes.get('tool-c')?.zone).toBe('collapsible')
  })

  it('结构异常的工具作为边界，两侧有效调用仍可分别成组', () => {
    const nodes = [
      makeToolNode('a', settledTool('a')),
      makeToolNode('b', settledTool('b')),
      makeToolNode('bad', { callId: 'bad' }),
      makeToolNode('c', settledTool('c')),
      makeToolNode('d', settledTool('d')),
    ]
    const closing = makeAssistant('closing')
    const plan = buildTurnPresentation(
      makeChat([...nodes, closing, makeTail('tail', closing)]),
      1,
    )

    expect(plan.nodes.get('a')?.toolGroup?.memberKeys).toEqual(['a', 'b'])
    expect(plan.nodes.get('bad')).toEqual({ zone: 'persistent' })
    expect(plan.nodes.get('c')?.toolGroup?.memberKeys).toEqual(['c', 'd'])
  })

  it('最终回答前的工具组无论成功失败都进入同一个 turn 折叠', () => {
    const context = makeNode('context', 'context')
    const first = makeToolNode('tool-a', settledTool('a'))
    const failed = makeToolNode('tool-b', settledTool('b', { isError: true }))
    const closing = makeAssistant('closing')
    const plan = buildTurnPresentation(
      makeChat([context, first, failed, closing, makeTail('tail', closing)]),
      1,
    )

    expect(plan.nodes.get('tool-a')).toMatchObject({
      zone: 'collapsible',
      toolGroupRole: 'leader',
    })
    expect(plan.nodes.get('tool-a')?.toolGroup?.summary.failed).toBe(1)
    expect(plan.nodes.get('tool-b')?.zone).toBe('collapsible')
    expect(plan.canCollapse).toBe(true)
  })

  it('单个工具无论成功失败都进入 turn 折叠', () => {
    const context = makeNode('context', 'context')
    const succeeded = makeToolNode('tool-succeeded', settledTool('succeeded'))
    const failed = makeToolNode('tool-failed', settledTool('failed', { isError: true }))
    const closing = makeAssistant('closing')
    const successPlan = buildTurnPresentation(
      makeChat([context, succeeded, closing, makeTail('tail', closing)]),
      1,
    )
    const failurePlan = buildTurnPresentation(
      makeChat([context, failed, closing, makeTail('tail', closing)]),
      1,
    )

    expect(successPlan.nodes.get('tool-succeeded')).toEqual({ zone: 'collapsible' })
    expect(failurePlan.nodes.get('tool-failed')).toEqual({ zone: 'collapsible' })
    expect(successPlan.canCollapse).toBe(true)
    expect(failurePlan.canCollapse).toBe(true)
  })

  it('最终回答后的失败工具组始终可见', () => {
    const closing = makeAssistant('closing')
    const first = makeToolNode('tool-a', settledTool('a'))
    const failed = makeToolNode('tool-b', settledTool('b', { isError: true }))
    const plan = buildTurnPresentation(
      makeChat([closing, first, failed, makeTail('tail', closing)]),
      1,
    )

    expect(plan.nodes.get('tool-a')).toMatchObject({
      zone: 'persistent',
      toolGroupRole: 'leader',
    })
    expect(plan.nodes.get('tool-b')?.zone).toBe('persistent')
  })

  it('有运行中工具时默认展开整个 turn，但仍允许手动折叠', () => {
    const context = makeNode('context', 'context')
    const first = makeToolNode('tool-a', runningTool('a'))
    const second = makeToolNode('tool-b', runningTool('b'))
    const closing = makeAssistant('closing')
    const open = makeTurn(1, { status: 'open' })
    const plan = buildTurnPresentation(
      makeChat([context, first, second, closing], open),
      1,
    )

    expect(plan.canCollapse).toBe(true)
    expect(plan.defaultCollapsed).toBe(false)
    expect(plan.nodes.get('tool-a')?.toolGroup?.summary.running).toBe(2)
  })
})
