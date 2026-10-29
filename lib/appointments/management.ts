import prisma from "@/lib/prisma";
import type { RequestUserType } from "@/types/requestUser";
import { consultationQuerySchema, consultationSchema, timeOffSchema, type ScheduleInput } from "@/types/dto/AppointmentRequests";
import z from "zod";
import { requirePrivilege } from "./authorization";
import { write } from "./database";
import { ensure } from "./errors";
import { bookingPolicy } from "./policy";
import { validateExistingSchedules } from "./scheduling";

export async function getSchedule(user: RequestUserType, key: string) {
    requirePrivilege(user, "scheduling:manage");
    const schedule = await prisma.schedule.findUnique({ where: { key } });
    return { schedule: schedule ?? { key, weekly: [], exceptions: [] }, policy: bookingPolicy() };
}

export async function replaceSchedule(user: RequestUserType, key: string, input: ScheduleInput) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "scheduling:manage");
        if (key !== "business") ensure(await tx.user.findUnique({ where: { id: key } }), 404, "Staff account not found");
        const schedule = await tx.schedule.upsert({ where: { key }, create: { key, staffId: key === "business" ? null : key, ...input }, update: input });
        await validateExistingSchedules(tx);
        return schedule;
    });
}

export async function getQualifications(user: RequestUserType, staffId: string) {
    requirePrivilege(user, "scheduling:manage");
    return prisma.staffService.findMany({ where: { staffId }, include: { service: true }, orderBy: { serviceId: "asc" } });
}

export async function replaceQualifications(user: RequestUserType, staffId: string, serviceIds: string[]) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "scheduling:manage");
        ensure(await tx.user.findUnique({ where: { id: staffId } }), 404, "Staff account not found");
        ensure(await tx.service.count({ where: { id: { in: serviceIds } } }) === serviceIds.length, 400, "Unknown service");
        await tx.staffService.deleteMany({ where: { staffId } });
        await tx.staffService.createMany({ data: serviceIds.map(serviceId => ({ staffId, serviceId })) });
        await validateExistingSchedules(tx);
        return { staffId, serviceIds };
    });
}

export async function getTimeOff(user: RequestUserType, staffId: string, pageNumber: number, pageSize: number) {
    requirePrivilege(user, "scheduling:manage");
    const where = { staffId };
    const [totalCount, entries] = await prisma.$transaction([
        prisma.staffTimeOff.count({ where }),
        prisma.staffTimeOff.findMany({ where, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: pageSize, skip: (pageNumber - 1) * pageSize }),
    ], { isolationLevel: "RepeatableRead" });
    return { entries, pagination: { pageNumber, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) } };
}

export async function addTimeOff(user: RequestUserType, staffId: string, input: z.infer<typeof timeOffSchema>) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "scheduling:manage");
        ensure(await tx.user.findUnique({ where: { id: staffId } }), 404, "Staff account not found");
        const entry = await tx.staffTimeOff.create({ data: { staffId, ...input } });
        await validateExistingSchedules(tx);
        return entry;
    });
}

export async function deleteTimeOff(user: RequestUserType, staffId: string, id: string) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "scheduling:manage");
        await tx.staffTimeOff.delete({ where: { id, staffId } });
        return { id };
    });
}

export async function recordConsultation(user: RequestUserType, input: z.infer<typeof consultationSchema>) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "consultations:record");
        ensure(input.completedAt <= new Date(), 400, "Consultation must already be completed");
        const validUntil = input.validUntil ?? new Date(input.completedAt.getTime() + bookingPolicy().consultationDays * 86400000);
        ensure(validUntil > input.completedAt, 400, "Consultation expiry must follow completion");
        ensure(await tx.user.findUnique({ where: { id: input.customerId } }), 404, "Customer not found");
        ensure(await tx.service.count({ where: { id: { in: input.serviceIds } } }) === input.serviceIds.length, 400, "Unknown consultation service");
        return tx.consultationRecord.create({ data: {
            customerId: input.customerId, recordedById: actor.id, completedAt: input.completedAt, validUntil,
            approved: input.approved, notes: input.notes, clearances: { create: input.serviceIds.map(serviceId => ({ serviceId })) },
        }, include: { clearances: true } });
    });
}

export async function listConsultations(user: RequestUserType, input: z.infer<typeof consultationQuerySchema>) {
    const all = user.privileges.includes("consultations:read:all");
    if (!all) {
        requirePrivilege(user, "consultations:read:own");
        ensure(!input.customerId || input.customerId === user.id, 403, "Consultation access denied");
    }
    const where = { customerId: all ? input.customerId : user.id };
    const [totalCount, records] = await prisma.$transaction([
        prisma.consultationRecord.count({ where }),
        prisma.consultationRecord.findMany({ where, include: { clearances: true }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], skip: (input.pageNumber - 1) * input.pageSize, take: input.pageSize }),
    ], { isolationLevel: "RepeatableRead" });
    return { records, pagination: { pageNumber: input.pageNumber, pageSize: input.pageSize, totalCount, totalPages: Math.ceil(totalCount / input.pageSize) } };
}
