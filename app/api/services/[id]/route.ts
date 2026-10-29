import { NextRequest } from "next/server";
import { api, query, type IdContext } from "@/lib/appointments/http";
import { listServices, updateService } from "@/lib/appointments/catalog";
import { idSchema, serviceQuerySchema, serviceUpdateSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest, context: IdContext) {
    return api(request, async user => listServices(user, serviceQuerySchema.parse(query(request)), idSchema.parse((await context.params).id)));
}

export async function PATCH(request: NextRequest, context: IdContext) {
    return api(request, async user => updateService(user, idSchema.parse((await context.params).id), serviceUpdateSchema.parse(await request.json())));
}

export async function DELETE(request: NextRequest, context: IdContext) {
    return api(request, async user => updateService(user, idSchema.parse((await context.params).id), { status: "ARCHIVED", listed: false }));
}
