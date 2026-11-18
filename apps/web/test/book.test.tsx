import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Book } from '@/routes/Book'
import type { MeetingType } from '@calendar/sdk'
import {
  assertCreateBookingRequest,
  availabilityResponse,
  bookingErrorResponse,
  bookingResponse,
  meetingTypesResponse
} from './helpers/contract'

beforeEach(() => {
  // Guest zone comes from the browser; pin it so displayed times are deterministic.
  vi.stubEnv('TZ', 'Europe/Moscow')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function renderBook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } }
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Book />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Book', () => {
  it('shows each complete meeting type in API order and lets the guest change selection', async () => {
    const types: MeetingType[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Introduction',
        description: 'First conversation',
        durationMinutes: 45
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Review',
        description: 'Discuss a project',
        durationMinutes: 17
      }
    ]
    const fetch = vi.fn().mockResolvedValue(meetingTypesResponse('populated', types))
    vi.stubGlobal('fetch', fetch)
    renderBook()

    const first = await screen.findByRole('radio', { name: 'Introduction' })
    const second = screen.getByRole('radio', { name: 'Review' })
    expect(screen.getAllByRole('radio')).toEqual([first, second])
    expect(screen.getByText('First conversation')).toBeInTheDocument()
    expect(screen.getByText('45 мин.')).toBeInTheDocument()
    expect(screen.getByText('Discuss a project')).toBeInTheDocument()
    expect(screen.getByText('17 мин.')).toBeInTheDocument()
    expect(first).not.toBeChecked()
    fireEvent.click(first)
    expect(first).toBeChecked()
    fireEvent.click(second)
    expect(second).toBeChecked()
    expect(first).not.toBeChecked()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /записаться/i })).not.toBeInTheDocument()
  })

  it('loads the empty meeting type list with a way back home', async () => {
    const fetch = vi.fn().mockResolvedValue(meetingTypesResponse('empty'))
    vi.stubGlobal('fetch', fetch)

    renderBook()

    expect(screen.getByRole('heading', { level: 1, name: 'Запись на звонок' })).toBeInTheDocument()
    expect(await screen.findByText('Типов встреч пока нет. Загляните позже.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/')
    expect(fetch).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls[0]![0] as Request
    expect(request.method).toBe('GET')
    expect(new URL(request.url).pathname).toBe('/meeting-types')
    expect(new URL(request.url).search).toBe('')
  })

  it('distinguishes loading from an empty list until the response arrives', async () => {
    const response = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response.promise))

    renderBook()

    expect(screen.getByRole('status')).toHaveTextContent('Загружаем типы встреч…')
    expect(screen.queryByText('Типов встреч пока нет. Загляните позже.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    response.resolve(meetingTypesResponse('empty'))
    expect(await screen.findByText('Типов встреч пока нет. Загляните позже.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a contract HTTP error separately from empty data and lets the guest retry', async () => {
    const retry = Promise.withResolvers<Response>()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(meetingTypesResponse('unknown-query'))
      .mockReturnValueOnce(retry.promise)
    vi.stubGlobal('fetch', fetch)

    renderBook()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить типы встреч.')
    expect(screen.queryByText('Типов встреч пока нет. Загляните позже.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Загружаем типы встреч…')

    retry.resolve(meetingTypesResponse('empty'))
    expect(await screen.findByText('Типов встреч пока нет. Загляните позже.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('offers retry after a network failure without showing an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    renderBook()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить типы встреч.')
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeEnabled()
    expect(screen.queryByText('Типов встреч пока нет. Загляните позже.')).not.toBeInTheDocument()
  })
})

describe('Book availability', () => {
  const intro: MeetingType = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Introduction',
    description: 'First conversation',
    durationMinutes: 45
  }
  const review: MeetingType = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Review',
    description: 'Discuss a project',
    durationMinutes: 30
  }
  const window = {
    ownerTimeZone: 'Europe/Moscow',
    windowStartDate: '2026-11-18',
    windowEndDate: '2026-11-21'
  }
  const twoDays = {
    ...window,
    slots: [
      { start: '2026-11-18T06:00:00Z', end: '2026-11-18T06:45:00Z' },
      { start: '2026-11-18T06:30:00Z', end: '2026-11-18T07:15:00Z' },
      { start: '2026-11-19T06:00:00Z', end: '2026-11-19T06:45:00Z' }
    ]
  }

  function mockApi(availability: (url: URL) => Response) {
    const fetch = vi.fn(async (input: Request) => {
      const url = new URL(input.url)
      if (url.pathname === '/meeting-types')
        return meetingTypesResponse('populated', [intro, review])
      if (url.pathname === '/availability') return availability(url)
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('loads availability for the selected type, shows days without slots and keeps the chosen slot', async () => {
    const fetch = mockApi(() => availabilityResponse('available', twoDays))
    renderBook()

    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))

    const day18 = await screen.findByRole('button', { name: /18 ноября/ })
    expect(day18).toHaveTextContent('2 слотов')
    // 2026-11-20 is a Friday with no slots in the response.
    const emptyDay = screen.getByRole('button', { name: /20 ноября/ })
    expect(emptyDay).toBeDisabled()
    expect(emptyDay).toHaveTextContent('нет слотов')

    fireEvent.click(day18)
    const slot = screen.getByRole('radio', { name: /09:00/ })
    fireEvent.click(slot)
    expect(slot).toBeChecked()

    const availabilityCalls = fetch.mock.calls.filter(
      ([request]) => new URL(request.url).pathname === '/availability'
    )
    expect(availabilityCalls).toHaveLength(1)
    expect(new URL(availabilityCalls[0]![0].url).searchParams.get('meetingTypeId')).toBe(intro.id)
  })

  it('resets the day and slot and reloads availability when the guest changes the type', async () => {
    const fetch = mockApi((url) =>
      availabilityResponse(
        'available',
        url.searchParams.get('meetingTypeId') === intro.id
          ? twoDays
          : { ...window, slots: [{ start: '2026-11-19T06:00:00Z', end: '2026-11-19T06:30:00Z' }] }
      )
    )
    renderBook()

    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))
    fireEvent.click(await screen.findByRole('button', { name: /18 ноября/ }))
    fireEvent.click(screen.getByRole('radio', { name: /09:00/ }))
    expect(screen.getByRole('radio', { name: /09:00/ })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Review' }))

    expect(await screen.findByRole('button', { name: /19 ноября/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /09:00/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Выберите день, чтобы увидеть свободное время/)).toBeInTheDocument()
    const calls = fetch.mock.calls
      .filter(([request]) => new URL(request.url).pathname === '/availability')
      .map(([request]) => new URL(request.url).searchParams.get('meetingTypeId'))
    expect(calls).toEqual([intro.id, review.id])
  })

  it('keeps all 14 dates accessible across months and clears the slot when changing days', async () => {
    mockApi(() =>
      availabilityResponse('available', {
        ...window,
        windowStartDate: '2026-11-25',
        windowEndDate: '2026-12-09',
        slots: [
          { start: '2026-11-25T06:00:00Z', end: '2026-11-25T06:45:00Z' },
          { start: '2026-12-08T07:00:00Z', end: '2026-12-08T07:45:00Z' }
        ]
      })
    )
    renderBook()
    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))

    const dates = await screen.findByRole('list', { name: 'Даты встречи' })
    expect(within(dates).getAllByRole('button')).toHaveLength(14)
    expect(within(dates).getByRole('button', { name: /26 ноября, нет слотов/ })).toBeDisabled()
    const first = within(dates).getByRole('button', { name: /25 ноября, 1 слотов/ })
    fireEvent.click(first)
    fireEvent.click(screen.getByRole('radio', { name: /09:00/ }))
    expect(first).toHaveAttribute('aria-pressed', 'true')

    const last = within(dates).getByRole('button', { name: /8 декабря, 1 слотов/ })
    fireEvent.click(last)
    expect(last).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('radio', { name: /09:00/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /10:00/ })).not.toBeChecked()
  })

  it('shows a clear no-slots state instead of day buttons when nothing is available', async () => {
    mockApi(() => availabilityResponse('empty'))
    renderBook()

    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))

    expect(await screen.findByText(/На ближайшие дни свободных слотов нет/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ноября/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an availability error separately and refetches on retry', async () => {
    let attempt = 0
    mockApi(() => {
      attempt += 1
      return attempt === 1
        ? availabilityResponse('unknown-type')
        : availabilityResponse('available', twoDays)
    })
    renderBook()

    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить свободное время.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(await screen.findByText(/Время показано в вашем часовом поясе/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows slot times in the guest time zone with an explicit zone label', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    mockApi(() => availabilityResponse('available', twoDays))
    renderBook()

    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))
    fireEvent.click(await screen.findByRole('button', { name: /18 ноября/ }))

    const slot = await screen.findByRole('radio', { name: /01:00/ })
    const label = slot.closest('label')
    expect(label).toHaveTextContent('18 нояб. 2026 г., 01:00')
    expect(label?.textContent).toMatch(/GMT-5|EST|UTC−5/)
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument()
  })
})

describe('Book booking creation', () => {
  const intro: MeetingType = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Introduction',
    description: 'First conversation',
    durationMinutes: 45
  }
  const availabilityBody = {
    ownerTimeZone: 'Europe/Moscow',
    windowStartDate: '2026-11-18',
    windowEndDate: '2026-11-21',
    slots: [{ start: '2026-11-18T06:00:00Z', end: '2026-11-18T06:45:00Z' }]
  }
  const bookingBody = {
    id: '22222222-2222-4222-8222-222222222222',
    meetingType: intro,
    guestName: 'Анна',
    start: '2026-11-18T06:00:00Z',
    end: '2026-11-18T06:45:00Z'
  }

  function mockApi(
    booking: () => Response | Promise<Response>,
    availability: () => Response = () => availabilityResponse('available', availabilityBody)
  ) {
    const fetch = vi.fn(async (input: Request) => {
      const url = new URL(input.url)
      if (url.pathname === '/meeting-types') return meetingTypesResponse('populated', [intro])
      if (url.pathname === '/availability') return availability()
      if (url.pathname === '/bookings' && input.method === 'POST') return booking()
      throw new Error(`Unexpected request ${input.method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  async function pickSlot() {
    fireEvent.click(await screen.findByRole('radio', { name: 'Introduction' }))
    fireEvent.click(await screen.findByRole('button', { name: /18 ноября/ }))
    fireEvent.click(await screen.findByRole('radio', { name: /09:00/ }))
  }

  function nameInput() {
    return screen.getByLabelText('Ваше имя')
  }

  it('shows the summary, sends the contract body and confirms from the server response', async () => {
    const fetch = mockApi(() => bookingResponse(bookingBody))
    renderBook()
    await pickSlot()

    const summary = screen.getByRole('region', { name: 'Проверьте выбор' })
    expect(within(summary).getByText('Introduction')).toBeInTheDocument()
    expect(within(summary).getByText('45 мин.')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Записаться' })
    expect(submit).toBeDisabled()

    fireEvent.change(nameInput(), { target: { value: '  Анна  ' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    const confirmation = await screen.findByRole('region', { name: 'Запись подтверждена' })
    expect(within(confirmation).getByText('Анна')).toBeInTheDocument()
    expect(within(confirmation).getByText('Introduction')).toBeInTheDocument()
    expect(within(confirmation).getByText(/09:00/)).toBeInTheDocument()
    expect(within(confirmation).getByText(/09:45/)).toBeInTheDocument()
    expect(within(confirmation).getByText('45 мин.')).toBeInTheDocument()

    const post = fetch.mock.calls.find(
      ([request]) => request.method === 'POST' && new URL(request.url).pathname === '/bookings'
    )
    expect(post).toBeDefined()
    expect(await assertCreateBookingRequest(post![0])).toEqual({
      meetingTypeId: intro.id,
      start: '2026-11-18T06:00:00Z',
      guestName: 'Анна'
    })
  })

  it('blocks repeated submission while the request is in flight', async () => {
    const deferred = Promise.withResolvers<Response>()
    const fetched: Request[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const url = new URL(input.url)
        if (url.pathname === '/meeting-types') return meetingTypesResponse('populated', [intro])
        if (url.pathname === '/availability')
          return availabilityResponse('available', availabilityBody)
        fetched.push(input)
        return deferred.promise
      })
    )
    renderBook()
    await pickSlot()
    fireEvent.change(nameInput(), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Записаться' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Сохраняем запись…')
    expect(screen.getByRole('button', { name: 'Записаться' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Записаться' }))
    fireEvent.submit(screen.getByRole('form', { name: 'Создание записи' }))
    expect(fetched).toHaveLength(1)

    deferred.resolve(bookingResponse(bookingBody))
    expect(await screen.findByRole('heading', { name: 'Запись подтверждена' })).toBeInTheDocument()
  })

  it('explains a conflict, keeps the name and type and clears the taken slot', async () => {
    const fetch = mockApi(() => bookingErrorResponse('SLOT_CONFLICT'))
    renderBook()
    await pickSlot()
    fireEvent.change(nameInput(), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Записаться' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Это время уже занято')
    expect(screen.queryByText('Запись подтверждена')).not.toBeInTheDocument()
    expect(nameInput()).toHaveValue('Анна')
    expect(screen.getByRole('radio', { name: 'Introduction' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Записаться' })).not.toBeInTheDocument()

    const availabilityCalls = fetch.mock.calls.filter(
      ([request]) => new URL(request.url).pathname === '/availability'
    )
    expect(availabilityCalls.length).toBeGreaterThan(1)
  })

  it('does not claim success or absence when the network fails', async () => {
    const fetch = mockApi(() => Promise.reject(new TypeError('Failed to fetch')))
    renderBook()
    await pickSlot()
    fireEvent.change(nameInput(), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Записаться' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Результат неизвестен')
    expect(screen.queryByText('Запись подтверждена')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Записаться' })).toBeEnabled()
    expect(
      fetch.mock.calls.filter(
        ([request]) => request.method === 'POST' && new URL(request.url).pathname === '/bookings'
      )
    ).toHaveLength(1)
  })

  it('keeps the selection and name after a validation error', async () => {
    mockApi(() => bookingErrorResponse('VALIDATION_ERROR'))
    renderBook()
    await pickSlot()
    fireEvent.change(nameInput(), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Записаться' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать запись')
    expect(nameInput()).toHaveValue('Анна')
    expect(screen.getByRole('radio', { name: /09:00/ })).toBeChecked()
  })
})
