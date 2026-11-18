import type { Booking } from '@calendar/sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { meetingTypesResponse, upcomingResponse } from './helpers/contract'

afterEach(() => {
  window.history.pushState({}, '', '/')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function renderOwner() {
  window.history.pushState({}, '', '/owner')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } }
  })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  )
}

const intro: Booking['meetingType'] = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Introduction',
  description: 'First conversation',
  durationMinutes: 45
}
const review: Booking['meetingType'] = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Review',
  description: 'Discuss a project',
  durationMinutes: 30
}

const firstBooking: Booking = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  meetingType: intro,
  guestName: 'Анна',
  start: '2026-11-18T06:00:00Z',
  end: '2026-11-18T06:45:00Z'
}
const secondBooking: Booking = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  meetingType: review,
  guestName: 'Борис',
  start: '2026-11-18T09:00:00Z',
  end: '2026-11-18T09:30:00Z'
}

function mockOwner(
  bookings: (attempt: number, search: URLSearchParams) => Response | Promise<Response>,
  meetingTypes: Booking['meetingType'][] = []
) {
  let attempt = 0
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    if (url.pathname === '/meeting-types') {
      return meetingTypes.length > 0
        ? meetingTypesResponse('populated', meetingTypes)
        : meetingTypesResponse('empty')
    }
    if (url.pathname === '/bookings') {
      attempt += 1
      return bookings(attempt, url.searchParams)
    }
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function bookingCalls(fetch: ReturnType<typeof mockOwner>) {
  return fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/bookings')
}

function lastBookingSearch(fetch: ReturnType<typeof mockOwner>) {
  return new URL(bookingCalls(fetch).at(-1)![0].url).searchParams
}

describe('Owner upcoming bookings', () => {
  it('shows every type booking in Europe/Moscow with guest, type, duration and explicit zone', async () => {
    mockOwner(() => upcomingResponse('populated', [firstBooking, secondBooking]))
    renderOwner()

    const list = await screen.findByRole('list', { name: 'Предстоящие записи' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)

    expect(within(items[0]!).getByText('Анна')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Introduction · 45 мин.')).toBeInTheDocument()
    expect(within(items[0]!).getByText(/09:00/)).toBeInTheDocument()
    expect(within(items[0]!).getByText(/09:45/)).toBeInTheDocument()

    expect(within(items[1]!).getByText('Борис')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Review · 30 мин.')).toBeInTheDocument()
    expect(within(items[1]!).getByText(/12:00/)).toBeInTheDocument()

    expect(screen.getByText(/часовом поясе владельца: Europe\/Moscow/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Предстоящих записей нет.')).not.toBeInTheDocument()
  })

  it('distinguishes an empty list from loading and from a read error, and retries', async () => {
    const pending = Promise.withResolvers<Response>()
    let attempts = 0
    mockOwner(() => {
      attempts += 1
      return attempts === 1 ? pending.promise : upcomingResponse('empty')
    })
    renderOwner()

    expect(await screen.findByText('Загружаем предстоящие записи…')).toHaveAttribute(
      'role',
      'status'
    )
    expect(screen.queryByText('Предстоящих записей нет.')).not.toBeInTheDocument()

    pending.resolve(upcomingResponse('unknown-query'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить предстоящие записи.'
    )
    expect(screen.queryByText('Предстоящих записей нет.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))

    expect(await screen.findByText('Предстоящих записей нет.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.queryByRole('list', { name: 'Предстоящие записи' })).not.toBeInTheDocument()
  })

  it('refreshes the list on the manual button', async () => {
    const fetch = mockOwner((attempt) =>
      attempt === 1 ? upcomingResponse('empty') : upcomingResponse('populated', [firstBooking])
    )
    renderOwner()

    expect(await screen.findByText('Предстоящих записей нет.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))

    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.queryByText('Предстоящих записей нет.')).not.toBeInTheDocument()
    expect(bookingCalls(fetch)).toHaveLength(2)
  })

  it('refreshes the list when the window regains visibility without polling', async () => {
    const fetch = mockOwner((attempt) =>
      attempt === 1
        ? upcomingResponse('populated', [firstBooking])
        : upcomingResponse('populated', [firstBooking, secondBooking])
    )
    renderOwner()

    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.queryByText('Борис')).not.toBeInTheDocument()
    const before = bookingCalls(fetch).length

    window.dispatchEvent(new Event('visibilitychange'))

    expect(await screen.findByText('Борис')).toBeInTheDocument()
    expect(bookingCalls(fetch).length).toBeGreaterThan(before)
  })
})

describe('Owner upcoming booking filters', () => {
  it('sends guest name, meeting type and date range together, then resets every control', async () => {
    const fetch = mockOwner(
      () => upcomingResponse('populated', [firstBooking, secondBooking]),
      [intro, review]
    )
    renderOwner()

    expect(await screen.findByText('Анна')).toBeInTheDocument()
    const typeSelect = screen.getByLabelText('Тип встречи')
    expect(
      within(typeSelect)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Все типы', 'Introduction', 'Review'])
    expect(
      fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/meeting-types')
    ).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Имя гостя'), { target: { value: '  анн  ' } })
    await waitFor(() => expect(lastBookingSearch(fetch).get('guestName')).toBe('анн'))

    fireEvent.change(typeSelect, { target: { value: review.id } })
    await waitFor(() => expect(lastBookingSearch(fetch).get('meetingTypeId')).toBe(review.id))

    fireEvent.change(screen.getByLabelText('Дата с'), { target: { value: '2026-11-18' } })
    await waitFor(() => expect(lastBookingSearch(fetch).get('fromDate')).toBe('2026-11-18'))

    fireEvent.change(screen.getByLabelText('Дата по'), { target: { value: '2026-11-19' } })
    await waitFor(() => expect(lastBookingSearch(fetch).get('toDate')).toBe('2026-11-19'))

    expect(Object.fromEntries(lastBookingSearch(fetch))).toEqual({
      guestName: 'анн',
      meetingTypeId: review.id,
      fromDate: '2026-11-18',
      toDate: '2026-11-19'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))

    await waitFor(() => expect(lastBookingSearch(fetch).toString()).toBe(''))
    expect(screen.getByLabelText('Имя гостя')).toHaveValue('')
    expect(typeSelect).toHaveValue('')
    expect(screen.getByLabelText('Дата с')).toHaveValue('')
    expect(screen.getByLabelText('Дата по')).toHaveValue('')
  })

  it('distinguishes no bookings at all from no matches for active filters', async () => {
    mockOwner(() => upcomingResponse('empty'))
    renderOwner()

    expect(await screen.findByText('Предстоящих записей нет.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Имя гостя'), { target: { value: 'Никто' } })

    expect(await screen.findByText('По выбранным фильтрам записей нет.')).toBeInTheDocument()
    expect(screen.queryByText('Предстоящих записей нет.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))

    expect(await screen.findByText('Предстоящих записей нет.')).toBeInTheDocument()
    expect(screen.queryByText('По выбранным фильтрам записей нет.')).not.toBeInTheDocument()
  })

  it('keeps filters on manual refresh and on window focus refresh', async () => {
    const fetch = mockOwner(() => upcomingResponse('populated', [firstBooking]))
    renderOwner()

    await screen.findByText('Анна')
    fireEvent.change(screen.getByLabelText('Имя гостя'), { target: { value: 'Анна' } })
    await waitFor(() => expect(lastBookingSearch(fetch).get('guestName')).toBe('Анна'))

    const beforeRefresh = bookingCalls(fetch).length
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await waitFor(() => expect(bookingCalls(fetch).length).toBeGreaterThan(beforeRefresh))
    expect(lastBookingSearch(fetch).get('guestName')).toBe('Анна')

    const beforeFocus = bookingCalls(fetch).length
    window.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(bookingCalls(fetch).length).toBeGreaterThan(beforeFocus))
    expect(lastBookingSearch(fetch).get('guestName')).toBe('Анна')
    expect(screen.getByLabelText('Имя гостя')).toHaveValue('Анна')
  })
})
