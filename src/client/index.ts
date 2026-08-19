import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DshSlotRendererDecorator } from './adapter/dsh-slot-renderer-decorator.ts'
import { createDecoratedChatRenderer } from './components/create-decorated-renderer.tsx'
import { en, NS, zh } from './locales.ts'
import { PresentationStateStore } from './presentation/state-store.ts'
import { installStyles } from './styles.ts'

export const inject = ['slots', 'sessions', 'locale']

/** 安装只影响展示的会话 renderer 装饰器。 */
export function apply(ctx: ClientContext): void {
  const state = new PresentationStateStore()
  const t = ctx.locale.bind(NS)
  const locale = {
    getSnapshot: () => ctx.locale.getSnapshot(),
    subscribe: (listener: () => void) => ctx.locale.subscribe(listener),
  }

  // 先注册状态清理，Cordis 逆序卸载时会先撤掉 wrapper，再清空状态。
  ctx.effect(() => () => { state.clear() }, 'message-fold: presentation state')
  ctx.effect(installStyles, 'message-fold: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'message-fold: dictionaries')
  ctx.effect(() => {
    const prune = (): void => {
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.phase === 'ready') state.pruneSessions(new Set(Object.keys(snapshot.byId)))
    }
    prune()
    return ctx.sessions.list.subscribe(prune)
  }, 'message-fold: session state pruning')

  ctx.slots.inject('conversation.chat.node', () => {
    const adapter = new DshSlotRendererDecorator(ctx.slots, (error) => {
      console.error('[dsh-message-fold] disabled because the DSH renderer contract is incompatible:', error)
    })
    return adapter.install((entryKey, original) => createDecoratedChatRenderer(entryKey, original, {
      state,
      locale,
      t,
    }))
  })
}
