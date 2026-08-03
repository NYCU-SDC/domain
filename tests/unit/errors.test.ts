import { describe, expect, it } from "vitest";

import { safeErrorDiagnostics } from "../../app/shared/lib/errors";

describe("safe error diagnostics", () => {
	it("keeps bounded native error details without a stack", () => {
		const diagnostics = safeErrorDiagnostics(new TypeError("runtime failure"));
		expect(diagnostics).toEqual({ errorMessage: "runtime failure", errorName: "TypeError" });
		expect(diagnostics).not.toHaveProperty("stack");
	});

	it.each(["Bearer token-value", "cookie contained a value", "OAuth code leaked", "API token was invalid"])("redacts sensitive fragments in %s", message => {
		expect(safeErrorDiagnostics(new Error(message)).errorMessage).toBe("Sensitive error message redacted");
	});

	it("does not stringify unknown thrown values", () => {
		expect(safeErrorDiagnostics({ secret: "do-not-log" })).toEqual({ errorMessage: "Non-Error value", errorName: "UnknownError" });
	});
});
