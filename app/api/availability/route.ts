import { NextRequest } from "next/server";
import { api } from "@/lib/appointments/http";
import { findAvailability } from "@/lib/appointments/appointments";
import { availabilitySchema } from "@/types/dto/AppointmentRequests";

// POST carries structured service/variant selections. This endpoint does not reserve capacity.
export async function POST(request: NextRequest) {
    return api(request, async user => findAvailability(user, availabilitySchema.parse(await request.json())));
}
