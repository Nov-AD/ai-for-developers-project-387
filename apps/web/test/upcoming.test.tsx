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

function mockOwner(bookings: (attempt: number) => Response | Promise<Response>) {
  let attempt = 0
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
    if (url.pathname === '/bookings') {
      attempt += 1
      return bookings(attempt)
    }
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function bookingCalls(fetch: ReturnType<typeof mockOwner>) {
  return fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/bookings')
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

  it('labels the guest name control and applies it after a short debounce', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
      if (url.pathname === '/bookings') {
        return url.searchParams.has('guestName')
          ? upcomingResponse('populated', [firstBooking])
          : upcomingResponse('populated', [firstBooking, secondBooking])
      }
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    renderOwner()

    const input = await screen.findByLabelText('Имя гостя')
    expect(input).toHaveAccessibleName('Имя гостя')
    expect(await screen.findByText('Борис')).toBeInTheDocument()
    const before = bookingCalls(fetch).length

    fireEvent.change(input, { target: { value: '  анна  ' } })

    expect(bookingCalls(fetch)).toHaveLength(before)
    await waitFor(() => expect(bookingCalls(fetch).length).toBeGreaterThan(before), {
      timeout: 1500
    })
    const request = bookingCalls(fetch).at(-1)![0] as Request
    expect(new URL(request.url).searchParams.get('guestName')).toBe('анна')
    await waitFor(() => expect(screen.queryByText('Борис')).not.toBeInTheDocument())
    expect(screen.getByText('Анна')).toBeInTheDocument()
  })

  it('clears the guest name and immediately requests the full list on reset', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
      if (url.pathname === '/bookings') {
        return url.searchParams.has('guestName')
          ? upcomingResponse('populated', [firstBooking])
          : upcomingResponse('populated', [firstBooking, secondBooking])
      }
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    renderOwner()

    const input = await screen.findByLabelText('Имя гостя')
    await screen.findByText('Борис')
    fireEvent.change(input, { target: { value: 'Анна' } })
    await waitFor(() => expect(screen.queryByText('Борис')).not.toBeInTheDocument(), {
      timeout: 1500
    })
    const before = bookingCalls(fetch).length

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))

    expect(input).toHaveValue('')
    await waitFor(() => expect(bookingCalls(fetch).length).toBeGreaterThan(before))
    const request = bookingCalls(fetch).at(-1)![0] as Request
    expect(new URL(request.url).searchParams.has('guestName')).toBe(false)
    expect(await screen.findByText('Борис')).toBeInTheDocument()
  })

  it('distinguishes an empty filtered result from no upcoming bookings', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
      if (url.pathname === '/bookings') {
        return url.searchParams.has('guestName')
          ? upcomingResponse('filtered-empty')
          : upcomingResponse('empty')
      }
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    renderOwner()

    expect(await screen.findByText('Предстоящих записей нет.')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Имя гостя'), {
      target: { value: 'Никого' }
    })

    expect(await screen.findByText('По выбранным фильтрам записей нет.')).toBeInTheDocument()
    expect(screen.queryByText('Предстоящих записей нет.')).not.toBeInTheDocument()
  })

  it('shows the existing read error for a filtered request', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
      if (url.pathname === '/bookings') {
        return url.searchParams.has('guestName')
          ? upcomingResponse('unknown-query')
          : upcomingResponse('empty')
      }
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    renderOwner()

    await screen.findByText('Предстоящих записей нет.')
    fireEvent.change(await screen.findByLabelText('Имя гостя'), { target: { value: 'Анна' } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить предстоящие записи.'
    )
  })

  it('shows the existing loading state while a filtered request is pending', async () => {
    const filtered = Promise.withResolvers<Response>()
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
      if (url.pathname === '/bookings') {
        return url.searchParams.has('guestName')
          ? filtered.promise
          : upcomingResponse('populated', [firstBooking, secondBooking])
      }
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    renderOwner()

    await screen.findByText('Борис')
    fireEvent.change(await screen.findByLabelText('Имя гостя'), { target: { value: 'Анна' } })

    expect(await screen.findByText('Загружаем предстоящие записи…')).toHaveAttribute(
      'role',
      'status'
    )
    filtered.resolve(upcomingResponse('populated', [firstBooking]))
    expect(await screen.findByText('Анна')).toBeInTheDocument()
  })

  it('keeps the guest name filter when the list is refreshed manually', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('empty')
      if (url.pathname === '/bookings') {
        return url.searchParams.has('guestName')
          ? upcomingResponse('populated', [firstBooking])
          : upcomingResponse('populated', [firstBooking, secondBooking])
      }
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    renderOwner()

    const input = await screen.findByLabelText('Имя гостя')
    const initialCalls = bookingCalls(fetch).length
    fireEvent.change(input, { target: { value: 'Анна' } })
    await waitFor(() => expect(bookingCalls(fetch).length).toBeGreaterThan(initialCalls), {
      timeout: 1500
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Обновить список' })).toBeEnabled()
    )
    const before = bookingCalls(fetch).length

    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))

    await waitFor(() => expect(bookingCalls(fetch).length).toBeGreaterThan(before))
    const request = bookingCalls(fetch).at(-1)![0] as Request
    expect(new URL(request.url).searchParams.get('guestName')).toBe('Анна')
    expect(input).toHaveValue('Анна')
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
