import { NextRequest } from "next/server";
import * as jose from "jose";

type RequestUserType = {
    privileges: string[];
    [key: string]: unknown;
};

export async function getUser(request : NextRequest) : Promise<RequestUserType | null>{

    const loginToken = request.cookies.get("login-token")?.value
    
    const secretText = process.env.JOSE_SECRET || "TemporySecret8929%"

    const secret = new TextEncoder().encode(secretText)

    try{

        const tokenData = await jose.jwtVerify(
            loginToken||"",
            secret
        )

        const user = tokenData.payload as unknown as RequestUserType

        return user

    }catch{

        return null

    }
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