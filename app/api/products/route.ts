import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/utils/authentication";

export async function GET(request: NextRequest) {
    const user = getUser(request)

}
