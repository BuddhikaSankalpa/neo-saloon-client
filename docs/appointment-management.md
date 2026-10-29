# Appointment backend

This module uses Next.js Route Handlers, Zod DTOs, the existing User.privileges array,
and PostgreSQL through Prisma. Roles are descriptive only: ADMIN, STAFF and CUSTOMER
do not grant any permission. No frontend, payments, inventory usage, general customer
cancellation, or shared-room/equipment scheduling is included.

## Setup

1. Review `prisma/migrations/20261013000000_appointment_management/migration.sql`.
   It creates the appointment tables, indexes, foreign keys and domain checks; it
   does not modify existing user/product data or grant privileges.
2. Apply reviewed pending migrations using your normal deployment process
   (`npx prisma migrate deploy`), then run `npx prisma generate`. **The implementation
   work did not apply migrations to your configured database.** Check all pending
   migrations before deployment, since migrate deploy applies all pending entries.
3. Configure a nonempty `JOSE_SECRET` and the policy settings below. Existing login
   tokens without an expiration are intentionally rejected; users must log in again.
4. An existing authorized operator must explicitly grant the management privileges
   below. If no account has grant authority, bootstrap the chosen operator through
   your controlled database administration process. No account/email/role is auto-promoted.
5. Use `PUT /api/scheduling/business` for business hours. For every bookable staff
   account, grant `appointments:receive`, configure their schedule with
   `PUT /api/scheduling/{userId}`, and configure qualified services with
   `PUT /api/scheduling/{userId}/services`.
6. Existing customers need explicit grants of the self-service privileges below.
   Registration grants these to new accounts from a server-owned constant; clients
   cannot supply their privileges. There is intentionally no blanket existing-user migration.

## Privileges

| Privilege | Scope |
| --- | --- |
| `services:read` | Active, listed services and active variants |
| `services:read:all` | Catalog management reads including archived/unlisted entries |
| `services:add` | Create services |
| `services:edit` | Edit/archive services and create/edit/deactivate variants |
| `appointments:availability:read` | Own customer availability, no other customers' data |
| `appointments:add:own` | Book for the authenticated account |
| `appointments:read:own` | Own appointments and history |
| `appointments:read:assigned` | Currently assigned appointments and history |
| `appointments:read:all` | All appointments and history |
| `appointments:edit:own` | Own booked appointments before the cutoff |
| `appointments:edit:assigned` | Currently assigned booked appointments, with reason |
| `appointments:edit:all` | Any booked appointment, with reason |
| `appointments:assign` | Assign a qualified, available staff member |
| `appointments:takeover` | Become the assigned staff member when qualified/available |
| `appointments:receive` | Eligibility for assignment, in addition to qualifications and hours |
| `appointments:execute:assigned` | Start/complete a currently assigned appointment |
| `appointments:no-show:assigned` | Mark customer absence on a currently assigned appointment |
| `consultations:record` | Record an outcome for a customer and specified services |
| `consultations:read:own` | Own consultation records |
| `consultations:read:all` | All consultation records |
| `scheduling:manage` | Manage/read working hours, qualifications, time off |
| `users:privileges:edit` | Grant/revoke user privileges, additionally requiring existing `users:edit` |

New registrations receive `services:read`, `appointments:availability:read`,
`appointments:add:own`, `appointments:read:own`, `appointments:edit:own`, and
`consultations:read:own`. Read privileges do not imply mutation privileges and vice versa.
Ownership/assignment alone grants nothing. Token privileges are ignored; current
account status and privileges are loaded from the database on each authenticated request,
and checked again inside appointment mutation transactions.

Grant removal takes effect on the next request. Revoking a staff account's receive
privilege or suspending it does not rewrite existing reservations; explicitly reassign
its upcoming bookings. Assignment/qualification checks will prevent it accepting new bookings.

## Configurable policy

Set environment variables consistently on every application instance. Invalid values
fail closed. Restart instances after changes. Review future reservations before changing
the timezone; it changes how all stored local schedules are interpreted.

| Setting | Default | Meaning |
| --- | --- | --- |
| `SALOON_TIMEZONE` | `Asia/Colombo` | IANA timezone for local working-hour definitions |
| `APPOINTMENT_BUFFER_MINUTES` | `0` | Reserved minutes after services; snapshotted when booking |
| `APPOINTMENT_EDIT_CUTOFF_MINUTES` | `60` | Customer changes require more than this many minutes before the existing start |
| `APPOINTMENT_NO_SHOW_GRACE_MINUTES` | `15` | Earliest absence cancellation after scheduled start |
| `APPOINTMENT_ADVANCE_DAYS` | `90` | Maximum days ahead for booking/rescheduling |
| `CONSULTATION_VALIDITY_DAYS` | `90` | Default clearance validity from completion; authorized recorder may supply explicit expiry |
| `APPOINTMENT_SLOT_MINUTES` | `15` | Availability search increment; direct bookings accept any whole minute |

