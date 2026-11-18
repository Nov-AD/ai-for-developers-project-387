import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Booking } from '@calendar/sdk'

// Observe real browser traffic; no route interception or fetch mocks.
// The filter scenario seeds records through the real API, not a mock.
function bookingResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url() === new URL('/bookings', page.url()).href &&
      response.request().method() === 'POST'
  )
}

function bookingsQueryMatches(url: string, expected: Record<string, string> = {}) {
  const parsed = new URL(url)
  if (parsed.pathname !== '/bookings') return false
  const keys = [...parsed.searchParams.keys()].sort()
  const expectedKeys = Object.keys(expected).sort()
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => parsed.searchParams.get(key) === expected[key])
  )
}

test('владелец создаёт тип встречи, гость записывается, второй гость получает конфликт', async ({
  page: owner,
  context
}) => {
  const meetingName = 'Браузерная встреча'
  const guestName = 'Анна Тестовая'
  const otherGuestName = 'Борис Тестовый'

  await test.step('на телефоне предупреждение компактно, а подробности доступны с клавиатуры', async () => {
    await owner.setViewportSize({ width: 320, height: 740 })
    await owner.goto('/owner')
    const warning = owner.getByRole('complementary', { name: 'Ограничения учебного приложения' })
    await expect(warning).toContainText('Данные публичны и сбрасываются при перезапуске.')
    const details = warning.getByText(/Раздел не защищён авторизацией/)
    await expect(details).not.toBeVisible()
    expect((await warning.boundingBox())!.height).toBeLessThanOrEqual(200)
    await expect(owner.getByRole('heading', { name: 'Новый тип встречи' })).toBeInViewport()
    const summary = warning.locator('summary')
    await summary.focus()
    await owner.keyboard.press('Enter')
    await expect(details).toBeVisible()
    await expect(warning.getByText(/Работа в нескольких процессах не поддерживается/)).toBeVisible()
    await owner.keyboard.press('Enter')
    await expect(details).not.toBeVisible()
    await owner.setViewportSize({ width: 1280, height: 720 })
  })

  await test.step('владелец создаёт тип встречи через форму', async () => {
    await owner.goto('/owner')
    await expect(owner.getByText('Предстоящих записей нет.', { exact: true })).toBeVisible()
    await owner.getByLabel('Название', { exact: true }).fill(meetingName)
    await owner.getByLabel('Описание (необязательно)').fill('Сквозная проверка настоящего API')
    await owner.getByLabel('Длительность в минутах').fill('45')
    await owner.getByRole('button', { name: 'Создать тип встречи', exact: true }).click()
    await expect(owner.getByRole('status')).toHaveText(`Тип встречи «${meetingName}» создан.`)
    await expect(owner.getByRole('heading', { name: meetingName, exact: true })).toBeVisible()
  })

  const guest = await context.newPage()
  const otherGuest = await context.newPage()
  let selectedStart = ''

  await test.step('два гостя заранее выбирают один свободный слот и вводят имена', async () => {
    for (const [page, name] of [
      [guest, guestName],
      [otherGuest, otherGuestName]
    ] as const) {
      await page.goto('/book')
      await page.getByRole('radio', { name: meetingName, exact: true }).check()
      if (page === guest) {
        const dates = page.getByRole('list', { name: 'Даты встречи' })
        await expect(dates.getByRole('button')).toHaveCount(14)
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 })
          // All two weeks fit in two rows, without horizontal page scrolling.
          expect((await dates.boundingBox())!.height).toBeLessThanOrEqual(120)
          expect(
            await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
          ).toBe(true)
        }
        const lastDay = dates.getByRole('button', { name: /\d+ слотов$/ }).last()
        await lastDay.focus()
        await page.keyboard.press('Enter')
        await expect(lastDay).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByRole('group', { name: 'Выберите время', exact: true })).toBeVisible()
      }
      // Use the second available day in the real window, so crossing midnight
      // during the test cannot push the chosen date out of a tomorrow-based window.
      await page
        .getByRole('button', { name: /\d+ слотов$/ })
        .nth(1)
        .click()
      const slot = page
        .getByRole('group', { name: 'Выберите время', exact: true })
        .getByRole('radio')
        .first()
      await slot.check()
      const start = await slot.inputValue()
      if (selectedStart) expect(start).toBe(selectedStart)
      selectedStart = start
      await page.getByLabel('Ваше имя', { exact: true }).fill(name)
      await expect(page.getByRole('button', { name: 'Записаться', exact: true })).toBeEnabled()
    }
  })

  const booking =
    await test.step('первый гость получает HTTP 201 и подтверждение сохранённой записи', async () => {
      const responsePromise = bookingResponse(guest)
      await guest.getByRole('button', { name: 'Записаться', exact: true }).click()
      const response = await responsePromise
      expect(response.status()).toBe(201)
      const booking: Booking = await response.json()
      expect(booking).toMatchObject({
        guestName,
        start: selectedStart,
        meetingType: { name: meetingName, durationMinutes: 45 }
      })
      expect(Date.parse(booking.end) - Date.parse(booking.start)).toBe(45 * 60_000)

      const confirmation = guest.getByRole('region', { name: 'Запись подтверждена', exact: true })
      await expect(confirmation).toBeVisible()
      const displayedTime = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      })
      // Expected times come from the chosen start and the known duration,
      // independently of the UI's formatter and of the server's computed end.
      await expect(confirmation.locator('dd')).toHaveText([
        meetingName,
        guestName,
        displayedTime.format(new Date(selectedStart)),
        displayedTime.format(new Date(Date.parse(selectedStart) + 45 * 60_000)),
        '45 мин.',
        'Europe/Moscow'
      ])
      return booking
    })

  await test.step('второй гость получает настоящий HTTP 409 без ложного подтверждения', async () => {
    const responsePromise = bookingResponse(otherGuest)
    const availabilityPromise = otherGuest.waitForResponse(
      (response) => new URL(response.url()).pathname === '/availability'
    )
    await otherGuest.getByRole('button', { name: 'Записаться', exact: true }).click()
    const response = await responsePromise
    expect(response.status()).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SLOT_CONFLICT' })
    expect((await availabilityPromise).status()).toBe(200)
    await expect(otherGuest.getByRole('alert')).toContainText('Это время уже занято.')
    await expect(otherGuest.getByLabel('Ваше имя', { exact: true })).toHaveValue(otherGuestName)
    await expect(otherGuest.getByRole('radio', { name: meetingName, exact: true })).toBeChecked()
    await expect(
      otherGuest.getByRole('heading', { name: 'Запись подтверждена', exact: true })
    ).toHaveCount(0)
    await expect(otherGuest.locator('input[name="slot"]:checked')).toHaveCount(0)
    await expect(otherGuest.locator(`input[name="slot"][value="${selectedStart}"]`)).toHaveCount(0)
    await expect(otherGuest.getByRole('button', { name: 'Записаться', exact: true })).toHaveCount(0)
  })

  await test.step('владелец обновляет список и видит только успешную запись', async () => {
    const responsePromise = owner.waitForResponse(
      (response) => new URL(response.url()).pathname === '/bookings'
    )
    await owner.getByRole('button', { name: 'Обновить список', exact: true }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual([booking])
    const records = owner
      .getByRole('list', { name: 'Предстоящие записи', exact: true })
      .getByRole('listitem')
    await expect(records).toHaveCount(1)
    await expect(records).toContainText(guestName)
    await expect(records).toContainText(`${meetingName} · 45 мин.`)
    await expect(records).not.toContainText(otherGuestName)
    await expect(records).toContainText('GMT+3')
    // The owner and guest use the same explicit zone in this scenario.
    const confirmationTimes = await guest
      .getByRole('region', { name: 'Запись подтверждена', exact: true })
      .locator('dd')
      .filter({ hasText: /GMT\+3/ })
      .allTextContents()
    for (const time of confirmationTimes) await expect(records).toContainText(time)
  })
})

