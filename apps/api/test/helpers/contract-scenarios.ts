import type { FastifyInstance } from 'fastify'
import { expect, vi } from 'vitest'
import { assertContractResponse, contractOperations, type ContractScenario } from './contract.ts'

/** Fixtures come from TypeSpec; only real API-created identifiers replace example identifiers. */
export async function prepareContractScenario(
  instance: FastifyInstance,
  operationId: string,
  scenario: ContractScenario
) {
  const request = structuredClone(scenario.request ?? {})
  const body = request.body as Record<string, unknown> | undefined
  const unknownType = scenario.name === 'unknown-type'
  const upcomingWithBooking = ['populated', 'filtered', 'trimmed-filter', 'empty-filter']
  const needsType =
    (operationId === 'listMeetingTypes' && scenario.name === 'populated') ||
    (operationId === 'listUpcomingBookings' && upcomingWithBooking.includes(scenario.name)) ||
    (operationId === 'getAvailability' && ['available', 'empty'].includes(scenario.name)) ||
    (operationId === 'createBooking' && !unknownType)

  if (!needsType) return request

  const durationMinutes = operationId === 'getAvailability' && scenario.name === 'empty' ? 540 : 45
  const created = await instance.inject({
    method: 'POST',
    url: '/meeting-types',
    payload: { name: 'Contract example', durationMinutes }
  })
  expect(created.statusCode, 'scenario preparation requires POST /meeting-types → 201').toBe(201)
  const type = created.json<{ id: string }>()
  const createType = contractOperations.find(
    ({ operation }) => operation.operationId === 'createMeetingType'
  )!.operation
  assertContractResponse(createType, created.statusCode, created.json())

  if (request.query?.meetingTypeId) request.query.meetingTypeId = type.id
  if (body?.meetingTypeId) body.meetingTypeId = type.id

  const seedBooking = async (start: string, guestName = 'Example guest') => {
    const saved = await instance.inject({
      method: 'POST',
      url: '/bookings',
      payload: { meetingTypeId: type.id, start, guestName }
    })
    expect(saved.statusCode, 'scenario preparation requires POST /bookings → 201').toBe(201)
    const createBooking = contractOperations.find(
      ({ operation }) => operation.operationId === 'createBooking'
    )!.operation
    assertContractResponse(createBooking, saved.statusCode, saved.json())
  }

  if (scenario.name === 'occupied' || operationId === 'listUpcomingBookings') {
    const requestedGuestName =
      typeof request.query?.guestName === 'string' ? request.query.guestName.trim() : ''
    const guestName =
      ['filtered', 'trimmed-filter'].includes(scenario.name) && requestedGuestName
        ? requestedGuestName
        : 'Example guest'
    await seedBooking('2026-11-18T06:00:00Z', guestName)
  }
  if (operationId === 'getAvailability' && scenario.name === 'empty') {
    // All ten working dates in [2026-11-18, 2026-12-02), 09:00–18:00 Moscow.
    for (const date of [
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-30',
      '2026-12-01'
    ]) {
      await seedBooking(`${date}T06:00:00Z`)
    }
  }
  if (scenario.name === 'stale-selection') {
    vi.setSystemTime(new Date('2026-12-03T09:00:00Z'))
  }

  return request
}
