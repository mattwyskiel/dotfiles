local M = {}

local targets = {
  native = vim.NIL,
  windows = 'x86_64-pc-windows-gnu',
  linux = 'x86_64-unknown-linux-gnu',
  mac = 'aarch64-apple-darwin',
}

-- Keep choices local to a workspace and this Neovim session, not the global LSP config.
local selected = {}

local function apply(client, target)
  local settings = vim.deepcopy(client.settings or client.config.settings or {})
  local rust = settings['rust-analyzer'] or {}
  rust.cargo = rust.cargo or {}
  rust.check = rust.check or {}
  rust.cargo.target = target
  rust.check.targets = vim.NIL -- Follow cargo.target for check-on-save too.
  settings['rust-analyzer'] = rust

  -- workspace/configuration reads client.settings; retain the config copy as well.
  client.settings = settings
  client.config.settings = settings
  client:notify('workspace/didChangeConfiguration', { settings = settings })
end

function M.setup()
  vim.api.nvim_create_user_command('RustTarget', function(opts)
    local clients = vim.lsp.get_clients { name = 'rust_analyzer', bufnr = 0 }
    if #clients == 0 then
      vim.notify('RustTarget: open a Rust buffer and wait for rust-analyzer to attach', vim.log.levels.WARN)
      return
    end

    if opts.args == '' then
      local target = vim.tbl_get(clients[1].settings or {}, 'rust-analyzer', 'cargo', 'target')
      vim.notify('RustTarget: ' .. (target and target ~= vim.NIL and target or 'native (Cargo default)'))
      return
    end

    local target = targets[opts.args]
    if target == nil then
      -- Allow explicit triples for architectures not covered by the shortcuts.
      if not opts.args:match '^[%w_]+%-[%w_]+%-[%w_-]+$' then
        vim.notify('RustTarget: use native, windows, linux, mac, or a Rust target triple', vim.log.levels.ERROR)
        return
      end
      target = opts.args
    end

    for _, client in ipairs(clients) do
      if client.root_dir then
        selected[client.root_dir] = target
      end
      apply(client, target)
    end
    vim.notify('RustTarget: ' .. opts.args .. ' (rust-analyzer is reloading; terminal Cargo target unchanged)')
  end, {
    nargs = '?',
    desc = 'Show or switch the current Rust workspace compilation target',
    complete = function(lead)
      return vim.tbl_filter(function(name)
        return name:sub(1, #lead) == lead
      end, { 'native', 'windows', 'linux', 'mac' })
    end,
  })

  -- Preserve the workspace choice if its LSP restarts during this session.
  vim.api.nvim_create_autocmd('LspAttach', {
    group = vim.api.nvim_create_augroup('mattwyskiel-rust-target', { clear = true }),
    callback = function(event)
      local client = vim.lsp.get_client_by_id(event.data.client_id)
      if not client or client.name ~= 'rust_analyzer' or not client.root_dir then
        return
      end
      local target = selected[client.root_dir]
      local current = vim.tbl_get(client.settings or {}, 'rust-analyzer', 'cargo', 'target')
      if target ~= nil and current ~= target then
        apply(client, target)
      end
    end,
  })
end

return M
