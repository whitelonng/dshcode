/** React-free Client Workspace service and command facade. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ArchivedSessionItem, WorkspaceView } from '../types.ts'
import type { ClientWorkspaceModel, WorkspaceSnapshot } from './model.ts'

/** Structured create failure for callers that distinguish Host business errors. */
export class WorkspaceCreateError extends Error {
  override readonly name = 'WorkspaceCreateError'

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/**
 * Command failure carrying the Host wire code, so callers that map specific
 * rejections to dedicated copy (the archive section's session-active remedy)
 * keep their typed handling over the shared service face. The code is also
 * readable as the plain `code` field: consumer plugins cannot import this
 * class as a value (cross-plugin value imports are a bundle error), so they
 * match on the structure instead of the class identity.
 */
export class WorkspaceCommandError extends Error {
  override readonly name = 'WorkspaceCommandError'

  /** The Host wire code of the failed command. */
  readonly code: string

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure, operation: string) {
    super(`workspace ${operation} failed: ${rpcError.code}: ${rpcError.message}`)
    this.code = rpcError.code
  }
}

/** Bare observable source for the Workspace Controller snapshot. */
export interface WorkspaceSource {
  /** Read the identity-stable current snapshot. */
  getSnapshot(): WorkspaceSnapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** Workspace Controller's Client service face. */
export interface IWorkspaces {
  /** Host-authoritative Workspace rows, order, archive set, and follow lifecycle. */
  readonly list: WorkspaceSource
  /**
   * Register an existing path as a Workspace.
   * @param input - Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Rename a Workspace.
   * @param workspaceId - target Workspace.
   * @param title - new display title.
   * @returns the renamed Workspace.
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Delete a Workspace registration without deleting Sessions or files.
   * @param workspaceId - target Workspace.
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the Host registry order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - anchor Workspace; omitted appends.
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Archive a Session from Workspace grouping surfaces.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * List the Host's archived sessions for the settings surface.
   * @returns one row per archived Session, in archive-set order.
   */
  listArchived(): Promise<ArchivedSessionItem[]>
  /**
   * Remove one Session from the registry-global archive set.
   * @param sessionId - Session to unarchive.
   */
  restoreSession(sessionId: SessionId): Promise<void>
  /**
   * Permanently delete one archived Session (log first, then accounting).
   * @param sessionId - archived Session to delete.
   */
  deleteSession(sessionId: SessionId): Promise<void>
  /**
   * Move a Session within one Workspace account.
   * @param workspaceId - owning Workspace.
   * @param sessionId - Session to move.
   * @param beforeSessionId - anchor Session; omitted appends.
   * @returns the changed Workspace.
   */
  insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView>
}

/** Owns the bare Workspace snapshot and Workspace-only commands. */
export class WorkspaceController extends Service implements IWorkspaces {
  readonly list: WorkspaceSource

  /**
   * @param ctx - Client root Context.
   * @param model - Remote-backed Workspace state model.
   */
  constructor(ctx: Context, private readonly model: ClientWorkspaceModel) {
    super(ctx, 'workspaces')
    this.list = model
  }

  async create(input: { path: string }): Promise<WorkspaceView> {
    const result = await this.model.create(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value.workspace
  }

  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const result = await this.model.rename(workspaceId, title)
    if (!result.ok) throw commandError('rename', result.error)
    return result.value.workspace
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    const result = await this.model.delete(workspaceId)
    if (!result.ok) throw commandError('delete', result.error)
  }

  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const result = await this.model.insertBefore(workspaceId, beforeWorkspaceId)
    if (!result.ok) throw commandError('reorder', result.error)
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.archiveSession(sessionId)
    if (!result.ok) throw commandError('session archive', result.error)
  }

  /**
   * List the Host's archived sessions for the settings surface.
   * @returns one row per archived Session, in archive-set order.
   */
  async listArchived(): Promise<ArchivedSessionItem[]> {
    const result = await this.model.listArchived()
    if (!result.ok) throw commandError('archived listing', result.error)
    return [...result.value.items]
  }

  /**
   * Remove one Session from the registry-global archive set.
   * @param sessionId - Session to unarchive.
   */
  async restoreSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.restoreSession(sessionId)
    if (!result.ok) throw commandError('session restore', result.error)
  }

  /**
   * Permanently delete one archived Session (log first, then accounting).
   * @param sessionId - archived Session to delete.
   */
  async deleteSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.deleteSession(sessionId)
    if (!result.ok) throw commandError('session delete', result.error)
  }

  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    const result = await this.model.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    if (!result.ok) throw commandError('move', result.error)
    return result.value.workspace
  }
}

function commandError(operation: string, failure: RemoteFailure): Error {
  return new WorkspaceCommandError(failure, operation)
}
