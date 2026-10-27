import { expect, test, type Page } from '@playwright/test'

/*
 * The graph canvas at presentation size (1920 by 1080) with the generated
 * 200-node fixture (scripts/make-graph-200.mjs). The page is the development
 * harness at #/__graph, served by a build in mode "e2e".
 *
 * Times are taken inside the page, from the input event to the change it
 * causes, so they leave out Playwright's own round trips.
 */

test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' })

const CAP = 24
const FIRST_LAYOUT_BUDGET_MS = 1000
const RESPONSE_BUDGET_MS = 100

const harness = (query: string) => `/#/__graph?source=200&mount=click&${query}`

const nodes = (page: Page) => page.locator('[data-node-id]')

/** Presses "Show graph" and returns the ms until `count` nodes are on the page. */
async function timeFirstLayout(page: Page, count: number): Promise<number> {
  await page.getByRole('button', { name: 'Show graph' }).waitFor()
  return page.evaluate(async (expected) => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Show graph',
    ) as HTMLButtonElement
    const start = performance.now()
    button.click()
    return new Promise<number>((resolve) => {
      const check = () => {
        if (document.querySelectorAll('[data-node-id]').length >= expected)
          resolve(performance.now() - start)
        else requestAnimationFrame(check)
      }
      check()
    })
  }, count)
}

/**
 * The ms from the next input event to the next change of `selector`'s
 * attributes (and, with `subtree`, those of its descendants).
 */
async function timeResponse(
  page: Page,
  selector: string,
  subtree: boolean,
  act: () => Promise<void>,
): Promise<number> {
  await page.evaluate(
    ([sel, deep]) => {
      const w = window as unknown as { __start?: number; __end?: number }
      w.__start = undefined
      w.__end = undefined
      const stamp = () => (w.__start ??= performance.now())
      for (const type of ['keydown', 'pointerdown', 'pointermove', 'click'])
        window.addEventListener(type, stamp, { capture: true, once: true })
      new MutationObserver(() => {
        if (w.__start !== undefined) w.__end ??= performance.now()
      }).observe(document.querySelector(sel as string) as Element, {
        attributes: true,
        subtree: deep as boolean,
      })
    },
    [selector, subtree],
  )
  await act()
  await page.waitForFunction(
    () => (window as unknown as { __end?: number }).__end !== undefined,
  )
  return page.evaluate(() => {
    const w = window as unknown as { __start: number; __end: number }
    return w.__end - w.__start
  })
}

/** The "x nodes ... folded into y groups" counts from the canvas description. */
async function visibleNodeCount(page: Page): Promise<number> {
  // The canvas is described by its summary and then the path list.
  const ids = await page
    .getByRole('group', { name: /^Graph for configuration/ })
    .getAttribute('aria-describedby')
  const summary = (ids ?? '').split(' ')[0]
  const text = (await page.locator(`[id="${summary}"]`).textContent()) ?? ''
  const total = Number(/shows (\d+) nodes/.exec(text)?.[1])
  const folded = /(\d+) nodes are folded into (\d+) groups/.exec(text)
  return folded ? total - Number(folded[1]) + Number(folded[2]) : total
}

/** The size each node's label shows at on screen, and its box height. */
const labelSizes = (page: Page) =>
  page.evaluate(() => {
    const zoom = new DOMMatrixReadOnly(
      getComputedStyle(document.querySelector('.react-flow__viewport')!)
        .transform,
    ).a
    return [...document.querySelectorAll('[data-node-id]')].map((button) => {
      const label = button.querySelector<HTMLElement>(
        'span[style*="font-size"]',
      )!
      return {
        id: button.getAttribute('data-node-id'),
        onScreen: parseFloat(getComputedStyle(label).fontSize) * zoom,
        height: label.getBoundingClientRect().height,
      }
    })
  })

const smallestLabel = async (page: Page) =>
  Math.min(...(await labelSizes(page)).map((n) => n.onScreen))

