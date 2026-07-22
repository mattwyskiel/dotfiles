# Chrome DevTools MCP Pi Extension

Adds a session-scoped toggle for Google Chrome DevTools MCP tools in Pi.

## Commands

- `/chrome-devtools-mcp on` or `/cdp on` — start `chrome-devtools-mcp` and enable its tools.
- `/chrome-devtools-mcp off` or `/cdp off` — disable its tools and stop the MCP server process.
- `/chrome-devtools-mcp toggle` or `/cdp toggle` — switch on/off.
- `/chrome-devtools-mcp status` or `/cdp status` — show current state.
- `/chrome-devtools-mcp` with no args opens an interactive selector in TUI mode.

Enabled/disabled state is persisted in the current Pi session branch. The footer shows `chrome-devtools: on/off`.

## Tool naming

MCP tools are registered with the `chrome_devtools__` prefix, for example `chrome_devtools__list_pages`.

## Configuration

Environment variables:

- `PI_CHROME_DEVTOOLS_MCP_PACKAGE` — npm package spec. Defaults to `chrome-devtools-mcp@latest`.
- `PI_CHROME_DEVTOOLS_MCP_COMMAND` — command to run. Defaults to `npx`.
- `PI_CHROME_DEVTOOLS_MCP_ARGS` — JSON string array of arguments to pass after the package name.
- `PI_CHROME_DEVTOOLS_MCP_BROWSER_URL` — adds `--browser-url=<value>`.
- `PI_CHROME_DEVTOOLS_MCP_SLIM=1` — adds `--slim`.
- `PI_CHROME_DEVTOOLS_MCP_HEADLESS=1` — adds `--headless`.

The extension disables Chrome DevTools MCP usage statistics and update checks by default with flags/environment variables.
