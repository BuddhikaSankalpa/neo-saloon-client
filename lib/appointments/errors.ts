export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export function ensure(condition: unknown, status: number, message: string): asserts condition {
    if (!condition) throw new ApiError(status, message);
}
