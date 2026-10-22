local bun_filetypes = {
  'javascript',
  'javascriptreact',
  'typescriptreact',
  'typescript',
  'json',
  'jsonc',
  'json5',
  'css',
  'scss',
  'less',
  'html',
  'htmlangular',
  'vue',
  'svelte',
  'yaml',
  'toml',
  'markdown',
  'mdx',
  'markdown.mdx',
  'graphql',
  'handlebars',
}

local formatters_by_ft = {}
for _, filetype in ipairs(bun_filetypes) do
  formatters_by_ft[filetype] = { 'bun_fmt' }
end

local function format_with_lsp(bufnr, async)
  if #vim.lsp.get_clients { bufnr = bufnr, method = 'textDocument/formatting' } > 0 then
    vim.lsp.buf.format { bufnr = bufnr, async = async, timeout_ms = 1000 }
  end
end

return {
  'stevearc/conform.nvim',
  ft = bun_filetypes,
  cmd = { 'ConformInfo' },
  init = function()
    vim.filetype.add { extension = { mdx = 'mdx', handlebars = 'handlebars' } }

    vim.keymap.set('', '<leader>f', function()
      local bufnr = vim.api.nvim_get_current_buf()
      if formatters_by_ft[vim.bo[bufnr].filetype] then
        require('conform').format { bufnr = bufnr, async = true, lsp_format = 'never' }
      else
        format_with_lsp(bufnr, true)
      end
    end, { desc = '[F]ormat buffer' })

    vim.api.nvim_create_autocmd('BufWritePre', {
      desc = 'Format with the LSP outside Bun-supported file types',
      group = vim.api.nvim_create_augroup('mattwyskiel-lsp-format', { clear = true }),
      callback = function(event)
        if not formatters_by_ft[vim.bo[event.buf].filetype] then
          format_with_lsp(event.buf, false)
        end
      end,
    })
  end,
  opts = {
    notify_on_error = false,
    default_format_opts = { lsp_format = 'never' },
    format_on_save = function(bufnr)
      if formatters_by_ft[vim.bo[bufnr].filetype] then
        return { timeout_ms = 500, lsp_format = 'never' }
      end
    end,
    formatters = {
      bun_fmt = {
        command = 'bun',
        args = { 'fmt', '--no-script', '--stdin-filepath', '$FILENAME' },
        stdin = true,
      },
    },
    formatters_by_ft = formatters_by_ft,
  },
}
