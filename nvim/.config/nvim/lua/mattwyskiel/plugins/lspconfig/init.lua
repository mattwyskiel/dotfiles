return {
  -- Community-maintained defaults consumed by vim.lsp.config().
  -- Language server executables are installed declaratively by mise.
  'neovim/nvim-lspconfig',
  dependencies = {
    'b0o/schemastore.nvim',

    -- Useful status updates for LSP.
    { 'j-hui/fidget.nvim', opts = {} },

    -- Allows extra capabilities provided by blink.cmp
    'saghen/blink.cmp',
  },
  config = function()
    --  This function gets run when an LSP attaches to a particular buffer.
    --    That is to say, every time a new file is opened that is associated with
    --    an lsp (for example, opening `main.rs` is associated with `rust_analyzer`) this
    --    function will be executed to configure the current buffer
    vim.api.nvim_create_autocmd('LspAttach', {
      group = vim.api.nvim_create_augroup('kickstart-lsp-attach', { clear = true }),
      callback = function(event)
        -- setup keymaps
        require 'mattwyskiel.plugins.lspconfig.set-keymaps'(event)

        -- setup highlight
        require 'mattwyskiel.plugins.lspconfig.highlight'(event)
      end,
    })

    require 'mattwyskiel.plugins.lspconfig.diagnostic'

    -- LSP servers and clients are able to communicate to each other what features they support.
    --  By default, Neovim doesn't support everything that is in the LSP specification.
    --  When you add blink.cmp, luasnip, etc. Neovim now has *more* capabilities.
    --  So, we create new capabilities with blink.cmp, and then broadcast that to the servers.
    local capabilities = require('blink.cmp').get_lsp_capabilities()

    local servers = require 'mattwyskiel.plugins.lspconfig.servers'

    for server_name, server in pairs(servers) do
      server.capabilities = vim.tbl_deep_extend('force', {}, capabilities, server.capabilities or {})
      server.capabilities.textDocument.foldingRange = {
        dynamicRegistration = false,
        lineFoldingOnly = true,
      }

      vim.lsp.config(server_name, server)
      vim.lsp.enable(server_name)
    end

    -- SourceKit ships with Xcode and is not managed by mise.
    if vim.fn.has 'mac' == 1 and vim.fn.executable 'sourcekit-lsp' == 1 then
      vim.lsp.enable 'sourcekit'
    end
  end,
}
