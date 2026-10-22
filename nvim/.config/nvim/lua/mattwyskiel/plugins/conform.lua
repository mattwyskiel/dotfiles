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
      javascript = { 'bun_fmt' },
      javascriptreact = { 'bun_fmt' },
      typescriptreact = { 'bun_fmt' },
      typescript = { 'bun_fmt' },
      json = { 'bun_fmt' },
      jsonc = { 'bun_fmt' },
      json5 = { 'bun_fmt' },
      css = { 'bun_fmt' },
      scss = { 'bun_fmt' },
      less = { 'bun_fmt' },
      html = { 'bun_fmt' },
      htmlangular = { 'bun_fmt' },
      vue = { 'bun_fmt' },
      svelte = { 'bun_fmt' },
      yaml = { 'bun_fmt' },
      toml = { 'bun_fmt' },
      markdown = { 'bun_fmt' },
      mdx = { 'bun_fmt' },
      ['markdown.mdx'] = { 'bun_fmt' },
      graphql = { 'bun_fmt' },
      handlebars = { 'bun_fmt' },

      rust = { 'rustfmt' },
    },
  },
}
