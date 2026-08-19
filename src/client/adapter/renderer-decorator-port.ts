import type { ComponentType, ExoticComponent } from 'react'

export type ChatRendererProps = Record<string, unknown>
export type ChatRenderer = ComponentType<ChatRendererProps> | ExoticComponent<ChatRendererProps>
export type ChatRendererDecorator = (entryKey: string, original: ChatRenderer) => ChatRenderer

/** 插件自有的稳定边界；未来 DSH 提供正式装饰 API 时只需替换其实现。 */
export interface RendererDecoratorPort {
  install(decorate: ChatRendererDecorator): () => void
}
