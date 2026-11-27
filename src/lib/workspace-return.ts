/**
 * The view (graph or list) each workspace was last shown in, for this browser
 * tab, so the links from a paper back to its workspace open the same view.
 * The workspace page's URL (`?view=list`) stays the source of truth; this only
 * remembers it in sessionStorage. Storage can be missing or throw (private
 * windows, blocked site data, the prerender), and then the links open the graph.
 */

import type { WorkspaceView } from './workspace'

const key = (workspaceId: string) => `schema:workspace-view:${workspaceId}`

/** Called by the workspace page whenever its view is shown. The graph is the default, so it is stored as no entry. */
export function rememberWorkspaceView(workspaceId: string, view: WorkspaceView): void {
  try {
    if (view === 'list') sessionStorage.setItem(key(workspaceId), 'list')
    else sessionStorage.removeItem(key(workspaceId))
  } catch {
    // Without storage the way back opens the graph.
  }
}

/** The path back to a workspace, in the view it was last shown in. */
export function workspacePath(workspaceId: string): string {
  let list = false
  try {
    list = sessionStorage.getItem(key(workspaceId)) === 'list'
  } catch {
    list = false
  }
  return list ? `/w/${workspaceId}?view=list` : `/w/${workspaceId}`
}
