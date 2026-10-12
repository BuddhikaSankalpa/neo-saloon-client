import { MediaType, ProductStatus } from "@/app/generated/prisma/enums";
import z from "zod";


const ProductStatusEnum = z.enum(ProductStatus);
const MediaTypeEnum = z.enum(MediaType);

export const MediaArraySchema = z.array(
    z.object({
        url : z.url(),
        type : MediaTypeEnum
    })
)

const ProductCreationRequestSchema = z.object({
    sku: z.string().max(50),
    name: z.string().max(100),
    altNames : z.array( z.string().max(100) ).optional().default([]),
    description: z.string(),
    stock : z.number().int().min(0),
    status : ProductStatusEnum.optional().default("ACTIVE"),
    price : z.number().min(0),
    compareAt : z.number().min(0).optional(),
    brand : z.string().max(100).optional(),
    model : z.string().max(100).optional(),
    media : MediaArraySchema
})




export default ProductCreationRequestSchema

export type ProductCreationRequest = z.infer<typeof ProductCreationRequestSchema>