/**
 * Waits until the canvas has placed its layout and applied its fit
 * (`data-layout-ready`), after the frames in which a change of input reaches
 * the page.
 */
async function layoutReady(page: Page) {
  const frames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
  await frames()
  const flag = page.locator('[data-layout-ready]')
  // Below the first recorded node there is no canvas to wait for.
  if ((await flag.count()) === 0) return
  await expect(flag).toHaveAttribute('data-layout-ready', 'true')
  // The frames in which the placed nodes and routes reach the page.
  await frames()
}

/** Events applied: all of them, and a cursor part way through the run. */
const CURSORS = [
  { name: 'the full fixture', B: '', C: '' },
  { name: 'a mid-replay cursor', B: '&count=157', C: '&count=405' },
] as const

test.describe('graph canvas legibility', () => {
  for (const config of ['B', 'C'] as const) {
    for (const cursor of CURSORS) {
      test(`on ${cursor.name} for ${config} every label shows at 14 px or more under fit view`, async ({
        page,
      }) => {
        await page.goto(`/#/__graph?config=${config}${cursor[config]}`)
        await page.reload()
        await expect(nodes(page).first()).toBeVisible()
        await layoutReady(page)
        const sizes = await labelSizes(page)
        expect(sizes.length).toBeGreaterThan(5)
        for (const { id, onScreen, height } of sizes) {
          expect(onScreen, `${id} type size on screen`).toBeGreaterThanOrEqual(
            14,
          )
          expect(height, `${id} label box height`).toBeGreaterThanOrEqual(14)
        }
      })
    }
  }
})

test.describe('graph canvas toolbar', () => {
  test('sits outside the drawing, and its fit button keeps labels at 14 px or more', async ({
    page,
  }) => {
    await page.goto('/#/__graph?config=C')
    await page.reload()
    await expect(nodes(page).first()).toBeVisible()
    await layoutReady(page)
    // The library's own controls are not used.
    await expect(page.locator('.react-flow__controls')).toHaveCount(0)
    const toolbar = page.getByRole('toolbar', { name: 'Zoom' })
    const [bar, drawing] = await Promise.all([
      toolbar.boundingBox(),
      page.locator('.react-flow').boundingBox(),
    ])
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(drawing!.y + 1)
    // Zoom out as far as the button allows, then fit.
    for (let i = 0; i < 4; i += 1)
      await page.getByRole('button', { name: 'Zoom out' }).click()
    await expect.poll(() => smallestLabel(page)).toBeLessThan(14)
    await page.getByRole('button', { name: 'Fit to the evidence' }).click()
    await expect.poll(() => smallestLabel(page)).toBeGreaterThanOrEqual(14)
  })
})

