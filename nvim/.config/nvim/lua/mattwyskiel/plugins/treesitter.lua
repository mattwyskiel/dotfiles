return { -- Highlight, edit, and navigate code
  'nvim-treesitter/nvim-treesitter',
  build = ':TSUpdate',
  lazy = false,
  branch = 'main',
  -- [[ Configure Treesitter ]] See `:help nvim-treesitter`
  config = function()
    local parsers = { 'bash', 'c', 'diff', 'html', 'lua', 'luadoc', 'markdown', 'markdown_inline', 'query', 'vim', 'vimdoc' }
    local treesitter = require 'nvim-treesitter'

    if treesitter.install then
      treesitter.install(parsers)
    else
      -- Migrate an existing checkout from the legacy master branch before Lazy restores main.
      require('nvim-treesitter.configs').setup { ensure_installed = parsers }
    end
  end,
}
