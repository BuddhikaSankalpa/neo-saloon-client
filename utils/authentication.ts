import { NextRequest, NextResponse } from "next/server";
import * as jose from "jose"

export async function getUser(request: NextRequest) {
    const loginToken = request.cookies.get("login-token")?.value
    const secretText = process.env.JOSE_SECRET;
    const secret = new TextEncoder().encode(secretText);

    try {
        const user = await jose.jwtVerify(
            loginToken||"",
            secret 
        )
        return user.payload 

    } catch (error) {
        return null
    }
}