test.describe('graph canvas after scrubbing', () => {
  /** Every tag clear of every node and of every other tag, and every route elk's own. */
  async function expectTidy(
    page: Page,
    at: string,
    edges: boolean,
    allowPlain = false,
  ) {
    // The library draws an edge once both its nodes are measured, a few frames after the layout.
    if (edges)
      await expect
        .poll(() => page.locator('[data-edge-id]').count(), {
          message: `tags at ${at}`,
        })
        .toBeGreaterThan(0)
    const report = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect()
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom
      const tags = [...document.querySelectorAll('[data-edge-id]')]
      const boxes = [...document.querySelectorAll('[data-node-id]')].map(box)
      return {
        tags: tags.length,
        plain: tags.filter((t) => t.getAttribute('data-route') !== 'elk')
          .length,
        onNode: tags.filter((t) => boxes.some((b) => hit(box(t), b))).length,
        stacked: tags.filter((t, i) =>
          tags.slice(i + 1).some((o) => hit(box(t), box(o))),
        ).length,
      }
    })
    if (edges) expect(report.tags, `tags at ${at}`).toBeGreaterThan(0)
    if (!allowPlain)
      expect(report.plain, `edges on a fallback route at ${at}`).toBe(0)
    expect(report.onNode, `tags on a node at ${at}`).toBe(0)
    expect(report.stacked, `tags over tags at ${at}`).toBe(0)
  }

  test('in replay no edge uses a fallback route and no tag sits on a node', async ({
    page,
  }) => {
    await page.goto('/#/__graph?config=C')
    await page.reload()
    await expect(nodes(page).first()).toBeVisible()
    const slider = page.getByRole('slider')
    // Scrub up, down and up again, as a person drags the cursor.
    for (const count of [120, 260, 366, 461, 550, 605, 366, 160, 605]) {
      await slider.fill(String(count))
      await layoutReady(page)
      await expectTidy(page, `${count} events`, count >= 366)
    }
  })

  test('in live a tag never sits on a node or another tag, though some routes are plain', async ({
    page,
  }) => {
    await page.goto('/#/__graph?config=C&mode=live')
    await page.reload()
    await expect(nodes(page).first()).toBeVisible()
    const slider = page.getByRole('slider')
    for (const count of [366, 411, 461, 500, 550, 604]) {
      await slider.fill(String(count))
      await layoutReady(page)
      await expectTidy(page, `${count} events (live)`, true, true)
    }
    // At the end of the stream the final graph is laid out whole.
    await slider.fill('605')
    await layoutReady(page)
    await expectTidy(page, 'the end of the stream (live)', true)
  })

  test('in live the edges stay drawn when events arrive back to back', async ({
    page,
  }) => {
    // The library measures a node's handles once; fast changes used to leave
    // it with none measured and every edge undrawn.
    for (let round = 0; round < 8; round += 1) {
      await page.goto('/#/__graph?config=C&mode=live')
      await page.reload()
      await expect(nodes(page).first()).toBeVisible()
      const slider = page.getByRole('slider')
      for (const count of [366, 411, 461, 500, 550, 604]) {
        await slider.fill(String(count))
        await layoutReady(page)
      }
      await expect(
        page.locator('.react-flow__edge'),
        `edges after round ${round}`,
      ).not.toHaveCount(0)
    }
  })

  test('shows no evidence path before its event and the path after it', async ({
    page,
  }) => {
    await page.goto('/#/__graph?config=C')
    await page.reload()
    await expect(nodes(page).first()).toBeVisible()
    const slider = page.getByRole('slider')
    await slider.fill('366')
    await layoutReady(page)
    expect(await page.locator('[data-on-path="true"]').count()).toBe(0)
    await slider.fill('605')
    await layoutReady(page)
    expect(await page.locator('[data-on-path="true"]').count()).toBeGreaterThan(
      0,
    )
  })
})

