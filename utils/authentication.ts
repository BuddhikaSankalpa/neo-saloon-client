import { NextRequest } from "next/server";
import * as jose from "jose";
import prisma from "@/lib/prisma";
import type { RequestUserType } from "@/types/requestUser";

export async function getUser(request : NextRequest) : Promise<RequestUserType | null>{

    const loginToken = request.cookies.get("login-token")?.value
    
    const secretText = process.env.JOSE_SECRET

    if (!secretText || !loginToken) return null;
    const secret = new TextEncoder().encode(secretText)
    let userId: string;

    try{

        const tokenData = await jose.jwtVerify(
            loginToken||"",
            secret,
            { algorithms: ["HS256"], requiredClaims: ["exp"] }
        )

        if (typeof tokenData.payload.id !== "string") return null;
        userId = tokenData.payload.id;

    }catch{

        return null

    }
    // Token claims identify the account; the database determines current access.
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, privileges: true, status: true },
    });
    return user?.status === "ACTIVE" ? user : null;
}

export async function isPrivileged(request : NextRequest , privilege : string) : Promise<boolean>{

    const user:RequestUserType | null = await getUser(request)

    if(user == null){
        return false
    }

    if(user.privileges.includes(privilege)){
        return true
    }else{
        return false
    }
}
