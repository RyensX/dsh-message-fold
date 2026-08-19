import { describe, expect, it } from 'vitest'
import { buildTurnPresentation } from '../src/client/presentation/build-turn-presentation.ts'
import {
  makeAssistant, makeChat, makeNode, makeTail, makeToolNode, makeTurn, settledTool,
} from './fixtures.ts'

describe('buildTurnPresentation', () => {
  it('只按 turn-tail.closing 识别 closed turn 的最终回答', () => {
    const user = makeNode('user', 'user')
    const context = makeNode('context', 'context')
    const intermediate = makeAssistant('intermediate', { step: 1, seq: 10 })
    const closing = makeAssistant('closing', {
      step: 2,
      seq: 20,
      blocks: [
        { kind: 'reasoning', text: 'internal' },
        { kind: 'text', text: 'final answer' },
      ],
    })
    const tail = makeTail('tail', closing)
    const plan = buildTurnPresentation(
      makeChat([user, context, intermediate, closing, tail]),
      1,
    )

    expect(plan).toMatchObject({
      canCollapse: true,
      defaultCollapsed: true,
      anchorKey: 'context',
      closingKey: 'closing',
      collapsibleCount: 3,
      durationMs: 3_000,
    })
    expect(plan.nodes.get('user')?.zone).toBe('persistent')
    expect(plan.nodes.get('context')?.zone).toBe('collapsible')
    expect(plan.nodes.get('intermediate')?.zone).toBe('collapsible')
    expect(plan.nodes.get('closing')).toEqual({
      zone: 'closing',
      stripReasoningWhenCollapsed: true,
    })
    expect(plan.nodes.get('tail')?.zone).toBe('persistent')
  })

  it('前置 context 不会把本轮折叠入口锚到 user 之前', () => {
    const preContext = makeNode('pre-context', 'context')
    const user = makeNode('user', 'user')
    const postContext = makeNode('post-context', 'context')
    const tool = makeToolNode('tool', settledTool('tool', { isError: true }))
    const closing = makeAssistant('closing')
    const plan = buildTurnPresentation(
      makeChat([preContext, user, postContext, tool, closing, makeTail('tail', closing)]),
      1,
    )

    expect(plan.canCollapse).toBe(true)
    expect(plan.anchorKey).toBe('post-context')
    expect(plan.nodes.get('pre-context')?.zone).toBe('collapsible')
    expect(plan.nodes.get('tool')?.zone).toBe('collapsible')
  })

  it('user 之后没有中间节点时，把折叠入口放在最终回答之前', () => {
    const preContext = makeNode('pre-context', 'context')
    const user = makeNode('user', 'user')
    const closing = makeAssistant('closing')
    const plan = buildTurnPresentation(
      makeChat([preContext, user, closing, makeTail('tail', closing)]),
      1,
    )

    expect(plan.canCollapse).toBe(true)
    expect(plan.anchorKey).toBe('closing')
  })

  it('识别空 reasoning block 以便展示层过滤，但不把它计为中间活动', () => {
    const closing = makeAssistant('closing', {
      blocks: [
        { kind: 'reasoning', text: '   ' },
        { kind: 'text', text: 'final answer' },
      ],
    })
    const tail = makeTail('tail', closing)
    const plan = buildTurnPresentation(makeChat([closing, tail]), 1)

    expect(plan.canCollapse).toBe(false)
    expect(plan.collapsibleCount).toBe(0)
    expect(plan.nodes.get('closing')).toEqual({
      zone: 'closing',
      stripReasoningWhenCollapsed: true,
    })
  })

  it('仅把 open turn 末尾已 settled 的纯文本 assistant 当临时最终回答', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing', { time: 3_250 })
    const open = makeTurn(1, { status: 'open' })
    const plan = buildTurnPresentation(makeChat([context, closing], open), 1)

    expect(plan.canCollapse).toBe(true)
    expect(plan.closingKey).toBe('closing')
    expect(plan.durationMs).toBe(2_250)

    const withToolBlock = makeAssistant('tool-producing', {
      blocks: [
        { kind: 'text', text: 'I will inspect it.' },
        { kind: 'tool-call', callId: 'call-1', name: 'read', argsRaw: '{}' },
      ],
    })
    expect(buildTurnPresentation(makeChat([context, withToolBlock], open), 1).canCollapse).toBe(false)

    const hiddenLaterActivity = makeAssistant('hidden-running', {
      status: 'running',
      finalized: false,
      visibility: 'hidden',
      blocks: [],
    })
    expect(buildTurnPresentation(
      makeChat([context, closing, hiddenLaterActivity], open),
      1,
    ).canCollapse).toBe(false)
  })

  it.each(['aborted', 'interrupted', 'extension-reason'])(
    '结束原因为 %s 时禁用整体折叠',
    (reason) => {
      const context = makeNode('context', 'context')
      const closing = makeAssistant('closing')
      const tail = makeTail('tail', closing)
      const turn = makeTurn(1, { reason })
      const plan = buildTurnPresentation(makeChat([context, closing, tail], turn), 1)

      expect(plan.canCollapse).toBe(false)
      expect(plan.defaultCollapsed).toBe(false)
      expect(plan.nodes.get('context')?.zone).toBe('collapsible')
    },
  )

  it.each(['completed', 'blocked', 'error', 'max-tokens'])(
    '结束原因为 %s 时允许按规则折叠',
    (reason) => {
      const context = makeNode('context', 'context')
      const closing = makeAssistant('closing')
      const noticeKind = reason === 'error' ? 'turn-error' : 'turn-max-tokens'
      const notice = makeNode('notice', noticeKind)
      const tail = makeTail('tail', closing)
      const turn = makeTurn(1, { reason })
      const plan = buildTurnPresentation(makeChat([context, closing, notice, tail], turn), 1)

      expect(plan.canCollapse).toBe(true)
      expect(plan.nodes.get('notice')?.zone).toBe('persistent')
    },
  )

  it('最终 assistant 后的内容始终可见', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const command = makeNode('post-command', 'command', { outcome: null })
    const tail = makeTail('tail', closing)
    const plan = buildTurnPresentation(makeChat([context, closing, command, tail]), 1)

    expect(plan.canCollapse).toBe(true)
    expect(plan.nodes.get('post-command')?.zone).toBe('persistent')
  })

  it('未知 kind 保持可见并截断工具分组', () => {
    const first = makeToolNode('tool-a', settledTool('a'))
    const unknown = makeNode('future', 'future-node', { payload: true })
    const second = makeToolNode('tool-b', settledTool('b'))
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const plan = buildTurnPresentation(makeChat([first, unknown, second, closing, tail]), 1)

    expect(plan.nodes.get('future')?.zone).toBe('persistent')
    expect(plan.nodes.get('tool-a')?.toolGroup).toBeUndefined()
    expect(plan.nodes.get('tool-b')?.toolGroup).toBeUndefined()
  })

  it('历史 key 缺失或 timeline 缺失时整体 fail-open', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing')
    const tail = makeTail('tail', closing)
    const missingNode = makeChat([context, closing, tail], makeTurn(), [
      'context', 'missing', 'closing', 'tail',
    ])
    expect(buildTurnPresentation(missingNode, 1)).toMatchObject({
      canCollapse: false,
      anchorKey: null,
      collapsibleCount: 0,
    })

    const noTimeline = {
      ...makeChat([context, closing, tail]),
      timeline: { turnOrder: [], turns: new Map() },
    }
    expect(buildTurnPresentation(noTimeline, 1).canCollapse).toBe(false)
  })

  it('closing 身份不匹配时不猜测 closed turn 的最终回答', () => {
    const context = makeNode('context', 'context')
    const closing = makeAssistant('closing', { seq: 20 })
    const mismatched = makeAssistant('other', { seq: 21 })
    const tail = makeTail('tail', mismatched)
    const plan = buildTurnPresentation(makeChat([context, closing, tail]), 1)

    expect(plan.canCollapse).toBe(false)
    expect(plan.closingKey).toBeNull()
  })
})
