import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

type UnknownRecord = Record<string, unknown>
type RemoveBlock = (block: UnknownRecord | null) => boolean

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null
}

function projectBlocks(
  node: ChatConversationViewNode,
  remove: RemoveBlock,
): ChatConversationViewNode {
  const data = record(node.data)
  if (data === null || !Array.isArray(data.blocks)) return node
  let changesLength = false
  for (let index = 0; index < data.blocks.length; index += 1) {
    // Array.filter 也会压实稀疏数组；保留旧投影函数在异常输入上的精确结果。
    if (!(index in data.blocks) || remove(record(data.blocks[index]))) {
      changesLength = true
      break
    }
  }
  if (!changesLength) return node
  const blocks = data.blocks.filter(block => !remove(record(block)))
  return { ...node, data: { ...data, blocks } }
}

function isReasoning(block: UnknownRecord | null): boolean {
  return block?.kind === 'reasoning'
}

function isEmptyReasoning(block: UnknownRecord | null): boolean {
  return block?.kind === 'reasoning'
    && typeof block.text === 'string'
    && block.text.trim() === ''
}

function cachedProjection(
  entries: WeakMap<ChatConversationViewNode, ChatConversationViewNode>,
  node: ChatConversationViewNode,
  remove: RemoveBlock,
): ChatConversationViewNode {
  const cached = entries.get(node)
  if (cached !== undefined) return cached
  const projected = projectBlocks(node, remove)
  // 无需投影的常见节点不占用缓存；原 node 本身已经提供稳定引用。
  if (projected !== node) entries.set(node, projected)
  return projected
}

/** 按不可变 Chat Node 身份复用只读展示投影；Node 更新后会自然使用新的缓存项。 */
export class NodeProjectionCache {
  private readonly reasoning = new WeakMap<ChatConversationViewNode, ChatConversationViewNode>()
  private readonly emptyReasoning = new WeakMap<ChatConversationViewNode, ChatConversationViewNode>()

  withoutReasoning(node: ChatConversationViewNode): ChatConversationViewNode {
    return cachedProjection(this.reasoning, node, isReasoning)
  }

  withoutEmptyReasoning(node: ChatConversationViewNode): ChatConversationViewNode {
    return cachedProjection(this.emptyReasoning, node, isEmptyReasoning)
  }
}
