// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { MessageFoldSettingsSchema } from '../src/settings-schema.ts'

describe('Host 设置注册', () => {
  it('schema 默认开启工具准备提示', () => {
    expect(MessageFoldSettingsSchema()).toEqual({ showToolPreparation: true })
  })

  it('在 settings service 可用时注册 dsh-message-fold namespace', () => {
    const register = vi.fn()
    const ctx = {
      inject(dependencies: string[], callback: (ctx: unknown) => void) {
        expect(dependencies).toEqual(['settings'])
        callback({ settings: { register } })
      },
    } as unknown as Context

    apply(ctx)
    expect(String(register.mock.calls[0]?.[0])).toBe('dsh-message-fold')
    expect(register.mock.calls[0]?.[1]).toBe(MessageFoldSettingsSchema)
  })
})
