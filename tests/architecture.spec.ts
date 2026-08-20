// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const srcRoot = join(root, 'src')
const adapterPath = 'client/adapter/dsh-slot-renderer-decorator.ts'

function sourceFiles(directory: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) result.push(path)
  }
  return result
}

describe('架构边界', () => {
  it('把 StoredEntry.component 与 sentinel 兼容逻辑限制在单一适配器', () => {
    for (const path of sourceFiles(srcRoot)) {
      const local = relative(srcRoot, path)
      if (local === adapterPath) continue
      const source = readFileSync(path, 'utf8')
      expect(source, local).not.toMatch(/\bStoredEntry\b/)
      expect(source, local).not.toMatch(/\.component\b/)
      expect(source, local).not.toMatch(/sentinelKey|registry_bump|bumpVersion/)
    }
  })

  it('不使用 DOM 扫描、MutationObserver 或浏览器持久化', () => {
    const source = sourceFiles(srcRoot).map(path => readFileSync(path, 'utf8')).join('\n')
    expect(source).not.toMatch(/MutationObserver|querySelector|localStorage|sessionStorage/)
  })

  it('把 DSH flow DOM 选择器限制在单一样式兼容层', () => {
    for (const path of sourceFiles(srcRoot)) {
      const local = relative(srcRoot, path)
      if (local === 'client/styles.ts') continue
      const source = readFileSync(path, 'utf8')
      expect(source, local).not.toMatch(/data-chat-flow-key|data-slot=["']conversation\.chat\.node/)
    }
  })

  it('manifest 同时声明 bundle patch 和 Web client 依赖边', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string
      dsh: {
        bundle: { patch: string }
        client: { platform: string; inject: string[] }
      }
      peerDependencies: Record<string, string>
    }
    expect(manifest.name).toBe('dsh-message-fold')
    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-client-connection',
          '@deepseek-ai/dsh-client-runtime',
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-conversation',
          '@deepseek-ai/dsh-client-ui-settings',
          '@deepseek-ai/dsh-api-remotes',
        ],
        platform: 'web',
      },
    })
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBe('4.0.1')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime']).toBe('0.1.0-rc.7')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-settings']).toBe('0.1.0-rc.7')
  })

  it('工具准备实现不扫描完整 ChatNodeStore，也不注册额外 Conversation Definition', () => {
    const source = sourceFiles(srcRoot).map(path => readFileSync(path, 'utf8')).join('\n')
    expect(source).not.toMatch(/chat\.nodes\.values\s*\(/)
    expect(source).not.toMatch(/conversationEvents\.register\s*\(/)
  })

  it('cordis patch 只插入插件自身一项', () => {
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8').trim()).toBe([
      '- insert:',
      '    - id: dsh-message-fold',
      '      name: dsh-message-fold',
    ].join('\n'))
  })
})
