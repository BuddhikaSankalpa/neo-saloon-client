import { NextRequest } from "next/server";
import { api, query, type IdContext } from "@/lib/appointments/http";
import { addTimeOff, getTimeOff } from "@/lib/appointments/management";
import { idSchema, paginationSchema, timeOffSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest, context: IdContext) {
    return api(request, async user => {
        const params = paginationSchema.strict().parse(query(request));
        return getTimeOff(user, idSchema.parse((await context.params).id), params.pageNumber, params.pageSize);
    });
}

export async function POST(request: NextRequest, context: IdContext) {
    return api(request, async user => addTimeOff(user, idSchema.parse((await context.params).id), timeOffSchema.parse(await request.json())), 201);
}
