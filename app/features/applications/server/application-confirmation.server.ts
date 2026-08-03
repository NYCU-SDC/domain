import { requireSecret } from "~/server/config.server";
import type { AccessApplicationFormInput } from "~/shared/lib/applications";
import { constantTimeEqual, hmacSha256Hex } from "~/shared/lib/crypto";
import { AppError } from "~/shared/lib/errors";

const confirmationLifetimeMilliseconds = 10 * 60 * 1_000;
const confirmationVersion = "v1";

type NormalizedApplicationInput = AccessApplicationFormInput & { requestedNamespace: string };

export interface ApplicationConfirmation {
	readonly applicationId: string;
	readonly expiresAt: number;
	readonly token: string;
}

function confirmationPayload(applicationId: string, expiresAt: number, input: NormalizedApplicationInput): string {
	return JSON.stringify([
		"nycu.club:application-confirmation:v1",
		applicationId,
		expiresAt,
		input.organizationName,
		input.applicantName,
		input.githubLogin,
		input.contact,
		input.requestedNamespace,
		input.currentWebsiteUrl,
		input.purpose,
		input.terms,
		input.website
	]);
}

export async function createApplicationConfirmation(input: NormalizedApplicationInput, env: Env, now = Date.now()): Promise<ApplicationConfirmation> {
	const applicationId = crypto.randomUUID();
	const expiresAt = now + confirmationLifetimeMilliseconds;
	const signature = await hmacSha256Hex(requireSecret(env, "AUTH_SECRET"), confirmationPayload(applicationId, expiresAt, input));
	return {
		applicationId,
		expiresAt,
		token: `${confirmationVersion}.${applicationId}.${expiresAt}.${signature}`
	};
}

export async function verifyApplicationConfirmation(token: string | undefined, input: NormalizedApplicationInput, env: Env, now = Date.now()): Promise<string> {
	const [version, applicationId, expiresAtValue, signature, extra] = token?.split(".") ?? [];
	const expiresAt = Number(expiresAtValue);
	if (
		version !== confirmationVersion ||
		!applicationId ||
		!expiresAtValue ||
		!signature ||
		extra ||
		!Number.isSafeInteger(expiresAt) ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(applicationId)
	) {
		throw new AppError("VALIDATION_ERROR", "確認資料無效，請返回修改後重新檢查", {
			details: [{ field: "confirmation", message: "確認資料無效，請重新檢查申請內容" }]
		});
	}
	if (expiresAt <= now || expiresAt > now + confirmationLifetimeMilliseconds) {
		throw new AppError("VALIDATION_ERROR", "確認頁面已逾時，請返回修改後重新檢查", {
			details: [{ field: "confirmation", message: "確認頁面已逾時，請重新檢查申請內容" }]
		});
	}
	const expected = await hmacSha256Hex(requireSecret(env, "AUTH_SECRET"), confirmationPayload(applicationId, expiresAt, input));
	if (!(await constantTimeEqual(signature, expected))) {
		throw new AppError("VALIDATION_ERROR", "確認後的申請資料已變更，請返回修改後重新檢查", {
			details: [{ field: "confirmation", message: "申請資料已變更，請重新檢查全部內容" }]
		});
	}
	return applicationId;
}
