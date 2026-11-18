import Fastify, { type FastifyInstance, type HTTPMethods } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.ts'
import {
  assertContractResponse,
  contract,
  contractOperations,
  type HttpMethod
} from './helpers/contract.ts'
import { prepareContractScenario } from './helpers/contract-scenarios.ts'

/** OpenAPI uses `{id}` for path parameters, Fastify uses `:id`. */
function toFastifyUrl(openapiPath: string): string {
  return openapiPath.replace(/\{([^}]+)\}/g, ':$1')
}

const instances: FastifyInstance[] = []

async function build(): Promise<{
  instance: FastifyInstance
  routes: Array<{ method: HttpMethod; url: string }>
}> {
  const instance = Fastify()
  const routes: Array<{ method: HttpMethod; url: string }> = []

  instance.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      routes.push({
        method: method.toLowerCase() as HttpMethod,
        url: route.url
      })
    }
  })

  await instance.register(app)
  await instance.ready()
  instances.push(instance)

  return { instance, routes }
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async (instance) => instance.close()))
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('API contract', () => {
  it('is OpenAPI 3.1', () => {
    expect(contract.openapi).toBe('3.1.0')
  })

  it.each(contractOperations)(
    'implements $method $path ($operation.operationId)',
    async ({ method, path }) => {
      const { instance } = await build()

      expect(
        instance.hasRoute({
          method: method.toUpperCase() as HTTPMethods,
          url: toFastifyUrl(path)
        }),
        `${method.toUpperCase()} ${path} is declared in the contract but not implemented`
      ).toBe(true)
    }
  )

  it('exposes no routes missing from the contract', async () => {
    const { routes } = await build()
    const declared = new Set(
      contractOperations.map(({ method, path }) => `${method.toUpperCase()} ${toFastifyUrl(path)}`)
    )

    for (const route of routes) {
      // Fastify adds HEAD routes for GET handlers and CORS adds `OPTIONS *`
      // for preflight requests; neither is an operation of the contract.
      if (route.method === 'head' || route.url === '*') continue

      expect(
        declared,
        `${route.method.toUpperCase()} ${route.url} is implemented but not declared in the contract`
      ).toContain(`${route.method.toUpperCase()} ${route.url}`)
    }
  })

  const scenarios = contractOperations.flatMap(({ method, path, operation }) =>
    (operation['x-contract-scenarios'] ?? []).map((scenario) => ({
      method,
      path,
      operation,
      scenario,
      label: `${method.toUpperCase()} ${path}: ${scenario.name} → ${scenario.status}`
    }))
  )

  it.each(scenarios)(
    '$label responds with the declared status and JSON schema',
    async ({ method, path, operation, scenario }) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-17T09:00:00Z'))
      vi.stubEnv('BOOKING_WINDOW_START', 'tomorrow')
      const { instance } = await build()
      expect(
        instance.hasRoute({
          method: method.toUpperCase() as HTTPMethods,
          url: toFastifyUrl(path)
        }),
        `${method.toUpperCase()} ${path} is declared in the contract but not implemented`
      ).toBe(true)
      const request = await prepareContractScenario(instance, operation.operationId, scenario)
      const response = await instance.inject({
        method: method.toUpperCase() as HTTPMethods,
        url: path,
        query: request.query as Record<string, string> | undefined,
        ...(request.body === undefined ? {} : { payload: request.body as Record<string, unknown> })
      })

      expect(response.statusCode).toBe(scenario.status)
      expect(response.headers['content-type']).toMatch(/^application\/json\b/)
      const body: unknown = response.json()
      assertContractResponse(operation, response.statusCode, body)
      if (scenario.status >= 400) {
        expect(body).toMatchObject({ code: (scenario.body as { code: string }).code })
      }
      if (scenario.name === 'empty') {
        if (operation.operationId === 'getAvailability') expect(body).toMatchObject({ slots: [] })
        else expect(body).toEqual([])
      }
      if (
        [
          'populated',
          'filtered',
          'trimmed-filter',
          'empty-filter',
          'filtered-by-type',
          'filtered-by-type-and-name',
          'filtered-from-date',
          'filtered-to-date',
          'filtered-date-range',
          'filtered-by-date-and-name',
          'filtered-by-all-filters'
        ].includes(scenario.name)
      ) {
        expect(body).toHaveLength(1)
      }
      if (['filtered-empty', 'filtered-date-empty'].includes(scenario.name))
        expect(body).toEqual([])
      if (scenario.name === 'available') {
        expect((body as { slots: unknown[] }).slots.length).toBeGreaterThan(0)
      }
    }
  )
})
