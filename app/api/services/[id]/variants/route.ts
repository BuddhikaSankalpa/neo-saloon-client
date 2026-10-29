import { NextRequest } from "next/server";
import { api, type IdContext } from "@/lib/appointments/http";
import { createVariant } from "@/lib/appointments/catalog";
import { idSchema, variantSchema } from "@/types/dto/AppointmentRequests";

export async function POST(request: NextRequest, context: IdContext) {
    return api(request, async user => createVariant(user, idSchema.parse((await context.params).id), variantSchema.parse(await request.json())), 201);
}
