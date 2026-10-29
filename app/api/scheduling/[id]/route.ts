import { NextRequest } from "next/server";
import z from "zod";
import { api, type IdContext } from "@/lib/appointments/http";
import { getSchedule, replaceSchedule } from "@/lib/appointments/management";
import { idSchema, scheduleSchema } from "@/types/dto/AppointmentRequests";

const keySchema = z.union([z.literal("business"), idSchema]);
export async function GET(request: NextRequest, context: IdContext) {
    return api(request, async user => getSchedule(user, keySchema.parse((await context.params).id)));
}

export async function PUT(request: NextRequest, context: IdContext) {
    return api(request, async user => replaceSchedule(user, keySchema.parse((await context.params).id), scheduleSchema.parse(await request.json())));
}
