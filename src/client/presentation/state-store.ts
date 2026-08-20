type Listener = () => void

interface StoredFlag {
  readonly sessionId: string
  readonly value: boolean
}

/** 长度前缀允许 id/key 包含任意分隔符，同时避开热渲染路径中的 JSON 序列化。 */
export function turnStateKey(sessionId: string, turn: number): string {
  return `t:${sessionId.length}:${sessionId}:${turn}`
}

export function toolGroupStateKey(sessionId: string, turn: number, firstNodeKey: string): string {
  return `g:${sessionId.length}:${sessionId}:${turn}:${firstNodeKey.length}:${firstNodeKey}`
}

/** 页面内的用户选择；不会写入 Session 或任何浏览器持久化。 */
export class PresentationStateStore {
  private readonly turnFlags = new Map<string, StoredFlag>()
  private readonly groupFlags = new Map<string, StoredFlag>()
  private readonly listeners = new Map<string, Set<Listener>>()

  getTurn(key: string): boolean | undefined {
    return this.turnFlags.get(key)?.value
  }

  setTurn(key: string, sessionId: string, collapsed: boolean): void {
    if (this.turnFlags.get(key)?.value === collapsed) return
    this.turnFlags.set(key, { sessionId, value: collapsed })
    this.publish(key)
  }

  getToolGroup(key: string): boolean | undefined {
    return this.groupFlags.get(key)?.value
  }

  setToolGroup(key: string, sessionId: string, expanded: boolean): void {
    if (this.groupFlags.get(key)?.value === expanded) return
    this.groupFlags.set(key, { sessionId, value: expanded })
    this.publish(key)
  }

  subscribe(key: string, listener: Listener): () => void {
    let listeners = this.listeners.get(key)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(key, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(key)
    }
  }

  pruneSessions(liveSessionIds: ReadonlySet<string>): void {
    const changed: string[] = []
    for (const [key, flag] of this.turnFlags) {
      if (liveSessionIds.has(flag.sessionId)) continue
      this.turnFlags.delete(key)
      changed.push(key)
    }
    for (const [key, flag] of this.groupFlags) {
      if (liveSessionIds.has(flag.sessionId)) continue
      this.groupFlags.delete(key)
      changed.push(key)
    }
    for (const key of changed) this.publish(key)
  }

  clear(): void {
    const changed = new Set([...this.turnFlags.keys(), ...this.groupFlags.keys()])
    this.turnFlags.clear()
    this.groupFlags.clear()
    for (const key of changed) this.publish(key)
  }

  private publish(key: string): void {
    for (const listener of this.listeners.get(key) ?? []) listener()
  }
}
