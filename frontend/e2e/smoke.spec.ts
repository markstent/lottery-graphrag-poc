import { expect, test } from '@playwright/test'

test('application renders its title', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Semantic Context Lab' }),
  ).toBeVisible()
})
