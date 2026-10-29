import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { insideSchedule, overlaps, localParts } from "../lib/appointments/time";
import { canAccessAppointment, requireAssigned, requirePrivilege } from "../lib/appointments/authorization";
import { bookingSchema, scheduleSchema, appointmentQuerySchema, variantSchema, updateAppointmentSchema } from "../types/dto/AppointmentRequests";
import type { RequestUserType } from "../types/requestUser";

const user: RequestUserType = { id: randomUUID(), email: "test@example.com", firstName: "Test", lastName: "User", role: "ADMIN", privileges: [] };

test("role labels and ownership never grant privileges", () => {
    assert.throws(() => requirePrivilege(user, "services:add"));
    assert.equal(canAccessAppointment(user, { customerId: user.id, staffId: user.id }, "read"), false);
    const reader = { ...user, privileges: ["appointments:read:own"] };
    assert.equal(canAccessAppointment(reader, { customerId: reader.id, staffId: "other" }, "read"), true);
    assert.equal(canAccessAppointment(reader, { customerId: "other", staffId: reader.id }, "read"), false);
    assert.throws(() => requireAssigned({ ...user, privileges: ["appointments:execute:assigned"] }, { customerId: user.id, staffId: "other" }, "appointments:execute:assigned"));
});

test("half-open intervals allow adjacent bookings but reject overlaps", () => {
    const date = (minute: number) => new Date(Date.UTC(2030, 0, 7, 9, minute));
    assert.equal(overlaps(date(0), date(30), date(30), date(60)), false);
    assert.equal(overlaps(date(0), date(31), date(30), date(60)), true);
});

test("schedule checks cover closure, breaks, holidays, buffers and timezone", () => {
    const schedule = scheduleSchema.parse({ weekly: [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 780, endMinute: 1020 }], exceptions: [{ date: "2030-01-14", windows: [] }] });
    assert.equal(insideSchedule(null, new Date("2030-01-07T09:00Z"), new Date("2030-01-07T10:00Z"), "UTC"), false);
    assert.equal(insideSchedule(schedule, new Date("2030-01-07T09:00Z"), new Date("2030-01-07T12:00Z"), "UTC"), true);
    assert.equal(insideSchedule(schedule, new Date("2030-01-07T11:00Z"), new Date("2030-01-07T13:00Z"), "UTC"), false);
    assert.equal(insideSchedule(schedule, new Date("2030-01-14T09:00Z"), new Date("2030-01-14T10:00Z"), "UTC"), false);
    assert.equal(insideSchedule(schedule, new Date("2030-01-07T16:00Z"), new Date("2030-01-07T17:00:01Z"), "UTC"), false);
    assert.deepEqual(localParts(new Date("2030-01-07T03:30Z"), "Asia/Colombo"), { date: "2030-01-07", weekday: 1, minute: 540 });
});

test("strict DTOs reject forged identity, prices, duplicate services and invalid queries", () => {
    const valid = { startsAt: "2030-01-07T10:00:00Z", services: [{ serviceId: randomUUID() }] };
    assert.equal(bookingSchema.safeParse(valid).success, true);
    for (const forged of [{ customerId: user.id }, { staffId: user.id }, { feeMinor: 1 }, { status: "COMPLETED" }]) assert.equal(bookingSchema.safeParse({ ...valid, ...forged }).success, false);
    assert.equal(bookingSchema.safeParse({ ...valid, services: [valid.services[0], valid.services[0]] }).success, false);
    assert.equal(bookingSchema.safeParse({ ...valid, startsAt: "2030-01-07T10:00:00" }).success, false);
    assert.equal(variantSchema.safeParse({ name: "Long", feeMinor: 100 }).success, false);
    assert.equal(appointmentQuerySchema.safeParse({ pageSize: "-1" }).success, false);
    assert.equal(appointmentQuerySchema.safeParse({ placedFrom: "2030-02-01T00:00:00Z", placedTo: "2030-01-01T00:00:00Z" }).success, false);
    assert.equal(updateAppointmentSchema.safeParse({ version: 1 }).success, false);
    assert.equal(scheduleSchema.safeParse({ weekly: [{ weekday: 1, startMinute: 600, endMinute: 660 }, { weekday: 1, startMinute: 650, endMinute: 700 }], exceptions: [] }).success, false);
});
