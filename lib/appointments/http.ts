import { NextRequest, NextResponse } from "next/server";
import z from "zod";
import { getUser } from "@/utils/authentication";
import type { RequestUserType } from "@/types/requestUser";
import { ApiError, ensure } from "./errors";

export async function api(request: NextRequest, work: (user: RequestUserType) => Promise<unknown>, status = 200) {
    try {
        if (!["GET", "HEAD"].includes(request.method)) {
            const origin = request.headers.get("origin");
            ensure(!origin || origin === request.nextUrl.origin, 403, "Cross-origin mutation rejected");
        }
        const user = await getUser(request);
        ensure(user, 401, "Authentication required");
        return NextResponse.json({ data: await work(user) }, { status, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        if (error instanceof ApiError) return NextResponse.json({ message: error.message }, { status: error.status });
        if (error instanceof z.ZodError) return NextResponse.json({ message: "Invalid request", issues: error.issues }, { status: 400 });
        if (error instanceof SyntaxError) return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (["P2002", "P2003", "P2034"].includes(String(code))) return NextResponse.json({ message: "Conflicting update; refresh and retry" }, { status: 409 });
        if (code === "P2025") return NextResponse.json({ message: "Resource not found" }, { status: 404 });
        console.error("Appointment API failure", error);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}

export function query(request: NextRequest) {
    const result: Record<string, string> = {};
    for (const [key, value] of request.nextUrl.searchParams) {
        ensure(!(key in result), 400, `Duplicate query parameter: ${key}`);
        result[key] = value;
    }
    return result;
}

export type IdContext = { params: Promise<{ id: string }> };
