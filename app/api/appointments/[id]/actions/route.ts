import { NextRequest } from "next/server";
import { api, type IdContext } from "@/lib/appointments/http";
import { appointmentAction } from "@/lib/appointments/appointments";
import { actionSchema, idSchema } from "@/types/dto/AppointmentRequests";

export async function POST(request: NextRequest, context: IdContext) {
    return api(request, async user => appointmentAction(user, idSchema.parse((await context.params).id), actionSchema.parse(await request.json())));
}
