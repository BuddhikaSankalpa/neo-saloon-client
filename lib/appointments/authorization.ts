import type { RequestUserType } from "@/types/requestUser";
import { ensure } from "./errors";

export function requirePrivilege(user: RequestUserType, privilege: string) {
    ensure(user.privileges.includes(privilege), 403, `Missing privilege: ${privilege}`);
}

type Ownership = { customerId: string; staffId: string };
export function canAccessAppointment(user: RequestUserType, appointment: Ownership, action: "read" | "edit") {
    return user.privileges.includes(`appointments:${action}:all`)
        || (user.id === appointment.customerId && user.privileges.includes(`appointments:${action}:own`))
        || (user.id === appointment.staffId && user.privileges.includes(`appointments:${action}:assigned`));
}

export function requireAssigned(user: RequestUserType, appointment: Ownership, privilege: string) {
    requirePrivilege(user, privilege);
    ensure(user.id === appointment.staffId, 403, "Only the currently assigned staff member may perform this action");
}
