import type { ChatNode, ToolCategory, ToolSummary } from './model.ts'

type UnknownRecord = Record<string, unknown>

const TOOL_CATEGORIES: readonly ToolCategory[] = ['read', 'search', 'modify', 'command', 'web', 'other']

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null
}

function categoryOf(block: UnknownRecord): ToolCategory {
  const resultView = record(block.resultView)
  const callView = record(block.callView)

  const resultCategory = categoryFromCard(resultView?.card)
  if (resultCategory !== null) return resultCategory

  const callCategory = categoryFromCard(callView?.card)
  if (callCategory !== null) return callCategory

  const kind = callView?.kind
  if (kind === 'read') return 'read'
  if (kind === 'search') return 'search'
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'modify'
  if (kind === 'execute') return 'command'
  if (kind === 'fetch') return 'web'
  return 'other'
}

function categoryFromCard(card: unknown): ToolCategory | null {
  if (card === 'read') return 'read'
  if (card === 'search') return 'search'
  if (card === 'diff') return 'modify'
  if (card === 'terminal') return 'command'
  if (card === 'web') return 'web'
  return null
}

function toolRoot(node: ChatNode): UnknownRecord | null {
  const data = record(node.data)
  return data === null ? null : record(data.root)
}

/** 递归汇总根调用和子调用；遇到不完整结构时整体放弃摘要。 */
export function summarizeToolNodes(nodes: readonly ChatNode[]): ToolSummary | null {
  const roots = nodes.map(toolRoot)
  if (roots.some(root => root === null)) return null

  const categories = Object.fromEntries(TOOL_CATEGORIES.map(category => [category, 0])) as Record<ToolCategory, number>
  const visited = new Set<object>()
  const parents = new Map<UnknownRecord, Set<UnknownRecord>>()
  const runningBlocks: UnknownRecord[] = []
  const invocations: Array<{ category: ToolCategory; startedAt: number; discovery: number }> = []
  const pending = [...roots] as UnknownRecord[]
  let total = 0
  let running = 0
  let failed = 0

  for (let index = 0; index < pending.length; index += 1) {
    const block = pending[index]
    if (block === undefined || visited.has(block)) continue
    const settled = block.kind === 'tool-result'
    const subCalls = block.subCalls
    const callTime = settled ? block.callTime : block.time
    if (typeof block.callId !== 'string'
      || !Array.isArray(subCalls)
      || (block.kind !== undefined && !settled)
      || (settled && typeof block.isError !== 'boolean')
      || (settled && callTime !== null && (typeof callTime !== 'number' || !Number.isFinite(callTime)))
      || (!settled && (typeof block.name !== 'string' || block.name === ''
        || typeof callTime !== 'number' || !Number.isFinite(callTime)))) return null
    visited.add(block)
    total += 1
    const category = categoryOf(block)
    categories[category] += 1
    invocations.push({
      category,
      // callTime=null 表示调用起点早于当前窗口，因此排在窗口内已知调用之前。
      startedAt: callTime === null ? Number.NEGATIVE_INFINITY : callTime as number,
      discovery: invocations.length,
    })
    if (!settled) {
      running += 1
      runningBlocks.push(block)
    }
    if (settled && block.isError === true) failed += 1
    for (const child of subCalls) {
      const childRecord = record(child)
      if (childRecord === null) return null
      const childParents = parents.get(childRecord) ?? new Set<UnknownRecord>()
      childParents.add(block)
      parents.set(childRecord, childParents)
      pending.push(childRecord)
    }
  }

  // 运行中的父调用只是等待其运行中子调用；摘要只展示实际活跃的叶子。
  const hasRunningDescendant = new Set<UnknownRecord>()
  for (const runningBlock of runningBlocks) {
    const ancestors = [...(parents.get(runningBlock) ?? [])]
    const seen = new Set<UnknownRecord>()
    for (let index = 0; index < ancestors.length; index += 1) {
      const ancestor = ancestors[index]
      if (ancestor === undefined || seen.has(ancestor)) continue
      seen.add(ancestor)
      hasRunningDescendant.add(ancestor)
      for (const parent of parents.get(ancestor) ?? []) ancestors.push(parent)
    }
  }
  const activeToolNames = runningBlocks
    .filter(block => !hasRunningDescendant.has(block))
    .sort((left, right) => (left.time as number) - (right.time as number))
    .map(block => block.name as string)
  const categoryOrder: ToolCategory[] = []
  const orderedCategories = new Set<ToolCategory>()
  invocations.sort((left, right) => {
    if (left.startedAt !== right.startedAt) return left.startedAt < right.startedAt ? -1 : 1
    return left.discovery - right.discovery
  })
  for (const { category } of invocations) {
    if (orderedCategories.has(category)) continue
    orderedCategories.add(category)
    categoryOrder.push(category)
  }

  return { total, running, activeToolNames, failed, categoryOrder, categories }
}
