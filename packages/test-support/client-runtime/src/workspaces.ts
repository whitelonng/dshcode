/** Test-owned workspaces face: the renderer standard-kit observable plus recorded actions. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { workspaceSnapshot } from './fixtures.ts'
import type { FixtureSnapshot, Stabilizer } from './fixtures.ts'

/** Writable test representation of the immutable Workspace Controller snapshot. */
type WorkspaceFixtureSnapshot = FixtureSnapshot<WorkspaceSnapshot>

/** Callable command names on the production Workspace Controller face. */
type WorkspaceAction = {
  [Key in keyof IWorkspaces]: IWorkspaces[Key] extends (...args: never[]) => unknown ? Key : never
}[keyof IWorkspaces]

/**
 * Product desktop extensions beyond the upstream Controller face. The upstream
 * moved these verbs to the host directory-picking seam, but the test double
 * retains them as extra stubbable methods so feature suites keep driving the
 * recorded desktop flows without depending on that seam's Host backend.
 */
type ProductWorkspaceAction =
  | 'openPath'
  | 'pickDirectory'
  | 'pickFiles'
  | 'locateFiles'
  | 'listDirectory'
  | 'createDirectory'
  | 'restoreSession'
  | 'deleteSession'

/** Everything the double records and can stub. */
type AnyWorkspaceAction = WorkspaceAction | ProductWorkspaceAction

/** Product-extension signatures, used by {@link WorkspaceStub} for the keys outside {@link IWorkspaces}. */
interface ProductWorkspaceStub {
  openPath: (path: string) => Promise<void>
  pickDirectory: () => Promise<string | null>
  pickFiles: () => Promise<{ cancelled: boolean; paths: string[] }>
  locateFiles: (sessionId: SessionId, names: string[]) => Promise<Array<{ name: string; paths: string[] }>>
  listDirectory: (path: string | undefined, signal: AbortSignal | undefined) => Promise<DirectoryListing>
  createDirectory: (path: string, name: string) => Promise<string>
  restoreSession: (sessionId: SessionId) => Promise<void>
  deleteSession: (sessionId: SessionId) => Promise<void>
}

/** Test replacement retaining one command's parameters and result. */
type WorkspaceStub<Key extends AnyWorkspaceAction> =
  Key extends keyof IWorkspaces
    ? (...args: Parameters<IWorkspaces[Key]>) => ReturnType<IWorkspaces[Key]>
    : Key extends ProductWorkspaceAction
      ? ProductWorkspaceStub[Key]
      : never

/**
 * Workspaces test double. Implements the same IWorkspaces face features
 * receive as `ctx.workspaces`, so a production face change breaks this
 * double at compile time. Every action records into {@link
 * TestWorkspaces.calls}; defaults are inert echoes — feature tests needing
 * richer behavior replace them via {@link TestWorkspaces.stub}.
 */
export class TestWorkspaces implements IWorkspaces {
  /** The useWorkspaces standard feed. */
  readonly list: SnapshotStore<WorkspaceFixtureSnapshot>

  /** Calls observed on the action face, newest last. */
  readonly calls: { method: string; args: unknown[] }[] = []

  /** Replaceable action seat: feature tests may stub richer behavior. */
  private readonly stubs = new Map<AnyWorkspaceAction, (...args: unknown[]) => unknown>()

  /**
   * @param stabilize - the owning runtime's act wrapper.
   */
  constructor(private readonly stabilize: Stabilizer) {
    this.list = createSnapshotStore<WorkspaceFixtureSnapshot>({ ...workspaceSnapshot() })
  }

  /**
   * Update the workspace list state through an immer draft.
   * @param mutate - draft mutator.
   */
  async update(mutate: (draft: WorkspaceFixtureSnapshot) => void): Promise<void> {
    await this.stabilize(() => { this.list.update(mutate) })
  }

