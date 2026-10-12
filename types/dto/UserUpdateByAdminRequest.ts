import z from "zod";

const UserUpdateByAdminRequestSchema = z.object(
    {
        id : z.never().optional(),
        password : z.never().optional(),
    }
)

export type UserUpdateByAdminRequest = z.infer<typeof UserUpdateByAdminRequestSchema>

export {UserUpdateByAdminRequestSchema}