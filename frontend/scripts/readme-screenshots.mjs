// Captures the README screenshots from the running dev app into docs/images/.
//
// Usage: node scripts/readme-screenshots.mjs [http://localhost:5173]
// Needs the Vite dev server and the API (see "Run it" in the README).
// Read only: Live Lab replays a recorded run, so no model is called.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = new URL('../../docs/images/', import.meta.url).pathname
const RUN = 'official-2026-10-29'
const QUESTION =
  'Which games in other markets belong to the same kind of game family as game GAME_AT_05?'
const SETTLE_MS = 1500

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

async function shoot(name, hash, ready) {
  await page.goto(`${BASE}/#/${hash}`)
  await ready?.()
  await page.waitForTimeout(SETTLE_MS)
  await page.screenshot({ path: `${OUT}${name}.png` })
  console.log(`${name}.png`)
}

await shoot('overview', 'overview', () =>
  page.getByRole('heading', { level: 1 }).first().waitFor(),
)

await shoot('live-lab', 'live-lab', async () => {
  await page.getByRole('button', { name: QUESTION }).click()
  await page.getByRole('button', { name: 'Recorded run', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByText('The run is complete.').waitFor({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Fit to the evidence' }).click()
  await page
    .getByRole('button', { name: "Show C's path" })
    .evaluate((button) => button.scrollIntoView())
})

await shoot('data-model', 'data-model', () =>
  page.getByRole('heading', { level: 1 }).first().waitFor(),
)

await shoot('results', `results?run=${RUN}`, () =>
  page
    .getByRole('heading', { name: 'Outcomes' })
    .first()
    .evaluate((heading) => heading.scrollIntoView()),
)

await shoot('help', 'help?section=company', () =>
  page.getByRole('heading', { name: 'What a world is' }).first().waitFor(),
)

await browser.close()
