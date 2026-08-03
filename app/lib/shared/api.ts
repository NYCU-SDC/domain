import { AppError, toAppError } from "./errors";

export interface ApiSuccess<T> {
	readonly data: T;
	readonly ok: true;
	readonly requestId: string;
}

export interface ApiFailure {
	readonly error: {
		readonly code: string;
		readonly details?: ReadonlyArray<{ field: string; message: string }>;
		readonly message: string;
	};
	readonly ok: false;
	readonly requestId: string;
}

const apiHeaders = {
	"Cache-Control": "no-store",
	"Content-Type": "application/json; charset=utf-8"
} as const;

export function apiSuccess<T>(data: T, requestId: string, init?: { headers?: HeadersInit; status?: number }): Response {
	const headers = new Headers(apiHeaders);
	if (init?.headers) {
		for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
	}
	return Response.json({ data, ok: true, requestId } satisfies ApiSuccess<T>, { headers, status: init?.status ?? 200 });
}

export function apiFailure(error: unknown, requestId: string): Response {
	const appError = toAppError(error);
	const body: ApiFailure = {
		error: {
			code: appError.code,
			message: appError.message,
			...(appError.details ? { details: appError.details } : {})
		},
		ok: false,
		requestId
	};
	const headers = new Headers(apiHeaders);
	if (appError.code === "RATE_LIMITED") headers.set("Retry-After", "60");
	return Response.json(body, { headers, status: appError.httpStatus });
}

export function assertJsonRequest(request: Request): void {
	const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
	if (!contentType.startsWith("application/json")) {
		throw new AppError("VALIDATION_ERROR", "此 API 只接受 application/json 格式", { httpStatus: 415 });
	}
}
