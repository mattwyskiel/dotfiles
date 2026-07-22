import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
export type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type, type TSchema } from "typebox";

export type McpBridgeServerSpec = {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
};

export type McpBridgeConfig = {
	id: string;
	displayName: string;
	commandName: string;
	aliases?: string[];
	toolPrefix: string;
	getServerSpec: (ctx: ExtensionContext) => McpBridgeServerSpec;
	toolGuideline?: (piToolName: string) => string;
};

type EnabledState = {
	enabled: boolean;
};

type Connection = {
	client: Client;
	transport: StdioClientTransport;
};

type McpToolDetails = {
	mcpToolName: string;
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	meta?: Record<string, unknown>;
	rawContent?: unknown[];
};

export function createMcpBridgeExtension(pi: ExtensionAPI, config: McpBridgeConfig) {
	const stateEntry = `${config.id}-state`;
	const statusKey = config.id;
	const toolPrefix = config.toolPrefix.endsWith("__") ? config.toolPrefix : `${config.toolPrefix}__`;

	let desiredEnabled = false;
	let connection: Connection | undefined;
	let connecting: Promise<Connection> | undefined;
	let registeredToolNames = new Set<string>();
	let mcpToolsByPiName = new Map<string, Tool>();
	let lastCtx: ExtensionContext | undefined;
	let lastSpec: McpBridgeServerSpec | undefined;

	function persistState() {
		pi.appendEntry<EnabledState>(stateEntry, { enabled: desiredEnabled });
	}

	function restoreState(ctx: ExtensionContext) {
		desiredEnabled = false;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== stateEntry) continue;
			const data = entry.data as EnabledState | undefined;
			if (typeof data?.enabled === "boolean") desiredEnabled = data.enabled;
		}
	}

	function updateStatus(ctx = lastCtx) {
		if (!ctx?.hasUI) return;

		const toolCount = registeredToolNames.size;
		if (connection) {
			ctx.ui.setStatus(statusKey, `${config.displayName}: on${toolCount ? ` (${toolCount})` : ""}`);
		} else if (connecting) {
			ctx.ui.setStatus(statusKey, `${config.displayName}: starting`);
		} else if (desiredEnabled) {
			ctx.ui.setStatus(statusKey, `${config.displayName}: enabled`);
		} else {
			ctx.ui.setStatus(statusKey, `${config.displayName}: off`);
		}
	}

	async function connect(ctx: ExtensionContext): Promise<Connection> {
		lastCtx = ctx;
		if (connection) return connection;
		if (connecting) return connecting;

		connecting = (async () => {
			updateStatus(ctx);
			const spec = config.getServerSpec(ctx);
			lastSpec = spec;
			const transport = new StdioClientTransport({
				command: spec.command,
				args: spec.args ?? [],
				env: spec.env ?? getDefaultEnvironment(),
				cwd: spec.cwd ?? ctx.cwd,
				stderr: "pipe",
			});

			let stderrTail = "";
			transport.stderr?.on("data", (chunk) => {
				stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
			});

			const client = new Client({ name: `pi-${config.id}`, version: "1.0.0" });
			try {
				await client.connect(transport);
				connection = { client, transport };
				transport.onclose = () => {
					connection = undefined;
					connecting = undefined;
					updateStatus();
				};
				return connection;
			} catch (error) {
				await transport.close().catch(() => undefined);
				const suffix = stderrTail.trim() ? `\n\nServer stderr:\n${stderrTail.trim()}` : "";
				throw new Error(`Failed to start ${config.displayName} MCP: ${error instanceof Error ? error.message : String(error)}${suffix}`);
			} finally {
				connecting = undefined;
				updateStatus(ctx);
			}
		})();

		return connecting;
	}

	async function disconnect() {
		const current = connection;
		connection = undefined;
		connecting = undefined;
		if (current) await current.client.close().catch(() => current.transport.close().catch(() => undefined));
		updateStatus();
	}

	function piToolName(mcpName: string) {
		return `${toolPrefix}${mcpName.replace(/[^A-Za-z0-9_-]/g, "_")}`;
	}

	function normalizeSchema(schema: Tool["inputSchema"] | undefined): TSchema {
		if (!schema || typeof schema !== "object") return Type.Object({});
		if (schema.type !== "object") return Type.Object({}, { additionalProperties: true });
		return schema as unknown as TSchema;
	}

	function registerMcpTool(mcpTool: Tool) {
		const name = piToolName(mcpTool.name);
		mcpToolsByPiName.set(name, mcpTool);
		if (registeredToolNames.has(name)) return;

		const definition: ToolDefinition<TSchema, McpToolDetails> = {
			name,
			label: mcpTool.annotations?.title || mcpTool.name,
			description: `${config.displayName} MCP tool: ${mcpTool.description || mcpTool.name}`,
			promptSnippet: mcpTool.description || `Run ${config.displayName} MCP tool ${mcpTool.name}`,
			promptGuidelines: [
				config.toolGuideline?.(name) ?? `Use ${name} only for tasks that require ${config.displayName} MCP capabilities.`,
			],
			parameters: normalizeSchema(mcpTool.inputSchema),
			executionMode: "sequential",
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				if (!desiredEnabled) {
					throw new Error(`${config.displayName} MCP is disabled. Run /${config.commandName} on to enable it.`);
				}

				onUpdate?.({
					content: [{ type: "text", text: `Calling ${config.displayName} MCP tool ${mcpTool.name}...` }],
					details: { mcpToolName: mcpTool.name },
				});
				const { client } = await connect(ctx);
				if (signal?.aborted) throw new Error("Cancelled");

				const result = await client.callTool(
					{ name: mcpTool.name, arguments: params as Record<string, unknown> },
					undefined,
					{ signal },
				) as CallToolResult;

				const formatted = formatMcpResult(mcpTool.name, result);
				if (result.isError) throw new Error(resultToText(formatted));
				return formatted;
			},
		};

		pi.registerTool(definition);
		registeredToolNames.add(name);
	}

	async function refreshMcpTools(ctx: ExtensionContext) {
		const { client } = await connect(ctx);
		const list = await client.listTools();
		mcpToolsByPiName = new Map();
		for (const tool of list.tools) registerMcpTool(tool as Tool);
		return Array.from(mcpToolsByPiName.keys());
	}

	function withoutBridgeTools(names: string[]) {
		return names.filter((name) => !name.startsWith(toolPrefix));
	}

	async function enable(ctx: ExtensionContext, notify = true) {
		lastCtx = ctx;
		desiredEnabled = true;
		const toolNames = await refreshMcpTools(ctx);
		pi.setActiveTools([...new Set([...withoutBridgeTools(pi.getActiveTools()), ...toolNames])]);
		persistState();
		updateStatus(ctx);
		if (notify && ctx.hasUI) ctx.ui.notify(`${config.displayName} MCP enabled (${toolNames.length} tools).`, "info");
	}

	async function disable(ctx: ExtensionContext, notify = true) {
		lastCtx = ctx;
		desiredEnabled = false;
		pi.setActiveTools(withoutBridgeTools(pi.getActiveTools()));
		persistState();
		await disconnect();
		updateStatus(ctx);
		if (notify && ctx.hasUI) ctx.ui.notify(`${config.displayName} MCP disabled.`, "info");
	}

	function statusText(ctx: ExtensionContext) {
		const spec = lastSpec ?? safeGetServerSpec(ctx);
		const activeBridgeTools = pi.getActiveTools().filter((name) => name.startsWith(toolPrefix));
		return [
			`${config.displayName} MCP: ${desiredEnabled ? "enabled" : "disabled"}`,
			`Server process: ${connection ? `running (pid ${connection.transport.pid ?? "unknown"})` : connecting ? "starting" : "stopped"}`,
			`Registered tools: ${registeredToolNames.size}`,
			`Active tools: ${activeBridgeTools.length}`,
			`Command: ${spec.command} ${(spec.args ?? []).join(" ")}`,
		].join("\n");
	}

	function safeGetServerSpec(ctx: ExtensionContext) {
		try {
			return config.getServerSpec(ctx);
		} catch {
			return { command: "<invalid>", args: [] };
		}
	}

	async function handleCommand(args: string, ctx: ExtensionContext) {
		lastCtx = ctx;
		const action = args.trim().toLowerCase();

		if (!action && ctx.hasUI) {
			const choice = await ctx.ui.select(`${config.displayName} MCP`, [
				desiredEnabled ? "Disable" : "Enable",
				"Toggle",
				"Status",
			]);
			if (!choice) return;
			return handleCommand(choice.toLowerCase(), ctx);
		}

		if (["on", "enable", "enabled", "start"].includes(action)) return enable(ctx);
		if (["off", "disable", "disabled", "stop"].includes(action)) return disable(ctx);
		if (["toggle", "switch"].includes(action)) return desiredEnabled ? disable(ctx) : enable(ctx);
		if (["status", ""].includes(action)) {
			if (ctx.hasUI) ctx.ui.notify(statusText(ctx), "info");
			else console.log(statusText(ctx));
			return;
		}

		if (ctx.hasUI) ctx.ui.notify(`Usage: /${config.commandName} [on|off|toggle|status]`, "error");
	}

	function completions(prefix: string) {
		return ["on", "off", "toggle", "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
	}

	pi.registerCommand(config.commandName, {
		description: `Toggle ${config.displayName} MCP tools on/off`,
		getArgumentCompletions: completions,
		handler: handleCommand,
	});

	for (const alias of config.aliases ?? []) {
		pi.registerCommand(alias, {
			description: `Alias for /${config.commandName}`,
			getArgumentCompletions: completions,
			handler: handleCommand,
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		restoreState(ctx);
		updateStatus(ctx);
		if (desiredEnabled) {
			try {
				await enable(ctx, false);
			} catch (error) {
				desiredEnabled = false;
				updateStatus(ctx);
				if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		} else {
			pi.setActiveTools(withoutBridgeTools(pi.getActiveTools()));
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		lastCtx = ctx;
		const wasEnabled = desiredEnabled;
		restoreState(ctx);
		if (desiredEnabled && !wasEnabled) await enable(ctx, false);
		if (!desiredEnabled && wasEnabled) await disable(ctx, false);
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		await disconnect();
		lastCtx?.ui.setStatus(statusKey, undefined);
		lastCtx = undefined;
	});
}

function resultToText(result: AgentToolResult<McpToolDetails>) {
	return result.content.map((item) => item.type === "text" ? item.text : `[${item.mimeType} image]`).join("\n");
}

function formatMcpResult(mcpToolName: string, result: CallToolResult): AgentToolResult<McpToolDetails> {
	const content: AgentToolResult<McpToolDetails>["content"] = [];

	for (const item of result.content) {
		if (item.type === "text") {
			content.push({ type: "text", text: item.text });
			continue;
		}

		if (item.type === "image") {
			content.push({ type: "image", mimeType: item.mimeType, data: item.data });
			continue;
		}

		if (item.type === "resource") {
			const resource = item.resource;
			if ("text" in resource) {
				content.push({ type: "text", text: `Resource ${resource.uri}:\n${resource.text}` });
			} else {
				content.push({ type: "text", text: `Resource ${resource.uri} (${resource.mimeType || "application/octet-stream"}) returned ${resource.blob.length} base64 bytes.` });
			}
			continue;
		}

		if (item.type === "resource_link") {
			content.push({ type: "text", text: `Resource link: ${item.name} (${item.uri})${item.description ? `\n${item.description}` : ""}` });
			continue;
		}

		content.push({ type: "text", text: JSON.stringify(item, null, 2) });
	}

	if (result.structuredContent) {
		content.push({ type: "text", text: `Structured content:\n${JSON.stringify(result.structuredContent, null, 2)}` });
	}

	const finalContent = content.length > 0 ? content : [{ type: "text" as const, text: "MCP returned no content." }];

	return {
		content: finalContent,
		details: {
			mcpToolName,
			isError: result.isError,
			structuredContent: result.structuredContent,
			meta: result._meta,
			rawContent: result.content,
		},
	};
}
