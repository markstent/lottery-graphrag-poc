import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DESTINATIONS } from '../app/router'
import { Screen } from './screen'

describe('Screen', () => {
  it.each(DESTINATIONS)(
    'puts the purpose sentence of $label first, then its heading',
    ({ name, label, purpose }) => {
      render(
        <Screen destination={name}>
          <p>content</p>
        </Screen>,
      )
      const main = screen.getByTestId('screen')
      expect(main.firstElementChild).toHaveTextContent(purpose)
      expect(
        screen.getByRole('heading', { level: 1, name: label }),
      ).toBeVisible()
      expect(main.lastElementChild).toHaveTextContent('content')
    },
  )
})
