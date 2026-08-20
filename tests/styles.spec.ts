import { describe, expect, it } from 'vitest'
import { installStyles } from '../src/client/styles.ts'

describe('样式生命周期', () => {
  it('只添加并释放插件自有 style 标签', () => {
    const before = document.head.querySelectorAll('style').length
    const dispose = installStyles()
    const style = document.head.querySelector('style[data-plugin="dsh-message-fold"]')

    expect(style).toBeTruthy()
    expect(document.head.querySelectorAll('style').length).toBe(before + 1)
    expect(style?.textContent).toContain('prefers-reduced-motion')
    expect(style?.textContent).toContain('[data-chat-flow-key]:has(')
    expect(style?.textContent).toContain('[data-dsh-message-fold-hidden]')
    expect(style?.textContent).toContain('.dsh-message-fold-preparation')
    expect(style?.textContent).toContain('.dsh-message-fold-switch')
    dispose()
    expect(document.head.querySelector('style[data-plugin="dsh-message-fold"]')).toBeNull()
  })
})
