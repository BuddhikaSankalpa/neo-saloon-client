import { NextRequest } from "next/server";
import { api } from "@/lib/appointments/http";
import { updateVariant } from "@/lib/appointments/catalog";
import { idSchema, variantUpdateSchema } from "@/types/dto/AppointmentRequests";

type Context = { params: Promise<{ id: string; variantId: string }> };
export async function PATCH(request: NextRequest, context: Context) {
    return api(request, async user => {
        const params = await context.params;
        return updateVariant(user, idSchema.parse(params.id), idSchema.parse(params.variantId), variantUpdateSchema.parse(await request.json()));
    });
}

export async function DELETE(request: NextRequest, context: Context) {
    return api(request, async user => {
        const params = await context.params;
        return updateVariant(user, idSchema.parse(params.id), idSchema.parse(params.variantId), { active: false });
    });
}