  /**
   * Replace an action's behavior (the recorded call is still appended first).
   * @param method - Controller action name (e.g. 'create').
   * @param impl - replacement behavior.
   */
  stub<Key extends AnyWorkspaceAction>(method: Key, impl: WorkspaceStub<Key>): void {
    this.stubs.set(method, impl as (...args: unknown[]) => unknown)
  }

  /**
   * Create a Workspace (recorded). The default echoes a view derived from
   * the input; stub for failure or list-coupled flows.
   * @param input - the Host create payload.
   * @returns the created Workspace view.
   */
  async create(input: { path: string }): Promise<WorkspaceView> {
    this.calls.push({ method: 'create', args: [input] })
    const stub = this.stubs.get('create')
    if (stub !== undefined) return await (stub(input) as Promise<WorkspaceView>)
    return {
      workspaceId: `ws-${input.path}` as WorkspaceId,
      title: input.path,
      path: input.path,
      sessionIds: [],
    } as unknown as WorkspaceView
  }

  /**
   * Open a path with the host OS default application (recorded; default no-op).
   * @param path - host-resolvable path.
   */
  async openPath(path: string): Promise<void> {
    this.calls.push({ method: 'openPath', args: [path] })
    await (this.stubs.get('openPath')?.(path) as Promise<void> | undefined)
  }

  /**
   * Directory picker (recorded). The default cancels (null); stub to select.
   * @returns the picked path, or null.
   */
  async pickDirectory(): Promise<string | null> {
    this.calls.push({ method: 'pickDirectory', args: [] })
    const stub = this.stubs.get('pickDirectory')
    if (stub !== undefined) return await (stub() as Promise<string | null>)
    return null
  }

  /**
   * File picker (recorded). The default cancels; stub to select paths.
   * @returns cancellation plus selected absolute paths.
   */
  async pickFiles(): Promise<{ cancelled: boolean; paths: string[] }> {
    this.calls.push({ method: 'pickFiles', args: [] })
    const stub = this.stubs.get('pickFiles')
    if (stub !== undefined) return await (stub() as Promise<{ cancelled: boolean; paths: string[] }>)
    return { cancelled: true, paths: [] }
  }

  /**
   * Drag-location (recorded). The default finds nothing; stub to resolve.
   * @param sessionId - target session.
   * @param names - dragged basenames.
   * @returns one item per name, each with an empty `paths` list by default.
   */
  async locateFiles(sessionId: SessionId, names: string[]): Promise<Array<{ name: string; paths: string[] }>> {
    this.calls.push({ method: 'locateFiles', args: [sessionId, names] })
    const stub = this.stubs.get('locateFiles')
    if (stub !== undefined) return await (stub(sessionId, names) as Promise<Array<{ name: string; paths: string[] }>>)
    return names.map(name => ({ name, paths: [] }))
  }

