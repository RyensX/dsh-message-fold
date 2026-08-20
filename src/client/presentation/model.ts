import type {
  ChatConversationViewNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'

export type NodeZone = 'persistent' | 'collapsible' | 'closing'

export type ToolCategory = 'read' | 'search' | 'modify' | 'command' | 'web' | 'other'

export interface ToolSummary {
  readonly total: number
  readonly running: number
  /** 按启动顺序排列的运行中叶子工具名；父调用等待子调用时不重复展示。 */
  readonly activeToolNames: readonly string[]
  readonly failed: number
  /** 按各分类第一次调用的启动时间排列，仅包含实际出现的分类。 */
  readonly categoryOrder: readonly ToolCategory[]
  readonly categories: Readonly<Record<ToolCategory, number>>
}

export interface ToolGroupPlan {
  readonly firstKey: string
  readonly memberKeys: readonly string[]
  readonly summary: ToolSummary
}

export interface NodePresentation {
  readonly zone: NodeZone
  readonly toolGroup?: ToolGroupPlan
  readonly toolGroupRole?: 'leader' | 'member'
  readonly stripReasoningWhenCollapsed?: true
}

export interface TurnPresentation {
  readonly turn: number
  readonly canCollapse: boolean
  readonly defaultCollapsed: boolean
  readonly anchorKey: string | null
  readonly closingKey: string | null
  readonly collapsibleCount: number
  readonly durationMs: number | null
  readonly nodes: ReadonlyMap<string, NodePresentation>
}

export interface TurnPresentationInput {
  readonly chat: ChatSnapshot
  readonly turn: number
}

export type ChatNode = ChatConversationViewNode
