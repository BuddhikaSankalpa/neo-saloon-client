import { NextRequest } from "next/server";
import { api, type IdContext } from "@/lib/appointments/http";
import { getAppointment, updateAppointment } from "@/lib/appointments/appointments";
import { idSchema, updateAppointmentSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest, context: IdContext) {
    return api(request, async user => getAppointment(user, idSchema.parse((await context.params).id)));
}

export async function PATCH(request: NextRequest, context: IdContext) {
    return api(request, async user => updateAppointment(user, idSchema.parse((await context.params).id), updateAppointmentSchema.parse(await request.json())));
}
