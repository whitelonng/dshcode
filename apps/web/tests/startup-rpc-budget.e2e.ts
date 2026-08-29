// Cold-boot RPC budget. The describe mirror (packages/client/ui-settings) is
// the one `settings.describe` reader in the browser, so startup describe
// traffic stays bounded no matter how many client plugins own a preference.
// A regression here means a consumer bypassed the mirror — grep for
// `settings.describe(` outside ui-settings' client sources.
//
// Zero model calls: the lane only boots chrome, so no replay fixture mounts.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/**
 * Both reads are the mirror's: once eagerly at bind time over HTTP, and once
 * on the first-connection reset — that second read closes the window where a
 * document commit lands between the eager read and the SSE subscription and
 * its invalidation is lost. Every settings consumer derives from these two.
 */
const DESCRIBE_BUDGET = 2

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
})

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await scaffold?.close()
})

describe('startup RPC budget', () => {
  it('keeps cold-boot settings.describe at the mirror count', async () => {
    page = await newEnglishPage(browser)
    watchConsole(page)
    const calls: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) calls.push(url.pathname.slice('/api/'.length))
    })
    await page.goto(scaffold.baseUrl)
    // Boot settles when the workspace picker is interactive; the trailing wait
    // absorbs the first-connection reset wave the budget must include.
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    const describeCount = calls.filter(method => method === 'settings.describe').length
    expect(describeCount, `startup /api calls:\n${calls.join('\n')}`).toBe(DESCRIBE_BUDGET)
  })
})
