import { expect, test } from '@playwright/test'

test('application shell renders with primary navigation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Semantic Context Lab')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Live Lab' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Results' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible()
})
