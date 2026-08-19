import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCategory, ToolSummary, TurnPresentation } from './presentation/model.ts'

export const NS = 'messageFold'

export const zh = {
  'turn.worked': '耗时 {duration}',
  'turn.earlier': '{count} 条较早消息',
  'turn.expand': '展开中间活动',
  'turn.collapse': '折叠中间活动',
  'tools.count': '{count} 次工具调用',
  'tools.expand': '展开工具调用',
  'tools.collapse': '折叠工具调用',
  'tools.read': '读取 {count}',
  'tools.search': '搜索 {count}',
  'tools.modify': '修改 {count}',
  'tools.command': '命令 {count}',
  'tools.web': 'Web {count}',
  'tools.other': '其他 {count}',
  'tools.running': '运行中 {count}',
  'tools.failed': '失败 {count}',
  'duration.seconds': '{seconds}秒',
  'duration.minutes': '{minutes}分{seconds}秒',
} as const

export type MessageFoldKey = keyof typeof zh

export const en = {
  'turn.worked': 'Worked for {duration}',
  'turn.earlier': '{count} earlier messages',
  'turn.expand': 'Expand intermediate activity',
  'turn.collapse': 'Collapse intermediate activity',
  'tools.count': '{count} tool calls',
  'tools.expand': 'Expand tool calls',
  'tools.collapse': 'Collapse tool calls',
  'tools.read': 'Read {count}',
  'tools.search': 'Search {count}',
  'tools.modify': 'Modify {count}',
  'tools.command': 'Command {count}',
  'tools.web': 'Web {count}',
  'tools.other': 'Other {count}',
  'tools.running': 'Running {count}',
  'tools.failed': 'Failed {count}',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
} satisfies Record<MessageFoldKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-message-fold 自有文案。 */
    messageFold: MessageFoldKey
  }
}

export type MessageFoldTranslate = TranslateNS<'messageFold'>

function durationText(milliseconds: number, t: MessageFoldTranslate): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes === 0
    ? t('duration.seconds', { seconds })
    : t('duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
}

export function turnSummaryText(plan: TurnPresentation, t: MessageFoldTranslate): string {
  return plan.durationMs === null
    ? t('turn.earlier', { count: plan.collapsibleCount })
    : t('turn.worked', { duration: durationText(plan.durationMs, t) })
}

const CATEGORY_KEYS = {
  read: 'tools.read',
  search: 'tools.search',
  modify: 'tools.modify',
  command: 'tools.command',
  web: 'tools.web',
  other: 'tools.other',
} as const satisfies Record<ToolCategory, MessageFoldKey>

export function toolSummaryText(summary: ToolSummary, t: MessageFoldTranslate): string {
  const parts = [t('tools.count', { count: summary.total })]
  for (const category of Object.keys(CATEGORY_KEYS) as ToolCategory[]) {
    const count = summary.categories[category]
    if (count > 0) parts.push(t(CATEGORY_KEYS[category], { count }))
  }
  if (summary.running > 0) parts.push(t('tools.running', { count: summary.running }))
  if (summary.failed > 0) parts.push(t('tools.failed', { count: summary.failed }))
  return parts.join(' · ')
}
