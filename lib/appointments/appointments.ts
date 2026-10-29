import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import type { RequestUserType } from "@/types/requestUser";
import { appointmentQuerySchema, availabilitySchema, type AppointmentAction, type AppointmentUpdate, type BookingInput } from "@/types/dto/AppointmentRequests";
import z from "zod";
import { canAccessAppointment, requireAssigned, requirePrivilege } from "./authorization";
import { write, type Database } from "./database";
import { ApiError, ensure } from "./errors";
import { bookingPolicy } from "./policy";
import { availabilityContext, availableStaff, clearanceIds, loadClearances, planReservation, resolveServices, validateBookingTime } from "./scheduling";
import { addMinutes } from "./time";

const include = { services: { orderBy: { position: "asc" as const } } };
type Appointment = Prisma.AppointmentGetPayload<{ include: typeof include }>;

export function presentAppointment(appointment: Appointment) {
    const { requestHash: _hash, idempotencyKey: _key, ...data } = appointment;
    return { ...data, totalFeeMinor: appointment.services.reduce((sum, s) => sum + s.feeMinor, 0), currency: appointment.services[0]?.currency ?? null };
}

async function load(tx: Database, id: string) {
    const appointment = await tx.appointment.findUnique({ where: { id }, include });
    ensure(appointment, 404, "Appointment not found");
    return appointment;
}

async function history(tx: Database, actorId: string, action: string, before: Appointment | null, after: Appointment, reason?: string) {
    const json = (value: Appointment) => JSON.parse(JSON.stringify(presentAppointment(value))) as Prisma.InputJsonValue;
    await tx.appointmentHistory.create({ data: { appointmentId: after.id, actorId, action, reason, ...(before ? { before: json(before) } : {}), after: json(after) } });
}

export async function bookAppointment(user: RequestUserType, input: BookingInput, idempotencyKey: string) {
    const requestHash = createHash("sha256").update(JSON.stringify({
        startsAt: input.startsAt.toISOString(), services: input.services.map(s => ({ serviceId: s.serviceId, variantId: s.variantId ?? null })),
        preferredStaffId: input.preferredStaffId ?? null, customerNotes: input.customerNotes,
    })).digest("hex");
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "appointments:add:own");
        const existing = await tx.appointment.findUnique({ where: { customerId_idempotencyKey: { customerId: actor.id, idempotencyKey } }, include });
        if (existing) {
            ensure(existing.requestHash === requestHash, 409, "Idempotency key was already used for a different booking");
            return presentAppointment(existing);
        }
        const plan = await planReservation(tx, actor.id, input);
        const after = await tx.appointment.create({ data: {
            customerId: actor.id, staffId: plan.staffId, preferredStaffId: input.preferredStaffId,
            startsAt: input.startsAt, endsAt: plan.endsAt, reservedUntil: plan.reservedUntil, bufferMinutes: plan.bufferMinutes,
            customerNotes: input.customerNotes, idempotencyKey, requestHash, services: { create: plan.services },
        }, include });
        await history(tx, actor.id, "BOOKED", null, after);
        return presentAppointment(after);
    });
}

export async function listAppointments(user: RequestUserType, params: z.infer<typeof appointmentQuerySchema>) {
    requirePrivilege(user, `appointments:read:${params.scope}`);
    const where: Prisma.AppointmentWhereInput = { AND: [
        params.scope === "own" ? { customerId: user.id } : params.scope === "assigned" ? { staffId: user.id } : {},
        {
            customerId: params.customerId, staffId: params.staffId, status: params.status,
            ...(params.serviceId ? { services: { some: { serviceId: params.serviceId } } } : {}),
            createdAt: { gte: params.placedFrom, lt: params.placedTo },
            startsAt: { gte: params.scheduledFrom, lt: params.scheduledTo },
        },
    ] };
    const [totalCount, appointments] = await prisma.$transaction([
        prisma.appointment.count({ where }),
        prisma.appointment.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (params.pageNumber - 1) * params.pageSize, take: params.pageSize }),
    ], { isolationLevel: "RepeatableRead" });
    return { appointments: appointments.map(presentAppointment), pagination: { pageNumber: params.pageNumber, pageSize: params.pageSize, totalCount, totalPages: Math.ceil(totalCount / params.pageSize) } };
}

