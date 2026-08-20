import { createElement, type ComponentType } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SettingsScope, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageFoldSettings } from '../src/settings-contract.ts'
import {
  MessageFoldSettingsSection,
} from '../src/client/components/MessageFoldSettingsSection.tsx'
import { zh, type MessageFoldKey, type MessageFoldTranslate } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MessageFoldKey, params: Record<string, unknown> = {}) =>
  zh[key].replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? ''))
) as MessageFoldTranslate

function scopeSnapshot(
  status: SettingsScopeSnapshot<MessageFoldSettings>['status'],
  enabled = true,
  writable = true,
): SettingsScopeSnapshot<MessageFoldSettings> {
  return {
    status,
    value: status === 'ready' ? { showToolPreparation: enabled } : undefined,
    base: undefined,
    user: undefined,
    revision: status === 'ready' ? 1 : undefined,
    writable,
    mode: 'host',
  }
}

class TestScope implements SettingsScope<MessageFoldSettings> {
  private readonly listeners = new Set<() => void>()
  readonly set = vi.fn(async (field: string, value: unknown) => {
    if (field !== 'showToolPreparation' || typeof value !== 'boolean') return
    this.snapshot = scopeSnapshot('ready', value, this.snapshot.writable)
    for (const listener of [...this.listeners]) listener()
  })
  readonly unset = vi.fn(async () => {})

  constructor(private snapshot: SettingsScopeSnapshot<MessageFoldSettings>) {}

  getSnapshot(): SettingsScopeSnapshot<MessageFoldSettings> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

function renderSection(scope: TestScope) {
  const Section = MessageFoldSettingsSection as ComponentType<Record<string, unknown>>
  return render(createElement(Section, { settings: scope, t, close: () => {} }))
}

describe('消息折叠设置页', () => {
  it('默认开启并通过 Host settings scope 实时持久化', async () => {
    const scope = new TestScope(scopeSnapshot('ready', true))
    const user = userEvent.setup()
    renderSection(scope)

    expect(screen.getByRole('heading', { name: '消息折叠' })).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: '工具调用准备提示' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await user.click(toggle)
    expect(scope.set).toHaveBeenCalledWith('showToolPreparation', false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('设置不可用时按开启展示且禁用写入', () => {
    const scope = new TestScope(scopeSnapshot('unavailable', false, false))
    renderSection(scope)

    const toggle = screen.getByRole('switch', { name: '工具调用准备提示' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle).toHaveProperty('disabled', true)
    expect(screen.getByText('设置服务暂不可用；当前按开启处理。')).toBeTruthy()
  })
})
