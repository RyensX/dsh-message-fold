import type { ChatNode, ToolCategory, ToolSummary } from './model.ts'

type UnknownRecord = Record<string, unknown>

const CATEGORY_ORDER: readonly ToolCategory[] = ['read', 'search', 'modify', 'command', 'web', 'other']

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

  const categories = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0])) as Record<ToolCategory, number>
  const visited = new Set<object>()
  const pending = [...roots] as UnknownRecord[]
  let total = 0
  let running = 0
  let failed = 0

  while (pending.length > 0) {
    const block = pending.shift()
    if (block === undefined || visited.has(block)) continue
    const settled = block.kind === 'tool-result'
    if (typeof block.callId !== 'string'
      || !Array.isArray(block.subCalls)
      || (block.kind !== undefined && !settled)
      || (settled && typeof block.isError !== 'boolean')) return null
    visited.add(block)
    total += 1
    categories[categoryOf(block)] += 1
    if (!settled) running += 1
    if (settled && block.isError === true) failed += 1
    for (const child of block.subCalls) {
      const childRecord = record(child)
      if (childRecord === null) return null
      pending.push(childRecord)
    }
  }

  return { total, running, failed, categories }
}
