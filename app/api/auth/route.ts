import prisma from "@/lib/prisma";
import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import * as jose from "jose";


//LOGIN USERS ----------------------------------------------------------------------

export async function POST(request : NextRequest){

    const body = await request.json();

    if(body.email == null){
        
        return NextResponse.json(
            {
                message : "Email is required"
            },
            {
                status : 422
            }
        )

    }

    if(body.password == null){
        return NextResponse.json(
            {
                message : "Password is required"
            },
            {
                status : 422
            }
        )
    }

    const user = await prisma.user.findFirst(
        {
            where : {
                email : body.email
            }
        }
    )

    

    if(user == null){
        
        return NextResponse.json(
            {
                message : "User not found"
            },
            {
                status : 404
            }
        )

    }

    if(user.status != "ACTIVE"){

        return NextResponse.json(
            {
                message : "Your account is disabled. Please contact the administrator."
            },
            {
                status : 403
            }
        )
    }

    const isPasswordValid = await compare(body.password, user.password)

    if(isPasswordValid){

        await prisma.user.update(
            {
                where : {
                    id : user.id
                },
                data : {
                    lastLogin : new Date()
                }
            }
        )

        const secretText = process.env.JOSE_SECRET 

        const secret = new TextEncoder().encode(secretText)

        const token = await new jose.SignJWT({
            id : user.id,
            email : user.email,
            firstName : user.firstName,
            lastName : user.lastName,
            role : user.role,
            privileges : user.privileges
        }).setProtectedHeader({ alg : "HS256" }).sign(secret)

        const response = NextResponse.json(
            {
                message : "Login successful",
                role : user.role,
            }
        )

        response.cookies.set(
            {
                name : "login-token",
                value : token,
                httpOnly : true, // This cookie is only accessible by the server
                secure : false, // This cookie is only sent over HTTPS
                sameSite : "lax", // This cookie is only sent to the same site
                maxAge : 60 * 60 * 24 * 7, // 7 days
            }
        )
        
        return response

    }else{

        return NextResponse.json(
            {
                message : "Invalid password"
            },
            {
                status : 401
            }
        )

    }    

}