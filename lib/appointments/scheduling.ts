import type { AppointmentService } from "@/app/generated/prisma/client";
import { scheduleSchema, type BookingInput } from "@/types/dto/AppointmentRequests";
import type { Database } from "./database";
import { ensure } from "./errors";
import { bookingPolicy } from "./policy";
import { addMinutes, insideSchedule, localParts, overlaps } from "./time";

export async function resolveServices(tx: Database, selections: BookingInput["services"], previous: AppointmentService[] = []) {
    const services = await tx.service.findMany({ where: { id: { in: selections.map(s => s.serviceId) } }, include: { variants: true } });
    return selections.map((selection, position) => {
        const service = services.find(s => s.id === selection.serviceId);
        ensure(service?.status === "ACTIVE" && service.listed, 409, "A selected service is not bookable");
        const variant = selection.variantId ? service.variants.find(v => v.id === selection.variantId && v.active) : null;
        ensure(!selection.variantId || variant, 400, "Variant does not belong to the selected service or is inactive");
        ensure(variant || !service.variants.some(v => v.active), 400, "Select a variant for this service");
        const snapshot = previous.find(s => s.serviceId === service.id && s.variantId === (variant?.id ?? null));
        return {
            serviceId: service.id, variantId: variant?.id ?? null, position,
            name: snapshot?.name ?? service.name, variantName: snapshot?.variantName ?? variant?.name ?? null,
            durationMinutes: snapshot?.durationMinutes ?? service.durationMinutes,
            feeMinor: snapshot?.feeMinor ?? service.feeMinor, currency: snapshot?.currency ?? service.currency,
            requiresConsultation: service.requiresConsultation,
        };
    });
}

export async function loadClearances(tx: Database, customerId: string, services: { serviceId: string; requiresConsultation: boolean }[]) {
    const required = services.filter(s => s.requiresConsultation).map(s => s.serviceId);
    return required.length ? await tx.consultationRecord.findMany({
        where: { customerId, clearances: { some: { serviceId: { in: required } } } },
        include: { clearances: true }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    }) : [];
}

export async function clearanceIds(tx: Database, customerId: string, services: { serviceId: string; requiresConsultation: boolean }[], end: Date, cached?: Awaited<ReturnType<typeof loadClearances>>) {
    const records = cached ?? await loadClearances(tx, customerId, services);
    const now = new Date();
    return services.map(s => {
        if (!s.requiresConsultation) return null;
        // The latest outcome supersedes older approvals, including a denial/expiry.
        const record = records.find(r => r.clearances.some(c => c.serviceId === s.serviceId));
        ensure(record?.approved && record.completedAt <= now && record.validUntil >= end, 409, `Valid consultation clearance required for service ${s.serviceId}`);
        return record.id;
    });
}

export function validateBookingTime(start: Date, now = new Date()) {
    ensure(start > now, 409, "Appointment must start in the future");
    ensure(start.getTime() <= now.getTime() + bookingPolicy().advanceDays * 86400000, 400, "Appointment exceeds the advance booking limit");
    ensure(start.getUTCSeconds() === 0 && start.getUTCMilliseconds() === 0, 400, "Appointment time must be aligned to a minute");
}

export async function availabilityContext(tx: Database, customerId: string, serviceIds: string[], from: Date, to: Date, excludeId?: string) {
    const customer = await tx.user.findUnique({ where: { id: customerId }, select: { status: true } });
    ensure(customer?.status === "ACTIVE", 409, "Customer account is not active");
    const staff = await tx.user.findMany({
        where: { status: "ACTIVE", privileges: { has: "appointments:receive" }, AND: serviceIds.map(serviceId => ({ staffServices: { some: { serviceId } } })) },
        select: { id: true, firstName: true, lastName: true, schedule: true, timeOff: { where: { startsAt: { lt: to }, endsAt: { gt: from } } } },
    });
    const business = await tx.schedule.findUnique({ where: { key: "business" } });
    const reservations = await tx.appointment.findMany({
        where: {
            ...(excludeId ? { id: { not: excludeId } } : {}),
            OR: [{ customerId }, { staffId: { in: staff.map(s => s.id) } }],
            AND: [{ OR: [
                { status: "BOOKED", startsAt: { lt: to }, reservedUntil: { gt: from } },
                { status: "IN_PROGRESS", startsAt: { lt: to } },
            ] }],
        },
        select: { staffId: true, customerId: true, startsAt: true, reservedUntil: true, status: true },
    });
    return {
        customerId,
        business: business ? scheduleSchema.parse({ weekly: business.weekly, exceptions: business.exceptions }) : null,
        staff: staff.map(s => ({ ...s, schedule: s.schedule ? scheduleSchema.parse({ weekly: s.schedule.weekly, exceptions: s.schedule.exceptions }) : null })),
        reservations,
    };
}

