/**
 * Verify a release family's version baseline, and — when publishing — that the
 * run comes from the family's tag and its members are publishable.
 *
 * Publication happens only from GitHub Actions, so the tag and publishability
 * checks are gates on the workflow, not advisory local warnings
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */

import { parseArgs } from 'node:util'
import { isEntry } from './process.ts'
import { releaseFamily, type ReleaseFamily, type ReleaseMember } from './families.ts'

/**
 * Assert every member may be published: npm refuses a `private` package.
 * @param members - the family's members.
 */
function verifyPublishable(members: readonly ReleaseMember[]): void {
  const priv = members.filter(member => member.manifest.private === true)
  if (priv.length > 0) {
    throw new Error(`publishing requires removing "private": true from:\n${priv.map(member => member.directory).join('\n')}`)
  }
}

/**
 * Assert the workflow runs from a tag this family publishes from, and that the
 * tag names a version the family actually carries.
 * @param family - the release family.
 * @param members - the family's members.
 * @param ref - the `GITHUB_REF` value.
 */
function verifyTag(family: ReleaseFamily, members: readonly ReleaseMember[], ref: string): void {
  const prefix = 'refs/tags/'
  if (!ref.startsWith(prefix)) {
    throw new Error(`publishing release family ${family.id} requires running from a ${family.tagPrefix}* tag, got ${ref || '(no ref)'}`)
  }
  const tag = ref.slice(prefix.length)
  if (!tag.startsWith(family.tagPrefix)) {
    throw new Error(`tag ${tag} does not belong to release family ${family.id} (expected ${family.tagPrefix}*)`)
  }
  const expected = members.map(member => family.tagFor(member))
  if (!expected.includes(tag)) {
    throw new Error(`tag ${tag} names no version this family carries; its members would tag as:\n${[...new Set(expected)].join('\n')}`)
  }
}

/** Run the verification for the family named by `--family`. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined) throw new Error('usage: verify.ts --family <dsh|vendor>')

  const family = releaseFamily(values.family)
  const members = family.members(process.cwd())
  family.verifyVersions(members)

  const publishing = process.env.RELEASE_PUBLISH === 'true'
  if (publishing) {
    verifyPublishable(members)
    verifyTag(family, members, process.env.GITHUB_REF ?? '')
  }

  const versions = [...new Set(members.map(member => member.version))]
  const summary = versions.length === 1 ? versions[0] : `${String(versions.length)} versions`
  console.log(`release verify: family ${family.id}, ${String(members.length)} member(s), ${summary}${publishing ? ', publish gates passed' : ''}`)
}

if (isEntry(import.meta.url)) main()
