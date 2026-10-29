import prisma from "@/lib/prisma";
import type { RequestUserType } from "@/types/requestUser";
import { serviceQuerySchema, serviceSchema, serviceUpdateSchema, variantSchema, variantUpdateSchema } from "@/types/dto/AppointmentRequests";
import z from "zod";
import { requirePrivilege } from "./authorization";
import { write } from "./database";
import { ensure } from "./errors";

export async function listServices(user: RequestUserType, input: z.infer<typeof serviceQuerySchema>, id?: string) {
    requirePrivilege(user, input.scope === "all" ? "services:read:all" : "services:read");
    const where = {
        id,
        ...(input.scope === "listed" ? { status: "ACTIVE" as const, listed: true } : {}),
        ...(input.search ? { name: { contains: input.search, mode: "insensitive" as const } } : {}),
    };
    const [totalCount, services] = await prisma.$transaction([
        prisma.service.count({ where }),
        prisma.service.findMany({ where, include: { variants: { where: input.scope === "listed" ? { active: true } : {}, orderBy: { name: "asc" } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: input.pageSize, skip: (input.pageNumber - 1) * input.pageSize }),
    ], { isolationLevel: "RepeatableRead" });
    if (id) { ensure(services[0], 404, "Service not found"); return services[0]; }
    return { services, pagination: { pageNumber: input.pageNumber, pageSize: input.pageSize, totalCount, totalPages: Math.ceil(totalCount / input.pageSize) } };
}

export async function createService(user: RequestUserType, input: z.infer<typeof serviceSchema>) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "services:add");
        return tx.service.create({ data: input });
    });
}

export async function updateService(user: RequestUserType, id: string, input: z.infer<typeof serviceUpdateSchema>) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "services:edit");
        return tx.service.update({ where: { id }, data: input });
    });
}

export async function createVariant(user: RequestUserType, serviceId: string, input: z.infer<typeof variantSchema>) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "services:edit");
        ensure(await tx.service.findUnique({ where: { id: serviceId } }), 404, "Service not found");
        return tx.serviceVariant.create({ data: { ...input, serviceId } });
    });
}

export async function updateVariant(user: RequestUserType, serviceId: string, id: string, input: z.infer<typeof variantUpdateSchema>) {
    return write(user, async (tx, actor) => {
        requirePrivilege(actor, "services:edit");
        return tx.serviceVariant.update({ where: { id, serviceId }, data: input });
    });
}
