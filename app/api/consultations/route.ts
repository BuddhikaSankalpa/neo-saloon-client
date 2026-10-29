import { NextRequest } from "next/server";
import { api, query } from "@/lib/appointments/http";
import { listConsultations, recordConsultation } from "@/lib/appointments/management";
import { consultationQuerySchema, consultationSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest) {
    return api(request, user => listConsultations(user, consultationQuerySchema.parse(query(request))));
}

export async function POST(request: NextRequest) {
    return api(request, async user => recordConsultation(user, consultationSchema.parse(await request.json())), 201);
}
