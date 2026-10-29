import { NextRequest } from "next/server";
import { api, type IdContext } from "@/lib/appointments/http";
import { getQualifications, replaceQualifications } from "@/lib/appointments/management";
import { idSchema, qualificationSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest, context: IdContext) {
    return api(request, async user => getQualifications(user, idSchema.parse((await context.params).id)));
}

export async function PUT(request: NextRequest, context: IdContext) {
    return api(request, async user => replaceQualifications(user, idSchema.parse((await context.params).id), qualificationSchema.parse(await request.json()).serviceIds));
}
