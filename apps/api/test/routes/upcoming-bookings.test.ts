import Fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/app.ts'
import { MemoryBookingRepository } from '../../src/repositories/bookings.ts'
import { MemoryMeetingTypeRepository } from '../../src/repositories/meeting-types.ts'
import bookingRoutes from '../../src/routes/bookings.ts'
import { assertContractResponse, contractOperations } from '../helpers/contract.ts'

const instances: FastifyInstance[] = []
const listOperation = contractOperations.find(
  ({ operation }) => operation.operationId === 'listUpcomingBookings'
)!.operation

async function build(): Promise<FastifyInstance> {
  const instance = Fastify()
  instances.push(instance)
  await instance.register(app)
  return instance
}

async function buildWithSeededRepository() {
  const instance = Fastify()
  instances.push(instance)
  instance.setValidatorCompiler(validatorCompiler)
  instance.setSerializerCompiler(serializerCompiler)
  const meetingTypes = new MemoryMeetingTypeRepository()
  const bookings = new MemoryBookingRepository()
  instance.decorate('meetingTypes', meetingTypes)
  instance.decorate('bookings', bookings)
  instance.decorate('bookingWindowStart', 'tomorrow')
  await instance.register(bookingRoutes)
  await instance.ready()
  return { instance, meetingTypes, bookings }
}

async function createType(
  instance: FastifyInstance,
  name: string,
  durationMinutes: number
): Promise<string> {
  const created = await instance.inject({
    method: 'POST',
    url: '/meeting-types',
    payload: { name, durationMinutes }
  })
  expect(created.statusCode).toBe(201)
  return created.json<{ id: string }>().id
}

async function book(
  instance: FastifyInstance,
  meetingTypeId: string,
  start: string,
  guestName = 'Гость'
) {
  const response = await instance.inject({
    method: 'POST',
    url: '/bookings',
    payload: { meetingTypeId, start, guestName }
  })
  expect(response.statusCode, `booking ${start} should be saved`).toBe(201)
  return response.json<{
    id: string
    meetingType: { id: string; name: string; durationMinutes: number }
    guestName: string
    start: string
    end: string
  }>()
}

async function upcoming(instance: FastifyInstance) {
  return instance.inject({ method: 'GET', url: '/bookings' })
}

async function upcomingByGuestName(instance: FastifyInstance, guestName: string) {
  return instance.inject({ method: 'GET', url: '/bookings', query: { guestName } })
}

async function upcomingByMeetingType(instance: FastifyInstance, meetingTypeId: string) {
  return instance.inject({ method: 'GET', url: '/bookings', query: { meetingTypeId } })
}

async function upcomingByDates(
  instance: FastifyInstance,
  query: { fromDate?: string; toDate?: string }
) {
  return instance.inject({ method: 'GET', url: '/bookings', query })
}

