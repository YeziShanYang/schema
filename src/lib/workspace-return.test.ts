import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberWorkspaceView, workspacePath } from './workspace-return'

function stubStorage() {
  const items = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  })
  return items
}

afterEach(() => vi.unstubAllGlobals())

describe('workspacePath', () => {
  it('opens the graph for a workspace never shown as a list', () => {
    stubStorage()
    expect(workspacePath('ws1')).toBe('/w/ws1')
  })

  it('opens the list after the list was shown, per workspace', () => {
    stubStorage()
    rememberWorkspaceView('ws1', 'list')
    expect(workspacePath('ws1')).toBe('/w/ws1?view=list')
    expect(workspacePath('ws2')).toBe('/w/ws2')
  })

  it('goes back to the graph once the graph is shown again, and stores nothing for it', () => {
    const items = stubStorage()
    rememberWorkspaceView('ws1', 'list')
    rememberWorkspaceView('ws1', 'graph')
    expect(workspacePath('ws1')).toBe('/w/ws1')
    expect(items.size).toBe(0)
  })

  it('opens the graph when storage is missing or throws', () => {
    vi.stubGlobal('sessionStorage', undefined)
    expect(() => rememberWorkspaceView('ws1', 'list')).not.toThrow()
    expect(workspacePath('ws1')).toBe('/w/ws1')
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => rememberWorkspaceView('ws1', 'list')).not.toThrow()
    expect(workspacePath('ws1')).toBe('/w/ws1')
  })
})