Missing business or staff hours mean **closed**. One staff member performs all selected
services sequentially. Maximum appointment service duration is 12 hours. Each service
may occur once per appointment. If active variants exist, one must be selected. All
variants inherit the parent service fee and duration; variant price/duration input is rejected.
An appointment cannot mix currencies. Money uses integer minor units (`250000` = LKR 2,500.00).

Schedule format (weekday 0 = Sunday; minute 1440 is midnight at end of day):

```json
{
  "weekly": [
    { "weekday": 1, "startMinute": 540, "endMinute": 720 },
    { "weekday": 1, "startMinute": 780, "endMinute": 1020 }
  ],
  "exceptions": [
    { "date": "2030-01-14", "windows": [] }
  ]
}
```

Each PUT replaces that schedule. Omitted weekdays are closed. An exception fully
replaces that date's weekly windows; an empty array marks a holiday. Split windows
represent breaks. Windows on successive days can represent overnight work. Staff
must be inside both their own and the business schedule, including the buffer.
Schedule/qualification/time-off mutations roll back if an existing active reservation
would no longer fit. Reassign/reschedule affected appointments first.

## API contract

Responses use `{ "data": ... }`; failures use `{ "message": ... }` and validation
errors also return `issues`. New DTOs reject unknown body/query fields. IDs must be UUIDs.
Timestamps must be ISO 8601 with `Z` or an explicit offset; booking times must be whole minutes.
Lists default to page 1 / 20 items, maximum 100 per page. List objects include pagination.
All new API responses containing data use private/no-store caching.

| Method/path | Request |
| --- | --- |
| GET `/api/services` | `scope=listed` (default) or `all`, optional `search`, pagination |
| POST `/api/services` | `name`, `durationMinutes`, `feeMinor`; optional description, currency, status, listed, requiresConsultation |
| GET `/api/services/{id}` | Same catalog scope; variants are included |
| PATCH `/api/services/{id}` | Subset of service attributes |
| DELETE `/api/services/{id}` | Archive/unlist, never physically delete |
| POST `/api/services/{id}/variants` | `name`, optional description/active |
| PATCH `/api/services/{id}/variants/{variantId}` | Name/description/active fields |
| DELETE `/api/services/{id}/variants/{variantId}` | Deactivate |
| POST `/api/availability` | `from`, `to`, `services`, optional preferredStaffId; maximum 7-day search |
| POST `/api/appointments` | Booking body below; required `Idempotency-Key` header (1–100 letters/digits/underscore/hyphen) |
| GET `/api/appointments` | Explicit `scope=own` (default), `assigned`, or `all`; filters below |
| GET `/api/appointments/{id}` | Scoped appointment detail |
| PATCH `/api/appointments/{id}` | Required `version`; optional startsAt/services/preferredStaffId/customerNotes/reason |
| POST `/api/appointments/{id}/actions` | Action body below |
| GET `/api/appointments/{id}/history` | Pagination; same read scope as appointment |
| POST `/api/consultations` | customerId, serviceIds, completedAt, approved; optional validUntil/notes |
| GET `/api/consultations` | Optional customerId and pagination; own/all consultation privilege applies |
| GET/PUT `/api/scheduling/business` | Business schedule |
| GET/PUT `/api/scheduling/{staffId}` | Staff schedule |
| GET/PUT `/api/scheduling/{staffId}/services` | PUT `{ "serviceIds": ["uuid"] }` replaces qualifications |
| GET/POST `/api/scheduling/{staffId}/time-off` | GET pagination; POST startsAt/endsAt/reason |
| DELETE `/api/scheduling/{staffId}/time-off/{timeOffId}` | Remove the specified time-off entry |

Booking example (replace IDs with actual UUIDs):

```json
{
  "startsAt": "2030-01-08T10:00:00+05:30",
  "services": [{ "serviceId": "uuid", "variantId": "uuid" }],
  "preferredStaffId": null,
  "customerNotes": "Optional request"
}
```

The customer is always the authenticated account. Prices, durations, statuses and
actual staff assignment cannot be supplied by the client. A repeated idempotency key
with the same normalized payload returns the existing appointment; a different payload
returns 409. Replay is subject to current booking privilege and returns current state.

