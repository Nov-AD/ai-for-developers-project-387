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

async function upcoming(instance: FastifyInstance, query = '') {
  return instance.inject({ method: 'GET', url: `/bookings${query}` })
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

  it('filters by a trimmed, case-insensitive guest name substring', async () => {
    freeze()
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const anna = await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')
    await book(instance, id, '2026-11-18T07:00:00Z', 'Борис')

    const substring = await upcoming(instance, `?guestName=${encodeURIComponent('анн')}`)
    expect(substring.statusCode).toBe(200)
    expect(substring.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([anna.id])
    assertContractResponse(listOperation, substring.statusCode, substring.json())

    const trimmed = await upcoming(instance, `?guestName=${encodeURIComponent('  Анна  ')}`)
    expect(trimmed.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([anna.id])

    expect((await upcoming(instance, '?guestName=%20%20')).json()).toHaveLength(2)
  })

  it('filters by exact meeting type and treats an unknown well-formed UUID as empty', async () => {
    freeze()
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)
    await book(instance, short, '2026-11-18T06:00:00Z', 'Анна')
    const boris = await book(instance, long, '2026-11-18T08:00:00Z', 'Борис')

    const filtered = await upcoming(instance, `?meetingTypeId=${long}`)
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([boris.id])
    assertContractResponse(listOperation, filtered.statusCode, filtered.json())

    const unknown = await upcoming(instance, '?meetingTypeId=99999999-9999-4999-8999-999999999999')
    expect(unknown.statusCode).toBe(200)
    expect(unknown.json()).toEqual([])
  })

  it('filters by inclusive owner calendar dates on the booking start', async () => {
    freeze()
    const instance = await build()
    const id = await createType(instance, 'Звонок', 30)
    const firstDay = await book(instance, id, '2026-11-18T06:00:00Z', 'Анна')
    const sameDay = await book(instance, id, '2026-11-18T08:00:00Z', 'Борис')
    const nextDay = await book(instance, id, '2026-11-19T06:00:00Z', 'Вера')

    const exact = await upcoming(instance, '?fromDate=2026-11-18&toDate=2026-11-18')
    expect(exact.statusCode).toBe(200)
    expect(exact.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      firstDay.id,
      sameDay.id
    ])
    assertContractResponse(listOperation, exact.statusCode, exact.json())

    const fromOnly = await upcoming(instance, '?fromDate=2026-11-19')
    expect(fromOnly.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      nextDay.id
    ])

    const toOnly = await upcoming(instance, '?toDate=2026-11-18')
    expect(toOnly.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      firstDay.id,
      sameDay.id
    ])

    const inclusive = await upcoming(instance, '?fromDate=2026-11-18&toDate=2026-11-19')
    expect(inclusive.json()).toHaveLength(3)
  })

  it('combines every filter with AND and preserves start/UUID ordering', async () => {
    freeze()
    const instance = await build()
    const short = await createType(instance, 'Короткий', 30)
    const long = await createType(instance, 'Длинный', 45)
    const first = await book(instance, short, '2026-11-18T06:00:00Z', 'Анна')
    await book(instance, long, '2026-11-18T08:00:00Z', 'Анна')
    await book(instance, short, '2026-11-19T06:00:00Z', 'Анна')
    await book(instance, short, '2026-11-18T07:00:00Z', 'Борис')
    const later = await book(instance, short, '2026-11-18T09:00:00Z', 'Анна')

    const response = await upcoming(
      instance,
      `?guestName=${encodeURIComponent('Анна')}&meetingTypeId=${short}&fromDate=2026-11-18&toDate=2026-11-18`
    )

    expect(response.statusCode).toBe(200)
    expect(response.json<Array<{ id: string }>>().map(({ id: found }) => found)).toEqual([
      first.id,
      later.id
    ])
    assertContractResponse(listOperation, response.statusCode, response.json())
  })

  it.each([
    ['guest name longer than 100 characters', `?guestName=${'x'.repeat(101)}`],
    ['malformed meeting type UUID', '?meetingTypeId=not-a-uuid'],
    ['malformed date', '?fromDate=2026-02-30'],
    ['fromDate later than toDate', '?fromDate=2026-11-19&toDate=2026-11-18']
  ])('rejects %s with a validation error', async (_label, query) => {
    freeze()
    const instance = await build()

    const response = await upcoming(instance, query)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    assertContractResponse(listOperation, response.statusCode, response.json())
  })
})
