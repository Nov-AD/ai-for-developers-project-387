import { expect, test, type Page } from '@playwright/test'
import type { Booking } from '@calendar/sdk'

// Observe real browser traffic; no route interception, API seeding or fetch mocks.
function bookingResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url() === new URL('/bookings', page.url()).href &&
      response.request().method() === 'POST'
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
