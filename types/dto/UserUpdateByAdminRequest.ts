import z from "zod";

const UserUpdateByAdminRequestSchema = z.object(
    {
        id : z.never().optional(),
        password : z.never().optional(),
        email: z.email().optional(),
        firstName: z.string().min(1).max(20).optional(),
        lastName: z.string().min(1).max(20).optional(),
        phone: z.string().max(40).optional(),
        profileImage: z.string().max(2000).optional(),
        role: z.string().min(1).max(40).optional(),
        status: z.enum(["ACTIVE", "BANNED", "SUSPENDED"]).optional(),
        privileges: z.array(z.string().regex(/^[a-z][a-z-]*(?::[a-z][a-z-]*)+$/).max(100)).max(100).optional(),
    }
).strict()

export type UserUpdateByAdminRequest = z.infer<typeof UserUpdateByAdminRequestSchema>

export {UserUpdateByAdminRequestSchema}
