import { MediaType, ProductStatus } from "@/app/generated/prisma/enums";
import z from "zod";
import { MediaArraySchema } from "./ProductCreationRequest";


const ProductStatusEnum = z.enum(ProductStatus);
const MediaTypeEnum = z.enum(MediaType);
const ProductUpdateRequestSchema = z.object({
    sku: z.string().max(50).optional(),
    name: z.string().max(100).optional(),
    altNames : z.array( z.string().max(100) ).optional(),
    description: z.string().optional(),
    stock : z.number().int().min(0).optional(),
    status : ProductStatusEnum.optional(),
    price : z.number().min(0).optional(),
    compareAt : z.number().min(0).optional(),
    brand : z.string().max(100).optional(),
    model : z.string().max(100).optional(),
    media : MediaArraySchema.optional()
})

export default ProductUpdateRequestSchema

export type ProductUpdateRequest = z.infer<typeof ProductUpdateRequestSchema>