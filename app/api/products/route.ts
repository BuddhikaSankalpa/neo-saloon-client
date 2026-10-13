import { NextRequest, NextResponse } from "next/server";
import { isPrivileged } from "@/utils/authentication";
import ProductCreationRequestSchema, { MediaArraySchema } from "@/types/dto/ProductCreationRequest";
import z from "zod";
import prisma from "@/lib/prisma";
import getPaginationInfo from "@/utils/pageInfoRetrieval";
import { ProductStatus } from "@/app/generated/prisma/enums";
import ProductUpdateRequestSchema from "@/types/dto/ProductUpdateRequest";


//RETREAVE PRODUCTS ----------------------------------------------------------------------
export async function GET(request : NextRequest){

    const params = getPaginationInfo(request)

    const hasPrivilege = await isPrivileged(request , "products:read")

    if(hasPrivilege){
        //All products except DELETED
        const totalProducts = await prisma.product.count(
            {
                where : {
                    NOT : {
                        status : ProductStatus.DELETED
                    }
                }
            }
        )

        const totalPages = Math.ceil( totalProducts / params.pageSize )

        const products = await prisma.product.findMany({
            skip : (params.pageNumber - 1) * params.pageSize,
            take : params.pageSize,
            include : {
                media : true
            },
            where : {
                NOT : {
                    status : ProductStatus.DELETED
                }
            }
        })

        return NextResponse.json(
            {
                message : "Products fetched successfully",
                products : products,
                pagination : {
                    pageNumber : params.pageNumber,
                    pageSize : params.pageSize,
                    totalPages : totalPages,
                    totalCount : totalProducts
                }
            }
        )
    }else{

        const totalProducts = await prisma.product.count(
            {
                where : {
                    status : ProductStatus.ACTIVE
                }
            }
        )
        const totalPages = Math.ceil( totalProducts / params.pageSize )

        const products = await prisma.product.findMany({
            skip : (params.pageNumber - 1) * params.pageSize,
            take : params.pageSize,
            include : {
                media : true
            },
            where : {
                status : ProductStatus.ACTIVE
            }
        })

        return NextResponse.json(
            {
                message : "Products fetched successfully",
                products : products,
                pagination : {
                    pageNumber : params.pageNumber,
                    pageSize : params.pageSize,
                    totalPages : totalPages,
                    totalCount : totalProducts
                }
            }
        )
    }
}




// CREATE PRODUCT ----------------------------------------------------------------------

export async function POST(request : NextRequest){

    const hasPrivilege = await isPrivileged(request , "products:add") 

    if(hasPrivilege){


        try{

            const body = await request.json()

            const parsedBody = ProductCreationRequestSchema.parse(body)

            await prisma.product.create(
                {
                    data : {
                        sku : parsedBody.sku,
                        name : parsedBody.name,
                        altNames : parsedBody.altNames,
                        description : parsedBody.description,
                        stock : parsedBody.stock,
                        status : parsedBody.status,
                        price : parsedBody.price,
                        compareAt : parsedBody.compareAt,
                        brand : parsedBody.brand,
                        model : parsedBody.model,
                        media : {
                            create : parsedBody.media
                        }
                    }
                }
            )

            return NextResponse.json(
                {
                    message : "Product created successfully"
                },
                {
                    status : 201
                }
            )

            
        }catch(error){

            if(error instanceof z.ZodError){

                return NextResponse.json(
                    {
                        message : error.issues[0]?.message ?? "Invalid input",
                    },
                    {
                        status : 400
                    }
                )

            }

            return NextResponse.json({
                message : "Internal server error",
            },
            {
                status : 500
            })
        }        


        

    }else{        
        return NextResponse.json({message : "You do not have the required privilege to add a product"} , {status : 403})
    }
}




//DELETE PRODUCT ----------------------------------------------------------------------

export async function DELETE(request : NextRequest){

    const hasPrivilege = await isPrivileged(request , "products:delete")

    if(!hasPrivilege){
        return NextResponse.json({message : "You do not have the required privilege to delete a product"} , {status : 403})
    }

    const id = request.nextUrl.searchParams.get("id")

    if(id == null){
        return NextResponse.json({message : "Product id is required"} , {status : 400})
    }
    try{    
        const existingProduct = await prisma.product.findUnique({
            where : {
                id : id
            }
        })

        if(existingProduct == null){
            return NextResponse.json({message : "Product not found"} , {status : 404})
        }

        await prisma.product.update(
            {
                where : {
                    id : id
                },
                data : {
                    status : ProductStatus.DELETED
                }
            }
        )

        return NextResponse.json(
            {
                message : "Product deleted successfully"
            },
            {
                status : 200
            }
        )
    }catch(error){
        return NextResponse.json(
            {
                message : "Internal server error"
            },
            {
                status : 500
            }
        )
    }
}




// UPDATE PRODUCT ----------------------------------------------------------------------

export async function PUT(request : NextRequest){

    const hasPrivilege = await isPrivileged(request , "products:edit")

    if(!hasPrivilege){
        return NextResponse.json({message : "You do not have the required privilege to update a product"} , {status : 403})
    }

    const id = request.nextUrl.searchParams.get("id")

    if(id == null){
        return NextResponse.json({message : "Product id is required"} , {status : 400})
    }

    try{

        const body = await request.json()

        const  parsedBody = ProductUpdateRequestSchema.parse(body)

        const existingProduct = await prisma.product.findUnique({
            where : {
                id : id
            }
        })

        if(existingProduct == null){
            return NextResponse.json({message : "Product not found"} , {status : 404})
        }

        if(existingProduct.status == ProductStatus.DELETED){
            return NextResponse.json({message : "Product not found"} , {status : 400})
        }

        await prisma.product.update(
            {
                where : {
                    id : id
                },
                data : {
                    sku : parsedBody.sku || existingProduct.sku,
                    name : parsedBody.name || existingProduct.name,
                    altNames : parsedBody.altNames || existingProduct.altNames,
                    description : parsedBody.description || existingProduct.description,
                    stock : parsedBody.stock || existingProduct.stock,
                    status : parsedBody.status || existingProduct.status,
                    price : parsedBody.price || existingProduct.price,
                    compareAt : parsedBody.compareAt || existingProduct.compareAt,
                    brand : parsedBody.brand || existingProduct.brand,
                    model : parsedBody.model || existingProduct.model
                }
            }
        )

        

        if(parsedBody.media != null && parsedBody.media.length > 0){

            const parsedMediaArray = MediaArraySchema.parse(parsedBody.media)
            
            await prisma.media.deleteMany({
                where : {
                    productId : id
                }
            })

            await prisma.product.update({
                where : {
                    id : id
                },
                data : {
                    media : {
                        create : parsedMediaArray
                    }
                }
            })

        }

        return NextResponse.json(
            {
                message : "Product updated successfully"
            },
            {
                status : 200
            }
        )

    }catch(error){

        if(error instanceof z.ZodError){
            return NextResponse.json(
                {
                    message : error.issues[0]?.message ?? "Invalid input",
                },
                {
                    status : 400
                }
            )
        }

        console.error(error)

        return NextResponse.json(
            {
                message : "Internal server error"
            },
            {
                status : 500
            }
        )
    }

}