export async function getAppointment(user: RequestUserType, id: string) {
    const appointment = await load(prisma, id);
    ensure(canAccessAppointment(user, appointment, "read"), 403, "Appointment access denied");
    return presentAppointment(appointment);
}

export async function getHistory(user: RequestUserType, id: string, pageNumber: number, pageSize: number) {
    return prisma.$transaction(async tx => {
        const appointment = await load(tx, id);
        ensure(canAccessAppointment(user, appointment, "read"), 403, "Appointment history access denied");
        const where = { appointmentId: id };
        const totalCount = await tx.appointmentHistory.count({ where });
        const entries = await tx.appointmentHistory.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (pageNumber - 1) * pageSize, take: pageSize });
        return { entries, pagination: { pageNumber, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) } };
    }, { isolationLevel: "RepeatableRead" });
}

function checkVersion(appointment: Appointment, version: number) {
    ensure(appointment.version === version, 409, "Appointment has changed; refresh before updating");
}

function requireEdit(actor: RequestUserType, before: Appointment, reason?: string) {
    ensure(canAccessAppointment(actor, before, "edit"), 403, "Appointment edit denied");
    ensure(before.status === "BOOKED", 409, "Only booked appointments can be changed");
    const operational = actor.privileges.includes("appointments:edit:all") || (actor.id === before.staffId && actor.privileges.includes("appointments:edit:assigned"));
    if (!operational) ensure(before.startsAt.getTime() - Date.now() > bookingPolicy().editCutoffMinutes * 60000, 409, "Customer edit cutoff has passed");
    else ensure(reason, 400, "A reason is required for staff changes");
}

async function edit(tx: Database, actor: RequestUserType, before: Appointment, input: AppointmentUpdate, action: string) {
    checkVersion(before, input.version);
    requireEdit(actor, before, input.reason);
    if (input.preferredStaffId !== undefined) {
        ensure((actor.id === before.customerId && actor.privileges.includes("appointments:edit:own")) || actor.privileges.includes("appointments:assign"), 403, "Changing staff preference requires ownership and edit privilege, or assignment privilege");
    }
    const capacityChange = input.startsAt !== undefined || input.services !== undefined || input.preferredStaffId !== undefined;
    const plan = capacityChange ? await planReservation(tx, before.customerId, {
        startsAt: input.startsAt ?? before.startsAt,
        services: input.services ?? before.services.map(s => ({ serviceId: s.serviceId, variantId: s.variantId })),
        preferredStaffId: input.preferredStaffId === undefined ? before.staffId : input.preferredStaffId,
        customerNotes: input.customerNotes ?? before.customerNotes,
    }, before.services, before.id, before.bufferMinutes) : null;
    if (plan) await tx.appointmentService.deleteMany({ where: { appointmentId: before.id } });
    const after = await tx.appointment.update({ where: { id: before.id, version: before.version }, data: {
        startsAt: input.startsAt, preferredStaffId: input.preferredStaffId, customerNotes: input.customerNotes, version: { increment: 1 },
        ...(plan ? { staffId: plan.staffId, endsAt: plan.endsAt, reservedUntil: plan.reservedUntil, services: { create: plan.services } } : {}),
    }, include });
    await history(tx, actor.id, action, before, after, input.reason);
    return presentAppointment(after);
}

export async function updateAppointment(user: RequestUserType, id: string, input: AppointmentUpdate) {
    return write(user, async (tx, actor) => edit(tx, actor, await load(tx, id), input, "UPDATED"));
}

