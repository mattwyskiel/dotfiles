# Xcode MCP Pi Extension

Adds a session-scoped toggle for Xcode MCP tools in Pi using:

```sh
xcrun mcpbridge
```

## Commands

- `/xcode-mcp on` or `/xcm on` — start `xcrun mcpbridge` and enable its tools.
- `/xcode-mcp off` or `/xcm off` — disable its tools and stop the MCP server process.
- `/xcode-mcp toggle` or `/xcm toggle` — switch on/off.
- `/xcode-mcp status` or `/xcm status` — show current state.
- `/xcode-mcp` with no args opens an interactive selector in TUI mode.

Enabled/disabled state is persisted in the current Pi session branch. The footer shows `xcode: on/off`.

## Tool naming

MCP tools are registered with the `xcode__` prefix.

## Configuration

Environment variables:

- `PI_XCODE_MCP_COMMAND` — command to run. Defaults to `xcrun`.
- `PI_XCODE_MCP_ARGS` — JSON string array of args. Defaults to `["mcpbridge"]`.
