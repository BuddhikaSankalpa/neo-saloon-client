import z from "zod";

export const idSchema = z.uuid();
export const instantSchema = z.iso.datetime({ offset: true }).transform(value => new Date(value));
export const paginationSchema = z.object({
    pageNumber: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const reason = z.string().trim().min(1).max(1000);
export const serviceSelectionSchema = z.array(z.object({
    serviceId: idSchema,
    variantId: idSchema.nullable().optional(),
}).strict()).min(1).max(20).refine(items => new Set(items.map(item => item.serviceId)).size === items.length, "Select each service only once");

export const bookingSchema = z.object({
    startsAt: instantSchema,
    services: serviceSelectionSchema,
    preferredStaffId: idSchema.nullable().optional(),
    customerNotes: z.string().trim().max(2000).default(""),
}).strict();

export const updateAppointmentSchema = z.object({
    version: z.number().int().positive(),
    startsAt: instantSchema.optional(),
    services: serviceSelectionSchema.optional(),
    preferredStaffId: idSchema.nullable().optional(),
    customerNotes: z.string().trim().max(2000).optional(),
    reason: reason.optional(),
}).strict().refine(value => [value.startsAt, value.services, value.preferredStaffId, value.customerNotes].some(item => item !== undefined), "Provide an update");

export const actionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("reschedule"), version: z.number().int().positive(), startsAt: instantSchema, reason }).strict(),
    z.object({ action: z.literal("reassign"), version: z.number().int().positive(), staffId: idSchema, reason }).strict(),
    z.object({ action: z.literal("takeover"), version: z.number().int().positive(), reason }).strict(),
    z.object({ action: z.literal("start"), version: z.number().int().positive() }).strict(),
    z.object({ action: z.literal("complete"), version: z.number().int().positive() }).strict(),
    z.object({ action: z.literal("no-show"), version: z.number().int().positive(), reason }).strict(),
]);

export const appointmentQuerySchema = paginationSchema.extend({
    scope: z.enum(["own", "assigned", "all"]).default("own"),
    customerId: idSchema.optional(), staffId: idSchema.optional(), serviceId: idSchema.optional(),
    status: z.enum(["BOOKED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    placedFrom: instantSchema.optional(), placedTo: instantSchema.optional(),
    scheduledFrom: instantSchema.optional(), scheduledTo: instantSchema.optional(),
}).strict().refine(q => !q.placedFrom || !q.placedTo || q.placedFrom < q.placedTo, "Invalid placed date range")
    .refine(q => !q.scheduledFrom || !q.scheduledTo || q.scheduledFrom < q.scheduledTo, "Invalid scheduled date range");

export const availabilitySchema = z.object({
    from: instantSchema, to: instantSchema,
    services: serviceSelectionSchema,
    preferredStaffId: idSchema.optional(),
}).strict().refine(q => q.to > q.from && q.to.getTime() - q.from.getTime() <= 7 * 86400000, "Availability range must be positive and at most seven days");

export const variantSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).default(""),
    active: z.boolean().default(true),
}).strict();
export const variantUpdateSchema = variantSchema.partial().strict().refine(v => Object.keys(v).length > 0, "Provide an update");
export const serviceSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(4000).default(""),
    durationMinutes: z.number().int().min(1).max(720),
    feeMinor: z.number().int().min(0).max(100000000),
    currency: z.string().regex(/^[A-Z]{3}$/).default("LKR"),
    status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).default("ACTIVE"),
    listed: z.boolean().default(true),
    requiresConsultation: z.boolean().default(false),
}).strict();
export const serviceUpdateSchema = serviceSchema.partial().strict().refine(v => Object.keys(v).length > 0, "Provide an update");
export const serviceQuerySchema = paginationSchema.extend({
    scope: z.enum(["listed", "all"]).default("listed"),
    search: z.string().trim().max(100).optional(),
}).strict();

const windowSchema = z.object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
}).strict().refine(w => w.startMinute < w.endMinute, "Window must end after it starts");
export const scheduleSchema = z.object({
    weekly: z.array(windowSchema.safeExtend({ weekday: z.number().int().min(0).max(6) })).max(28),
    exceptions: z.array(z.object({ date: z.iso.date(), windows: z.array(windowSchema).max(4) }).strict()).max(366),
}).strict().superRefine((s, ctx) => {
    const groups = [...Array.from({ length: 7 }, (_, day) => s.weekly.filter(w => w.weekday === day)), ...s.exceptions.map(e => e.windows)];
    if (new Set(s.exceptions.map(e => e.date)).size !== s.exceptions.length) ctx.addIssue({ code: "custom", message: "Duplicate exception date" });
    for (const windows of groups) {
        const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
        if (sorted.some((w, i) => i > 0 && w.startMinute < sorted[i - 1].endMinute)) ctx.addIssue({ code: "custom", message: "Schedule windows overlap" });
    }
});
export const qualificationSchema = z.object({ serviceIds: z.array(idSchema).max(200).refine(ids => new Set(ids).size === ids.length, "Duplicate services") }).strict();
export const timeOffSchema = z.object({ startsAt: instantSchema, endsAt: instantSchema, reason }).strict()
    .refine(v => v.startsAt < v.endsAt, "Time off must end after it starts");
export const consultationSchema = z.object({
    customerId: idSchema,
    serviceIds: z.array(idSchema).min(1).max(20).refine(ids => new Set(ids).size === ids.length, "Duplicate services"),
    completedAt: instantSchema,
    validUntil: instantSchema.optional(),
    approved: z.boolean(), notes: z.string().trim().max(4000).default(""),
}).strict();
export const consultationQuerySchema = paginationSchema.extend({ customerId: idSchema.optional() }).strict();

export type BookingInput = z.infer<typeof bookingSchema>;
export type AppointmentUpdate = z.infer<typeof updateAppointmentSchema>;
export type AppointmentAction = z.infer<typeof actionSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
