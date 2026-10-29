import { NextRequest } from "next/server";
import { api, query } from "@/lib/appointments/http";
import { createService, listServices } from "@/lib/appointments/catalog";
import { serviceQuerySchema, serviceSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest) {
    return api(request, user => listServices(user, serviceQuerySchema.parse(query(request))));
}

export async function POST(request: NextRequest) {
    return api(request, async user => createService(user, serviceSchema.parse(await request.json())), 201);
}
