import type { ZodError } from "zod";

export const errorCodes = ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT", "PROTECTED_RESOURCE", "RATE_LIMITED", "UPSTREAM_ERROR", "INTERNAL_ERROR"] as const;

export type ErrorCode = (typeof errorCodes)[number];

const statusByCode: Record<ErrorCode, number> = {
	CONFLICT: 409,
	FORBIDDEN: 403,
	INTERNAL_ERROR: 500,
	NOT_FOUND: 404,
	PROTECTED_RESOURCE: 403,
	RATE_LIMITED: 429,
	UNAUTHENTICATED: 401,
	UPSTREAM_ERROR: 502,
	VALIDATION_ERROR: 400
};

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly details?: ReadonlyArray<{ field: string; message: string }>;
	readonly httpStatus: number;

	constructor(
		code: ErrorCode,
		message: string,
		options?: {
			cause?: unknown;
			details?: ReadonlyArray<{ field: string; message: string }>;
			httpStatus?: number;
		}
	) {
		super(message, { cause: options?.cause });
		this.name = "AppError";
		this.code = code;
		this.details = options?.details;
		this.httpStatus = options?.httpStatus ?? statusByCode[code];
	}
}

export function validationErrorFromZod(error: ZodError): AppError {
	return new AppError("VALIDATION_ERROR", "輸入資料格式不正確", {
		details: error.issues.map(issue => ({
			field: issue.path.join(".") || "request",
			message: issue.message
		}))
	});
}

export function toAppError(error: unknown): AppError {
	if (error instanceof AppError) return error;
	return new AppError("INTERNAL_ERROR", "系統暫時無法處理請求", { cause: error });
}

const SENSITIVE_ERROR_FRAGMENT = /\b(?:authorization|bearer|cookie|oauth(?:\s+|_)code|session(?:\s+|_)token|api(?:\s+|_)token)\b/iu;

export function safeErrorDiagnostics(error: unknown): { errorMessage: string; errorName: string } {
	if (!(error instanceof Error)) {
		return { errorMessage: "Non-Error value", errorName: "UnknownError" };
	}
	const message = SENSITIVE_ERROR_FRAGMENT.test(error.message) ? "Sensitive error message redacted" : error.message;
	return {
		errorMessage: message.slice(0, 300),
		errorName: error.name.slice(0, 80)
	};
}
