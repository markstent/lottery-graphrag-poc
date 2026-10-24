import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, json } from '../../test/api-stub'
import { DICTIONARY, GAME_ROWS } from './data-model.fixtures'
import { RowsGrid } from './rows-grid'

const GAMES = DICTIONARY[1]
const PATH = '/api/v1/datasets/dev-seed2026/tables/games/rows'

afterEach(() => vi.unstubAllGlobals())

/** Answers the rows route from `answer`, and records each request's query. */
function stubRows(
  answer: (query: URLSearchParams) => Response = (query) =>
    json(GAME_ROWS(Number(query.get('offset')), 50)),
) {
  const queries: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      expect(url.pathname).toBe(PATH)
      queries.push(url.searchParams)
      return Promise.resolve(answer(url.searchParams))
    }),
  )
  return queries
}

const renderGrid = (onOpenRow = vi.fn()) =>
  render(
    <RowsGrid datasetId="dev-seed2026" schema={GAMES} onOpenRow={onOpenRow} />,
  )

describe('RowsGrid', () => {
  it('asks for the first fifty rows and shows the total', async () => {
    const queries = stubRows()
    renderGrid()
    expect(await screen.findByText('Rows 1 to 50 of 120')).toBeVisible()
    expect(queries[0].get('limit')).toBe('50')
    expect(queries[0].get('offset')).toBe('0')
    expect(queries[0].has('column')).toBe(false)
    expect(screen.getAllByRole('row')).toHaveLength(51)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('says how the value is read, in words, for the column chosen', async () => {
    stubRows()
    renderGrid()
    await screen.findByText('Rows 1 to 50 of 120')
    expect(
      screen.getByText('Matches the whole value, read as text.'),
    ).toBeVisible()
    await userEvent.selectOptions(
      screen.getByLabelText('Column'),
      'launched_at',
    )
    expect(
      screen.getByText('Matches the whole value, read as a timestamp.'),
    ).toBeVisible()
  })

  it('pages forward and back, and stops at the last page', async () => {
    const queries = stubRows((q) =>
      json(
        GAME_ROWS(Number(q.get('offset')), q.get('offset') === '100' ? 20 : 50),
      ),
    )
    renderGrid()
    await screen.findByText('Rows 1 to 50 of 120')
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Rows 51 to 100 of 120')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Rows 101 to 120 of 120')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('Rows 51 to 100 of 120')).toBeVisible()
    expect(queries.map((q) => q.get('offset'))).toEqual([
      '0',
      '50',
      '100',
      '50',
    ])
  })

  it('filters by a column and value, from the first page, and keeps the filter while paging', async () => {
    const queries = stubRows((q) =>
      q.has('column')
        ? json(
            GAME_ROWS(
              Number(q.get('offset')),
              Number(q.get('offset')) === 0 ? 50 : 25,
              75,
            ),
          )
        : json(GAME_ROWS(Number(q.get('offset')), 50)),
    )
    renderGrid()
    await screen.findByText('Rows 1 to 50 of 120')
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Rows 51 to 100 of 120')

    await userEvent.selectOptions(
      screen.getByLabelText('Column'),
      'launched_at',
    )
    await userEvent.type(screen.getByLabelText('Value'), '2026-03-04T10:15:00')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(await screen.findByText('Rows 1 to 50 of 75')).toBeVisible()
    const filtered = queries[queries.length - 1]
    expect(filtered.get('column')).toBe('launched_at')
    expect(filtered.get('value')).toBe('2026-03-04T10:15:00')
    expect(filtered.get('offset')).toBe('0')

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Rows 51 to 75 of 75')
    const paged = queries[queries.length - 1]
    expect(paged.get('offset')).toBe('50')
    expect(paged.get('column')).toBe('launched_at')
    expect(paged.get('value')).toBe('2026-03-04T10:15:00')
  })

  it('clears the filter and returns to the whole table', async () => {
    const queries = stubRows()
    renderGrid()
    await screen.findByText('Rows 1 to 50 of 120')
    await userEvent.type(screen.getByLabelText('Value'), 'GAME_001')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await screen.findByText('Rows 1 to 50 of 120')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    await vi.waitFor(() =>
      expect(queries[queries.length - 1].has('column')).toBe(false),
    )
    expect(screen.getByLabelText('Value')).toHaveValue('')
  })

  it('shows the server message plainly when a value does not fit the column, and keeps the filter', async () => {
    stubRows((q) =>
      q.has('column')
        ? json(
            {
              error: {
                error_code: 'VALIDATION_ERROR',
                message: "'last week' is not a TIMESTAMP value for launched_at",
                retryable: false,
              },
            },
            422,
          )
        : json(GAME_ROWS(0, 50)),
    )
    renderGrid()
    await screen.findByText('Rows 1 to 50 of 120')
    await userEvent.selectOptions(
      screen.getByLabelText('Column'),
      'launched_at',
    )
    await userEvent.type(screen.getByLabelText('Value'), 'last week')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "'last week' is not a TIMESTAMP value for launched_at",
    )
    expect(screen.getByLabelText('Value')).toHaveValue('last week')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('says plainly when a filter matches nothing', async () => {
    stubRows((q) =>
      q.has('column')
        ? json({ ...GAME_ROWS(0, 0, 0) })
        : json(GAME_ROWS(0, 50)),
    )
    renderGrid()
    await screen.findByText('Rows 1 to 50 of 120')
    await userEvent.type(screen.getByLabelText('Value'), 'GAME_999')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(
      await screen.findByText('No row has game_id equal to GAME_999.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('says plainly when the table has no rows', async () => {
    stubRows(() => json(GAME_ROWS(0, 0, 0)))
    renderGrid()
    expect(await screen.findByText('This table has no rows.')).toBeVisible()
  })

  it('shows a loading state, then an error with Retry when the server fails', async () => {
    let fail = true
    stubRows(() =>
      fail ? failure('The data is unavailable.', true) : json(GAME_ROWS(0, 50)),
    )
    renderGrid()
    expect(screen.getByRole('status')).toHaveTextContent('Loading Rows')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The data is unavailable.',
    )
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Rows 1 to 50 of 120')).toBeVisible()
  })

  it('opens a row by its key, and shows each value as it is stored', async () => {
    stubRows()
    const onOpenRow = vi.fn()
    renderGrid(onOpenRow)
    const first = (await screen.findAllByRole('row'))[1]
    expect(within(first).getAllByText('2026-03-04T10:15:00')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Open GAME_002' }))
    expect(onOpenRow).toHaveBeenCalledWith('GAME_002')
  })
})
