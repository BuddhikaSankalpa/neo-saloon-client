import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import type { RequestUserType } from "@/types/requestUser";
import { ApiError, ensure } from "./errors";

export type Database = Prisma.TransactionClient;

// A single salon-wide lock keeps schedule edits, consultation recording and booking
// mutations in the same ordering. Serializable isolation also protects read predicates.
export async function write<T>(user: RequestUserType, work: (tx: Database, actor: RequestUserType) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await prisma.$transaction(async tx => {
                await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(734902611)`;
                const actor = await tx.user.findUnique({ where: { id: user.id }, select: {
                    id: true, email: true, firstName: true, lastName: true, role: true, privileges: true, status: true,
                } });
                ensure(actor?.status === "ACTIVE", 401, "Account is no longer active");
                return work(tx, actor);
            }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 20000 });
        } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
                if (attempt < 2) continue;
                throw new ApiError(409, "Concurrent update; refresh and retry");
            }
            throw error;
        }
    }
    throw new ApiError(409, "Concurrent update; retry");
}
