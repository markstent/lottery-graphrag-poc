import { expect, test, type Page, type Request } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import {
  expectNoUnmockedRequests,
  mockApi,
  type DataModelState,
} from './mock-api'
import { EXAMPLE, ROW_COUNTS, rowsOf } from './mock-data-model'

/*
 * Data Model in a browser, against the mock API (D-115): five tabs on one
 * explorer layout, each step a link. SHOTS=<dir> also saves pictures.
 */

test.use({ viewport: { width: 1920, height: 1080 } })

// A call the mock does not answer is refused; it must not go unnoticed.
test.afterEach(({ page }) => expectNoUnmockedRequests(page))

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${name}.png` })
}

async function open(page: Page, hash: string, state?: DataModelState) {
  await mockApi(page, 'published', 'official', state)
  await page.goto(`/${hash}`)
}

const rowsRequests = (page: Page, table: string) => {
  const seen: URL[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith(`/tables/${table}/rows`)) seen.push(url)
  })
  return seen
}

const total = (n: number) => n.toLocaleString('en-GB')
const section = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Data Model sections' })
    .getByRole('link', { name, exact: true })
const column = (page: Page, step: number) =>
  page.getByRole('region', { name: new RegExp(`^${step} `) })
/** A box of the Graph tab's drawing, by its record id. */
const box = (page: Page, id: string) =>
  page.locator(`g[role=button][data-node-id="${id}"]`)

const EXAMPLE_ID = EXAMPLE.incident_id!
const NATIONAL_DRAW = '#/data-model?tab=concepts&concept=CONCEPT_NATIONAL_DRAW'
/** An incident with enough support cases in the capture to fold into one box. */
const MANY_CASES = 'INC_031'

test('the mock names an example incident', () => {
  expect(EXAMPLE_ID).toMatch(/^INC_\d+$/)
})

test.describe('Overview', () => {
  test('opens when the address names no tab, with the example on every card', async ({
    page,
  }) => {
    await open(page, '#/data-model')
    await expect(section(page, 'Overview')).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const name of [
      "The company's data",
      'The links between records',
      'One dictionary for four countries',
    ])
      await expect(
        page.getByRole('region', { name }).getByText(EXAMPLE_ID).first(),
      ).toBeVisible()
    // Through the layers, the incident type ends at its shared concept.
    const fit = page.getByRole('region', { name: 'How they fit together' })
    await expect(fit.getByText('Application incident')).toBeVisible()
    await shot(page, 'overview')
  })

  for (const [button, tab, label, heading] of [
    ['Explore tables', 'tables', 'Tables', '1 Choose a table'],
    ['Explore the graph', 'graph', 'Graph', '1 Choose a kind or find a record'],
    ['Explore concepts', 'concepts', 'Concepts', '1 Choose a concept'],
  ] as const)
    test(`"${button}" opens the ${tab} tab`, async ({ page }) => {
      await open(page, '#/data-model')
      await page.getByRole('link', { name: button }).click()
      await expect(page).toHaveURL(new RegExp(`#/data-model\\?tab=${tab}$`))
      await expect(section(page, label)).toHaveAttribute('aria-current', 'page')
      await expect(
        page.getByRole('heading', { name: heading, level: 2 }),
      ).toBeVisible()
    })

  test('a kind in the core of the graph opens a sample of that kind', async ({
    page,
  }) => {
    await open(page, '#/data-model')
    await page
      .getByRole('region', { name: 'The core of the graph' })
      .getByRole('link', { name: /^game, / })
      .click()
    await expect(page).toHaveURL(/#\/data-model\?tab=graph&kind=Game$/)
    await expect(
      column(page, 1).getByRole('button', { name: /^game \d+$/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('img', { name: / and its neighbours$/ }),
    ).toBeVisible()
  })

  test('the stories line opens the Stories tab', async ({ page }) => {
    await open(page, '#/data-model')
    await page.getByRole('link', { name: /stories are planted/ }).click()
    await expect(page).toHaveURL(/#\/data-model\?tab=stories$/)
    await expect(
      page.getByRole('heading', { name: '1 Choose a story', level: 2 }),
    ).toBeVisible()
  })
})

test.describe('Tables', () => {
  test('opens on the example incident, the row beside its rows', async ({
    page,
  }) => {
    await open(page, '#/data-model?tab=tables')
    await expect(
      column(page, 1).getByRole('button', { name: /^incidents / }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      column(page, 3).getByText('Becomes these links in the graph'),
    ).toBeVisible()
    await expect(column(page, 3).getByText(EXAMPLE_ID).first()).toBeVisible()
  })

  test('a row, a linked row and on into the graph', async ({ page }) => {
    await open(page, '#/data-model?tab=tables&table=incidents')
    await page.getByRole('button', { name: 'Open INC_001' }).click()
    await expect(page).toHaveURL(/table=incidents&row=INC_001$/)
    const record = column(page, 3)
    await expect(record.getByText('PLT_APP_ANDROID').first()).toBeVisible()
    await shot(page, 'tables-row')

    // An underlined value goes to the row it names, in its own table.
    await page
      .getByRole('row', { name: /^Open INC_001 / })
      .getByRole('link', { name: 'PLV_APP_ANDROID_2' })
      .click()
    await expect(page).toHaveURL(
      /tab=tables&table=platform_versions&row=PLV_APP_ANDROID_2$/,
    )
    await expect(
      column(page, 1).getByRole('button', { name: /^platform versions / }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: 'Open PLV_APP_ANDROID_2' }),
    ).toBeVisible()
    await shot(page, 'tables-linked-row')

    await record.getByRole('link', { name: 'Open in the graph' }).click()
    await expect(page).toHaveURL(/tab=graph&node=PLV_APP_ANDROID_2$/)
    await expect(box(page, 'PLV_APP_ANDROID_2')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.goBack()
    await expect(page).toHaveURL(/row=PLV_APP_ANDROID_2$/)
    await expect(section(page, 'Tables')).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('a row with no record in the graph says so', async ({ page }) => {
    await open(page, '#/data-model?tab=tables&table=tickets')
    await page
      .getByRole('button', { name: /^Open TKT_\d+$/ })
      .first()
      .click()
    await expect(
      column(page, 3).getByText('This row is not in the graph.'),
    ).toBeVisible()
    await expect(
      column(page, 3).getByRole('link', { name: 'Open in the graph' }),
    ).toHaveCount(0)
  })

  /* Devices repeat their first-seen timestamps widely, so a copied one has pages. */
  test('filter by a copied timestamp and page', async ({ page }) => {
    const requests = rowsRequests(page, 'devices')
    await open(page, '#/data-model?tab=tables&table=devices')
    await expect(
      page.getByText(`Rows 1 to 50 of ${total(ROW_COUNTS.devices)}`),
    ).toBeVisible()

    // Copy the first_seen_at value of the first row, exactly as the grid shows it.
    const headers = await page.getByRole('columnheader').allInnerTexts()
    const stamp = await page
      .getByRole('row')
      .nth(1)
      .getByRole('cell')
      .nth(headers.indexOf('first_seen_at'))
      .innerText()
    expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/)
    const matching = (
      rowsOf(
        'devices',
        new URLSearchParams({ column: 'first_seen_at', value: stamp }),
      ).body as { total: number }
    ).total
    expect(matching).toBeGreaterThan(50)

    await page.getByLabel('Column').selectOption('first_seen_at')
    await page.getByLabel('Value').fill(stamp)
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(
      page.getByText(`Rows 1 to 50 of ${total(matching)}`),
    ).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(51)

    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(
      page.getByText(
        `Rows 51 to ${Math.min(100, matching)} of ${total(matching)}`,
      ),
    ).toBeVisible()

    // On to the last page: its bounds are exact and there is no way further.
    const next = page.getByRole('button', { name: 'Next page' })
    for (let start = 101; start <= matching; start += 50) {
      await next.click()
      await expect(
        page.getByText(
          `Rows ${total(start)} to ${total(Math.min(start + 49, matching))} of ${total(matching)}`,
        ),
      ).toBeVisible()
    }
    await expect(next).toBeDisabled()

    const typed = requests.filter((url) => url.searchParams.has('column'))
    expect(typed.map((url) => Number(url.searchParams.get('offset')))).toEqual(
      Array.from({ length: Math.ceil(matching / 50) }, (_, i) => i * 50),
    )
    for (const url of typed) {
      expect(url.searchParams.get('column')).toBe('first_seen_at')
      expect(url.searchParams.get('value')).toBe(stamp)
      expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50)
    }
  })

  test('a value that does not fit the column shows the server message', async ({
    page,
  }) => {
    await open(page, '#/data-model?tab=tables&table=tickets')
    await page.getByLabel('Column').selectOption('purchase_timestamp')
    await page.getByLabel('Value').fill('last week')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(
      "'last week' is not a TIMESTAMP value for purchase_timestamp",
    )
    // Devices are captured in full, so a filter on them has the world's own total.
    await page.goto('/#/data-model?tab=tables&table=devices')
    await page.getByLabel('Column').selectOption('first_seen_at')
    await page.getByLabel('Value').fill('2031-01-01T00:00:00')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(
      page.getByText('No row has first_seen_at equal to 2031-01-01T00:00:00.'),
    ).toBeVisible()
  })
})

test.describe('Graph', () => {
  test('opens on the example incident and its neighbours', async ({ page }) => {
    await open(page, '#/data-model?tab=graph')
    await expect(box(page, EXAMPLE_ID)).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('img', { name: `${EXAMPLE_ID} and its neighbours` }),
    ).toBeVisible()
  })

  test('search by id, a group of neighbours, and back to the table row', async ({
    page,
  }) => {
    await open(page, '#/data-model?tab=graph')
    await page
      .getByRole('searchbox', { name: 'Find a record by id' })
      .fill('GAME_UK_01')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page).toHaveURL(/tab=graph&node=GAME_UK_01$/)
    await expect(
      page.getByRole('button', { name: 'Albion Millions, game' }),
    ).toHaveAttribute('aria-pressed', 'true')
    // The neighbours come from the rows: the game's own market among them.
    await expect(
      page.getByRole('button', { name: 'United Kingdom, market' }),
    ).toBeVisible()

    // An id no record has says so, and keeps the page.
    await page
      .getByRole('searchbox', { name: 'Find a record by id' })
      .fill('NOT_A_RECORD')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByText('No record with that id.')).toBeVisible()

    // Many neighbours of one kind of link are one box; choosing it lists them.
    await page.goto(`/#/data-model?tab=graph&node=${MANY_CASES}`)
    const group = page.getByRole('button', {
      name: /^\d+ support cases, click to list them$/,
    })
    await group.click()
    await expect(page).toHaveURL(
      new RegExp(`node=${MANY_CASES}&group=RELATED_TO%3Ain$`),
    )
    await expect(group).toHaveAttribute('aria-pressed', 'true')
    const members = column(page, 3)
    const firstMember = members.getByRole('button', { name: /^SUP_\d+$/ })
    await expect(firstMember.first()).toBeVisible()
    const id = await firstMember.first().innerText()
    await shot(page, 'graph-group')

    await firstMember.first().click()
    await expect(page).toHaveURL(new RegExp(`tab=graph&node=${id}$`))
    await members.getByRole('link', { name: 'See its table row' }).click()
    await expect(page).toHaveURL(
      new RegExp(`tab=tables&table=support_cases&row=${id}$`),
    )
    await expect(
      page.getByRole('row', { name: new RegExp(`^Open ${id} `) }),
    ).toHaveAttribute('aria-current', 'true')
  })

  test('a kind of record opens a sample of it', async ({ page }) => {
    await open(page, `#/data-model?tab=graph&node=${EXAMPLE_ID}`)
    await column(page, 1)
      .getByRole('button', { name: /^game \d+$/ })
      .click()
    await expect(page).toHaveURL(/tab=graph&node=GAME_/)
    await expect(
      column(page, 1).getByRole('button', { name: /^game \d+$/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('presentation mode draws the record and its neighbours larger', async ({
    page,
  }) => {
    await mockApi(page)
    const drawing = async (url: string) => {
      await page.goto(url)
      const picture = page.getByRole('img', {
        name: `${EXAMPLE_ID} and its neighbours`,
      })
      await expect(picture).toBeVisible()
      return (await picture.boundingBox())!
    }
    const normal = await drawing('/#/data-model?tab=graph')
    const presenting = await drawing('/?present=1#/data-model?tab=graph')
    expect(presenting.height).toBeGreaterThan(normal.height)
  })
})

test.describe('Concepts', () => {
  test('one concept under four names, its terms filtered by country', async ({
    page,
  }) => {
    await open(page, NATIONAL_DRAW)
    const concept = page.getByRole('region', { name: 'Concept', exact: true })
    await expect(concept.getByText('Αριθμολαχείο')).toBeVisible()
    await expect(concept.getByText('Zahlenziehung')).toBeVisible()
    const terms = page.getByRole('region', { name: 'Country terms for it' })
    await expect(terms.getByRole('group')).toHaveCount(4)

    await page.getByRole('button', { name: 'Greece' }).click()
    await expect(page).toHaveURL(/concept=CONCEPT_NATIONAL_DRAW&market=MKT_GR$/)
    await expect(terms.getByRole('group')).toHaveCount(1)
    await expect(terms.getByText(/Αριθμολαχείο/)).toBeVisible()
    await expect(terms.getByText(/Zahlenziehung/)).toHaveCount(0)
    await shot(page, 'concepts-filtered')

    await page.getByRole('button', { name: 'All markets' }).click()
    await expect(terms.getByRole('group')).toHaveCount(4)
  })

  test('the concept tree is one tab stop and moves with the arrow keys', async ({
    page,
  }) => {
    await open(page, NATIONAL_DRAW)
    const tree = page.getByRole('tree', { name: 'Concepts' })
    await page.getByRole('searchbox', { name: 'Search concepts' }).focus()
    await page.keyboard.press('Tab')
    await expect(
      tree.getByRole('treeitem', { name: 'National Draw' }),
    ).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(
      tree.getByRole('treeitem', { name: 'Draw game' }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/concept=CONCEPT_DRAW_GAME$/)
    await expect(
      page
        .getByRole('region', { name: 'Concept', exact: true })
        .getByText('Ziehungsspiel', { exact: true }),
    ).toBeVisible()
  })
})

test.describe('Stories', () => {
  test('a story, what was planted, and on to Help', async ({ page }) => {
    await open(page, '#/data-model?tab=stories')
    await page.getByRole('button', { name: /^Shared device cluster / }).click()
    await expect(page).toHaveURL(/tab=stories&story=SCN-002$/)
    const planted = column(page, 2)
    await expect(
      planted.getByRole('heading', { name: 'Shared device cluster' }),
    ).toBeVisible()
    await expect(planted.getByText('Noise level')).toBeVisible()
    await expect(
      planted.getByRole('list', { name: 'Rows added' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'See its questions' }),
    ).toHaveAttribute('href', '#/help?section=questions&story=SCN-002')
    // Only the truth ledger names the rows a story planted: nothing here points at one.
    for (const step of [1, 2, 3])
      await expect(
        column(page, step).locator('a[href*="tab=tables"], a[href*="node="]'),
      ).toHaveCount(0)

    await page.getByRole('link', { name: 'Read the full story' }).click()
    await expect(page).toHaveURL(/#\/help\?section=stories&story=SCN-002$/)
    await expect(
      page.getByRole('heading', { name: 'Help', level: 1 }),
    ).toBeVisible()
  })
})

test.describe('old addresses', () => {
  test('the warehouse tab opens Tables with its table', async ({ page }) => {
    await open(page, '#/data-model?tab=warehouse&table=incidents')
    await expect(section(page, 'Tables')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      column(page, 1).getByRole('button', { name: /^incidents / }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByText(/^From Incident management, 44 rows/),
    ).toBeVisible()
  })

  test('the ontology tab opens Concepts with its concept', async ({ page }) => {
    await open(page, '#/data-model?tab=ontology&concept=CONCEPT_NATIONAL_DRAW')
    await expect(section(page, 'Concepts')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      page
        .getByRole('tree', { name: 'Concepts' })
        .getByRole('treeitem', { selected: true }),
    ).toHaveText('National Draw')
  })

  test('the scenarios tab opens Stories', async ({ page }) => {
    await open(page, '#/data-model?tab=scenarios')
    await expect(section(page, 'Stories')).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

const TABS = [
  ['overview', '#/data-model'],
  ['tables', '#/data-model?tab=tables'],
  ['graph', '#/data-model?tab=graph'],
  ['concepts', NATIONAL_DRAW],
  ['stories', '#/data-model?tab=stories'],
] as const

test.describe('layout', () => {
  for (const width of [1440, 1600])
    test(`no tab scrolls sideways at ${width} wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockApi(page)
      for (const [tab, hash] of TABS) {
        await page.goto(`/${hash}`)
        await expect(page.getByRole('main')).toBeVisible()
        await expect(page.locator('[role=status]')).toHaveCount(0)
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        )
        expect(scrollWidth, tab).toBeLessThanOrEqual(width)
      }
    })
})

/** Presses Tab until `name` matches the focused element, at most `limit` times. */
async function tabTo(page: Page, name: RegExp, limit = 120) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const el = document.activeElement
      return el === null
        ? ''
        : (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '')
    })
    if (name.test(focused.replace(/\s+/g, ' ').trim())) return
  }
  throw new Error(`Tab never reached ${name}`)
}

/** The focused element shows a focus ring. */
async function expectVisibleFocus(page: Page) {
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!)
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })
  expect(ring.style).toBe('solid')
  expect(ring.width).toBeGreaterThanOrEqual(2)
}

test.describe('keyboard only', () => {
  test('Overview: Tab to an Explore button and open its tab', async ({
    page,
  }) => {
    await open(page, '#/data-model')
    await section(page, 'Overview').focus()
    await tabTo(page, /^Explore tables$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=tables$/)
  })

  test('Tables: choose a table, a row, and reach the graph button', async ({
    page,
  }) => {
    await open(page, '#/data-model?tab=tables')
    await section(page, 'Tables').focus()
    await tabTo(page, /^markets 4$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=tables&table=markets$/)
    await expect(
      page.getByRole('button', { name: 'Open MKT_GR' }),
    ).toBeVisible()
    await tabTo(page, /^Open MKT_GR$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/table=markets&row=MKT_GR$/)
    // The record loads beside the rows; its button follows them in tab order.
    await expect(
      column(page, 3).getByRole('link', { name: 'Open in the graph' }),
    ).toBeVisible()
    await tabTo(page, /^Open in the graph$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=graph&node=MKT_GR$/)
  })

  test('Graph: choose a kind and reach its table row', async ({ page }) => {
    await open(page, '#/data-model?tab=graph')
    await section(page, 'Graph').focus()
    await tabTo(page, /^platform 8$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=graph&node=PLT_/)
    await expect(
      column(page, 3).getByText(/^From platforms, row PLT_/),
    ).toBeVisible()
    await tabTo(page, /^See its table row$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=tables&table=platforms&row=PLT_/)
  })

  test('Concepts: choose a concept and filter its terms', async ({ page }) => {
    await open(page, '#/data-model?tab=concepts')
    await section(page, 'Concepts').focus()
    await tabTo(page, /^Lottery product$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/concept=CONCEPT_DRAW_GAME$/)
    await expect(
      column(page, 2).getByRole('heading', { name: 'Draw game' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Greece' })).toBeVisible()
    await tabTo(page, /^Greece$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/concept=CONCEPT_DRAW_GAME&market=MKT_GR$/)
  })

  test('Stories: choose a story and reach Help', async ({ page }) => {
    await open(page, '#/data-model?tab=stories')
    await section(page, 'Stories').focus()
    await tabTo(page, /^Shared device cluster/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/story=SCN-002$/)
    // The address moves first; wait for the story it names before tabbing on.
    await expect(
      column(page, 2).getByRole('heading', { name: 'Shared device cluster' }),
    ).toBeVisible()
    await tabTo(page, /^Read the full story$/)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/help\?section=stories&story=SCN-002$/)
  })
})

test.describe('states', () => {
  for (const state of ['pending', 'empty', 'error'] as const)
    test(`every tab shows its ${state} state`, async ({ page }) => {
      for (const [tab, hash] of TABS) {
        await open(page, hash, state)
        await expect(page.getByRole('main')).toBeVisible()
        if (state === 'pending')
          await expect(page.getByRole('status').first(), tab).toBeVisible()
        if (state === 'error')
          await expect(page.getByRole('alert').first(), tab).toContainText(
            'The data is unavailable.',
          )
        if (state === 'empty')
          await expect(page.getByRole('alert'), tab).toHaveCount(0)
        await shot(page, `${tab}-${state}`)
      }
    })
})
