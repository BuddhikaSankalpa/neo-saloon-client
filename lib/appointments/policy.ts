import z from "zod";

function minutes(name: string, fallback: number, max: number) {
    return z.coerce.number().int().min(0).max(max).parse(process.env[name] ?? fallback);
}

// Invalid configuration fails closed rather than relaxing a booking restriction.
export function bookingPolicy() {
    const timeZone = process.env.SALOON_TIMEZONE ?? "Asia/Colombo";
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return {
        timeZone,
        bufferMinutes: minutes("APPOINTMENT_BUFFER_MINUTES", 0, 120),
        editCutoffMinutes: minutes("APPOINTMENT_EDIT_CUTOFF_MINUTES", 60, 10080),
        noShowGraceMinutes: minutes("APPOINTMENT_NO_SHOW_GRACE_MINUTES", 15, 1440),
        advanceDays: z.coerce.number().int().min(1).max(365).parse(process.env.APPOINTMENT_ADVANCE_DAYS ?? 90),
        consultationDays: z.coerce.number().int().min(1).max(365).parse(process.env.CONSULTATION_VALIDITY_DAYS ?? 90),
        slotMinutes: z.coerce.number().int().min(5).max(60).parse(process.env.APPOINTMENT_SLOT_MINUTES ?? 15),
    };
}

export const registrationPrivileges = [
    "services:read", "appointments:availability:read", "appointments:add:own",
    "appointments:read:own", "appointments:edit:own", "consultations:read:own",
];
