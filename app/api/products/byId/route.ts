import { ProductStatus } from "@/app/generated/prisma/enums";
import prisma from "@/lib/prisma";
import { isPrivileged } from "@/utils/authentication";
import { NextRequest, NextResponse } from "next/server";



//RETRIEVE PRODUCTS BY ID ----------------------------------------------------------------------

export async function GET(request : NextRequest){

    const id = request.nextUrl.searchParams.get("id")

    if(id == null){
        return NextResponse.json({message : "Product id is required"} , {status : 400})
    }

    try{
        const product = await prisma.product.findUnique({
            where : {
                id : id
            }
        })

        if(product == null){
            return NextResponse.json({message : "Product not found"} , {status : 404})
        }

        if(product.status == ProductStatus.DELETED){
            return NextResponse.json({message : "Product not found"} , {status : 404})
        }

        if(product.status == ProductStatus.INACTIVE){

            const hasPrivilege = await isPrivileged(request , "products:read")

            if(!hasPrivilege){
                return NextResponse.json({message : "Product not found"} , {status : 404})
            }

        }

        return NextResponse.json(product , {status : 200})
    }catch(error){

        return NextResponse.json({message : "Internal server error"} , {status : 500})
        
    }


}