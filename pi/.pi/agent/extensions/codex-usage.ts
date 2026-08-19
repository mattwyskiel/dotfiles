import { Buffer } from "node:buffer";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "openai-codex";
const STATUS_KEY = "codex-usage";
const FALLBACK_BASE_URL = "https://chatgpt.com/backend-api";
const MIN_REFRESH_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

type UsageWindow = {
	label: string;
	usedPercent: number;
	remainingPercent: number;
	resetsAt?: number;
};

type UsageSnapshot = {
	planType?: string;
	primary?: UsageWindow;
	secondary?: UsageWindow;
	additional: Array<{ name: string; primary?: UsageWindow; secondary?: UsageWindow }>;
	creditBalance?: string;
	fetchedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? number : undefined;
}

function durationLabel(seconds: number | undefined): string {
	if (!seconds || seconds <= 0) return "window";
	if (seconds >= 86_400 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
	if (seconds >= 3_600 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
	if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
	return `${Math.round(seconds)}s`;
}

function parseWindow(value: unknown, now: number): UsageWindow | undefined {
	if (!isRecord(value)) return undefined;

	const usedPercent = finiteNumber(value.used_percent);
	if (usedPercent === undefined) return undefined;

	const windowSeconds = finiteNumber(value.limit_window_seconds);
	const resetAt = finiteNumber(value.reset_at);
	const resetAfterSeconds = finiteNumber(value.reset_after_seconds);
	const resetsAt = resetAt !== undefined
		? (resetAt > 1_000_000_000_000 ? resetAt : resetAt * 1_000)
		: resetAfterSeconds !== undefined
			? now + resetAfterSeconds * 1_000
			: undefined;
	const clampedUsed = Math.min(100, Math.max(0, usedPercent));

	return {
		label: durationLabel(windowSeconds),
		usedPercent: clampedUsed,
		remainingPercent: 100 - clampedUsed,
		resetsAt,
	};
}

export function parseUsagePayload(value: unknown, now = Date.now()): UsageSnapshot | undefined {
	if (!isRecord(value)) return undefined;

	const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : undefined;
	const primary = parseWindow(rateLimit?.primary_window, now);
	const secondary = parseWindow(rateLimit?.secondary_window, now);
	const additional: UsageSnapshot["additional"] = [];

	if (Array.isArray(value.additional_rate_limits)) {
		for (const item of value.additional_rate_limits) {
			if (!isRecord(item) || !isRecord(item.rate_limit)) continue;
			const extraPrimary = parseWindow(item.rate_limit.primary_window, now);
			const extraSecondary = parseWindow(item.rate_limit.secondary_window, now);
			if (!extraPrimary && !extraSecondary) continue;
			const rawName = typeof item.limit_name === "string"
				? item.limit_name
				: typeof item.metered_feature === "string"
					? item.metered_feature
					: "additional";
			additional.push({
				name: rawName.toLowerCase().includes("spark") || rawName.toLowerCase().includes("bengalfox")
					? "Spark"
					: rawName,
				primary: extraPrimary,
				secondary: extraSecondary,
			});
		}
	}

	if (!primary && !secondary && additional.length === 0) return undefined;

	const credits = isRecord(value.credits) ? value.credits : undefined;
	const balance = credits?.balance;
	return {
		planType: typeof value.plan_type === "string" ? value.plan_type : undefined,
		primary,
		secondary,
		additional,
		creditBalance: typeof balance === "string" || typeof balance === "number" ? String(balance) : undefined,
		fetchedAt: now,
	};
}

function decodeAccountId(token: string): string | undefined {
	try {
		const payloadPart = token.split(".")[1];
		if (!payloadPart) return undefined;
		const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
		const authClaim = payload["https://api.openai.com/auth"];
		if (!isRecord(authClaim)) return undefined;
		return typeof authClaim.chatgpt_account_id === "string" ? authClaim.chatgpt_account_id : undefined;
	} catch {
		return undefined;
	}
}

function usageUrl(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	return normalized.endsWith("/backend-api")
		? `${normalized}/wham/usage`
		: `${normalized}/api/codex/usage`;
}

function roundedPercent(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function statusText(snapshot: UsageSnapshot): string {
	const windows = [snapshot.primary, snapshot.secondary]
		.filter((window): window is UsageWindow => window !== undefined)
		.map((window) => {
			const reset = relativeTime(window.resetsAt);
			return `${window.label} ${roundedPercent(window.remainingPercent)}% left${reset ? `, resets in ${reset}` : ""}`;
		});
	return `Codex: ${windows.join(" · ")}`;
}

function relativeTime(timestamp: number | undefined, now = Date.now()): string | undefined {
	if (timestamp === undefined) return undefined;
	const totalMinutes = Math.max(0, Math.ceil((timestamp - now) / 60_000));
	const days = Math.floor(totalMinutes / (24 * 60));
	const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function detailText(snapshot: UsageSnapshot): string {
	const lines = [`Codex usage${snapshot.planType ? ` (${snapshot.planType})` : ""}`];
	const addWindow = (prefix: string, window: UsageWindow | undefined) => {
		if (!window) return;
		const reset = relativeTime(window.resetsAt);
		lines.push(`${prefix}${window.label}: ${roundedPercent(window.remainingPercent)}% left${reset ? `, resets in ${reset}` : ""}`);
	};
	addWindow("", snapshot.primary);
	addWindow("", snapshot.secondary);
	for (const extra of snapshot.additional) {
		addWindow(`${extra.name} `, extra.primary);
		addWindow(`${extra.name} `, extra.secondary);
	}
	if (snapshot.creditBalance !== undefined) lines.push(`Credits: ${snapshot.creditBalance}`);
	return lines.join("\n");
}

function applyStatus(ctx: ExtensionContext, snapshot: UsageSnapshot | undefined): void {
	if (!snapshot) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const remaining = [snapshot.primary?.remainingPercent, snapshot.secondary?.remainingPercent]
		.filter((value): value is number => value !== undefined);
	const lowest = remaining.length > 0 ? Math.min(...remaining) : 100;
	const color = lowest <= 10 ? "error" : lowest <= 25 ? "warning" : "success";
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, statusText(snapshot)));
}

export default function (pi: ExtensionAPI) {
	let snapshot: UsageSnapshot | undefined;
	let lastAttemptAt = 0;
	let refreshPromise: Promise<UsageSnapshot> | undefined;

	async function fetchUsage(ctx: ExtensionContext, force = false): Promise<UsageSnapshot> {
		const now = Date.now();
		if (!force && snapshot && now - lastAttemptAt < MIN_REFRESH_INTERVAL_MS) return snapshot;
		if (refreshPromise) return refreshPromise;
		lastAttemptAt = now;

		refreshPromise = (async () => {
			const resolved = await ctx.modelRegistry.getProviderAuth(PROVIDER_ID);
			const token = resolved?.auth.apiKey;
			if (!token) throw new Error("OpenAI Codex is not logged in; run /login");

			const provider = ctx.modelRegistry.getProvider(PROVIDER_ID);
			const baseUrl = resolved?.auth.baseUrl ?? provider?.baseUrl ?? FALLBACK_BASE_URL;
			const headers: Record<string, string> = {
				Authorization: `Bearer ${token}`,
				"User-Agent": "pi-codex-usage/1.0",
			};
			const accountId = decodeAccountId(token);
			if (accountId) headers["ChatGPT-Account-Id"] = accountId;

			const response = await fetch(usageUrl(baseUrl), {
				headers,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`Codex usage request failed (${response.status})`);
			const parsed = parseUsagePayload(await response.json());
			if (!parsed) throw new Error("Codex returned an unrecognized usage response");
			snapshot = parsed;
			applyStatus(ctx, snapshot);
			return parsed;
		})().finally(() => {
			refreshPromise = undefined;
		});

		return refreshPromise;
	}

	async function refreshSilently(ctx: ExtensionContext): Promise<void> {
		try {
			await fetchUsage(ctx);
		} catch {
			applyStatus(ctx, snapshot);
		}
	}

	pi.registerCommand("codex-usage", {
		description: "Refresh and show remaining OpenAI Codex subscription usage",
		handler: async (_args, ctx) => {
			try {
				const current = await fetchUsage(ctx, true);
				ctx.ui.notify(detailText(current), "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await refreshSilently(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await refreshSilently(ctx);
	});
}
