import { NextRequest } from "next/server";
import { api } from "@/lib/appointments/http";
import { deleteTimeOff } from "@/lib/appointments/management";
import { idSchema } from "@/types/dto/AppointmentRequests";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; timeOffId: string }> }) {
    return api(request, async user => {
        const params = await context.params;
        return deleteTimeOff(user, idSchema.parse(params.id), idSchema.parse(params.timeOffId));
    });
}
