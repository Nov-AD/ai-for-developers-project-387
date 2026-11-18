import type { MeetingType } from '@calendar/sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import {
  assertMeetingTypeRequest,
  meetingTypeResponse,
  meetingTypesResponse,
  upcomingResponse
} from './helpers/contract'

afterEach(() => {
  window.history.pushState({}, '', '/')
  vi.unstubAllGlobals()
})

function renderApp(path = '/owner') {
  window.history.pushState({}, '', path)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } }
  })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  )
}

function fillForm(name = ' Introduction ', description = 'First conversation', duration = '45') {
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Описание (необязательно)'), {
    target: { value: description }
  })
  fireEvent.change(screen.getByLabelText('Длительность в минутах'), { target: { value: duration } })
}

describe('Owner', () => {
  it('keeps the essential warning visible and full limitations collapsed by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        new URL(request.url).pathname === '/bookings'
          ? upcomingResponse('empty')
          : meetingTypesResponse('empty')
      )
    )
    renderApp()

    const warning = screen.getByRole('complementary', { name: 'Ограничения учебного приложения' })
    expect(
      within(warning).getByText(
        'Данные публичны и сбрасываются при перезапуске. Не вводите реальные персональные данные.'
      )
    ).toBeVisible()
    const summary = within(warning).getByText('Подробнее об ограничениях')
    expect(summary).toBeVisible()
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(within(warning).getByText(/раздел не защищён авторизацией/i)).not.toBeVisible()
    expect(
      within(warning).getByText(/работа в нескольких процессах не поддерживается/i)
    ).not.toBeVisible()
    expect(screen.getByRole('form', { name: 'Создание типа встречи' })).toBeInTheDocument()
    await screen.findByText('Типов встреч пока нет. Загляните позже.')
  })

  it('navigates from home, creates a type, refreshes the owner list and shows it to the guest', async () => {
    const type: MeetingType = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Introduction',
      description: 'First conversation',
      durationMinutes: 45
    }
    let saved = false
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/bookings') return upcomingResponse('empty')
      if (request.method === 'POST') {
        expect(await assertMeetingTypeRequest(request)).toEqual({
          name: ' Introduction ',
          description: 'First conversation',
          durationMinutes: 45
        })
        saved = true
        return meetingTypeResponse('post', 'created', type)
      }
      expect(request.method).toBe('GET')
      expect(url.pathname).toBe('/meeting-types')
      return saved ? meetingTypesResponse('populated', [type]) : meetingTypesResponse('empty')
    })
    vi.stubGlobal('fetch', fetch)
    renderApp('/')

    fireEvent.click(screen.getByRole('link', { name: 'Владельцу' }))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Управление календарём' })
    ).toBeInTheDocument()
    expect(screen.getByText(/раздел не защищён авторизацией/i)).toBeInTheDocument()
    expect(screen.getByText(/данные доступны каждому/i)).toBeInTheDocument()
    expect(screen.getByText(/типы встреч и записи исчезают после перезапуска/i)).toBeInTheDocument()
    expect(await screen.findByText('Типов встреч пока нет. Загляните позже.')).toBeInTheDocument()

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Introduction' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('')
    expect(screen.getByText('First conversation')).toBeInTheDocument()
    expect(screen.getByText('45 мин.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Запись' }))
    const choice = await screen.findByRole('radio', { name: 'Introduction' })
    expect(choice).toHaveAccessibleDescription('First conversation 45 мин.')
    fireEvent.click(choice)
    expect(choice).toBeChecked()
    expect(fetch.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)
    expect(
      fetch.mock.calls.filter(([request]) => request.method === 'GET').length
    ).toBeGreaterThanOrEqual(3)
    expect(
      within(screen.getByRole('navigation')).getByRole('link', { name: 'Владельцу' })
    ).toHaveAttribute('href', '/owner')
  })

  it.each([
    [' ', '', '30', /название.*1.*100/i],
    ['n'.repeat(101), '', '30', /название.*1.*100/i],
    ['Test', 'd'.repeat(2001), '30', /описание.*2000/i],
    ['Test', '', '', /длительность.*целое.*1.*540/i],
    ['Test', '', '0', /длительность.*целое.*1.*540/i],
    ['Test', '', '-1', /длительность.*целое.*1.*540/i],
    ['Test', '', '1.5', /длительность.*целое.*1.*540/i],
    ['Test', '', '541', /длительность.*целое.*1.*540/i]
  ])(
    'validates the form without losing input or sending invalid data (%s, duration %s)',
    async (name, description, duration, message) => {
      const fetch = vi.fn(async (request: Request) => {
        if (new URL(request.url).pathname === '/bookings') return upcomingResponse('empty')
        return meetingTypesResponse('empty')
      })
      vi.stubGlobal('fetch', fetch)
      renderApp()
      await screen.findByText('Типов встреч пока нет. Загляните позже.')
      fillForm(name, description, duration)

      fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))

      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(screen.getByLabelText('Название')).toHaveValue(name)
      expect(screen.getByLabelText('Описание (необязательно)')).toHaveValue(description)
      expect(fetch.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Создать тип встречи' })).toBeEnabled()
    }
  )

  it('preserves inputs and accessible server field errors, then allows an explicit corrected submission', async () => {
    const type: MeetingType = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Introduction',
      description: '',
      durationMinutes: 17
    }
    let attempts = 0
    const fetch = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/bookings') return upcomingResponse('empty')
      if (request.method === 'POST') {
        await assertMeetingTypeRequest(request)
        attempts += 1
        return attempts === 1
          ? meetingTypeResponse('post', 'invalid-duration')
          : meetingTypeResponse('post', 'created', type)
      }
      return attempts > 1
        ? meetingTypesResponse('populated', [type])
        : meetingTypesResponse('empty')
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await screen.findByText('Типов встреч пока нет. Загляните позже.')
    fillForm(' Introduction ', '', '45')
    fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid meeting type.')
    expect(screen.getByLabelText('Название')).toHaveValue(' Introduction ')
    expect(screen.getByLabelText('Описание (необязательно)')).toHaveValue('')
    expect(screen.getByLabelText('Длительность в минутах')).toHaveValue(45)
    expect(screen.getByLabelText('Длительность в минутах')).toHaveAccessibleDescription(
      'Must be an integer from 1 to 540.'
    )
    expect(screen.getByLabelText('Длительность в минутах')).toBeInvalid()
    expect(screen.queryByText(/тип встречи.*создан/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Длительность в минутах'), { target: { value: '17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Introduction' })
    ).toBeInTheDocument()
    expect(screen.getByText('17 мин.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(attempts).toBe(2)
  })

  it('blocks repeat submissions and editing while saving and confirms only after the response', async () => {
    const pending = Promise.withResolvers<Response>()
    const fetch = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/bookings') return upcomingResponse('empty')
      if (request.method === 'POST') {
        await assertMeetingTypeRequest(request)
        return pending.promise
      }
      return meetingTypesResponse('empty')
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await screen.findByText('Типов встреч пока нет. Загляните позже.')
    fillForm('Introduction', '', '45')
    fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))

    expect(await screen.findByText('Сохраняем тип встречи…')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Создать тип встречи' })).toBeDisabled()
    expect(screen.getByLabelText('Название')).toBeDisabled()
    expect(screen.queryByText(/тип встречи.*создан/i)).not.toBeInTheDocument()
    fireEvent.submit(screen.getByRole('form', { name: 'Создание типа встречи' }))
    fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))
    expect(fetch.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)

    pending.resolve(meetingTypeResponse('post', 'created'))
    expect(await screen.findByText('Тип встречи «Introduction» создан.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать тип встречи' })).toBeEnabled()
  })

  it('does not automatically retry a network-failed creation or discard the form', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/bookings') return upcomingResponse('empty')
      if (request.method === 'POST') throw new TypeError('Failed to fetch')
      return meetingTypesResponse('empty')
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await screen.findByText('Типов встреч пока нет. Загляните позже.')
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Создать тип встречи' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('тип встречи мог сохраниться')
    expect(screen.getByLabelText('Название')).toHaveValue(' Introduction ')
    expect(screen.getByLabelText('Описание (необязательно)')).toHaveValue('First conversation')
    expect(screen.getByLabelText('Длительность в минутах')).toHaveValue(45)
    expect(screen.getByRole('button', { name: 'Создать тип встречи' })).toBeEnabled()
    expect(fetch.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)
    expect(screen.queryByText(/тип встречи.*создан/i)).not.toBeInTheDocument()
  })

  it('opens /owner directly, distinguishes loading and read error from empty data and retries', async () => {
    const first = Promise.withResolvers<Response>()
    const retry = Promise.withResolvers<Response>()
    let meetingTypeAttempts = 0
    const fetch = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/bookings') return upcomingResponse('empty')
      meetingTypeAttempts += 1
      return meetingTypeAttempts === 1 ? first.promise : retry.promise
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Управление календарём' })
    ).toBeInTheDocument()
    expect(screen.getByText('Загружаем типы встреч…')).toHaveAttribute('role', 'status')
    expect(screen.queryByText('Типов встреч пока нет. Загляните позже.')).not.toBeInTheDocument()
    first.resolve(meetingTypesResponse('unknown-query'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить типы встреч.')
    expect(screen.queryByText('Типов встреч пока нет. Загляните позже.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(await screen.findByText('Загружаем типы встреч…')).toHaveAttribute('role', 'status')
    retry.resolve(meetingTypesResponse('empty'))
    expect(await screen.findByText('Типов встреч пока нет. Загляните позже.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(meetingTypeAttempts).toBe(2)
  })
})
