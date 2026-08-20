import { describe, expect, it } from 'vitest'
import {
  toolSummaryText, zh, type MessageFoldKey, type MessageFoldTranslate,
} from '../src/client/locales.ts'
import { buildTurnPresentation } from '../src/client/presentation/build-turn-presentation.ts'
import { summarizeToolNodes } from '../src/client/presentation/tool-summary.ts'
import {
  deepFreeze, makeAssistant, makeChat, makeNode, makeTail, makeToolNode, makeTurn,
  runningTool, settledTool,
} from './fixtures.ts'

const t = ((key: MessageFoldKey, params: Record<string, unknown> = {}) =>
  zh[key].replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? ''))) as MessageFoldTranslate

describe('summarizeToolNodes', () => {
  it('递归统计子调用，并按 resultView 到 callView 的顺序分类', () => {
    const runningChild = runningTool('child-running', {
      name: 'bash',
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
      activeToolNames: ['bash'],
      failed: 1,
      categoryOrder: ['read', 'command', 'web'],
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
    expect(summarizeToolNodes([
      makeToolNode('empty-name', runningTool('x', { name: '' })),
    ])).toBeNull()
  })

  it('使用游标遍历循环与共享子调用，且每个 block 只读取一次子调用列表', () => {
    let childReads = 0
    const shared = runningTool('shared')
    const root: Record<string, unknown> = {
      ...settledTool('root'),
      get subCalls(): unknown[] {
        childReads += 1
        return [shared, shared, root]
      },
    }

    expect(summarizeToolNodes([makeToolNode('tool', root)])).toMatchObject({
      total: 2,
      running: 1,
    })
    expect(childReads).toBe(1)
  })

  it('只报告运行中的叶子工具，并按启动顺序保留并行同名调用', () => {
    const nestedBash = runningTool('nested-bash', { name: 'bash', time: 2_100 })
    const parent = runningTool('parent', {
      name: 'run_code',
      time: 2_000,
      subCalls: [nestedBash],
    })
    const parallelBash = runningTool('parallel-bash', { name: 'bash', time: 2_200 })
    const parallelOpen = runningTool('parallel-open', { name: 'open', time: 2_300 })
    const summary = summarizeToolNodes([
      makeToolNode('parent', parent),
      makeToolNode('parallel-bash', parallelBash),
      makeToolNode('parallel-open', parallelOpen),
    ])

    expect(summary).toMatchObject({
      total: 4,
      running: 4,
      activeToolNames: ['bash', 'bash', 'open'],
    })
    expect(toolSummaryText(summary!, t)).toContain('正在调用 bash ×2、open')
    expect(toolSummaryText(summary!, t)).not.toContain('正在运行')
  })

  it('按已调用统计追加当前工具，并在全部完成后只移除调用中部分', () => {
    const read = makeToolNode('read', settledTool('read'))
    const bash = makeToolNode('bash', runningTool('bash', {
      name: 'bash',
      time: 2_100,
      callView: { card: 'terminal', title: 'pnpm test' },
    }))
    const open = makeToolNode('open', runningTool('open', {
      name: 'open',
      time: 2_200,
    }))
    const active = summarizeToolNodes([read, bash, open])

    expect(toolSummaryText(active!, t)).toBe(
      '已调用 3 次工具 · 读取 2 · 命令 1 · 正在调用 bash、open',
    )

    const settled = summarizeToolNodes([
      read,
      makeToolNode('bash', settledTool('bash', {
        callView: { card: 'terminal', title: 'pnpm test' },
      })),
      makeToolNode('open', settledTool('open')),
    ])
    expect(toolSummaryText(settled!, t)).toBe('已调用 3 次工具 · 读取 2 · 命令 1')
  })

  it('按每种类型第一次调用的时间排列分类，后续同类调用只累加计数', () => {
    const read = makeToolNode('read', runningTool('read', {
      name: 'open',
      time: 2_000,
    }))
    const laterCommand = makeToolNode('later-command', runningTool('later-command', {
      name: 'bash',
      time: 3_000,
      callView: { card: 'terminal', title: 'pnpm test' },
    }))
    const firstCommand = makeToolNode('first-command', runningTool('first-command', {
      name: 'bash',
      time: 1_000,
      callView: { card: 'terminal', title: 'pwd' },
    }))
    // 节点输入顺序故意不同于调用时间，证明分类顺序来自第一次调用。
    const summary = summarizeToolNodes([read, laterCommand, firstCommand])

    expect(summary?.categoryOrder).toEqual(['command', 'read'])
    expect(toolSummaryText(summary!, t)).toBe(
      '已调用 3 次工具 · 命令 2 · 读取 1 · 正在调用 bash ×2、open',
    )
  })
})

describe('工具分组规划', () => {
  it('单个工具的结构校验与摘要共用同一次工具树遍历', () => {
    let childReads = 0
    const root = {
      ...settledTool('single'),
      get subCalls() {
        childReads += 1
        return []
      },
    }
    const tool = makeToolNode('tool', root)
    const closing = makeAssistant('closing')

    const plan = buildTurnPresentation(makeChat([
      tool, closing, makeTail('tail', closing),
    ]), 1)

    expect(plan.nodes.get('tool')).toEqual({ zone: 'collapsible' })
    expect(childReads).toBe(1)
  })

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
    expect(plan.nodes.get('tool-a')?.toolGroup?.summary.activeToolNames).toEqual([])
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
    expect(plan.nodes.get('tool-a')?.toolGroup?.summary.activeToolNames).toEqual(['read', 'read'])
  })

  it('后续工具接管运行文案，组尾完成且下一项非工具时恢复静态摘要', () => {
    const first = makeToolNode('tool-a', settledTool('a'))
    const running = makeToolNode('tool-b', runningTool('b', { name: 'bash' }))
    const boundary = makeNode('context', 'context')
    const activePlan = buildTurnPresentation(makeChat([first, running, boundary]), 1)

    expect(activePlan.nodes.get('tool-a')?.toolGroup?.summary.activeToolNames).toEqual(['bash'])

    const completed = makeToolNode('tool-b', settledTool('b'))
    const completedPlan = buildTurnPresentation(makeChat([first, completed, boundary]), 1)
    const completedSummary = completedPlan.nodes.get('tool-a')?.toolGroup?.summary
    expect(completedSummary?.activeToolNames).toEqual([])
    expect(toolSummaryText(completedSummary!, t)).toBe('已调用 2 次工具 · 读取 2')

    const next = makeToolNode('tool-c', runningTool('c', { name: 'open', time: 3_000 }))
    const continuedPlan = buildTurnPresentation(makeChat([first, completed, next, boundary]), 1)
    expect(continuedPlan.nodes.get('tool-a')?.toolGroup).toMatchObject({
      memberKeys: ['tool-a', 'tool-b', 'tool-c'],
      summary: { activeToolNames: ['open'] },
    })
    expect(toolSummaryText(continuedPlan.nodes.get('tool-a')!.toolGroup!.summary, t)).toBe(
      '已调用 3 次工具 · 读取 3 · 正在调用 open',
    )
  })
})
