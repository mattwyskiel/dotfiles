import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

// Use an installed Pi, without installing dependencies or calling live providers.
// PI_TEST_NODE_MODULES points to the node_modules directory of that installation.
const modules = process.env.PI_TEST_NODE_MODULES;

test("naming through the installed Pi provider runtime", {
	skip: !modules && "Set PI_TEST_NODE_MODULES to run the offline runtime tests",
}, async (t) => {
	const moduleUrl = (name) => pathToFileURL(join(modules, "@earendil-works", name, "dist/index.js")).href;
	const { ModelRuntime, ModelRegistry } = await import(moduleUrl("pi-coding-agent"));
	const { fauxProvider, fauxAssistantMessage, InMemoryCredentialStore } = await import(moduleUrl("pi-ai"));
	const source = await readFile(new URL("../git-worktree.ts", import.meta.url), "utf8");
	const code = stripTypeScriptTypes(source
		.replace(/^import .*;\n/gm, "")
		.replace("export default function gitWorktreeExtension", "function gitWorktreeExtension"));
	const summarize = runInNewContext(`${code}\nsummarizeTaskIdentity`, { AbortSignal, execFileCallback, promisify });
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		refreshOnCreate: false,
		allowModelNetwork: false,
	});
	const registry = new ModelRegistry(runtime);
	const identityJson = '{"slug":"runtime-task-name","title":"Runtime Task Name"}';

	async function assertNaming(model, fixture, checkRequest = () => {}) {
		fixture.setResponses([(context, options, _state, requestModel) => {
			assert.equal(options.cacheRetention, model.provider === "claude-bridge" || model.api === "pi-virtual" ? "none" : undefined);
			assert.equal(options.sessionId, undefined);
			assert.ok(options.signal instanceof AbortSignal);
			checkRequest(context, options, requestModel);
			return fauxAssistantMessage(identityJson);
		}]);
		const notifications = [];
		const identity = await summarize("Fix runtime naming", "local fallback", {
			model,
			modelRegistry: registry,
			ui: { notify: (...args) => notifications.push(args) },
		});
		assert.equal(identity.slug, "runtime-task-name");
		assert.equal(identity.title, "Runtime Task Name");
		assert.deepEqual(notifications, []);
		assert.equal(fixture.getPendingResponseCount(), 0, "The configured provider must serve the request");
	}

	for (const [name, resolution] of [
		["keyless", { auth: {} }],
		["header-only", { auth: { headers: { "X-Offline-Auth": "test" } } }],
		["ambient", { auth: {}, env: { OFFLINE_REGION: "test-region" } }],
		["endpoint", { auth: { apiKey: "offline-key", baseUrl: "https://offline.invalid" } }],
	]) {
		await t.test(`native provider: ${name}`, async () => {
			const fixture = fauxProvider({ provider: `offline-${name}`, tokensPerSecond: 1_000_000 });
			runtime.registerNativeProvider({
				...fixture.provider,
				auth: { apiKey: { name, resolve: async () => resolution } },
			});
			await assertNaming(fixture.getModel(), fixture, (_context, options, model) => {
				assert.equal(options.reasoning, "minimal");
				assert.equal(options.apiKey, resolution.auth.apiKey);
				if (resolution.auth.headers) assert.equal(options.headers["X-Offline-Auth"], "test");
				if (resolution.env) assert.equal(options.env.OFFLINE_REGION, "test-region");
				if (resolution.auth.baseUrl) assert.equal(model.baseUrl, resolution.auth.baseUrl);
			});
		});
	}

	// The bridge uses the legacy registration form with a custom streamSimple.
	// A fake transport verifies dispatch and isolation without spawning Claude Code.
	const fixture = fauxProvider({
		provider: "claude-bridge",
		api: "offline-bridge-api",
		models: [{ id: "offline-model" }],
		tokensPerSecond: 1_000_000,
	});
	runtime.registerProvider("claude-bridge", {
		api: fixture.api,
		apiKey: "offline-sentinel",
		baseUrl: "https://offline.invalid",
		models: fixture.models,
		streamSimple: fixture.provider.streamSimple,
	});
	const physicalModel = registry.find("claude-bridge", "offline-model");
	await t.test("legacy extension provider with a custom streaming API", async () => {
		await assertNaming(physicalModel, fixture, (_context, options) => {
			assert.equal(options.apiKey, "offline-sentinel");
		});
	});

	await t.test("virtual model routes the one-off request to its physical provider", async () => {
		let routes = 0;
		runtime.registerVirtualModel({
			provider: "offline-router",
			id: "auto",
			name: "Offline Router",
			route(request) {
				routes += 1;
				assert.equal(request.reason, "direct");
				return { model: physicalModel, thinkingLevel: "off" };
			},
		});
		await assertNaming(registry.find("offline-router", "auto"), fixture, (_context, _options, model) => {
			assert.equal(model.provider, "claude-bridge");
		});
		assert.equal(routes, 1);
	});
});
