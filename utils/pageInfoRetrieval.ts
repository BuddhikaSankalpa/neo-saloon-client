import { NextRequest } from "next/server";

export default function getPaginationInfo(request : NextRequest){

    const pageNumberInString = request.nextUrl.searchParams.get("pageNumber")||"1"
    const pageSizeInString = request.nextUrl.searchParams.get("pageSize")||"10"

    const pageNumber = parseInt(pageNumberInString)
    const pageSize = parseInt(pageSizeInString)

    return {
        pageNumber : pageNumber,
        pageSize : pageSize
    }
}