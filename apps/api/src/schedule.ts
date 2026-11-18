import { addDays, addMinutes, format, getISODay, parseISO } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import {
  BOOKING_WINDOW_DAYS,
  OWNER_TIME_ZONE,
  SLOT_STEP_MINUTES,
  WORKDAY_END_MINUTES,
  WORKDAY_START_MINUTES,
  type BookingWindowStart
} from './config.ts'

export type TimeInterval = { start: string; end: string }

export type OwnerWindow = { startDate: string; endDate: string }

/** Rolling window of 14 owner calendar dates; `endDate` is exclusive. */
export function ownerWindow(mode: BookingWindowStart, now: Date): OwnerWindow {
  const today = formatInTimeZone(now, OWNER_TIME_ZONE, 'yyyy-MM-dd')
  const first = mode === 'today' ? parseISO(today) : addDays(parseISO(today), 1)

  return {
    startDate: format(first, 'yyyy-MM-dd'),
    endDate: format(addDays(first, BOOKING_WINDOW_DAYS), 'yyyy-MM-dd')
  }
}

/** RFC 3339 UTC instant with seconds and no fractional part, as required by the contract. */
export function utcInstant(instant: Date): string {
  return formatInTimeZone(instant, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'")
}

/** Calendar date of an instant in the owner's time zone; never the process or browser zone. */
export function ownerDate(instant: string | Date): string {
  return formatInTimeZone(instant, OWNER_TIME_ZONE, 'yyyy-MM-dd')
}

/** Strict YYYY-MM-DD check that also rejects impossible dates such as 2026-02-30. */
export function isOwnerDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function overlaps(slotStart: number, slotEnd: number, bookings: TimeInterval[]): boolean {
  return bookings.some((booking) => {
    const start = Date.parse(booking.start)
    const end = Date.parse(booking.end)
    // Half-open intervals: touching endpoints do not overlap.
    return slotStart < end && slotEnd > start
  })
}

/**
 * A start is bookable only when it lies on the owner's grid, fully inside working hours,
 * inside the current window and strictly in the future. Availability never replaces this check.
 */
export function isBookableStart(options: {
  start: Date
  durationMinutes: number
  window: OwnerWindow
  now: Date
}): boolean {
  const { start, durationMinutes, window, now } = options
  if (Number.isNaN(start.getTime()) || start.getTime() <= now.getTime()) return false

  const dateKey = formatInTimeZone(start, OWNER_TIME_ZONE, 'yyyy-MM-dd')
  if (dateKey < window.startDate || dateKey >= window.endDate) return false
  if (getISODay(parseISO(dateKey)) > 5) return false

  const [hours, minutes] = formatInTimeZone(start, OWNER_TIME_ZONE, 'HH:mm')
    .split(':')
    .map(Number) as [number, number]
  const offset = hours * 60 + minutes - WORKDAY_START_MINUTES
  if (offset < 0 || offset % SLOT_STEP_MINUTES !== 0) return false
  if (hours * 60 + minutes + durationMinutes > WORKDAY_END_MINUTES) return false

  // The instant must be the exact local wall-clock time, not a DST approximation.
  return (
    fromZonedTime(
      `${dateKey}T${formatInTimeZone(start, OWNER_TIME_ZONE, 'HH:mm')}:00`,
      OWNER_TIME_ZONE
    ).getTime() === start.getTime()
  )
}

/**
 * Starts on the owner's 30-minute grid, fully inside working hours, strictly later than
 * `now`, and free of every booking of every meeting type.
 */
export function availableSlots(options: {
  window: OwnerWindow
  durationMinutes: number
  now: Date
  bookings: TimeInterval[]
}): TimeInterval[] {
  const { window, durationMinutes, now, bookings } = options
  const slots: TimeInterval[] = []
  const end = parseISO(window.endDate)

  for (let date = parseISO(window.startDate); date < end; date = addDays(date, 1)) {
    if (getISODay(date) > 5) continue
    const dateLabel = format(date, 'yyyy-MM-dd')

    for (
      let minutes = WORKDAY_START_MINUTES;
      minutes + durationMinutes <= WORKDAY_END_MINUTES;
      minutes += SLOT_STEP_MINUTES
    ) {
      const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
      const rest = String(minutes % 60).padStart(2, '0')
      const start = fromZonedTime(`${dateLabel}T${hours}:${rest}:00`, OWNER_TIME_ZONE)

      if (start.getTime() <= now.getTime()) continue
      if (overlaps(start.getTime(), start.getTime() + durationMinutes * 60_000, bookings)) continue

      slots.push({
        start: utcInstant(start),
        end: utcInstant(addMinutes(start, durationMinutes))
      })
    }
  }

  return slots
}
