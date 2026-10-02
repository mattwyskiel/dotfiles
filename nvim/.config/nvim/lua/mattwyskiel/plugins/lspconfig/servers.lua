-- Configure the language servers declared in ~/.config/mise/config.toml.
-- Add installation dependencies there and editor-specific settings here.
--
--  Add any additional override configuration in the following tables. Available keys are:
--  - cmd (table): Override the default command used to start the server
--  - filetypes (table): Override the default list of associated filetypes for the server
--  - capabilities (table): Override fields in capabilities. Can be used to disable certain LSP features.
--  - settings (table): Override the default settings passed when initializing the server.
--        For example, to see the options for `lua_ls`, you could go to: https://luals.github.io/wiki/settings/
local servers = {
  gopls = {},
  pyright = {},
  tsgo = {
    -- TypeScript 7 ships its own LSP as `tsc --lsp`; ts_ls requires the removed tsserver.js.
    -- Keep nvim-lspconfig's monorepo/Deno detection, but replace its preview-only `tsgo` command.
    cmd = function(dispatchers, config)
      local cmd = 'tsc'
      if config.root_dir then
        local package_dir = vim.fs.joinpath(config.root_dir, 'node_modules', 'typescript')
        local ok, package = pcall(function()
          return vim.json.decode(table.concat(vim.fn.readfile(vim.fs.joinpath(package_dir, 'package.json')), '\n'))
        end)
        local major = ok and tonumber((package.version or ''):match '^%d+')
        local local_cmd = vim.fs.joinpath(package_dir, 'bin', 'tsc')
        -- Older workspace compilers do not implement --lsp; use mise's native compiler instead.
        if major and major >= 7 and vim.fn.executable(local_cmd) == 1 then
          cmd = local_cmd
        end
      end
      return vim.lsp.rpc.start({ cmd, '--lsp', '--stdio' }, dispatchers, { cwd = config.root_dir })
    end,
  },
  eslint = {},
  biome = {},
  cssls = {},
  tailwindcss = {},
  lua_ls = {
    settings = {
      Lua = {
        completion = {
          callSnippet = 'Replace',
        },
        -- You can toggle below to ignore Lua_LS's noisy `missing-fields` warnings
        -- diagnostics = { disable = { 'missing-fields' } },
      },
    },
  },
  rust_analyzer = {},
  yamlls = {
    settings = {
      yaml = {
        schemaStore = {
          -- You must disable built-in schemaStore support if you want to use
          -- this plugin and its advanced options like `ignore`.
          enable = false,
          -- Avoid TypeError: Cannot read properties of undefined (reading 'length')
          url = '',
        },
        schemas = require('schemastore').yaml.schemas {
          ignore = {
            'docker-compose.yml',
          },
        },
      },
    },
  },
  jsonls = {
    settings = {
      json = {
        schemas = require('schemastore').json.schemas(),
        validate = { enable = true },
      },
    },
  },

  -- Docker
  dockerls = {},
  docker_compose_language_service = {},

  -- Autotools (Makefile)
  autotools_ls = {},
  clangd = {},
}

return servers