test.describe('graph canvas with 200 nodes', () => {
  test('clusters to the cap and lays out the first time in under a second', async ({
    page,
  }) => {
    await page.goto(harness(`cap=${CAP}`))
    await page.reload()
    // The count comes from the summary, so draw once, then time a second draw.
    await page.getByRole('button', { name: 'Show graph' }).click()
    const expected = await visibleNodeCount(page)
    expect(expected).toBeLessThanOrEqual(CAP)
    await page.reload()
    const elapsed = await timeFirstLayout(page, expected)
    console.log(
      `first layout, ${expected} of 200 nodes: ${elapsed.toFixed(0)} ms`,
    )
    expect(elapsed).toBeLessThan(FIRST_LAYOUT_BUDGET_MS)
    await expect(nodes(page)).toHaveCount(expected)
    await expect(page.locator('[data-state="cluster"]').first()).toBeVisible()
  })

  test('lays all 200 nodes out in under a second', async ({ page }) => {
    await page.goto(harness('cap=1000'))
    await page.reload()
    const elapsed = await timeFirstLayout(page, 200)
    console.log(`first layout, 200 of 200 nodes: ${elapsed.toFixed(0)} ms`)
    expect(elapsed).toBeLessThan(FIRST_LAYOUT_BUDGET_MS)
    await expect(nodes(page)).toHaveCount(200)
  })

  test('zooms, pans and dims within 100 ms of the input', async ({ page }) => {
    await page.goto(harness(`cap=${CAP}`))
    await page.reload()
    await page.getByRole('button', { name: 'Show graph' }).click()
    await expect(nodes(page).first()).toBeVisible()
    await layoutReady(page)
    const viewport = '.react-flow__viewport'

    await page.keyboard.press('Tab')
    // Tab from the page start reaches the harness buttons first; go on to a node.
    while (
      !(await page.evaluate(() =>
        document.activeElement?.hasAttribute('data-node-id'),
      ))
    )
      await page.keyboard.press('Tab')

    const zoom = await timeResponse(page, viewport, false, () =>
      page.keyboard.press('+'),
    )
    console.log(`zoom in: ${zoom.toFixed(1)} ms`)
    expect(zoom).toBeLessThan(RESPONSE_BUDGET_MS)

    const box = (await page.locator('.react-flow__pane').boundingBox())!
    const pan = await timeResponse(page, viewport, false, async () => {
      // Bottom right of the canvas, clear of the zoom buttons.
      await page.mouse.move(box.x + box.width - 60, box.y + box.height - 60)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 160, box.y + box.height - 20, {
        steps: 4,
      })
      await page.mouse.up()
    })
    console.log(`pan: ${pan.toFixed(1)} ms`)
    expect(pan).toBeLessThan(RESPONSE_BUDGET_MS)

    const focus = await timeResponse(page, '.react-flow__nodes', true, () =>
      page.getByRole('button', { name: 'Focus mode' }).click(),
    )
    console.log(`focus mode: ${focus.toFixed(1)} ms`)
    expect(focus).toBeLessThan(RESPONSE_BUDGET_MS)
    const dimmed = await page.locator('[data-dimmed="true"]').count()
    const onPath = await page.locator('[data-on-path="true"]').count()
    expect(dimmed).toBeGreaterThan(0)
    expect(dimmed + onPath).toBeGreaterThanOrEqual(
      (await nodes(page).count()) - 3,
    )
  })

  test('keeps every placed node where it is as events arrive', async ({
    page,
  }) => {
    await page.goto(harness('cap=1000&count=300'))
    await page.reload()
    await page.getByRole('button', { name: 'Show graph' }).click()
    await expect(nodes(page).first()).toBeVisible()
    const positions = () =>
      page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(
            (el) => [el.dataset.id, el.style.transform],
          ),
        ),
      )
    await layoutReady(page)
    const before = await positions()
    expect(Object.keys(before).length).toBeGreaterThan(5)
    const last = await page.getByRole('slider').getAttribute('max')
    await page.getByRole('slider').fill(last ?? '')
    await expect(nodes(page)).toHaveCount(200, { timeout: 5000 })
    const after = await positions()
    for (const [id, transform] of Object.entries(before))
      expect(after[id], id).toBe(transform)
  })

  test('is operable from the keyboard with a visible focus ring', async ({
    page,
  }) => {
    await page.goto(harness(`cap=${CAP}`))
    await page.reload()
    await page.getByRole('button', { name: 'Show graph' }).click()
    await expect(nodes(page).first()).toBeVisible()
    await layoutReady(page)

    // Tab enters the canvas at one node.
    while (
      !(await page.evaluate(() =>
        document.activeElement?.hasAttribute('data-node-id'),
      ))
    )
      await page.keyboard.press('Tab')
    const first = page.locator('[data-node-id]:focus')
    await expect(first).toHaveCount(1)
    const ring = await first.evaluate((el) => {
      const style = getComputedStyle(el)
      return [style.outlineStyle, style.outlineWidth, style.outlineColor]
    })
    expect(ring).toEqual(['solid', '3px', 'rgb(18, 21, 27)'])

    // The arrow keys follow an edge to a different node.
    const start = await first.getAttribute('data-node-id')
    let moved = false
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key)
      const now = await page
        .locator('[data-node-id]:focus')
        .getAttribute('data-node-id')
      if (now !== start) {
        moved = true
        break
      }
    }
    expect(moved).toBe(true)

    // Enter opens the node.
    const focused = await page
      .locator('[data-node-id]:focus')
      .getAttribute('data-node-id')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toHaveText(`Opened ${focused}`)

    // - zooms out, 0 fits again, Escape leaves the canvas.
    const scale = () =>
      page.evaluate(
        () =>
          new DOMMatrixReadOnly(
            getComputedStyle(document.querySelector('.react-flow__viewport')!)
              .transform,
          ).a,
      )
    const fitted = await scale()
    await page.keyboard.press('-')
    await expect.poll(scale).toBeLessThan(fitted)
    await page.keyboard.press('0')
    await expect.poll(scale).toBeCloseTo(fitted, 4)
    await page.keyboard.press('Escape')
    expect(
      await page.evaluate(() =>
        document.activeElement?.hasAttribute('data-node-id'),
      ),
    ).toBe(false)
  })
})

