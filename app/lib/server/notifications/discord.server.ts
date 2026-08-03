import { AppError } from "../../shared/errors";
import type { AccessApplicationView } from "../applications/applications.server";
import { requireSecret } from "../config.server";

function getDiscordWebhookUrl(env: Env): string {
	const value = requireSecret(env, "DISCORD_APPLICATION_WEBHOOK_URL");
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new AppError("INTERNAL_ERROR", "Discord 申請通知尚未正確設定", {
			cause: error
		});
	}
	if (url.protocol !== "https:" || url.hostname !== "discord.com" || !/^\/api\/webhooks\/\d+\/[A-Za-z\d_-]+$/u.test(url.pathname) || url.search || url.hash || url.username || url.password) {
		throw new AppError("INTERNAL_ERROR", "Discord 申請通知尚未正確設定");
	}
	return url.toString();
}

export async function notifyDiscordOfApplication(application: AccessApplicationView, env: Env, requestId: string, fetcher: typeof fetch = fetch): Promise<void> {
	const response = await fetcher(getDiscordWebhookUrl(env), {
		body: JSON.stringify({
			allowed_mentions: { parse: [] },
			embeds: [
				{
					color: 0x087be8,
					fields: [
						{ inline: true, name: "社團／單位", value: application.organizationName },
						{ inline: true, name: "GitHub", value: `@${application.githubLogin}` },
						{ inline: false, name: "申請 namespace", value: application.requestedNamespace },
						{ inline: false, name: "聯絡方式", value: application.contact },
						{ inline: false, name: "用途", value: application.purpose.slice(0, 1_024) }
					],
					footer: { text: `申請 ${application.id} · Request ${requestId}` },
					timestamp: new Date(application.createdAt).toISOString(),
					title: "新的 nycu.club 子網域申請"
				}
			]
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
		signal: AbortSignal.timeout(8_000)
	});
	if (!response.ok) {
		throw new AppError(response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR", `Discord 通知失敗（HTTP ${response.status}）`);
	}
}
