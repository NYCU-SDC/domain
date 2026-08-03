import { z } from "zod";

const githubLoginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/u;

export const applicationStatuses = ["pending", "reviewing", "approved", "rejected"] as const;

export const accessApplicationFormSchema = z.object({
	applicantName: z.string().trim().min(2, "請填寫申請人姓名").max(100),
	contact: z.string().trim().min(3, "請填寫可聯絡到你的 Email 或 Discord 帳號").max(160),
	currentWebsiteUrl: z
		.string()
		.trim()
		.max(500)
		.transform(value => value || null)
		.refine(value => {
			if (!value) return true;
			try {
				const url = new URL(value);
				return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
			} catch {
				return false;
			}
		}, "請輸入不含帳號密碼的 http 或 https 網址"),
	githubLogin: z
		.string()
		.trim()
		.transform(value => value.replace(/^@/u, "").toLowerCase())
		.pipe(z.string().min(1, "請填寫 GitHub username").max(39).regex(githubLoginPattern, "GitHub username 格式不正確")),
	organizationName: z.string().trim().min(2, "請填寫社團或單位名稱").max(120),
	purpose: z.string().trim().min(30, "請用至少 30 個字說明網站用途與預計內容").max(2_000),
	requestedNamespace: z.string().trim().min(4, "請填寫想申請的 namespace").max(253),
	terms: z.literal("accepted", {
		error: "請確認你了解 namespace 與使用規範"
	}),
	website: z.string().max(0, "表單驗證失敗").default("")
});

export const reviewAccessApplicationSchema = z.object({
	adminNote: z
		.string()
		.trim()
		.max(1_000)
		.transform(value => value || null),
	applicationId: z.uuid("申請 ID 格式不正確"),
	csrfToken: z.string().min(32),
	status: z.enum(applicationStatuses)
});

export const accessApplicationListQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	search: z.string().trim().max(120).default(""),
	status: z.enum(["all", ...applicationStatuses]).default("all")
});

export type AccessApplicationFormInput = z.infer<typeof accessApplicationFormSchema>;
export type AccessApplicationStatus = (typeof applicationStatuses)[number];
export type ReviewAccessApplicationInput = z.infer<typeof reviewAccessApplicationSchema>;
