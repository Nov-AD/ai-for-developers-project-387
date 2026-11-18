import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@doc("""
API for scheduling calls with one predefined owner; no authentication or multiple owners.
Data belongs to one application instance, is stored only in process memory and disappears
on restart. Do not use real personal data: the owner section and API are public.

The owner works Monday–Friday, 09:00–18:00 in Europe/Moscow, without holidays or exceptions.
BOOKING_WINDOW_START is a startup setting: today or tomorrow, default tomorrow; other
values fail startup with a clear error. For every availability/booking request, recompute
now and the owner's local date. The window contains exactly 14 consecutive calendar dates
from that date (or tomorrow), inclusive start and exclusive end; weekends do not extend it.
Compute calendar boundaries in Europe/Moscow, not by adding fixed 24-hour periods.

Slot starts are on the 30-minute grid from 09:00 owner time, strictly later than now.
The end is computed by the server from the meeting type duration, must be within 18:00
on the same working date, and is not required to be on the grid. Intervals are half-open
[start, end): overlap iff a.start < b.end and a.end > b.start; adjacent intervals are allowed.
All bookings of all meeting types block the owner. Revalidate the type, window, weekday,
hours, grid and future start at creation; availability is not a reservation. Checking
overlap and saving are one atomic repository operation, without an asynchronous gap.
Concurrent overlapping requests produce exactly one 201 and the remaining 409 responses.
Nonoverlapping and adjacent requests can all succeed. Multiple processes are unsupported.

All instants are RFC 3339 UTC strings ending in Z. Guests display the full date and time
in the browser's IANA time zone (fallback Europe/Moscow), without trimming or extending
the owner's window. Owners display bookings in Europe/Moscow with an explicit zone label.
All scheduling input is validated by the server. Scheduling operations reject unknown
query parameters and unknown body fields, not silently strip them. Body endpoints require
application/json; malformed JSON or unsupported request format is 400 VALIDATION_ERROR.
The existing health check keeps its original behavior.

The x-contract-scenarios operation extension contains named HTTP examples: request query/body,
expected status and response body. requestValid=false identifies deliberately invalid
requests; all other examples must satisfy the generated request schemas. These examples
are validated against the generated OpenAPI and can be reused as frontend HTTP fixtures.
""")
@service(#{ title: "Call scheduling API" })
@server("http://localhost:3000", "Local development")
@tag("Calendar")
namespace CallScheduling;

@doc("Service health check.")
@route("/health")
@get
@opExample(#{returnType: #{status: "ok"}})
@extension("x-contract-scenarios", #[#{name: "healthy", status: 200, body: #{status: "ok"}}])
op getHealth(): HealthResponse;

@doc("Health check response.")
model HealthResponse {
  @doc("Service status.")
  status: "ok";
}

@doc("Server-generated UUID or a UUID reference. Malformed values are a validation error.")
@format("uuid")
@example("11111111-1111-4111-8111-111111111111")
scalar Uuid extends string;

@doc("RFC 3339 instant in UTC, with seconds and optional fractional seconds, ending in Z; offsets are not accepted.")
@format("date-time")
@example("2026-11-18T06:00:00Z")
@pattern("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")
scalar UtcInstant extends string;

@doc("Calendar date YYYY-MM-DD in the owner's Europe/Moscow time zone, not a UTC instant.")
@format("date")
@example("2026-11-18")
scalar OwnerDate extends string;

@doc("Integer duration in minutes; need not be a multiple of the 30-minute start grid.")
@minValue(1)
@maxValue(540)
@example(45)
scalar DurationMinutes extends int32;

@doc("Name after trimming leading/trailing whitespace: 1–100 characters, never whitespace-only. Stored and returned trimmed.")
@minLength(1)
@maxLength(100)
@pattern("^\\S(?:[\\s\\S]*\\S)?$")
@example("Introduction")
scalar TrimmedName extends string;

@doc("Raw name input. Leading/trailing whitespace is allowed; after trimming it must contain 1–100 characters. The pattern encodes that post-trim limit, rather than incorrectly limiting raw length.")
@pattern("^\\s*\\S(?:[\\s\\S]{0,98}\\S)?\\s*$")
@example(" Introduction ")
scalar NameInput extends string;

@doc("Optional guest name filter. Surrounding whitespace is ignored; an empty value disables the filter. Matching is a case-insensitive substring; more than 100 characters after trimming is invalid.")
@pattern("^\\s*(?:\\S(?:[\\s\\S]{0,98}\\S)?)?\\s*$")
@example(" Alex ")
scalar GuestNameFilter extends string;

@doc("Description, at most 2000 characters; empty is allowed. Preserved as supplied, not trimmed.")
@maxLength(2000)
@example("")
scalar MeetingDescription extends string;

@doc("Full meeting type. UUID is generated by the server; types cannot be edited or deleted.")
@example(exampleType)
model MeetingType {
  @doc("Server-generated identifier.")
  id: Uuid;
  @doc("Trimmed meeting type name.")
  name: TrimmedName;
  @doc("Meeting purpose; empty when omitted during creation.")
  description: MeetingDescription;
  @doc("Length of each slot of this type.")
  durationMinutes: DurationMinutes;
}

@doc("Only these fields are accepted. Trim name before validating its length; do not strip unknown properties.")
@example(#{name: " Introduction ", durationMinutes: 45})
model CreateMeetingTypeInput {
  ...Record<never>;
  @doc("Meeting type name; validated after trimming.")
  name: NameInput;
  @doc("Optional description; defaults to the empty string.")
  description?: MeetingDescription = "";
  @doc("Integer duration, 1–540 minutes inclusive.")
  durationMinutes: DurationMinutes;
}

@doc("Available half-open interval; end equals start plus the selected meeting type's duration.")
@example(#{start: exampleStart, end: exampleEnd})
model Slot {
  @doc("Future start on the owner's 30-minute grid.")
  start: UtcInstant;
  @doc("Exclusive end, at or before 18:00 on the same owner working date.")
  end: UtcInstant;
}

@doc("Availability for the requested meeting type. Slots sorted by start ascending; no duplicates. Empty slots is success, not a loading/network error.")
@example(#{ownerTimeZone: "Europe/Moscow", windowStartDate: "2026-11-18", windowEndDate: "2026-12-02", slots: #[]})
model Availability {
  @doc("Owner's fixed IANA zone, used for scheduling and window boundaries.")
  ownerTimeZone: "Europe/Moscow";
  @doc("Inclusive first owner calendar date in the 14-day window.")
  windowStartDate: OwnerDate;
  @doc("Exclusive date, exactly 14 calendar dates after windowStartDate.")
  windowEndDate: OwnerDate;
  @doc("Only future intervals fully fitting the working hours and not overlapping any booking, across all meeting types.")
  slots: Slot[];
}

@doc("Creation accepts only the type reference, selected UTC start and guest name. End, duration and booking UUID cannot be supplied.")
@example(exampleBookingInput)
model CreateBookingInput {
  ...Record<never>;
  @doc("Existing meeting type reference.")
  meetingTypeId: Uuid;
  @doc("Selected start. Revalidated against the current schedule/window/now before saving.")
  start: UtcInstant;
  @doc("Guest name, trimmed before validation and storage. No email, phone or comment is collected.")
  guestName: NameInput;
}

@doc("Saved booking and complete meeting type details for confirmation; confirmation is not a separately retrievable public resource.")
@example(exampleBooking)
model Booking {
  @doc("Server-generated booking UUID.")
  id: Uuid;
  @doc("Referenced meeting type, including name and duration for the confirmation.")
  meetingType: MeetingType;
  @doc("Trimmed guest name.")
  guestName: TrimmedName;
  @doc("Saved start in UTC.")
  start: UtcInstant;
  @doc("Exclusive end in UTC, computed by the server.")
  end: UtcInstant;
}

@doc("Unified error envelope. Code is stable and machine-readable; message is human-readable. Field errors are optional arrays keyed by input field/parameter name.")
model ApiError<Code extends string> {
  @doc("Machine code; interpreted together with the documented HTTP status.")
  code: Code;
  @doc("Human-readable explanation.")
  @minLength(1)
  message: string;
  @doc("Optional input errors; use body/query field names (including unknown keys).")
  fieldErrors?: Record<string[]>;
}

@doc("Malformed JSON/UUID/UTC instant, missing or invalid fields, unknown body fields/query parameters, or unsupported request shape.")
@example(#{code: "VALIDATION_ERROR", message: "Invalid input.", fieldErrors: #{name: #["Enter a name."]}})
model ValidationError extends ApiError<"VALIDATION_ERROR"> {}

@doc("Selection is stale or violates the schedule: outside current window, weekend, off-grid, outside hours, or start <= now. Refresh availability and clear invalid selection; preserve guest name/type.")
@example(#{code: "INVALID_SLOT", message: "The selected start is no longer in the booking window."})
model InvalidSlotError extends ApiError<"INVALID_SLOT"> {}

@doc("Well-formed UUID does not identify an existing meeting type.")
@example(#{code: "MEETING_TYPE_NOT_FOUND", message: "Meeting type not found."})
model MeetingTypeNotFoundError extends ApiError<"MEETING_TYPE_NOT_FOUND"> {}

@doc("Another booking overlaps this interval, including one concurrently created for a different type. Clear slot, preserve name/type and refresh availability; do not show confirmation.")
@example(#{code: "SLOT_CONFLICT", message: "This slot has been taken. Please choose another."})
model SlotConflictError extends ApiError<"SLOT_CONFLICT"> {}

@doc("Input rejected; VALIDATION_ERROR is field/format validation, INVALID_SLOT is an invalid or stale schedule selection.")
model BadRequest<Body = ValidationError> {
  @statusCode statusCode: 400;
  @body body: Body;
}

@doc("Requested meeting type does not exist.")
model NotFound {
  @statusCode statusCode: 404;
  @body body: MeetingTypeNotFoundError;
}

@doc("Selected interval overlaps an existing booking.")
model Conflict {
  @statusCode statusCode: 409;
  @body body: SlotConflictError;
}

@doc("Resource successfully saved.")
model Created<Body> {
  @statusCode statusCode: 201;
  @body body: Body;
}

const exampleTypeId = "11111111-1111-4111-8111-111111111111";
const exampleStart = "2026-11-18T06:00:00Z";
const exampleEnd = "2026-11-18T06:45:00Z";
const exampleType = #{
  id: exampleTypeId,
  name: "Introduction",
  description: "",
  durationMinutes: 45
};
const exampleBooking = #{
  id: "22222222-2222-4222-8222-222222222222",
  meetingType: exampleType,
  guestName: "Alex",
  start: exampleStart,
  end: exampleEnd
};
const exampleBookingInput = #{
  meetingTypeId: exampleTypeId,
  start: exampleStart,
  guestName: " Alex "
};

@doc("Return all meeting types in creation order, with UUID ascending as the stable tie-breaker. New types are visible immediately. The initial store is empty. No query parameters are accepted.")
@route("/meeting-types")
@get
@opExample(#{returnType: #[]}, #{title: "Empty list"})
@opExample(#{returnType: #[exampleType]}, #{title: "Created types"})
@opExample(#{returnType: #{statusCode: 400, body: #{code: "VALIDATION_ERROR", message: "Unknown query parameter."}}})
@extension("x-contract-scenarios", #[
  #{name: "empty", status: 200, body: #[]},
  #{name: "populated", status: 200, body: #[exampleType]},
  #{name: "unknown-query", request: #{query: #{extra: "x"}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Unknown query parameter: extra.", fieldErrors: #{extra: #["Unknown parameter."]}}}
])
op listMeetingTypes(): MeetingType[] | BadRequest;

@doc("Create a meeting type; trim name, validate all fields, then generate UUID. Omitted description becomes empty. No query parameters are accepted. HTTP 201 contains the complete saved type.")
@route("/meeting-types")
@post
@opExample(#{parameters: #{body: #{name: " Introduction ", durationMinutes: 45}},
  returnType: #{statusCode: 201, body: exampleType}})
@opExample(#{returnType: #{statusCode: 400, body: #{code: "VALIDATION_ERROR", message: "Invalid meeting type."}}})
@extension("x-contract-scenarios", #[
  #{name: "created", request: #{body: #{name: " Introduction ", durationMinutes: 45}},
    status: 201, body: exampleType},
  #{name: "invalid-duration", request: #{body: #{name: "Introduction", durationMinutes: 0}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Invalid meeting type.", fieldErrors: #{durationMinutes: #["Must be an integer from 1 to 540."]}}},
  #{name: "unknown-field", request: #{body: #{name: "Introduction", durationMinutes: 45, extra: true}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Unknown field: extra.", fieldErrors: #{extra: #["Unknown field."]}}}
])
op createMeetingType(@doc("Meeting type fields to validate and save.") @body body: CreateMeetingTypeInput): Created<MeetingType> | BadRequest;

@doc("Compute current availability for the required meetingTypeId query parameter; no other parameters accepted. Use the service-wide owner schedule/window/overlap rules on every request. Missing/malformed UUID is 400; well-formed unknown UUID is 404. Empty availability is 200 with an empty slots array.")
@route("/availability")
@get
@opExample(#{parameters: #{meetingTypeId: exampleTypeId},
  returnType: #{ownerTimeZone: "Europe/Moscow", windowStartDate: "2026-11-18", windowEndDate: "2026-12-02",
    slots: #[#{start: exampleStart, end: exampleEnd}]}})
@opExample(#{returnType: #{statusCode: 400, body: #{code: "VALIDATION_ERROR", message: "Invalid meeting type identifier."}}})
@opExample(#{returnType: #{statusCode: 404, body: #{code: "MEETING_TYPE_NOT_FOUND", message: "Meeting type not found."}}})
@extension("x-contract-scenarios", #[
  #{name: "available", request: #{query: #{meetingTypeId: exampleTypeId}}, status: 200,
    body: #{ownerTimeZone: "Europe/Moscow", windowStartDate: "2026-11-18", windowEndDate: "2026-12-02",
      slots: #[#{start: exampleStart, end: exampleEnd}]}},
  #{name: "empty", request: #{query: #{meetingTypeId: exampleTypeId}}, status: 200,
    body: #{ownerTimeZone: "Europe/Moscow", windowStartDate: "2026-11-18", windowEndDate: "2026-12-02", slots: #[]}},
  #{name: "missing-type", request: #{query: #{}}, requestValid: false, status: 400,
    body: #{code: "VALIDATION_ERROR", message: "meetingTypeId is required.", fieldErrors: #{meetingTypeId: #["Required."]}}},
  #{name: "malformed-type", request: #{query: #{meetingTypeId: "not-a-uuid"}}, requestValid: false, status: 400,
    body: #{code: "VALIDATION_ERROR", message: "Invalid meeting type identifier."}},
  #{name: "unknown-type", request: #{query: #{meetingTypeId: "99999999-9999-4999-8999-999999999999"}}, status: 404,
    body: #{code: "MEETING_TYPE_NOT_FOUND", message: "Meeting type not found."}}
])
op getAvailability(@doc("Required UUID of the selected meeting type.") @query meetingTypeId: Uuid): Availability | BadRequest | NotFound;

@doc("""
Revalidate the current type, window, schedule, future start and overlaps, atomically save
and return HTTP 201 with server-computed end and meeting type details. Validation is 400
VALIDATION_ERROR, then unknown type is 404 MEETING_TYPE_NOT_FOUND, then invalid schedule
selection is 400 INVALID_SLOT, then overlap is 409 SLOT_CONFLICT. No query parameters.
Only a saved response confirms success. Do not retry creating requests automatically.
If the network loses the response, creation may have succeeded: show an uncertain result,
refresh availability when connection returns and do not claim the booking is absent.
After success refresh availability/upcoming lists; after conflict preserve name/type and
refresh availability. There is no idempotency key or booking lookup/confirmation endpoint.
""")
@route("/bookings")
@post
@opExample(#{parameters: #{body: exampleBookingInput}, returnType: #{statusCode: 201, body: exampleBooking}})
@opExample(#{returnType: #{statusCode: 400, body: #{code: "INVALID_SLOT", message: "The selected start is no longer in the booking window."}}})
@opExample(#{returnType: #{statusCode: 404, body: #{code: "MEETING_TYPE_NOT_FOUND", message: "Meeting type not found."}}})
@opExample(#{returnType: #{statusCode: 409, body: #{code: "SLOT_CONFLICT", message: "This slot has been taken. Please choose another."}}})
@extension("x-contract-scenarios", #[
  #{name: "created", request: #{body: exampleBookingInput}, status: 201, body: exampleBooking},
  #{name: "invalid-name", request: #{body: #{meetingTypeId: exampleTypeId, start: exampleStart, guestName: ""}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Invalid guest name.", fieldErrors: #{guestName: #["Enter a name."]}}},
  #{name: "stale-selection", request: #{body: exampleBookingInput}, status: 400,
    body: #{code: "INVALID_SLOT", message: "The selected start is no longer in the booking window."}},
  #{name: "unknown-type", request: #{body: #{meetingTypeId: "99999999-9999-4999-8999-999999999999", start: exampleStart, guestName: "Alex"}},
    status: 404, body: #{code: "MEETING_TYPE_NOT_FOUND", message: "Meeting type not found."}},
  #{name: "occupied", request: #{body: exampleBookingInput}, status: 409,
    body: #{code: "SLOT_CONFLICT", message: "This slot has been taken. Please choose another."}}
])
op createBooking(@doc("Selected meeting type/start and guest name; no server-owned fields.") @body body: CreateBookingInput): Created<Booking> | BadRequest<ValidationError | InvalidSlotError> | NotFound | Conflict;

@doc("""
Return all types' bookings whose end is strictly later than now, including calls already
in progress; exclude calls ending exactly now. Recompute now per request. Sort by start
ascending, then UUID ascending. Empty is 200 []. Display in Europe/Moscow with an explicit
time zone. Refresh on owner page entry, focus and manual refresh; no polling required.
The optional guestName query parameter trims surrounding whitespace, ignores an empty
value, matches a case-insensitive substring and rejects values longer than 100 characters
after trimming with 400 VALIDATION_ERROR. The optional meetingTypeId query parameter
narrows the list to bookings of one type; a malformed UUID is 400 VALIDATION_ERROR,
while a well-formed UUID with no matching type is still 200 [] because this is a filter,
not a lookup of one type. The optional fromDate and toDate query parameters are inclusive
YYYY-MM-DD calendar-date bounds for a booking's start in Europe/Moscow, not UTC or the
browser zone; either bound may be supplied alone. Empty date strings, malformed dates and
fromDate later than toDate are 400 VALIDATION_ERROR. All active filters combine with AND.
Unknown query parameters are still rejected.
""")
@route("/bookings")
@get
@opExample(#{returnType: #[]}, #{title: "Empty list"})
@opExample(#{returnType: #[exampleBooking]}, #{title: "Upcoming and ongoing calls"})
@opExample(#{parameters: #{guestName: "Alex"}, returnType: #[exampleBooking]}, #{title: "Filtered by guest name"})
@opExample(#{parameters: #{meetingTypeId: exampleTypeId}, returnType: #[exampleBooking]}, #{title: "Filtered by meeting type"})
@opExample(#{parameters: #{guestName: "Alex", meetingTypeId: exampleTypeId}, returnType: #[exampleBooking]}, #{title: "Filtered by guest name and meeting type"})
@opExample(#{parameters: #{fromDate: "2026-11-18", toDate: "2026-11-18"}, returnType: #[exampleBooking]}, #{title: "Filtered by inclusive date range"})
@opExample(#{parameters: #{fromDate: "2026-11-19"}, returnType: #[]}, #{title: "Filtered from a later date"})
@opExample(#{returnType: #{statusCode: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}}})
@extension("x-contract-scenarios", #[
  #{name: "empty", status: 200, body: #[]},
  #{name: "populated", status: 200, body: #[exampleBooking]},
  #{name: "filtered", request: #{query: #{guestName: "Alex"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-empty", request: #{query: #{guestName: "Nobody"}}, status: 200, body: #[]},
  #{name: "trimmed-filter", request: #{query: #{guestName: "  Alex  "}}, status: 200, body: #[exampleBooking]},
  #{name: "empty-filter", request: #{query: #{guestName: "   "}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-by-type", request: #{query: #{meetingTypeId: exampleTypeId}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-by-type-and-name", request: #{query: #{meetingTypeId: exampleTypeId, guestName: "Alex"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-from-date", request: #{query: #{fromDate: "2026-11-18"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-to-date", request: #{query: #{toDate: "2026-11-18"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-date-range", request: #{query: #{fromDate: "2026-11-18", toDate: "2026-11-18"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-by-date-and-name", request: #{query: #{guestName: "Alex", fromDate: "2026-11-18", toDate: "2026-11-18"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-by-all-filters", request: #{query: #{meetingTypeId: exampleTypeId, guestName: "Alex", fromDate: "2026-11-18", toDate: "2026-11-18"}}, status: 200, body: #[exampleBooking]},
  #{name: "filtered-date-empty", request: #{query: #{fromDate: "2026-11-19", toDate: "2026-11-19"}}, status: 200, body: #[]},
  #{name: "empty-date-filter", request: #{query: #{fromDate: ""}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}},
  #{name: "malformed-date-filter", request: #{query: #{fromDate: "18.11.2026"}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}},
  #{name: "reversed-date-range", request: #{query: #{fromDate: "2026-11-19", toDate: "2026-11-18"}},
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}},
  #{name: "unknown-type-filter", request: #{query: #{meetingTypeId: "99999999-9999-4999-8999-999999999999"}}, status: 200, body: #[]},
  #{name: "too-long-filter", request: #{query: #{guestName: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}},
  #{name: "malformed-type-filter", request: #{query: #{meetingTypeId: "not-a-uuid"}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}},
  #{name: "unknown-query", request: #{query: #{extra: "x"}}, requestValid: false,
    status: 400, body: #{code: "VALIDATION_ERROR", message: "Проверьте параметры запроса."}}
])
op listUpcomingBookings(
  @doc("Optional guest name filter; case-insensitive substring after trimming. Empty value disables the filter.") @query guestName?: GuestNameFilter,
  @doc("Optional meeting type filter; malformed UUID is 400, unknown well-formed UUID is 200 [].") @query meetingTypeId?: Uuid,
  @doc("Optional inclusive lower bound for the booking start's calendar date in Europe/Moscow; empty or malformed dates are 400.") @query fromDate?: OwnerDate,
  @doc("Optional inclusive upper bound for the booking start's calendar date in Europe/Moscow; empty or malformed dates are 400, and fromDate > toDate is 400.") @query toDate?: OwnerDate
): Booking[] | BadRequest;
