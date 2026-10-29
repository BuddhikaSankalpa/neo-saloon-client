import { NextRequest } from "next/server";
import z from "zod";
import { api, query } from "@/lib/appointments/http";
import { bookAppointment, listAppointments } from "@/lib/appointments/appointments";
import { appointmentQuerySchema, bookingSchema } from "@/types/dto/AppointmentRequests";

export async function GET(request: NextRequest) {
    return api(request, user => listAppointments(user, appointmentQuerySchema.parse(query(request))));
}

export async function POST(request: NextRequest) {
    return api(request, async user => bookAppointment(user, bookingSchema.parse(await request.json()),
        z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).parse(request.headers.get("Idempotency-Key"))), 201);
}
