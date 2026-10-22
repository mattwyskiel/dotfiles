return { -- Autoformat
  'stevearc/conform.nvim',
  event = { 'BufWritePre' },
  cmd = { 'ConformInfo' },
  init = function()
    vim.filetype.add { extension = { mdx = 'mdx', handlebars = 'handlebars' } }
  end,
  keys = {
    {
      '<leader>f',
      function()
        require('conform').format { async = true, lsp_format = 'fallback' }
      end,
      mode = '',
      desc = '[F]ormat buffer',
    },
  },
  opts = {
    notify_on_error = false,
    format_on_save = function(bufnr)
      -- Disable "format_on_save lsp_fallback" for languages that don't
      -- have a well standardized coding style. You can add additional
      -- languages here or re-enable it for the disabled ones.
      local disable_filetypes = { c = true, cpp = true }
      if disable_filetypes[vim.bo[bufnr].filetype] then
        return nil
      else
        return {
          timeout_ms = 500,
          lsp_format = 'fallback',
        }
      end
    end,
    formatters = {
      bun_fmt = {
        command = 'bun',
        args = { 'fmt', '--no-script', '--stdin-filepath', '$FILENAME' },
        stdin = true,
      },
    },
    formatters_by_ft = {
      lua = { 'stylua' },
      -- Conform can also run multiple formatters sequentially
      -- python = { "isort", "black" },
      --
      -- You can use 'stop_after_first' to run the first available formatter from the list
      javascript = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      javascriptreact = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      typescriptreact = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      typescript = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      json = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      jsonc = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      json5 = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      css = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      scss = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      less = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      html = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      htmlangular = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      vue = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      svelte = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      yaml = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      toml = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      markdown = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      mdx = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      ['markdown.mdx'] = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      graphql = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },
      handlebars = { 'bun_fmt', 'prettierd', 'prettier', stop_after_first = true },

      rust = { 'rustfmt' },
    },
  },
}