export async function appointmentAction(user: RequestUserType, id: string, input: AppointmentAction) {
    return write(user, async (tx, actor) => {
        const before = await load(tx, id);
        checkVersion(before, input.version);
        if (input.action === "reschedule") return edit(tx, actor, before, input, "RESCHEDULED");
        const now = new Date();
        let data: Prisma.AppointmentUpdateInput = { version: { increment: 1 } };
        if (input.action === "reassign" || input.action === "takeover") {
            requirePrivilege(actor, input.action === "reassign" ? "appointments:assign" : "appointments:takeover");
            ensure(before.status === "BOOKED", 409, "Only booked appointments can be reassigned");
            const staffId = input.action === "takeover" ? actor.id : input.staffId;
            ensure(staffId !== before.staffId, 409, "Staff member is already assigned");
            const plan = await planReservation(tx, before.customerId, {
                startsAt: before.startsAt, services: before.services.map(s => ({ serviceId: s.serviceId, variantId: s.variantId })),
                preferredStaffId: staffId, customerNotes: before.customerNotes,
            }, before.services, before.id, before.bufferMinutes);
            data = { ...data, staff: { connect: { id: plan.staffId } } };
        } else if (input.action === "start") {
            requireAssigned(actor, before, "appointments:execute:assigned");
            ensure(before.status === "BOOKED", 409, "Only booked appointments can start");
            ensure(now >= before.startsAt, 409, "Appointment cannot start before its scheduled time");
            const duration = before.services.reduce((sum, service) => sum + service.durationMinutes, 0);
            const expectedEnd = addMinutes(now, duration);
            // Round outward to minutes for working-hour validation.
            const projectedUntil = new Date(Math.ceil(addMinutes(expectedEnd, before.bufferMinutes).getTime() / 60000) * 60000);
            const context = await availabilityContext(tx, before.customerId, before.services.map(s => s.serviceId), before.startsAt, projectedUntil, before.id);
            const minuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
            ensure(availableStaff(context, minuteStart, projectedUntil, before.staffId).length, 409, "Starting now conflicts with working hours, qualifications, or another appointment");
            const services = await tx.service.findMany({ where: { id: { in: before.services.map(s => s.serviceId) } } });
            await clearanceIds(tx, before.customerId, services.map(s => ({ serviceId: s.id, requiresConsultation: s.requiresConsultation })), expectedEnd);
            data = { ...data, status: "IN_PROGRESS", actualStartedAt: now, reservedUntil: projectedUntil > before.reservedUntil ? projectedUntil : before.reservedUntil };
        } else if (input.action === "complete") {
            requireAssigned(actor, before, "appointments:execute:assigned");
            ensure(before.status === "IN_PROGRESS" && before.actualStartedAt && now >= before.actualStartedAt, 409, "Only a started appointment can be completed");
            data = { ...data, status: "COMPLETED", actualEndedAt: now };
        } else {
            requireAssigned(actor, before, "appointments:no-show:assigned");
            ensure(before.status === "BOOKED", 409, "Only booked appointments can be marked absent");
            ensure(now >= addMinutes(before.startsAt, bookingPolicy().noShowGraceMinutes), 409, "Customer absence grace period has not elapsed");
            data = { ...data, status: "CANCELLED", cancellationReason: "CUSTOMER_ABSENT" };
        }
        const after = await tx.appointment.update({ where: { id, version: before.version }, data, include });
        await history(tx, actor.id, input.action.toUpperCase(), before, after, "reason" in input ? input.reason : undefined);
        return { ...presentAppointment(after), warnings: input.action === "complete" && now > before.endsAt ? ["Appointment finished after its scheduled end; later bookings were not moved"] : [] };
    });
}

export async function findAvailability(user: RequestUserType, input: z.infer<typeof availabilitySchema>) {
    requirePrivilege(user, "appointments:availability:read");
    validateBookingTime(input.from);
    validateBookingTime(input.to);
    return prisma.$transaction(async tx => {
        const services = await resolveServices(tx, input.services);
        ensure(new Set(services.map(s => s.currency)).size === 1, 400, "Services must use the same currency");
        const duration = services.reduce((sum, s) => sum + s.durationMinutes, 0);
        ensure(duration <= 720, 400, "Appointment may not exceed twelve hours");
        const policy = bookingPolicy();
        const context = await availabilityContext(tx, user.id, services.map(s => s.serviceId), input.from, addMinutes(input.to, duration + policy.bufferMinutes));
        const clearances = await loadClearances(tx, user.id, services);
        const slots = [];
        // Clearance is evaluated for each end time; an expiry can fall inside this range.
        for (let start = input.from; start < input.to; start = addMinutes(start, policy.slotMinutes)) {
            const endsAt = addMinutes(start, duration);
            const staff = availableStaff(context, start, addMinutes(endsAt, policy.bufferMinutes), input.preferredStaffId);
            if (!staff.length) continue;
            try { await clearanceIds(tx, user.id, services, endsAt, clearances); }
            catch (error) { if (error instanceof ApiError && error.status === 409) continue; throw error; }
            slots.push({ startsAt: start, endsAt, staff: staff.map(s => ({ id: s.id, firstName: s.firstName, lastName: s.lastName })) });
        }
        return { slots, slotMinutes: policy.slotMinutes, timeZone: policy.timeZone };
    }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