  /**
   * Browse listing (recorded). The default serves an empty home level; stub
   * to shape a tree.
   * @param path - absolute directory to list; absent lists the home level.
   * @param signal - aborts an in-flight listing; forwarded to the wire like production.
   * @returns the level's listing.
   */
  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    // The signal is recorded and forwarded like the production face passes
    // it to the wire, so cancellation integration tests can observe or
    // reject on a superseded scan.
    this.calls.push({ method: 'listDirectory', args: [path, signal] })
    const stub = this.stubs.get('listDirectory')
    if (stub !== undefined) return await (stub(path, signal) as Promise<DirectoryListing>)
    // The chain runs root-to-target inclusive, per the DirectoryListing
    // contract — a bare root crumb would mislabel the level in browsers
    // driven by this double.
    return {
      path: '/home/test',
      home: '/home/test',
      crumbs: [
        { name: '/', path: '/', hidden: false },
        { name: 'home', path: '/home', hidden: false },
        { name: 'test', path: '/home/test', hidden: false },
      ],
      entries: [],
      truncated: false,
    }
  }

  /**
   * Browse child creation (recorded). The default joins parent and name.
   * @param path - absolute existing parent directory.
   * @param name - single path segment.
   * @returns the created directory's absolute path.
   */
  async createDirectory(path: string, name: string): Promise<string> {
    this.calls.push({ method: 'createDirectory', args: [path, name] })
    const stub = this.stubs.get('createDirectory')
    if (stub !== undefined) return await (stub(path, name) as Promise<string>)
    return `${path}/${name}`
  }

  /**
   * Rename a Workspace (recorded). The default echoes a minimal view.
   * @param workspaceId - target workspace.
   * @param title - new title.
   * @returns the updated view.
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    this.calls.push({ method: 'rename', args: [workspaceId, title] })
    const stub = this.stubs.get('rename')
    if (stub !== undefined) return await (stub(workspaceId, title) as Promise<WorkspaceView>)
    return { workspaceId, title, path: `/${title}`, sessionIds: [] } as unknown as WorkspaceView
  }

  /**
   * Delete a Workspace (recorded; default no-op).
   * @param workspaceId - target workspace.
   */
  async delete(workspaceId: WorkspaceId): Promise<void> {
    this.calls.push({ method: 'delete', args: [workspaceId] })
    await (this.stubs.get('delete')?.(workspaceId) as Promise<void> | undefined)
  }

  /**
   * Move a Workspace in display order (recorded; default no-op).
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor; omitted appends.
   */
  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    this.calls.push({ method: 'insertBefore', args: [workspaceId, beforeWorkspaceId] })
    await (this.stubs.get('insertBefore')?.(workspaceId, beforeWorkspaceId) as Promise<void> | undefined)
  }

  /**
   * Move an accounted session (recorded). The default echoes a minimal view.
   * @param workspaceId - target workspace.
   * @param sessionId - session to move.
   * @param beforeSessionId - anchor; omitted appends.
   * @returns the updated view.
   */
  async insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<WorkspaceView> {
    this.calls.push({ method: 'insertSessionBefore', args: [workspaceId, sessionId, beforeSessionId] })
    const stub = this.stubs.get('insertSessionBefore')
    if (stub !== undefined) return await (stub(workspaceId, sessionId, beforeSessionId) as Promise<WorkspaceView>)
    return { workspaceId, title: '', path: '', sessionIds: [sessionId] } as unknown as WorkspaceView
  }

  /**
   * Archive a session (recorded). The default mirrors the production face's
   * observable effect: the id joins the list state's archive set.
   * @param sessionId - session to archive.
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    this.calls.push({ method: 'archiveSession', args: [sessionId] })
    const stub = this.stubs.get('archiveSession')
    if (stub !== undefined) {
      await (stub(sessionId) as Promise<void>)
      return
    }
    await this.update((draft) => {
      draft.archivedSessionIds = [...draft.archivedSessionIds, sessionId]
    })
  }

  /**
   * Restore one session from the archive set (recorded). The default mirrors
   * the production face's observable effect: the id leaves the archive set.
   * @param sessionId - session to restore.
   */
  async restoreSession(sessionId: SessionId): Promise<void> {
    this.calls.push({ method: 'restoreSession', args: [sessionId] })
    const stub = this.stubs.get('restoreSession')
    if (stub !== undefined) {
      await (stub(sessionId) as Promise<void>)
      return
    }
    await this.update((draft) => {
      draft.archivedSessionIds = draft.archivedSessionIds.filter(id => id !== sessionId)
    })
  }

  /**
   * Permanently delete one archived session (recorded). The default mirrors
   * the production face's observable effect: the id leaves the archive set.
   * @param sessionId - archived session to delete.
   */
  async deleteSession(sessionId: SessionId): Promise<void> {
    this.calls.push({ method: 'deleteSession', args: [sessionId] })
    const stub = this.stubs.get('deleteSession')
    if (stub !== undefined) {
      await (stub(sessionId) as Promise<void>)
      return
    }
    await this.update((draft) => {
      draft.archivedSessionIds = draft.archivedSessionIds.filter(id => id !== sessionId)
    })
  }
}
