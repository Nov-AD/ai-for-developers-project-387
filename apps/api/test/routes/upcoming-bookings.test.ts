import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/app.ts'
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
