import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

// Fork-owned executed gate for the fork's CI workflow (fork-ci.yml). The
// file exists only on the dshcode fork, so this spec never runs upstream and
// never conflicts with upstream syncs. It executes through the upstream
// vitest include `scripts/**/*.spec.ts` (vitest.config.ts). It pins the
// fork's CI contract: hosted runners only, keyless only, parallel jobs behind
// one stable verdict, and single-producer caches restored by every lane.
const root = resolve(import.meta.dirname, '..')
const workflowPath = '.github/workflows/fork-ci.yml'
// The lanes behind the required verdict. `web` joined after its Ubuntu run
// proved the fork's goldens current; a lane only leaves this list together
// with all-checks-passed.needs.
const BLOCKING_JOBS = ['static', 'unit', 'coverage'] as const
const CACHED_JOBS = ['static', 'unit', 'web', 'coverage'] as const

describe('Fork CI workflow', () => {
  const workflow = loadWorkflow(workflowPath)

  it('keeps the branch-protection check name stable', () => {
    // Branch protection requires the check by DISPLAY NAME: renaming either
    // half silently strands the required check into a permanently-pending
    // state that blocks every merge. The check name GitHub renders is
    // "<workflow name> / <job name>".
    expect(workflow.name).toBe('Fork CI')
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')
    expect(workflow.jobs['all-checks-passed']).toMatchObject({ name: 'all checks passed' })
  })

  it('runs on every pull request, on master pushes, and manually', () => {
    expect(workflow.on).toEqual({
      push: { branches: ['master'] },
      pull_request: null,
      workflow_dispatch: null,
    })
  })

  it('stays keyless and read-only', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(JSON.stringify(workflow)).not.toContain('secrets.')
    // Telemetry must never reach the production endpoint baked into
    // apps/cli/cordis.yml.
    expect(workflow.env).toMatchObject({ DSH_TELEMETRY_DISABLED: '1' })
  })

  it('exempts master pushes from cancellation', () => {
    // A push run is the post-merge signal and the cache producer. The negated
    // form is load-bearing: naming pull_request alone would stop cancelling
    // superseded workflow_dispatch runs, which share this group on master.
    expect(workflow.concurrency).toMatchObject({
      group: 'fork-ci-${{ github.ref }}',
      'cancel-in-progress': "${{ github.event_name != 'push' }}",
    })
  })

  it('keeps every job on GitHub-hosted Linux runners', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      if (!isRecord(job)) throw new TypeError(`${jobName} must be a job mapping`)
      expect(job['runs-on'], `${jobName} must use a hosted runner`).toBe('ubuntu-latest')
    }
    // No runner label anywhere may reference the upstream self-hosted pools.
    expect(JSON.stringify(workflow)).not.toContain('self-hosted')
  })

  it('isolates every pnpm action setup destination per runner', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    const setups = Object.entries(workflow.jobs).flatMap(([jobName, job]) => {
      if (!isRecord(job) || !Array.isArray(job.steps)) return []
      return job.steps.flatMap((step) => {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) return []
        return [{ jobName, step }]
      })
    })

    expect(setups.length).toBeGreaterThan(0)
    for (const { jobName, step } of setups) {
      expect(step, `${jobName} must not share pnpm/action-setup's default destination`).toMatchObject({
        with: { dest: '${{ runner.temp }}/setup-pnpm' },
      })
    }
  })

  it('restores the pnpm store on every lane and saves it from exactly one producer', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    for (const jobName of CACHED_JOBS) {
      const job = workflow.jobs[jobName]
      if (!isRecord(job) || !Array.isArray(job.steps)) throw new TypeError(`${jobName} must define steps`)

      const restore = job.steps.filter(isRecord).find(step => step.name === 'Restore pnpm store')
      expect(restore, `${jobName} must restore the pnpm store on every event`).toMatchObject({
        uses: 'actions/cache/restore@v4',
      })
      expect(restore?.if, `${jobName} restore must be unconditional`).toBeUndefined()

      const save = job.steps.filter(isRecord).find(step => step.name === 'Save pnpm store (master push)')
      if (jobName === 'unit') {
        // The single producer: five parallel saves of one key would race and
        // waste cache compression on every master push.
        expect(save, 'unit must produce the pnpm store cache').toMatchObject({
          if: "github.event_name == 'push'",
          uses: 'actions/cache@v4',
        })
      } else {
        expect(save, `${jobName} must not save the pnpm store`).toBeUndefined()
      }
    }
  })

  it('gates the required lanes behind one stable pull-request verdict', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    const aggregate = workflow.jobs['all-checks-passed']
    if (!isRecord(aggregate) || !Array.isArray(aggregate.needs)) {
      throw new TypeError('Fork CI workflow must define the all-checks-passed aggregate with needs')
    }
    // `if: always()` keeps a failed dependency from skipping the aggregate:
    // GitHub counts a skipped required check as passing.
    expect(aggregate.if).toBe("always() && github.event_name == 'pull_request'")
    // Order-independent membership: the `needs:` array order is semantically
    // irrelevant to GitHub, so pin the set, not the sequence.
    expect(aggregate.needs).toHaveLength(BLOCKING_JOBS.length)
    for (const jobName of BLOCKING_JOBS) {
      expect(aggregate.needs, `${jobName} must gate the verdict`).toContain(jobName)
    }
    if (!Array.isArray(aggregate.steps)) throw new TypeError('Aggregate must define steps')
    const failStep = aggregate.steps.filter(isRecord).find(step => step.name === 'Fail if any needed job did not succeed')
    expect(failStep).toMatchObject({
      if: "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')",
    })
  })

  it('builds host contracts once and feeds every contracts-ready consumer from them', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    // The static lane must not double-build the host: `pnpm run lint` and
    // `pnpm run typecheck` each rebuild it, while the contracts-ready
    // scripts consume the single build:lib:host step.
    const staticRuns = stepRuns(workflow.jobs.static)
    expect(staticRuns).toContain('pnpm run build:lib:host')
    expect(staticRuns).toContain('pnpm run lint:contracts-ready')
    expect(staticRuns).toContain('pnpm run typecheck:contracts-ready')
    expect(staticRuns).not.toContain('pnpm run lint')
    expect(staticRuns).not.toContain('pnpm run typecheck')
  })

  it('runs the doc gates, the shared static gates, the module graph, and the desktop closure', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    const staticRuns = stepRuns(workflow.jobs.static)
    for (const gate of [
      'pnpm run doc-sync',
      'pnpm run verify-runtime-closure',
      'pnpm run constraints',
      'pnpm run verify-dsh-package-licenses',
      'pnpm run verify-package-invariants',
      'pnpm run verify-cordis-config',
      'pnpm run verify-optional-dependency-imports',
      'pnpm run test:issue-management',
      'pnpm run verify-module-graph',
      'pnpm run verify-desktop-runtime-closure',
    ]) {
      expect(staticRuns, `${gate} must run in the static lane`).toContain(gate)
    }

    // The doc gates live inside doc-sync; a separate docs lane would run
    // that inventory twice.
    expect(workflow.jobs.docs).toBeUndefined()

    expect(stepRuns(workflow.jobs.unit)).toContain('pnpm exec vitest run --maxWorkers=2')
  })

  it('defers knip and duplication until their fork debt is fixed', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    // check:ci:static embeds knip, which fails on the fork's pre-existing
    // debt (unused desktop file/deps, 108 unlisted test imports); duplication
    // fails on 14 plugin-installer clones. The lane must not adopt either
    // gate until that debt is fixed — otherwise every pull request starts red.
    const staticRuns = stepRuns(workflow.jobs.static)
    expect(staticRuns).not.toContain('pnpm run check:ci:static')
    expect(staticRuns).not.toContain('pnpm run knip')
    expect(staticRuns).not.toContain('pnpm run duplication')
  })

  it('scopes the archive baseline to pull requests so the doc gates read the trusted base', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    const staticJob = workflow.jobs.static
    if (!isRecord(staticJob) || !Array.isArray(staticJob.steps)) throw new TypeError('static job must define steps')
    // Full history is load-bearing for the baseline the PR step passes.
    const checkout = staticJob.steps.filter(isRecord).find(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
    expect(checkout).toMatchObject({ with: { 'fetch-depth': 0 } })
    const prStep = staticJob.steps.filter(isRecord).find(step => step.name === 'Run documentation gates (pull request)')
    const pushStep = staticJob.steps.filter(isRecord).find(step => step.name === 'Run documentation gates (push)')
    // An empty string would be read as a literal ref instead of the HEAD default.
    expect(prStep).toMatchObject({
      if: "github.event_name == 'pull_request'",
      env: { DSH_ARCHIVE_BASE_REF: '${{ github.event.pull_request.base.sha }}' },
    })
    expect(pushStep).toMatchObject({ if: "github.event_name != 'pull_request'" })
    expect(pushStep?.env).toBeUndefined()
  })

  it('prepares bubblewrap on the lanes whose suites need confinement', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    // Removing the step would silently skip the sandbox suites instead of
    // failing them — the exact false-green this preparation exists to prevent.
    for (const jobName of ['unit', 'web', 'coverage'] as const) {
      expect(
        stepRuns(workflow.jobs[jobName]).join('\n'),
        `${jobName} must prepare bubblewrap before running its suites`,
      ).toContain('bash scripts/prepare-ci-bubblewrap.sh')
    }
  })

  it('replays the built web frontend keylessly and tunes coverage for the hosted runner', () => {
    if (!isRecord(workflow.jobs)) throw new TypeError('Fork CI workflow must define jobs')

    const web = workflow.jobs.web
    if (!isRecord(web) || !Array.isArray(web.steps)) throw new TypeError('web job must define steps')
    const replayStep = web.steps.filter(isRecord).find(step => step.name === 'Build and run keyless web browser replay')
    expect(replayStep).toMatchObject({
      env: { DSH_SNAPSHOT: 'replay' },
      run: 'pnpm run test:web',
    })
    // The Playwright cache producer stays single-writer: only the web lane
    // installs Chromium.
    const playwrightSave = web.steps.filter(isRecord).find(step => step.name === 'Save Playwright browser cache (master push)')
    expect(playwrightSave).toMatchObject({
      if: "github.event_name == 'push'",
      uses: 'actions/cache@v4',
    })

    const coverage = workflow.jobs.coverage
    expect(coverage).toMatchObject({
      env: {
        DSH_COVERAGE_MAX_WORKERS: '3',
        DSH_GATE_CONCURRENCY: '2',
        // The process-exit scenario reads this knob for its ready wait;
        // dropping it re-exposes the loaded-lane race observed on CI.
        DSH_COVERAGE_TEST_TIMEOUT_MS: '60000',
      },
    })
    expect(stepRuns(coverage)).toContain('pnpm run check:ci:coverage')

    // A renamed or resuffixed check changes the check name branch protection
    // sees; the lane is blocking now, so keep the plain name.
    expect(web).toMatchObject({ name: 'web browser replay' })
  })

  it('keeps snapshot replay and real-API e2e out until they are re-owned for the fork', () => {
    // Both surfaces are deliberately absent while their upstream-owned goldens
    // and provider keys stay upstream concerns; re-enabling requires a
    // fork-side refresh and fork-held secrets respectively.
    const text = JSON.stringify(workflow)
    expect(text).not.toContain('test:snapshot')
    expect(text).not.toContain('DEEPSEEK_API_KEY')
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function stepRuns(job: unknown): string[] {
  if (!isRecord(job) || !Array.isArray(job.steps)) throw new TypeError('job must define steps')
  return job.steps.flatMap(step => (
    isRecord(step) && typeof step.run === 'string' ? [step.run] : []
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
