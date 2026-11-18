import type { components } from '../generated/openapi.js'

export type Booking = components['schemas']['Booking']
type MeetingType = components['schemas']['MeetingType']

export type SaveBookingInput = {
  meetingType: MeetingType
  guestName: string
  start: string
  end: string
}

export type SaveBookingResult = { status: 'saved'; booking: Booking } | { status: 'conflict' }

export type BookingFilters = {
  /** Case-insensitive substring of the guest name; an empty value does not narrow the list. */
  guestName?: string
}

export interface BookingRepository {
  list(): Booking[]
  /** Bookings whose end is strictly later than `now` and match every active filter, sorted by start, then UUID. */
  upcoming(now: Date, filters: BookingFilters): Booking[]
  /**
   * Check every booking of every meeting type and save in one synchronous step: no await
   * between the overlap check and the insert, so concurrent requests cannot both win.
   */
  save(input: SaveBookingInput): SaveBookingResult
}

export class MemoryBookingRepository implements BookingRepository {
  private readonly bookings = new Map<string, Booking>()

  list(): Booking[] {
    return Array.from(this.bookings.values())
  }

  upcoming(now: Date, filters: BookingFilters): Booking[] {
    const time = now.getTime()
    const guestName = filters.guestName?.trim().toLowerCase()
    return this.list()
      .filter((booking) => Date.parse(booking.end) > time)
      .filter((booking) => !guestName || booking.guestName.toLowerCase().includes(guestName))
      .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
  }

  save(input: SaveBookingInput): SaveBookingResult {
    const start = Date.parse(input.start)
    const end = Date.parse(input.end)
    const overlaps = this.list().some(
      (booking) => start < Date.parse(booking.end) && end > Date.parse(booking.start)
    )
    if (overlaps) return { status: 'conflict' }

    const booking: Booking = {
      id: crypto.randomUUID(),
      meetingType: input.meetingType,
      guestName: input.guestName,
      start: input.start,
      end: input.end
    }
    this.bookings.set(booking.id, booking)
    return { status: 'saved', booking }
  }
}