/** Tuesday 12:00 in Europe/Moscow; the window starts tomorrow (2026-11-18). */
function freeze(now = '2026-11-17T09:00:00Z') {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  vi.stubEnv('BOOKING_WINDOW_START', 'tomorrow')
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async (instance) => instance.close()))
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('GET /bookings', () => {
  it('returns an empty JSON array matching the contract before any booking exists', async () => {
    freeze()
    const instance = await build()

    const response = await upcoming(instance)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/^application\/json\b/)
    expect(response.json()).toEqual([])
    assertContractResponse(listOperation, response.statusCode, response.json())
  })

  it('returns all meeting types sorted by start with complete display data', async () => {
    freeze()
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)

    const later = await book(instance, long, '2026-11-18T08:00:00Z', 'Борис')
    const earlier = await book(instance, short, '2026-11-18T06:00:00Z', 'Анна')
    const latest = await book(instance, short, '2026-11-19T06:00:00Z', 'Вера')

    const response = await upcoming(instance)

    expect(response.statusCode).toBe(200)
    const body = response.json<Array<{ id: string }>>()
    expect(body.map(({ id }) => id)).toEqual([earlier.id, later.id, latest.id])
    expect(body[0]).toMatchObject({
      meetingType: { id: short, name: 'Короткий', durationMinutes: 30 },
      guestName: 'Анна',
      start: '2026-11-18T06:00:00Z',
      end: '2026-11-18T06:30:00Z'
    })
    expect(body[1]).toMatchObject({
      meetingType: { id: long, name: 'Длинный', durationMinutes: 45 },
      guestName: 'Борис',
      start: '2026-11-18T08:00:00Z'
    })
    assertContractResponse(listOperation, response.statusCode, body)
  })

  it('keeps a call in progress but drops it at the exact end instant', async () => {
    // The window starts tomorrow (2026-11-18); creation happens just before the slot.
    freeze('2026-11-17T05:00:00Z')
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const booking = await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')

    vi.setSystemTime(new Date('2026-11-18T06:15:00Z'))
    expect((await upcoming(instance)).json()).toEqual([booking])

    vi.setSystemTime(new Date('2026-11-18T06:29:59Z'))
    expect(
      (await upcoming(instance)).json<Array<{ id: string }>>().map(({ id: found }) => found)
    ).toEqual([booking.id])

    vi.setSystemTime(new Date('2026-11-18T06:30:00Z'))
    const ended = await upcoming(instance)
    expect(ended.statusCode).toBe(200)
    expect(ended.json()).toEqual([])
  })

  it('drops calls that ended while keeping later ones', async () => {
    freeze('2026-11-17T05:00:00Z')
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const first = await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')
    const second = await book(instance, id, '2026-11-18T07:00:00Z', 'Борис')

    vi.setSystemTime(new Date('2026-11-18T06:45:00Z'))

    const body = (await upcoming(instance)).json<Array<{ id: string }>>()

    expect(body.map(({ id: found }) => found)).toEqual([second.id])
    expect(body.map(({ id: found }) => found)).not.toContain(first.id)
  })

  it('filters by a case-insensitive guest-name substring after trimming', async () => {
    freeze()
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const first = await book(instance, id, '2026-11-18T06:00:00Z', 'Anna Petrova')
    const second = await book(instance, id, '2026-11-18T07:00:00Z', 'ANNA')
    await book(instance, id, '2026-11-18T08:00:00Z', 'Boris')

    const response = await upcomingByGuestName(instance, '  anna  ')

    expect(response.statusCode).toBe(200)
    const body = response.json<Array<{ id: string }>>()
    expect(body.map(({ id: found }) => found)).toEqual([first.id, second.id])
    assertContractResponse(listOperation, response.statusCode, body)

    const noMatch = await upcomingByGuestName(instance, 'Nobody')
    expect(noMatch.statusCode).toBe(200)
    expect(noMatch.json()).toEqual([])
  })

  it('does not narrow the list for an empty or whitespace-only guest name', async () => {
    freeze()
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const first = await book(instance, id, '2026-11-18T06:00:00Z', 'Anna')
    const second = await book(instance, id, '2026-11-18T07:00:00Z', 'Boris')

    for (const guestName of ['', '   ']) {
      const response = await upcomingByGuestName(instance, guestName)
      expect(response.statusCode).toBe(200)
      expect(response.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
        first.id,
        second.id
      ])
    }
  })

  it('rejects a guest name longer than 100 characters after trimming', async () => {
    freeze()
    const instance = await build()

    for (const guestName of ['x'.repeat(101), `  ${'x'.repeat(101)}  `]) {
      const response = await upcomingByGuestName(instance, guestName)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
      assertContractResponse(listOperation, response.statusCode, response.json())
    }

    const boundary = await upcomingByGuestName(instance, `  ${'x'.repeat(100)}  `)
    expect(boundary.statusCode).toBe(200)
    expect(boundary.json()).toEqual([])
  })

  it('keeps the end > now rule and stable sorting with an active filter', async () => {
    freeze('2026-11-17T05:00:00Z')
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const ongoing = await book(instance, id, '2026-11-18T06:00:00Z', 'Anna')
    const later = await book(instance, id, '2026-11-18T07:00:00Z', 'Anna')
    await book(instance, id, '2026-11-18T08:00:00Z', 'Boris')

    vi.setSystemTime(new Date('2026-11-18T06:15:00Z'))
    const inProgress = await upcomingByGuestName(instance, 'anna')
    expect(inProgress.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      ongoing.id,
      later.id
    ])

    vi.setSystemTime(new Date('2026-11-18T06:30:00Z'))
    const ended = await upcomingByGuestName(instance, 'anna')
    expect(ended.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([later.id])
  })

  it('filters by meeting type while preserving start and UUID ordering', async () => {
    freeze()
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)
    const later = await book(instance, short, '2026-11-18T08:00:00Z', 'Борис')
    const earlier = await book(instance, short, '2026-11-18T06:00:00Z', 'Анна')
    await book(instance, long, '2026-11-18T07:00:00Z', 'Вера')

    const response = await upcomingByMeetingType(instance, short)

    expect(response.statusCode).toBe(200)
    const body = response.json<Array<{ id: string }>>()
    expect(body.map(({ id }) => id)).toEqual([earlier.id, later.id])
    expect(body.every(({ meetingType }) => meetingType.id === short)).toBe(true)
    assertContractResponse(listOperation, response.statusCode, body)
  })

  it('combines the meeting-type and guest-name filters with AND', async () => {
    freeze()
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)
    const matching = await book(instance, short, '2026-11-18T06:00:00Z', 'Anna Petrova')
    await book(instance, short, '2026-11-18T07:00:00Z', 'Boris')
    await book(instance, long, '2026-11-18T08:00:00Z', 'Anna Petrova')

    const response = await instance.inject({
      method: 'GET',
      url: '/bookings',
      query: { meetingTypeId: short, guestName: '  anna  ' }
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<Array<{ id: string }>>()
    expect(body.map(({ id }) => id)).toEqual([matching.id])
    assertContractResponse(listOperation, response.statusCode, body)
  })

  it('rejects a malformed meeting type UUID and returns 200 [] for an unknown one', async () => {
    freeze()
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')

    const malformed = await upcomingByMeetingType(instance, 'not-a-uuid')
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    assertContractResponse(listOperation, malformed.statusCode, malformed.json())

    const unknown = await upcomingByMeetingType(instance, '99999999-9999-4999-8999-999999999999')
    expect(unknown.statusCode).toBe(200)
    expect(unknown.json()).toEqual([])
    assertContractResponse(listOperation, unknown.statusCode, unknown.json())
  })

  it('keeps the end > now rule with an active meeting-type filter', async () => {
    freeze('2026-11-17T05:00:00Z')
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const ongoing = await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')
    const later = await book(instance, id, '2026-11-18T07:00:00Z', 'Борис')

    vi.setSystemTime(new Date('2026-11-18T06:15:00Z'))
    const inProgress = await upcomingByMeetingType(instance, id)
    expect(inProgress.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      ongoing.id,
      later.id
    ])

    vi.setSystemTime(new Date('2026-11-18T06:30:00Z'))
    const ended = await upcomingByMeetingType(instance, id)
    expect(ended.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([later.id])
  })

  it('applies inclusive date bounds and accepts either bound alone', async () => {
    freeze()
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const first = await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')
    const second = await book(instance, id, '2026-11-19T06:00:00Z', 'Борис')
    const third = await book(instance, id, '2026-11-20T06:00:00Z', 'Вера')

    const both = await upcomingByDates(instance, {
      fromDate: '2026-11-18',
      toDate: '2026-11-19'
    })
    expect(both.statusCode).toBe(200)
    expect(both.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      first.id,
      second.id
    ])
    assertContractResponse(listOperation, both.statusCode, both.json())

    const fromOnly = await upcomingByDates(instance, { fromDate: '2026-11-19' })
    expect(fromOnly.statusCode).toBe(200)
    expect(fromOnly.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      second.id,
      third.id
    ])

    const toOnly = await upcomingByDates(instance, { toDate: '2026-11-18' })
    expect(toOnly.statusCode).toBe(200)
    expect(toOnly.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([first.id])

    const sameDay = await upcomingByDates(instance, {
      fromDate: '2026-11-19',
      toDate: '2026-11-19'
    })
    expect(sameDay.statusCode).toBe(200)
    expect(sameDay.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([second.id])
  })

  it('uses the booking start calendar date in Europe/Moscow, not the UTC date', async () => {
    freeze()
    const { instance, meetingTypes, bookings } = await buildWithSeededRepository()
    const meetingType = meetingTypes.create({ name: 'Звонок', durationMinutes: 30 })
    const lateMoscow = bookings.save({
      meetingType,
      guestName: 'Поздний',
      start: '2026-11-18T20:30:00Z',
      end: '2026-11-18T21:00:00Z'
    })
    const afterMidnightMoscow = bookings.save({
      meetingType,
      guestName: 'После полуночи',
      start: '2026-11-18T21:30:00Z',
      end: '2026-11-18T22:00:00Z'
    })
    expect(lateMoscow.status).toBe('saved')
    expect(afterMidnightMoscow.status).toBe('saved')
    const lateMoscowId = lateMoscow.status === 'saved' ? lateMoscow.booking.id : ''
    const afterMidnightMoscowId =
      afterMidnightMoscow.status === 'saved' ? afterMidnightMoscow.booking.id : ''

    const moscowDate = await upcomingByDates(instance, {
      fromDate: '2026-11-18',
      toDate: '2026-11-18'
    })
    expect(moscowDate.statusCode).toBe(200)
    expect(moscowDate.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      lateMoscowId
    ])

    const nextMoscowDate = await upcomingByDates(instance, {
      fromDate: '2026-11-19',
      toDate: '2026-11-19'
    })
    expect(nextMoscowDate.statusCode).toBe(200)
    expect(nextMoscowDate.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      afterMidnightMoscowId
    ])
  })

  it('rejects empty, malformed and impossible dates and a reversed range', async () => {
    freeze()
    const instance = await build()

    for (const query of [
      { fromDate: '' },
      { toDate: '' },
      { fromDate: '18.11.2026' },
      { toDate: '2026-02-30' },
      { fromDate: '2026-11-19', toDate: '2026-11-18' }
    ]) {
      const response = await upcomingByDates(instance, query)
      expect(response.statusCode, JSON.stringify(query)).toBe(400)
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
      assertContractResponse(listOperation, response.statusCode, response.json())
    }
  })

  it('combines date bounds with guest-name and meeting-type filters with AND', async () => {
    freeze()
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)
    const matching = await book(instance, short, '2026-11-18T06:00:00Z', 'Anna')
    await book(instance, short, '2026-11-18T07:00:00Z', 'Boris')
    await book(instance, short, '2026-11-19T06:00:00Z', 'Anna')
    await book(instance, long, '2026-11-18T08:00:00Z', 'Anna')

    const response = await instance.inject({
      method: 'GET',
      url: '/bookings',
      query: {
        meetingTypeId: short,
        guestName: '  anna  ',
        fromDate: '2026-11-18',
        toDate: '2026-11-18'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<Array<{ id: string }>>().map(({ id }) => id)).toEqual([matching.id])
    assertContractResponse(listOperation, response.statusCode, response.json())
  })

  it('applies every active filter by AND to the end > now set without changing the order', async () => {
    freeze('2026-11-17T05:00:00Z')
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)
    const tiny = await createType(instance, 'Минута', 1)
    const ended = await book(instance, tiny, '2026-11-18T06:00:00Z', 'Anna')
    const ongoing = await book(instance, short, '2026-11-18T07:00:00Z', 'Anna')
    const later = await book(instance, short, '2026-11-18T08:00:00Z', 'Anna')
    await book(instance, short, '2026-11-18T09:00:00Z', 'Boris')
    await book(instance, long, '2026-11-18T10:00:00Z', 'Anna')
    await book(instance, short, '2026-11-19T06:00:00Z', 'Anna')

    vi.setSystemTime(new Date('2026-11-18T07:15:00Z'))
    const response = await instance.inject({
      method: 'GET',
      url: '/bookings',
      query: {
        guestName: '  anna  ',
        meetingTypeId: short,
        fromDate: '2026-11-18',
        toDate: '2026-11-18'
      }
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<Array<{ id: string }>>()
    expect(body.map(({ id }) => id)).toEqual([ongoing.id, later.id])
    expect(body.map(({ id }) => id)).not.toContain(ended.id)
    assertContractResponse(listOperation, response.statusCode, body)
  })

  it('rejects unknown query parameters with the contract validation error', async () => {
    freeze()
    const instance = await build()

    const response = await instance.inject({ method: 'GET', url: '/bookings?extra=x' })

    expect(response.statusCode).toBe(400)
    expect(response.headers['content-type']).toMatch(/^application\/json\b/)
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    assertContractResponse(listOperation, response.statusCode, response.json())
  })

  it('keeps the upcoming list isolated between application instances', async () => {
    freeze()
    const [first, second] = await Promise.all([build(), build()])
    const firstType = await createType(first, 'Первый', 30)
    const secondType = await createType(second, 'Второй', 30)
    await book(first, firstType, '2026-11-18T06:00:00Z')

    expect((await upcoming(first)).json()).toHaveLength(1)
    expect((await upcoming(second)).json()).toEqual([])
    expect(await createType(second, 'Второй', 15)).not.toBe(secondType)
  })
})
