import { z } from 'zod'
import { type FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { components, operations } from '../generated/openapi.js'
import { addMinutes } from 'date-fns'
import { isBookableStart, isOwnerDate, ownerWindow, utcInstant } from '../schedule.ts'

const instant = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/)

const meetingType = z.object({
  id: z.uuid(),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^\S(?:[\s\S]*\S)?$/),
  description: z.string().max(2000),
  durationMinutes: z.int().min(1).max(540)
}) satisfies z.ZodType<components['schemas']['MeetingType']>

const booking = z.object({
  id: z.uuid(),
  meetingType,
  guestName: z.string().min(1).max(100),
  start: instant,
  end: instant
}) satisfies z.ZodType<components['schemas']['Booking']>

const validationError = z.object({
  code: z.literal('VALIDATION_ERROR'),
  message: z.string().min(1),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional()
}) satisfies z.ZodType<components['schemas']['ValidationError']>

const invalidSlotError = z.object({
  code: z.literal('INVALID_SLOT'),
  message: z.string().min(1),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional()
}) satisfies z.ZodType<components['schemas']['InvalidSlotError']>

const notFoundError = z.object({
  code: z.literal('MEETING_TYPE_NOT_FOUND'),
  message: z.string().min(1),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional()
}) satisfies z.ZodType<components['schemas']['MeetingTypeNotFoundError']>

const conflictError = z.object({
  code: z.literal('SLOT_CONFLICT'),
  message: z.string().min(1),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional()
}) satisfies z.ZodType<components['schemas']['SlotConflictError']>

const createInput = z.strictObject({
  meetingTypeId: z.uuid(),
  start: instant,
  guestName: z.string().trim().min(1).max(100)
}) satisfies z.ZodType<components['schemas']['CreateBookingInput']>

const ownerDateFilter = z.string().refine(isOwnerDate)

const upcomingFilters = z
  .strictObject({
    guestName: z.string().trim().max(100).optional(),
    meetingTypeId: z.uuid().optional(),
    fromDate: ownerDateFilter.optional(),
    toDate: ownerDateFilter.optional()
  })
  .refine(
    ({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate,
    'fromDate must not be later than toDate'
  ) satisfies z.ZodType<NonNullable<operations['listUpcomingBookings']['parameters']['query']>>

const bookingRoutes: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  fastify.post(
    '/bookings',
    {
      schema: {
        querystring: z.strictObject({}),
        body: createInput,
        response: {
          201: booking,
          400: z.union([validationError, invalidSlotError]),
          404: notFoundError,
          409: conflictError
        }
      },
      errorHandler: (error, _request, reply) => {
        if (
          error.validation ||
          error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
          error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
          error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
        ) {
          return reply.code(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Проверьте тип встречи, начало и имя гостя.'
          })
        }
        throw error
      }
    },
    async (request, reply) => {
      const meetingType = fastify.meetingTypes.find(request.body.meetingTypeId)
      if (!meetingType) {
        return reply
          .code(404)
          .send({ code: 'MEETING_TYPE_NOT_FOUND', message: 'Тип встречи не найден.' })
      }

      // Availability is never a reservation: revalidate against the current window and time.
      const now = new Date()
      const window = ownerWindow(fastify.bookingWindowStart, now)
      const start = new Date(request.body.start)
      if (!isBookableStart({ start, durationMinutes: meetingType.durationMinutes, window, now })) {
        return reply.code(400).send({
          code: 'INVALID_SLOT',
          message: 'Выбранное время больше недоступно. Обновите свободные слоты.'
        })
      }

      const end = utcInstant(addMinutes(start, meetingType.durationMinutes))
      const result = fastify.bookings.save({
        meetingType,
        guestName: request.body.guestName,
        start: utcInstant(start),
        end
      })
      if (result.status === 'conflict') {
        return reply.code(409).send({
          code: 'SLOT_CONFLICT',
          message: 'Это время уже занято. Выберите другой слот.'
        })
      }

      return reply.code(201).send(result.booking)
    }
  )

  fastify.get(
    '/bookings',
    {
      schema: {
        querystring: upcomingFilters,
        response: { 200: z.array(booking), 400: validationError }
      },
      errorHandler: (error, _request, reply) => {
        if (error.validation) {
          return reply.code(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Проверьте параметры запроса.'
          })
        }
        throw error
      }
    },
    async (request) => {
      // Recomputed per request: the window advances and finished calls disappear.
      const { guestName, meetingTypeId, fromDate, toDate } = request.query
      return fastify.bookings.upcoming(new Date(), {
        ...(guestName ? { guestName } : {}),
        ...(meetingTypeId ? { meetingTypeId } : {}),
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {})
      })
    }
  )
}

export default bookingRoutes
