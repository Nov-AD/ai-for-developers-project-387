import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  createBookingMutation,
  getAvailabilityOptions,
  getAvailabilityQueryKey,
  listUpcomingBookingsQueryKey,
  zMeetingTypeNotFoundError,
  zSlotConflictError,
  zValidationError,
  zInvalidSlotError,
  type Booking
} from '@calendar/sdk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MeetingTypes } from '@/components/MeetingTypes'
import { Button } from '@/components/ui/button'
import type { MeetingType } from '@calendar/sdk'
import {
  dateKeyInZone,
  dateKeysBetween,
  formatDateKey,
  formatInstant,
  guestTimeZone,
  ownerZone
} from '@/lib/time'

function errorCode(error: unknown): string | undefined {
  for (const schema of [
    zSlotConflictError,
    zInvalidSlotError,
    zValidationError,
    zMeetingTypeNotFoundError
  ]) {
    const parsed = schema.safeParse(error)
    if (parsed.success) return parsed.data.code
  }
  return undefined
}

function Confirmation({ booking, timeZone }: { booking: Booking; timeZone: string }) {
  return (
    <section aria-labelledby="confirmation-heading" className="space-y-3 rounded-xl border p-6">
      <h2 id="confirmation-heading" className="text-xl font-semibold">
        Запись подтверждена
      </h2>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Тип встречи</dt>
          <dd>{booking.meetingType.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Имя</dt>
          <dd>{booking.guestName}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Начало</dt>
          <dd>{formatInstant(booking.start, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Окончание</dt>
          <dd>{formatInstant(booking.end, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Длительность</dt>
          <dd>{booking.meetingType.durationMinutes} мин.</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Часовой пояс</dt>
          <dd>{timeZone}</dd>
        </div>
      </dl>
    </section>
  )
}

export function Book() {
  const [selectedType, setSelectedType] = useState<MeetingType>()
  const selectedTypeId = selectedType?.id
  const [selectedDay, setSelectedDay] = useState<string>()
  const [selectedSlot, setSelectedSlot] = useState<string>()
  const [guestName, setGuestName] = useState('')
  const queryClient = useQueryClient()

  const availability = useQuery({
    ...getAvailabilityOptions({ query: { meetingTypeId: selectedTypeId ?? '' } }),
    enabled: Boolean(selectedTypeId),
    retry: false
  })

  const refreshAvailability = async (meetingTypeId: string | undefined) => {
    if (!meetingTypeId) return
    await queryClient.invalidateQueries({
      queryKey: getAvailabilityQueryKey({ query: { meetingTypeId } })
    })
  }

  const create = useMutation({
    ...createBookingMutation(),
    retry: false,
    onSuccess: async () => {
      // Availability and the owner's upcoming list are refreshed from the server.
      await Promise.all([
        refreshAvailability(selectedTypeId),
        queryClient.invalidateQueries({ queryKey: listUpcomingBookingsQueryKey() })
      ])
    },
    onError: async (error) => {
      // A stale or taken slot must disappear; the guest name and type are preserved.
      if (['SLOT_CONFLICT', 'INVALID_SLOT'].includes(errorCode(error) ?? '')) {
        setSelectedSlot(undefined)
      }
      await refreshAvailability(selectedTypeId)
    }
  })

  const timeZone = guestTimeZone()
  const zone = ownerZone(availability.data?.ownerTimeZone)

  const days = useMemo(() => {
    const data = availability.data
    if (!data) return []
    const slotsByDay = new Map<string, Array<{ start: string; end: string }>>()
    for (const slot of data.slots) {
      const key = dateKeyInZone(slot.start, zone)
      slotsByDay.set(key, [...(slotsByDay.get(key) ?? []), slot])
    }
    return dateKeysBetween(data.windowStartDate, data.windowEndDate).map((key) => ({
      key,
      slots: slotsByDay.get(key) ?? []
    }))
  }, [availability.data, zone])

  const activeDay = days.find((day) => day.key === selectedDay)

  function chooseType(type: MeetingType) {
    setSelectedType(type)
    // A slot and a day belong to the availability of one type.
    setSelectedDay(undefined)
    setSelectedSlot(undefined)
  }

  function chooseDay(key: string) {
    setSelectedDay(key)
    const stillAvailable = days
      .find((day) => day.key === key)
      ?.slots.some((slot) => slot.start === selectedSlot)
    if (!stillAvailable) setSelectedSlot(undefined)
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 px-6 py-16 sm:py-24">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Запись на звонок</h1>

      <fieldset>
        <legend className="text-xl font-semibold">Выберите тип встречи</legend>
        <MeetingTypes selectedId={selectedTypeId} onSelect={chooseType} />
      </fieldset>

      {!selectedTypeId && (
        <p className="text-muted-foreground">
          Выберите тип встречи, чтобы увидеть свободное время.
        </p>
      )}

      {selectedTypeId && availability.isPending && (
        <p role="status" className="text-muted-foreground">
          Загружаем свободное время…
        </p>
      )}

      {selectedTypeId && availability.isError && (
        <div role="alert" className="space-y-4">
          <p>Не удалось загрузить свободное время. Проверьте соединение и попробуйте ещё раз.</p>
          <Button
            type="button"
            onClick={() => void availability.refetch()}
            disabled={availability.isFetching}
          >
            Повторить загрузку
          </Button>
        </div>
      )}

      {selectedTypeId && availability.data && (
        <section aria-labelledby="slot-heading" className="space-y-4">
          <div>
            <h2 id="slot-heading" className="text-xl font-semibold">
              Свободное время
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {availability.data.slots.length === 0
                ? 'На ближайшие дни свободных слотов нет. Попробуйте другой тип встречи или загляните позже.'
                : `Время показано в вашем часовом поясе: ${timeZone}.`}
            </p>
          </div>

          {availability.data.slots.length > 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">Выберите день</h3>
                <p className="mt-1 text-sm text-muted-foreground sm:hidden">
                  {formatDateKey(days[0]!.key)} — {formatDateKey(days[days.length - 1]!.key)}
                </p>
                <ul
                  aria-label="Даты встречи"
                  className="mt-2 grid grid-cols-7 gap-1 sm:flex sm:flex-wrap sm:gap-2"
                >
                  {days.map((day) => (
                    <li key={day.key}>
                      <Button
                        type="button"
                        className="h-14 w-full flex-col gap-0 px-0 sm:h-9 sm:w-auto sm:flex-row sm:gap-2 sm:px-4"
                        variant={selectedDay === day.key ? 'default' : 'outline'}
                        disabled={day.slots.length === 0}
                        aria-label={`${formatDateKey(day.key)}, ${day.slots.length === 0 ? 'нет слотов' : `${day.slots.length} слотов`}`}
                        aria-pressed={selectedDay === day.key}
                        onClick={() => chooseDay(day.key)}
                      >
                        <span className="text-base sm:hidden" aria-hidden="true">
                          {Number(day.key.slice(8))}
                        </span>
                        <span className="text-[10px] sm:hidden" aria-hidden="true">
                          {day.slots.length === 0 ? '—' : `${day.slots.length} сл.`}
                        </span>
                        <span className="hidden sm:inline">{formatDateKey(day.key)}</span>
                        <span className="hidden text-xs sm:inline">
                          {day.slots.length === 0 ? 'нет слотов' : `${day.slots.length} слотов`}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>

              {activeDay && activeDay.slots.length > 0 && (
                <fieldset>
                  <legend className="text-base font-semibold">Выберите время</legend>
                  <p className="mt-1 text-sm text-muted-foreground sm:hidden">
                    {formatDateKey(activeDay.key)}
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {activeDay.slots.map((slot) => (
                      <li key={slot.start}>
                        <label
                          className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary"
                          htmlFor={`slot-${slot.start}`}
                        >
                          <input
                            id={`slot-${slot.start}`}
                            type="radio"
                            name="slot"
                            value={slot.start}
                            checked={selectedSlot === slot.start}
                            onChange={() => setSelectedSlot(slot.start)}
                            className="size-4 shrink-0 accent-primary"
                          />
                          {formatInstant(slot.start, timeZone)}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}

              {!selectedDay && (
                <p className="text-muted-foreground">
                  Выберите день, чтобы увидеть свободное время.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {create.data ? (
        <Confirmation booking={create.data} timeZone={timeZone} />
      ) : (
        <>
          {selectedTypeId && (
            <section aria-labelledby="summary-heading" className="space-y-4 rounded-xl border p-6">
              <h2 id="summary-heading" className="text-xl font-semibold">
                Проверьте выбор
              </h2>

              {selectedSlot ? (
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">Тип встречи</dt>
                    <dd>{selectedType?.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Длительность</dt>
                    <dd>{selectedType?.durationMinutes} мин.</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Начало</dt>
                    <dd>{formatInstant(selectedSlot, timeZone)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Часовой пояс</dt>
                    <dd>{timeZone}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-muted-foreground">
                  Выберите свободное время выше, чтобы отправить запись.
                </p>
              )}

              <form
                className="space-y-4"
                aria-label="Создание записи"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!selectedTypeId || !selectedSlot || create.isPending) return
                  const trimmed = guestName.trim()
                  if (trimmed.length < 1 || trimmed.length > 100) return
                  create.mutate({
                    body: { meetingTypeId: selectedTypeId, start: selectedSlot, guestName: trimmed }
                  })
                }}
              >
                <div className="space-y-2">
                  <label htmlFor="guest-name" className="block text-sm font-medium">
                    Ваше имя
                  </label>
                  <input
                    id="guest-name"
                    name="guestName"
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                    required
                    className="w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
                  />
                  {guestName.trim().length === 0 && guestName.length > 0 && (
                    <p className="text-sm text-destructive">Укажите имя.</p>
                  )}
                </div>
                {selectedSlot && (
                  <Button
                    type="submit"
                    disabled={
                      create.isPending ||
                      guestName.trim().length < 1 ||
                      guestName.trim().length > 100
                    }
                  >
                    Записаться
                  </Button>
                )}
              </form>

              {create.isPending && <p role="status">Сохраняем запись…</p>}

              {create.isError && (
                <div role="alert" className="space-y-2 rounded-xl border border-destructive/40 p-4">
                  {errorCode(create.error) === 'SLOT_CONFLICT' ? (
                    <p>
                      Это время уже занято. Выберите другой свободный слот: доступность обновлена.
                    </p>
                  ) : errorCode(create.error) === 'INVALID_SLOT' ? (
                    <p>
                      Выбранное время больше недоступно. Выберите другой слот: доступность
                      обновлена.
                    </p>
                  ) : errorCode(create.error) ? (
                    <p>Не удалось создать запись. Проверьте данные и попробуйте ещё раз.</p>
                  ) : (
                    <p>
                      Результат неизвестен: запись могла сохраниться до потери ответа. Проверьте
                      свободное время, прежде чем отправлять форму снова.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <Button asChild variant="outline">
            <Link to="/">На главную</Link>
          </Button>
        </>
      )}
    </div>
  )
}
