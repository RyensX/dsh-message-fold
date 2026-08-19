import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const clientPath = resolve(root, 'lib/client.js')
const source = readFileSync(clientPath, 'utf8')
let handoff

vm.runInNewContext(source, {
  window: {
    __ModuleLoader__: {
      load(value) {
        handoff = value
      },
    },
  },
}, { filename: clientPath })

assert.equal(handoff?.id, 'dsh-message-fold')
assert.equal(typeof handoff?.factory, 'function')
assert.match(source, /return module\.exports;\s*}\s*}\);/)
assert.doesNotMatch(source, /^\s*import\s/m)
assert.doesNotMatch(source, /\/Users\/sutaowei\/project\/github\/deepseek-harness/)

const modules = new Map([
  ['react', await import('react')],
  ['react/jsx-runtime', await import('react/jsx-runtime')],
  ['@deepseek-ai/dsh-client-ui-primitives', { IconChevronRightOutline14: () => null }],
])
const exported = handoff.factory((id) => {
  if (!modules.has(id)) throw new Error(`未提供 bundle external: ${id}`)
  return modules.get(id)
})

assert.equal(typeof exported.apply, 'function')
assert.deepEqual([...exported.inject], ['slots', 'sessions', 'locale'])
assert.ok(existsSync(resolve(root, 'lib/client.js.map')))
assert.ok(existsSync(resolve(root, 'lib/types/index.d.ts')))
assert.ok(existsSync(resolve(root, 'lib/types/client/index.d.ts')))

const host = await import(`${pathToFileURL(resolve(root, 'lib/index.js')).href}?verify=${Date.now()}`)
assert.equal(typeof host.apply, 'function')
assert.equal(host.apply(), undefined)

console.log('bundle handoff verified')
