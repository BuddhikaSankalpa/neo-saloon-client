import { NextRequest } from "next/server";
import { api, query, type IdContext } from "@/lib/appointments/http";
import { getHistory } from "@/lib/appointments/appointments";
import { idSchema, paginationSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest, context: IdContext) {
    return api(request, async user => {
        const params = paginationSchema.strict().parse(query(request));
        return getHistory(user, idSchema.parse((await context.params).id), params.pageNumber, params.pageSize);
    });
}