export function availableStaff(context: Awaited<ReturnType<typeof availabilityContext>>, start: Date, reservedUntil: Date, preferredStaffId?: string | null) {
    const policy = bookingPolicy();
    if (!insideSchedule(context.business, start, reservedUntil, policy.timeZone)) return [];
    const conflict = (r: typeof context.reservations[number]) =>
        r.status === "IN_PROGRESS" ? r.startsAt < reservedUntil : overlaps(start, reservedUntil, r.startsAt, r.reservedUntil);
    if (context.reservations.some(r => r.customerId === context.customerId && conflict(r))) return [];
    return context.staff.filter(staff =>
        (!preferredStaffId || staff.id === preferredStaffId)
        && insideSchedule(staff.schedule, start, reservedUntil, policy.timeZone)
        && !staff.timeOff.some(t => overlaps(start, reservedUntil, t.startsAt, t.endsAt))
        && !context.reservations.some(r => r.staffId === staff.id && conflict(r))
    ).sort((a, b) => {
        const day = localParts(start, policy.timeZone).date;
        const workload = (id: string) => context.reservations.filter(r => r.staffId === id && localParts(r.startsAt, policy.timeZone).date === day)
            .reduce((sum, r) => sum + r.reservedUntil.getTime() - r.startsAt.getTime(), 0);
        return workload(a.id) - workload(b.id) || a.id.localeCompare(b.id);
    });
}

export async function planReservation(tx: Database, customerId: string, input: BookingInput, previous: AppointmentService[] = [], excludeId?: string, bufferMinutes = bookingPolicy().bufferMinutes) {
    validateBookingTime(input.startsAt);
    const services = await resolveServices(tx, input.services, previous);
    ensure(new Set(services.map(s => s.currency)).size === 1, 400, "Services must use the same currency");
    const duration = services.reduce((sum, s) => sum + s.durationMinutes, 0);
    ensure(duration <= 720, 400, "Appointment may not exceed twelve hours");
    const endsAt = addMinutes(input.startsAt, duration);
    const reservedUntil = addMinutes(endsAt, bufferMinutes);
    const consultations = await clearanceIds(tx, customerId, services, endsAt);
    // The day-wide window supplies a stable least-workload assignment rule.
    const from = new Date(input.startsAt.getTime() - 86400000);
    const to = new Date(reservedUntil.getTime() + 86400000);
    const context = await availabilityContext(tx, customerId, services.map(s => s.serviceId), from, to, excludeId);
    const staff = availableStaff(context, input.startsAt, reservedUntil, input.preferredStaffId)[0];
    ensure(staff, 409, "No eligible staff member is available for this time");
    return {
        endsAt, reservedUntil, bufferMinutes, staffId: staff.id,
        services: services.map(({ requiresConsultation: _requires, ...s }, index) => ({ ...s, consultationId: consultations[index] })),
    };
}

export async function validateExistingSchedules(tx: Database) {
    const reservations = await tx.appointment.findMany({
        where: { OR: [{ status: "BOOKED", reservedUntil: { gt: new Date() } }, { status: "IN_PROGRESS" }] }, include: { services: true },
    });
    for (const appointment of reservations) {
        const context = await availabilityContext(tx, appointment.customerId, appointment.services.map(s => s.serviceId), appointment.startsAt, appointment.reservedUntil, appointment.id);
        ensure(availableStaff(context, appointment.startsAt, appointment.reservedUntil, appointment.staffId).length, 409, "This schedule or qualification change invalidates an existing appointment; reassign or reschedule it first");
    }
}