Appointment filters: `customerId`, `staffId`, `serviceId`, `status`, `placedFrom`,
`placedTo`, `scheduledFrom`, `scheduledTo`, `pageNumber`, `pageSize`.
Placed dates refer to creation time, scheduled dates to appointment start. Bounds are
inclusive-from/exclusive-to. Access scope is ANDed with filters before both counting
and selecting. Staff filtering refers to current assignment. No other customer's
appointment details or consultation notes are returned by availability.

Action bodies always include the current integer `version`:

```json
{ "action": "reschedule", "version": 1, "startsAt": "2030-01-09T10:00:00+05:30", "reason": "Customer requested a later day" }
```

Other action values: `reassign` (staffId + reason), `takeover` (reason), `start`,
`complete`, `no-show` (reason). PATCH by operational staff requires a reason.
Staff preference changes additionally require own-edit ownership or `appointments:assign`.
Every mutation increments version and records before/after snapshots and actor in history.

## Booking and lifecycle decisions

- Explicit preferred staff must be qualified and available; no silent substitution.
  Automatic assignment chooses the eligible staff with least reserved workload for
  appointments starting on that local day, breaking ties by user ID.
- Updates retain the assigned staff unless a new preference or explicit null is sent.
  Null asks for automatic assignment. Reassign/takeover preserve the customer's original preference.
- Unchanged service/variant selections preserve historical fees, names and durations
  during rescheduling. New selections use current catalog values. Service archival does
  not rewrite existing appointments. It prevents booking/rescheduling those selections;
  notes and execution of an already booked service remain possible subject to other checks.
- Required consultations must be completed before booking, approved for every covered
  service, and valid through the service end. The latest completed outcome for each
  service wins; a denial or expired outcome does not fall back to an older approval.
  Records are append-only; record a new outcome to supersede an old one. Notes are visible
  to the customer and users with the explicit all-consultations read privilege.
- Consultation requirements are rechecked on rescheduling, service changes, assignment
  changes and starting. A later denial does not silently cancel a booking; the appointment
  must be resolved by an authorized operator, and it cannot start without valid clearance.
- Lifecycle: BOOKED → IN_PROGRESS → COMPLETED, or BOOKED → CANCELLED with
  CUSTOMER_ABSENT. Rescheduling retains BOOKED. Ordinary edits/transfers are only allowed
  before starting. Actual times come from the server, never request bodies.
- Start cannot occur before scheduled time. A late start checks its projected duration
  against opening hours, customer/staff conflicts and consultation validity. It never
  moves another booking. IN_PROGRESS is conservatively treated as occupying that staff
  member and customer until completion, including overruns. Completion releases capacity
  and reports a warning if it finished after scheduled end.
- Adjacent reservations are permitted; buffers occupy both customer and staff capacity.
  Completed/cancelled appointments do not block future slots. General cancellation,
  refunds and mid-service handovers need separate policies and are not implicitly authorized.

## Concurrency and verification

All appointment/catalog/scheduling/consultation writes use a shared PostgreSQL
transaction advisory lock plus Serializable isolation, with bounded retries for
serialization conflicts. Customer and staff conflict predicates are rechecked within
that transaction. Reservation, service items and history commit together. Version
checks reject stale changes. Failed edits leave the original booking intact.

The lock is intentionally salon-wide for this first release. Do not introduce another
write path that bypasses this transaction boundary. Multiple locations/high throughput
would require finer-grained locking and corresponding concurrency tests. Availability
is a consistent advisory snapshot, not a reservation.

Run `npm run typecheck` and `npm test` after generating Prisma Client. Integration tests
use the PGlite and pglite-socket packages already present through the installed Prisma
toolchain, with an ephemeral loopback server and in-memory PostgreSQL database. They
never read DATABASE_URL or .env, execute only the new migration against a test User
table, and close the database after running. No production/development data is touched.
If a future Prisma install removes those transitive test dependencies, explicitly add
them as development dependencies before running integration tests.

Coverage includes privileges and revocation, validation/privacy, snapshots, idempotency,
competing requests, consultation outcomes/expiry, rollback, variants, schedule changes,
assignment/takeover, execution/absence rules and HTTP boundaries. PGlite serializes its
database connection: the competing-request test verifies outcomes, not PostgreSQL's
multi-connection serialization behavior. Run multi-connection PostgreSQL contention
tests in staging before production rollout. The implementation adds no dependencies
and leaves package-lock.json unchanged.
