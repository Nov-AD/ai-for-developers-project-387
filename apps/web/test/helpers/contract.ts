import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { expect } from 'vitest'
import { parse } from 'yaml'

const contract = parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../packages/contract/tsp-output/openapi3/openapi.yaml'),
    'utf8'
  )
)
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)

/** Mock only HTTP, checking the status and body against generated OpenAPI first. */
export function meetingTypesResponse(
  name: 'empty' | 'populated' | 'unknown-query',
  body?: unknown
): Response {
  return meetingTypeResponse('get', name, body)
}

export function meetingTypeResponse(
  method: 'get' | 'post',
  name: string,
  bodyOverride?: unknown
): Response {
  const operation = contract.paths['/meeting-types'][method]
  const scenario = operation['x-contract-scenarios'].find(
    (scenario: { name: string }) => scenario.name === name
  )
  expect(scenario, `${method} /meeting-types: missing example ${name}`).toBeDefined()
  const { status } = scenario
  const body = bodyOverride ?? scenario.body
  const response = operation.responses[String(status)]
  expect(response, `GET /meeting-types: undeclared HTTP ${status}`).toBeDefined()
  const schema = response?.content?.['application/json']?.schema
  expect(schema).toBeDefined()
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(body), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return Response.json(body, { status })
}

export async function assertMeetingTypeRequest(request: Request): Promise<unknown> {
  expect(request.method).toBe('POST')
  expect(new URL(request.url).pathname).toBe('/meeting-types')
  expect(new URL(request.url).search).toBe('')
  expect(request.headers.get('content-type')).toMatch(/^application\/json\b/)
  const body = await request.json()
  const schema =
    contract.paths['/meeting-types'].post.requestBody.content['application/json'].schema
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(body), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return body
}

/** Availability response built from the TypeSpec scenario for `GET /availability`. */
export function availabilityResponse(name: string, body?: unknown): Response {
  const operation = contract.paths['/availability'].get
  const scenario = operation['x-contract-scenarios'].find(
    (candidate: { name: string }) => candidate.name === name
  )
  expect(scenario, `GET /availability: missing example ${name}`).toBeDefined()
  const { status } = scenario
  const payload = body ?? scenario.body
  const response = operation.responses[String(status)]
  const schema = response?.content?.['application/json']?.schema
  expect(schema, `GET /availability: undeclared HTTP ${status}`).toBeDefined()
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(payload), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return Response.json(payload, { status })
}

/** Booking response built from the TypeSpec `created` scenario for `POST /bookings`. */
export function bookingResponse(bodyOverride?: unknown): Response {
  const operation = contract.paths['/bookings'].post
  const scenario = operation['x-contract-scenarios'].find(
    (candidate: { name: string }) => candidate.name === 'created'
  )
  expect(scenario, 'POST /bookings: missing example created').toBeDefined()
  const { status } = scenario
  const payload = bodyOverride ?? scenario.body
  const schema = operation.responses[String(status)].content['application/json'].schema
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(payload), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return Response.json(payload, { status })
}

/** Declared error response for `POST /bookings`, validated against its OpenAPI schema. */
export function bookingErrorResponse(code: 'SLOT_CONFLICT' | 'INVALID_SLOT' | 'VALIDATION_ERROR') {
  const status = code === 'SLOT_CONFLICT' ? '409' : '400'
  const operation = contract.paths['/bookings'].post
  const schema = operation.responses[status].content['application/json'].schema
  const body = { code, message: 'Тестовое сообщение.' }
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(body), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return Response.json(body, { status: Number(status) })
}

export async function assertCreateBookingRequest(
  request: Request
): Promise<Record<string, unknown>> {
  expect(request.method).toBe('POST')
  expect(new URL(request.url).pathname).toBe('/bookings')
  const body = (await request.json()) as Record<string, unknown>
  const schema = contract.paths['/bookings'].post.requestBody.content['application/json'].schema
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(body), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return body
}

/** Upcoming bookings response built from the TypeSpec scenarios for `GET /bookings`. */
export function upcomingResponse(
  name:
    | 'empty'
    | 'populated'
    | 'filtered'
    | 'filtered-empty'
    | 'trimmed-filter'
    | 'empty-filter'
    | 'too-long-filter'
    | 'unknown-query',
  body?: unknown
): Response {
  const operation = contract.paths['/bookings'].get
  const scenario = operation['x-contract-scenarios'].find(
    (candidate: { name: string }) => candidate.name === name
  )
  expect(scenario, `GET /bookings: missing example ${name}`).toBeDefined()
  const { status } = scenario
  const payload = body ?? scenario.body
  const schema = operation.responses[String(status)].content['application/json'].schema
  const validate = ajv.compile({ components: contract.components, ...schema })
  expect(validate(payload), ajv.errorsText(validate.errors ?? undefined)).toBe(true)
  return Response.json(payload, { status })
}
