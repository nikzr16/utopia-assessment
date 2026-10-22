// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/features/orders/api'
import { OrderListPage, PAGE_SIZE, toListQuery } from '../../src/features/orders/OrderListPage'
import { BRANCH, reference } from './fixtures'

vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, listOrders: vi.fn(), fetchReferenceData: vi.fn() }
})

const listOrders = vi.mocked(api.listOrders)

const row = (n: number): api.OrderListRow => ({
  id: `o-${n}`,
  order_no: `ORDER${1000 + n}`,
  status: 'assigned',
  branch_id: BRANCH.shahAlam,
  branch_name: 'Shah Alam',
  customer_name: `Customer ${n}`,
  customer_phone: '60123456789',
  service_type_name: 'Repair',
  quoted_price: 100,
  assigned_technician_id: 't-ali',
  technician_name: 'Ali',
  scheduled_at: null,
  created_at: '2026-10-22T01:00:00+00:00',
  total_count: 30,
})

function renderList(url = '/orders') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/orders" element={<OrderListPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listOrders.mockReset().mockResolvedValue({ rows: [row(1), row(2)], total: 30 })
  vi.mocked(api.fetchReferenceData).mockReset().mockResolvedValue(reference)
})

describe('toListQuery', () => {
  it('reads search, filters and page from the URL (Malaysia days for dates)', () => {
    expect(
      toListQuery(new URLSearchParams('q=lim&status=open&branch=b1&tech=t1&from=2026-10-27&to=2026-10-27&page=3')),
    ).toEqual({
      search: 'lim',
      statuses: ['new', 'assigned', 'acknowledged', 'in_progress', 'job_done', 'reviewed'],
      branchId: 'b1',
      technicianId: 't1',
      scheduledFrom: '2026-10-26T16:00:00.000Z',
      scheduledTo: '2026-10-27T16:00:00.000Z',
      limit: PAGE_SIZE,
      offset: 50,
    })
    expect(toListQuery(new URLSearchParams('status=cancelled&page=-2'))).toMatchObject({
      statuses: ['cancelled'],
      offset: 0,
    })
    expect(toListQuery(new URLSearchParams('status=bogus')).statuses).toEqual([])
  })
})

describe('Order list (AC8)', () => {
  it('shows each order with a link to it and the page position', async () => {
    renderList()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'ORDER1001' }).getAttribute('href')).toBe('/orders/ORDER1001')
    expect(within(table).getByText('Customer 2')).toBeTruthy()
    expect(within(table).getAllByText('+60 12-345 6789')).toHaveLength(2)
    expect(screen.getByText('Showing 1–25 of 30')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('searches, filters, and pages through list_orders', async () => {
    const user = userEvent.setup()
    renderList()
    await screen.findByRole('table')
    await user.type(screen.getByLabelText('Search orders'), '012-345')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ search: '012-345', offset: 0 })))

    await user.selectOptions(screen.getByLabelText('Status'), 'open')
    await waitFor(() =>
      expect(listOrders.mock.lastCall?.[0]).toMatchObject({ search: '012-345', statuses: expect.arrayContaining(['new']) }),
    )
    await user.selectOptions(await screen.findByLabelText('Branch'), BRANCH.kl)
    await waitFor(() => expect(listOrders.mock.lastCall?.[0].branchId).toBe(BRANCH.kl))

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(listOrders.mock.lastCall?.[0].offset).toBe(PAGE_SIZE))
  })

  it('explains an empty result', async () => {
    listOrders.mockResolvedValue({ rows: [], total: 0 })
    renderList('/orders?q=nobody')
    expect(await screen.findByText('No orders match your search and filters.')).toBeTruthy()
  })

  it('shows a load error with a retry', async () => {
    listOrders.mockRejectedValueOnce(new api.ApiError('Could not reach the server. Check your connection and try again.'))
    const user = userEvent.setup()
    renderList()
    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeTruthy()
  })
})
