import { createMcpBridgeExtension, type ExtensionAPI, type ExtensionContext } from "../_lib/mcp-bridge.ts";

export default function xcodeMcpExtension(pi: ExtensionAPI) {
	createMcpBridgeExtension(pi, {
		id: "xcode-mcp",
		displayName: "xcode",
		commandName: "xcode-mcp",
		aliases: ["xcm"],
		toolPrefix: "xcode__",
		getServerSpec,
		toolGuideline: (name) => `Use ${name} only for Xcode, Apple platform project, simulator, build, test, and diagnostics tasks that require the Xcode MCP bridge.`,
	});
}

function getServerSpec(ctx: ExtensionContext) {
	return {
		command: process.env.PI_XCODE_MCP_COMMAND || "xcrun",
		args: getServerArgs(),
		cwd: ctx.cwd,
	};
}

function getServerArgs() {
	const customArgs = process.env.PI_XCODE_MCP_ARGS;
	if (customArgs) {
		try {
			const parsed = JSON.parse(customArgs) as unknown;
			if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
				throw new Error("PI_XCODE_MCP_ARGS must be a JSON string array");
			}
			return parsed;
		} catch (error) {
			throw new Error(`Invalid PI_XCODE_MCP_ARGS: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return ["mcpbridge"];
}
