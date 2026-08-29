/** Test-only loader for fixed SQLite fixtures. */

import { readFileSync } from 'node:fs'

export type TestSqlName =
  | 'add-unexpected-column'
  | 'count-events'
  | 'count-ignorable-events'
  | 'count-packed-events'
  | 'count-physical-types'
  | 'create-loose-schema'
  | 'create-unrelated-table'
  | 'delete-persistence-state'
  | 'delete-session-events'
  | 'empty-store-id'
  | 'insert-corrupt-event'
  | 'measure-write-traffic'
  | 'replace-events-with-nonstrict-table'
  | 'select-last-event'
  | 'select-event-rowids'
  | 'select-event-rows'
  | 'select-user-version'
  | 'set-application-id-12345'
  | 'set-user-version-15'
  | 'set-user-version-16'
  | 'set-user-version-17'
  | 'update-invalid-session-metadata'

/** Load one fixed test SQL resource. */
export function testSql(name: TestSqlName): string {
  return readFileSync(new URL(`./resources/sql/${name}.sql`, import.meta.url), 'utf8')
}
