import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

// Uses only an ephemeral in-memory database. Never reads DATABASE_URL or .env.
test("appointment backend against isolated PostgreSQL", { timeout: 120000 }, async t => {
    process.env.SALOON_TIMEZONE = "UTC";
    process.env.JOSE_SECRET = "isolated-test-secret-not-used-outside-tests";
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 7, 9) });
    const db = await PGlite.create();
    const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 1 });
    await server.start();
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/postgres`, max: 1 }) });
    (globalThis as unknown as { prisma: PrismaClient }).prisma = client;
    t.after(async () => { await client.$disconnect(); await server.stop(); await db.close(); t.mock.timers.reset(); });
    // Existing User table shape; the new migration itself is executed below.
    await db.exec(`CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY, "email" TEXT UNIQUE NOT NULL, "phone" TEXT UNIQUE,
        "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "password" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'CUSTOMER', "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastLogin" TIMESTAMP,
        "privileges" TEXT[] DEFAULT '{}', "profileImage" TEXT NOT NULL DEFAULT '/images/default-profile.png'
    )`);
    await db.exec(await readFile("prisma/migrations/20261013000000_appointment_management/migration.sql", "utf8"));
    const appointments = await import("../lib/appointments/appointments");
    const management = await import("../lib/appointments/management");
    const catalog = await import("../lib/appointments/catalog");
    const { getUser } = await import("../utils/authentication");
    const { registrationPrivileges } = await import("../lib/appointments/policy");
    const { appointmentQuerySchema } = await import("../types/dto/AppointmentRequests");
    const weekly = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
    await client.schedule.create({ data: { key: "business", weekly, exceptions: [] } });
    const manager = await client.user.create({ data: { email: `${randomUUID()}@example.com`, firstName: "Manager", lastName: "Test", password: "unused", privileges: ["services:add", "services:edit", "services:read:all", "scheduling:manage", "consultations:record", "appointments:read:all", "appointments:edit:all", "appointments:assign"] } });
    async function fixture(consultation = false) {
        const customer = await client.user.create({ data: { email: `${randomUUID()}@example.com`, firstName: "Customer", lastName: "Test", password: "unused", privileges: registrationPrivileges } });
        const service = await catalog.createService(manager, { name: "Haircut", description: "", durationMinutes: 60, feeMinor: 250000, currency: "LKR", status: "ACTIVE", listed: true, requiresConsultation: consultation });
        const staff = await client.user.create({ data: { email: `${randomUUID()}@example.com`, firstName: "Staff", lastName: "Test", password: "unused", privileges: ["appointments:receive", "appointments:read:assigned", "appointments:edit:assigned", "appointments:execute:assigned", "appointments:takeover", "appointments:no-show:assigned"], staffServices: { create: { serviceId: service.id } } } });
        await client.schedule.create({ data: { key: staff.id, staffId: staff.id, weekly, exceptions: [] } });
        const input = { startsAt: new Date("2030-01-08T10:00:00Z"), services: [{ serviceId: service.id }], preferredStaffId: staff.id, customerNotes: "" };
        return { customer, staff, service, input };
    }
    const fails = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (e: unknown) => !!e && typeof e === "object" && "status" in e && e.status === status);

    await t.test("privileges override role labels and revocation takes effect with an existing JWT", async () => {
        const f = await fixture();
        await client.user.update({ where: { id: f.customer.id }, data: { role: "ADMIN", privileges: [] } });
        await fails(appointments.bookAppointment(f.customer, f.input, randomUUID()), 403);
        const token = await new SignJWT({ id: f.customer.id, privileges: ["services:add"] }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JOSE_SECRET));
        const request = new NextRequest("http://localhost/api/services", { headers: { cookie: `login-token=${token}` } });
        assert.deepEqual((await getUser(request))?.privileges, []);
        await client.user.update({ where: { id: f.customer.id }, data: { status: "SUSPENDED" } });
        assert.equal(await getUser(request), null);
    });

    await t.test("booking snapshots, idempotency and history are atomic", async () => {
        const f = await fixture();
        const key = randomUUID();
        const a = await appointments.bookAppointment(f.customer, f.input, key);
        assert.equal(a.staffId, f.staff.id);
        assert.equal(a.totalFeeMinor, 250000);
        assert.equal((await appointments.bookAppointment(f.customer, f.input, key)).id, a.id);
        await fails(appointments.bookAppointment(f.customer, { ...f.input, customerNotes: "different" }, key), 409);
        await catalog.updateService(manager, f.service.id, { feeMinor: 1, durationMinutes: 30 });
        const updated = await appointments.updateAppointment(f.customer, a.id, { version: 1, startsAt: new Date("2030-01-08T12:00:00Z") });
        assert.equal(updated.totalFeeMinor, 250000);
        assert.equal(updated.endsAt.toISOString(), "2030-01-08T13:00:00.000Z");
        assert.equal((await appointments.getHistory(f.customer, a.id, 1, 20)).entries.length, 2);
        await fails(appointments.updateAppointment(f.customer, a.id, { version: 1, customerNotes: "stale" }), 409);
    });

    await t.test("competing requests reserve a slot once and allow adjacent appointments", async () => {
        const f = await fixture();
        const other = await client.user.create({ data: { email: `${randomUUID()}@example.com`, firstName: "Other", lastName: "Test", password: "unused", privileges: registrationPrivileges } });
        const results = await Promise.allSettled([appointments.bookAppointment(f.customer, f.input, randomUUID()), appointments.bookAppointment(other, f.input, randomUUID())]);
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
        assert.equal(results.filter(r => r.status === "rejected").length, 1);
        assert.equal(await client.appointment.count({ where: { staffId: f.staff.id } }), 1);
        await appointments.bookAppointment(other, { ...f.input, startsAt: new Date("2030-01-08T11:00:00Z") }, randomUUID());
    });

    await t.test("consultation is required, must cover the end time, and later denials supersede approvals", async () => {
        const f = await fixture(true);
        await fails(appointments.bookAppointment(f.customer, f.input, randomUUID()), 409);
        await management.recordConsultation(manager, { customerId: f.customer.id, serviceIds: [f.service.id], completedAt: new Date("2030-01-06T09:00:00Z"), approved: true, validUntil: new Date("2030-01-08T10:30:00Z"), notes: "" });
        await fails(appointments.bookAppointment(f.customer, f.input, randomUUID()), 409);
        await management.recordConsultation(manager, { customerId: f.customer.id, serviceIds: [f.service.id], completedAt: new Date("2030-01-06T10:00:00Z"), approved: true, notes: "" });
        const a = await appointments.bookAppointment(f.customer, f.input, randomUUID());
        assert.ok(a.services[0].consultationId);
        await management.recordConsultation(manager, { customerId: f.customer.id, serviceIds: [f.service.id], completedAt: new Date("2030-01-06T11:00:00Z"), approved: false, notes: "" });
        await fails(appointments.updateAppointment(f.customer, a.id, { version: 1, startsAt: new Date("2030-01-09T10:00:00Z") }), 409);
        assert.equal((await appointments.getAppointment(f.customer, a.id)).startsAt.toISOString(), f.input.startsAt.toISOString());
    });

    await t.test("scope filters cannot expose another customer's appointments or history", async () => {
        const f = await fixture();
        const a = await appointments.bookAppointment(f.customer, f.input, randomUUID());
        const stranger = (await fixture()).customer;
        await fails(appointments.getAppointment(stranger, a.id), 403);
        await fails(appointments.getHistory(stranger, a.id, 1, 20), 403);
        const hidden = await appointments.listAppointments(stranger, appointmentQuerySchema.parse({ customerId: f.customer.id }));
        assert.equal(hidden.pagination.totalCount, 0);
        const visible = await appointments.listAppointments(manager, appointmentQuerySchema.parse({ scope: "all", customerId: f.customer.id, staffId: f.staff.id, serviceId: f.service.id }));
        assert.equal(visible.pagination.totalCount, 1);
    });

    await t.test("variants inherit service fees and invalid variants are rejected", async () => {
        const f = await fixture();
        const v = await catalog.createVariant(manager, f.service.id, { name: "Long", description: "", active: true });
        await fails(appointments.bookAppointment(f.customer, f.input, randomUUID()), 400);
        await fails(appointments.bookAppointment(f.customer, { ...f.input, services: [{ serviceId: f.service.id, variantId: randomUUID() }] }, randomUUID()), 400);
        const a = await appointments.bookAppointment(f.customer, { ...f.input, services: [{ serviceId: f.service.id, variantId: v.id }] }, randomUUID());
        assert.equal(a.services[0].feeMinor, f.service.feeMinor);
    });

    await t.test("schedule changes and time off cannot invalidate existing bookings", async () => {
        const f = await fixture();
        const a = await appointments.bookAppointment(f.customer, f.input, randomUUID());
        await fails(management.replaceSchedule(manager, f.staff.id, { weekly: [], exceptions: [] }), 409);
        assert.deepEqual((await management.getSchedule(manager, f.staff.id)).schedule.weekly, weekly);
        await fails(management.addTimeOff(manager, f.staff.id, { startsAt: f.input.startsAt, endsAt: a.endsAt, reason: "Leave" }), 409);
        await fails(management.replaceQualifications(manager, f.staff.id, []), 409);
        assert.equal(await client.staffTimeOff.count({ where: { staffId: f.staff.id } }), 0);
    });

    await t.test("failed reschedules and service changes preserve the original reservation and history", async () => {
        const f = await fixture();
        const a = await appointments.bookAppointment(f.customer, f.input, randomUUID());
        const second = await appointments.bookAppointment(f.customer, { ...f.input, startsAt: new Date("2030-01-08T11:00:00Z") }, randomUUID());
        await fails(appointments.updateAppointment(f.customer, second.id, { version: 1, startsAt: new Date("2030-01-08T10:30:00Z") }), 409);
        const requiringConsultation = await catalog.createService(manager, { name: "Treatment", description: "", durationMinutes: 30, feeMinor: 1000, currency: "LKR", status: "ACTIVE", listed: true, requiresConsultation: true });
        await fails(appointments.updateAppointment(f.customer, a.id, { version: 1, services: [{ serviceId: requiringConsultation.id }] }), 409);
        assert.equal((await appointments.getAppointment(f.customer, second.id)).version, 1);
        assert.equal((await appointments.getHistory(f.customer, a.id, 1, 20)).entries.length, 1);
    });

    await t.test("takeover requires eligibility and transfers execution authority", async () => {
        const f = await fixture();
        const a = await appointments.bookAppointment(f.customer, f.input, randomUUID());
        const next = (await fixture()).staff;
        await fails(appointments.appointmentAction(next, a.id, { action: "takeover", version: 1, reason: "Cover" }), 409);
        await client.staffService.create({ data: { staffId: next.id, serviceId: f.service.id } });
        const changed = await appointments.appointmentAction(next, a.id, { action: "takeover", version: 1, reason: "Cover" });
        assert.equal(changed.staffId, next.id);
        await fails(appointments.appointmentAction(f.staff, a.id, { action: "start", version: 2 }), 403);
        await fails(appointments.appointmentAction(next, a.id, { action: "complete", version: 2 }), 409);
    });

    await t.test("execution, customer cutoff, absence grace and terminal states are enforced", async () => {
        const f = await fixture();
        const a = await appointments.bookAppointment(f.customer, { ...f.input, startsAt: new Date("2030-01-07T09:30:00Z") }, randomUUID());
        await fails(appointments.updateAppointment(f.customer, a.id, { version: 1, customerNotes: "too late" }), 409);
        await fails(appointments.appointmentAction(f.staff, a.id, { action: "start", version: 1 }), 409);
        await fails(appointments.appointmentAction(f.staff, a.id, { action: "no-show", version: 1, reason: "Absent" }), 409);
        t.mock.timers.setTime(Date.UTC(2030, 0, 7, 9, 30));
        const started = await appointments.appointmentAction(f.staff, a.id, { action: "start", version: 1 });
        assert.equal(started.status, "IN_PROGRESS");
        await fails(appointments.appointmentAction(f.staff, a.id, { action: "no-show", version: 2, reason: "Absent" }), 409);
        const completed = await appointments.appointmentAction(f.staff, a.id, { action: "complete", version: 2 });
        assert.equal(completed.status, "COMPLETED");
        await fails(appointments.updateAppointment(f.customer, a.id, { version: 3, customerNotes: "closed" }), 409);
        const absent = await appointments.bookAppointment(f.customer, { ...f.input, startsAt: new Date("2030-01-07T10:00:00Z") }, randomUUID());
        t.mock.timers.setTime(Date.UTC(2030, 0, 7, 10, 15));
        assert.equal((await appointments.appointmentAction(f.staff, absent.id, { action: "no-show", version: 1, reason: "Did not arrive" })).status, "CANCELLED");
    });

    await t.test("availability exposes only slots and staff and respects missing schedules", async () => {
        const f = await fixture();
        const input = { from: f.input.startsAt, to: new Date("2030-01-08T12:00:00Z"), services: f.input.services, preferredStaffId: f.staff.id };
        const available = await appointments.findAvailability(f.customer, input);
        assert.ok(available.slots.length > 0);
        assert.deepEqual(Object.keys(available.slots[0].staff[0]).sort(), ["firstName", "id", "lastName"]);
        await management.replaceSchedule(manager, f.staff.id, { weekly: [], exceptions: [] });
        assert.equal((await appointments.findAvailability(f.customer, input)).slots.length, 0);
    });

    await t.test("automatic assignment uses eligible available staff and preserves explicit preference", async () => {
        const f = await fixture();
        const replacement = (await fixture()).staff;
        await client.staffService.create({ data: { staffId: replacement.id, serviceId: f.service.id } });
        await management.replaceSchedule(manager, f.staff.id, { weekly: [], exceptions: [] });
        await fails(appointments.bookAppointment(f.customer, f.input, randomUUID()), 409);
        const a = await appointments.bookAppointment(f.customer, { ...f.input, preferredStaffId: null }, randomUUID());
        assert.equal(a.staffId, replacement.id);
    });

    await t.test("HTTP boundaries reject missing authentication, forged fields, duplicate filters and cross-origin writes", async () => {
        const f = await fixture();
        const routes = await import("../app/api/appointments/route");
        const token = await new SignJWT({ id: f.customer.id }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JOSE_SECRET));
        const headers = { cookie: `login-token=${token}`, "content-type": "application/json", "Idempotency-Key": randomUUID() };
        assert.equal((await routes.GET(new NextRequest("http://localhost/api/appointments"))).status, 401);
        assert.equal((await routes.GET(new NextRequest("http://localhost/api/appointments?scope=own&scope=all", { headers }))).status, 400);
        assert.equal((await routes.POST(new NextRequest("http://localhost/api/appointments", { method: "POST", headers, body: JSON.stringify({ ...f.input, customerId: manager.id }) }))).status, 400);
        assert.equal((await routes.POST(new NextRequest("http://localhost/api/appointments", { method: "POST", headers: { ...headers, origin: "https://untrusted.example" }, body: JSON.stringify(f.input) }))).status, 403);
        assert.equal((await routes.POST(new NextRequest("http://localhost/api/appointments", { method: "POST", headers, body: "{" }))).status, 400);
        const response = await routes.POST(new NextRequest("http://localhost/api/appointments", { method: "POST", headers, body: JSON.stringify(f.input) }));
        assert.equal(response.status, 201);
        assert.match(response.headers.get("cache-control")!, /no-store/);
        const json = await response.json();
        assert.equal(json.data.customerId, f.customer.id);
        assert.equal(json.data.requestHash, undefined);
        assert.equal(json.data.idempotencyKey, undefined);
    });
});
