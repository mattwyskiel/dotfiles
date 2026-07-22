import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpBridgeExtension, type ExtensionAPI, type ExtensionContext } from "../_lib/mcp-bridge.ts";

const DEFAULT_PACKAGE = "chrome-devtools-mcp@latest";

export default function chromeDevToolsMcpExtension(pi: ExtensionAPI) {
	createMcpBridgeExtension(pi, {
		id: "chrome-devtools-mcp",
		displayName: "chrome-devtools",
		commandName: "chrome-devtools-mcp",
		aliases: ["cdp"],
		toolPrefix: "chrome_devtools__",
		getServerSpec: getChromeServerSpec,
		toolGuideline: (name) => `Use ${name} only for browser automation, live page inspection, screenshots, console/network debugging, and Chrome performance analysis.`,
	});
}

function getChromeServerSpec(ctx: ExtensionContext) {
	return {
		command: process.env.PI_CHROME_DEVTOOLS_MCP_COMMAND || "npx",
		args: getServerArgs(),
		env: {
			...getDefaultEnvironment(),
			CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
			CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
		},
		cwd: ctx.cwd,
	};
}

function getServerArgs() {
	const packageName = process.env.PI_CHROME_DEVTOOLS_MCP_PACKAGE || DEFAULT_PACKAGE;
	const customArgs = process.env.PI_CHROME_DEVTOOLS_MCP_ARGS;
	if (customArgs) {
		try {
			const parsed = JSON.parse(customArgs) as unknown;
			if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
				throw new Error("PI_CHROME_DEVTOOLS_MCP_ARGS must be a JSON string array");
			}
			return ["-y", packageName, ...parsed];
		} catch (error) {
			throw new Error(`Invalid PI_CHROME_DEVTOOLS_MCP_ARGS: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const args = ["-y", packageName, "--no-usage-statistics"];
	if (process.env.PI_CHROME_DEVTOOLS_MCP_SLIM === "1") args.push("--slim");
	if (process.env.PI_CHROME_DEVTOOLS_MCP_HEADLESS === "1") args.push("--headless");
	if (process.env.PI_CHROME_DEVTOOLS_MCP_BROWSER_URL) {
		args.push(`--browser-url=${process.env.PI_CHROME_DEVTOOLS_MCP_BROWSER_URL}`);
	}
	return args;
}
