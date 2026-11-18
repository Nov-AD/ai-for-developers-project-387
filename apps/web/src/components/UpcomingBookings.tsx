import { listMeetingTypesOptions, listUpcomingBookingsOptions, type Booking } from '@calendar/sdk'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatInstant } from '@/lib/time'

/** The owner is a single preconfigured person in this zone. */
const OWNER_TIME_ZONE = 'Europe/Moscow'

const controlClass =
  'w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring'

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
  const [guestName, setGuestName] = useState('')
  const [guestNameFilter, setGuestNameFilter] = useState('')
  const [meetingTypeId, setMeetingTypeId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setGuestNameFilter(guestName.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [guestName])

  const filters = {
    ...(guestNameFilter ? { guestName: guestNameFilter } : {}),
    ...(meetingTypeId ? { meetingTypeId } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {})
  }
  const hasFilters = Object.keys(filters).length > 0

  const meetingTypes = useQuery({ ...listMeetingTypesOptions(), retry: false })
  const upcoming = useQuery({
    ...listUpcomingBookingsOptions({ query: filters }),
    // Refresh on page entry and window focus; the button below covers a manual refresh.
    refetchOnWindowFocus: true,
    retry: false
  })

  function resetFilters() {
    setGuestName('')
    setGuestNameFilter('')
    setMeetingTypeId('')
    setFromDate('')
    setToDate('')
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Время указано в часовом поясе владельца: {OWNER_TIME_ZONE}.
      </p>

      <div
        role="group"
        aria-label="Фильтры предстоящих записей"
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="space-y-2">
          <label htmlFor="upcoming-filter-guest-name" className="block text-sm font-medium">
            Имя гостя
          </label>
          <input
            id="upcoming-filter-guest-name"
            type="search"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            className={controlClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="upcoming-filter-meeting-type" className="block text-sm font-medium">
            Тип встречи
          </label>
          <select
            id="upcoming-filter-meeting-type"
            value={meetingTypeId}
            onChange={(event) => setMeetingTypeId(event.target.value)}
            className={controlClass}
          >
            <option value="">Все типы</option>
            {meetingTypes.data?.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="upcoming-filter-from" className="block text-sm font-medium">
            Дата с
          </label>
          <input
            id="upcoming-filter-from"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className={controlClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="upcoming-filter-to" className="block text-sm font-medium">
            Дата по
          </label>
          <input
            id="upcoming-filter-to"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className={controlClass}
          />
        </div>
      </div>

      <Button type="button" variant="outline" onClick={resetFilters}>
        Сбросить фильтры
      </Button>

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
          {hasFilters ? 'По выбранным фильтрам записей нет.' : 'Предстоящих записей нет.'}
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