function ownerCalendarDate(instant: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(instant))
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

type SeededSlot = { start: string; end: string }

async function createType(request: APIRequestContext, name: string, durationMinutes: number) {
  const response = await request.post('/meeting-types', { data: { name, durationMinutes } })
  expect(response.status()).toBe(201)
  return (await response.json()) as { id: string; name: string }
}

async function availableSlots(
  request: APIRequestContext,
  meetingTypeId: string
): Promise<SeededSlot[]> {
  const response = await request.get('/availability', { params: { meetingTypeId } })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { slots: SeededSlot[] }
  return body.slots
}

async function createBooking(
  request: APIRequestContext,
  meetingTypeId: string,
  start: string,
  guestName: string
) {
  const response = await request.post('/bookings', {
    data: { meetingTypeId, start, guestName }
  })
  expect(response.status()).toBe(201)
}

test('фильтры работают вместе, сохраняются при обновлении и сбрасываются', async ({
  page,
  request
}) => {
  const suffix = Date.now().toString()
  const typeA = await createType(request, `Знакомство ${suffix}`, 30)
  const typeB = await createType(request, `Обзор ${suffix}`, 45)
  const guestAnna = `Анна ${suffix}`
  const guestBoris = `Борис ${suffix}`

  const slotsA = await availableSlots(request, typeA.id)
  const slotsB = await availableSlots(request, typeB.id)
  expect(slotsA.length, 'type A must have available slots').toBeGreaterThan(0)
  expect(slotsB.length, 'type B must have available slots').toBeGreaterThan(0)

  const annaTypeA = slotsA[0]!
  const annaDate = ownerCalendarDate(annaTypeA.start)
  const annaTypeB = slotsB.find((slot) => ownerCalendarDate(slot.start) !== annaDate)
  expect(annaTypeB, 'type B needs a slot on another owner date').toBeDefined()
  const annaTypeBDate = ownerCalendarDate(annaTypeB!.start)
  const borisTypeA = slotsA.find(
    (slot) =>
      ownerCalendarDate(slot.start) !== annaDate && ownerCalendarDate(slot.start) !== annaTypeBDate
  )
  expect(borisTypeA, 'type A needs a slot on a third owner date').toBeDefined()

  await createBooking(request, typeA.id, annaTypeA.start, guestAnna)
  await createBooking(request, typeB.id, annaTypeB!.start, guestAnna)
  await createBooking(request, typeA.id, borisTypeA!.start, guestBoris)

  const initialResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && bookingsQueryMatches(response.url())
  )
  await page.goto('/owner')
  const records = page
    .getByRole('list', { name: 'Предстоящие записи', exact: true })
    .getByRole('listitem')
  const nameInput = page.getByLabel('Имя гостя', { exact: true })
  const typeSelect = page.getByLabel('Тип встречи', { exact: true })
  const fromDate = page.getByLabel('Дата с', { exact: true })
  const toDate = page.getByLabel('Дата по', { exact: true })

  await test.step('базовый список показывает все три записи без параметров запроса', async () => {
    expect((await initialResponse).status()).toBe(200)
    await expect(records.filter({ hasText: guestAnna })).toHaveCount(2)
    await expect(records.filter({ hasText: guestBoris })).toHaveCount(1)
    await expect(nameInput).toHaveValue('')
    await expect(typeSelect).toHaveValue('')
    await expect(fromDate).toHaveValue('')
    await expect(toDate).toHaveValue('')
  })

  const allFilters = {
    guestName: guestAnna,
    meetingTypeId: typeA.id,
    fromDate: annaDate,
    toDate: annaDate
  }

  await test.step('имя, тип и диапазон дат сужают выдачу одновременно', async () => {
    const responsePromise = page.waitForResponse((response) =>
      bookingsQueryMatches(response.url(), allFilters)
    )
    await nameInput.fill(`  ${guestAnna}  `)
    await typeSelect.selectOption({ label: typeA.name })
    await fromDate.fill(annaDate)
    await toDate.fill(annaDate)
    expect((await responsePromise).status()).toBe(200)

    await expect(records).toHaveCount(1)
    await expect(records).toContainText(guestAnna)
    await expect(records).toContainText(typeA.name)
    await expect(records).not.toContainText(guestBoris)
  })

  await test.step('пустая выдача под фильтрами отличается от отсутствия записей', async () => {
    await nameInput.fill(`Никого ${suffix}`)
    await expect(
      page.getByText('По выбранным фильтрам записей нет.', { exact: true })
    ).toBeVisible()
    await expect(page.getByText('Предстоящих записей нет.', { exact: true })).toHaveCount(0)
  })

  await test.step('сброс очищает все контролы и сразу возвращает полный список', async () => {
    const responsePromise = page.waitForResponse((response) => bookingsQueryMatches(response.url()))
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click()
    expect((await responsePromise).status()).toBe(200)

    await expect(nameInput).toHaveValue('')
    await expect(typeSelect).toHaveValue('')
    await expect(fromDate).toHaveValue('')
    await expect(toDate).toHaveValue('')
    await expect(records.filter({ hasText: guestAnna })).toHaveCount(2)
    await expect(records.filter({ hasText: guestBoris })).toHaveCount(1)
  })

  await test.step('обновление списка и возврат фокуса сохраняют все фильтры', async () => {
    await nameInput.fill(guestAnna)
    await typeSelect.selectOption({ label: typeA.name })
    await fromDate.fill(annaDate)
    await toDate.fill(annaDate)
    await expect(records).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Обновить список', exact: true })).toBeEnabled()

    const refreshPromise = page.waitForResponse((response) =>
      bookingsQueryMatches(response.url(), allFilters)
    )
    await page.getByRole('button', { name: 'Обновить список', exact: true }).click()
    expect((await refreshPromise).status()).toBe(200)
    await expect(records).toHaveCount(1)
    await expect(nameInput).toHaveValue(guestAnna)
    await expect(typeSelect).toHaveValue(typeA.id)
    await expect(fromDate).toHaveValue(annaDate)
    await expect(toDate).toHaveValue(annaDate)

    const focusPromise = page.waitForResponse((response) =>
      bookingsQueryMatches(response.url(), allFilters)
    )
    await page.evaluate('window.dispatchEvent(new Event("visibilitychange"))')
    expect((await focusPromise).status()).toBe(200)
    await expect(records).toHaveCount(1)
    await expect(nameInput).toHaveValue(guestAnna)
    await expect(typeSelect).toHaveValue(typeA.id)
    await expect(fromDate).toHaveValue(annaDate)
    await expect(toDate).toHaveValue(annaDate)
  })
})