test.describe('evidence out of view', () => {
  test('in presentation mode the toolbar says so, and the button brings a cropped node into view', async ({
    page,
  }) => {
    // A shorter screen than the evidence needs at presentation size.
    await page.setViewportSize({ width: 1920, height: 720 })
    await page.goto('/#/__graph?config=C&present=1')
    await page.reload()
    await expect(nodes(page).first()).toBeVisible()
    await layoutReady(page)
    const note = page.getByText(/evidence nodes? out of view/)
    await expect(note).toBeVisible()
    await expect(note).toHaveText(/^\d+ evidence nodes? out of view$/)
    await page.getByRole('button', { name: 'Bring into view' }).click()
    // Focus moves to an evidence node, and that node is wholly in the frame.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement
          if (!el.hasAttribute('data-node-id')) return false
          const box = el.getBoundingClientRect()
          const frame = document
            .querySelector('.react-flow')!
            .getBoundingClientRect()
          return (
            box.left >= frame.left &&
            box.top >= frame.top &&
            box.right <= frame.right &&
            box.bottom <= frame.bottom
          )
        }),
      )
      .toBe(true)
    // The evidence is taller than the frame, so framing one can push another out.
    await expect(page.getByText(/evidence nodes? out of view/)).toBeVisible()
    for (const { id, onScreen } of await labelSizes(page))
      expect(onScreen, `${id} type size on screen`).toBeGreaterThanOrEqual(14)
  })
})

test.describe('the out-of-view count', () => {
  const PATH = ['INC_037', 'SUP_00113', 'SUP_00121', 'SUP_00005']

  for (const config of ['B', 'C'] as const) {
    test(`on ${config} equals the evidence nodes the frame does not wholly show`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1920, height: 720 })
      await page.goto(`/#/__graph?config=${config}`)
      await page.reload()
      await expect(nodes(page).first()).toBeVisible()
      await layoutReady(page)
      const cropped = await page.evaluate((ids) => {
        const frame = document
          .querySelector('.react-flow')!
          .getBoundingClientRect()
        return ids.filter((id) => {
          const box = document
            .querySelector(`[data-node-id="${id}"]`)!
            .getBoundingClientRect()
          return !(
            box.left >= frame.left &&
            box.top >= frame.top &&
            box.right <= frame.right &&
            box.bottom <= frame.bottom
          )
        }).length
      }, PATH)
      const note = page.getByText(/evidence nodes? out of view/)
      if (cropped === 0) await expect(note).toHaveCount(0)
      else await expect(note).toHaveText(new RegExp(`^${cropped} evidence`))
    })
  }
})
