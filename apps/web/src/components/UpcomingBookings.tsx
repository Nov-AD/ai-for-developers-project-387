import { listUpcomingBookingsOptions, type Booking } from '@calendar/sdk'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { formatInstant } from '@/lib/time'

/** The owner is a single preconfigured person in this zone. */
const OWNER_TIME_ZONE = 'Europe/Moscow'
const GUEST_NAME_DEBOUNCE_MS = 300

function BookingItem({ booking }: { booking: Booking }) {
  return (
    <li className="space-y-1 rounded-lg border p-4">
      <p className="font-medium">{booking.guestName}</p>
      <p className="text-sm text-muted-foreground">
        {booking.meetingType.name} · {booking.meetingType.durationMinutes} мин.
      </p>
      <p className="text-sm">
        {formatInstant(booking.start, OWNER_TIME_ZONE)} —{' '}
        {formatInstant(booking.end, OWNER_TIME_ZONE)}
      </p>
    </li>
  )
}

export function UpcomingBookings() {
  const [guestNameInput, setGuestNameInput] = useState('')
  const [guestNameFilter, setGuestNameFilter] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setGuestNameFilter(guestNameInput.trim())
    }, GUEST_NAME_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [guestNameInput])

  const hasActiveFilters = guestNameFilter !== ''
  const upcoming = useQuery({
    ...listUpcomingBookingsOptions(
      hasActiveFilters ? { query: { guestName: guestNameFilter } } : undefined
    ),
    // Refresh on page entry and window focus; the button below covers a manual refresh.
    refetchOnWindowFocus: true,
    retry: false
  })

  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
  }

  function resetFilters() {
    setGuestNameInput('')
    setGuestNameFilter('')
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Время указано в часовом поясе владельца: {OWNER_TIME_ZONE}.
      </p>

      <form
        onSubmit={preventSubmit}
        aria-label="Фильтры предстоящих записей"
        className="flex flex-wrap items-end gap-4"
      >
        <div className="space-y-2">
          <label htmlFor="upcoming-guest-name" className="block text-sm font-medium">
            Имя гостя
          </label>
          <input
            id="upcoming-guest-name"
            name="guestName"
            value={guestNameInput}
            onChange={(event) => setGuestNameInput(event.target.value)}
            className="rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
        <Button type="button" variant="outline" onClick={resetFilters}>
          Сбросить фильтры
        </Button>
      </form>

      {upcoming.isPending && (
        <p role="status" className="text-muted-foreground">
          Загружаем предстоящие записи…
        </p>
      )}

      {upcoming.isError && (
        <div role="alert" className="space-y-4">
          <p>Не удалось загрузить предстоящие записи. Проверьте соединение и попробуйте ещё раз.</p>
          <Button
            type="button"
            onClick={() => void upcoming.refetch()}
            disabled={upcoming.isFetching}
          >
            Повторить загрузку
          </Button>
        </div>
      )}

      {upcoming.isSuccess && upcoming.data.length === 0 && (
        <p className="text-muted-foreground">
          {hasActiveFilters ? 'По выбранным фильтрам записей нет.' : 'Предстоящих записей нет.'}
        </p>
      )}

      {upcoming.isSuccess && upcoming.data.length > 0 && (
        <ul aria-label="Предстоящие записи" className="space-y-2">
          {upcoming.data.map((booking) => (
            <BookingItem key={booking.id} booking={booking} />
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => void upcoming.refetch()}
        disabled={upcoming.isFetching}
      >
        Обновить список
      </Button>
    </div>
  )
}
