require 'mattwyskiel.opts' -- general options

require 'mattwyskiel.keymaps' -- keymaps
require 'mattwyskiel.autocommands' -- autocommands
require 'mattwyskiel.filetypes' -- filetypes

require 'mattwyskiel.lazy' -- install lazy.nvim

require('lazy').setup({
  'NMAC427/guess-indent.nvim', -- Detect tabstop and shiftwidth automatically
  require 'mattwyskiel.plugins.gitsigns', -- Git signs in the gutter
  require 'mattwyskiel.plugins.which-key', -- Keymaps in a popup
  require 'mattwyskiel.plugins.neo-tree', -- File explorer
  require 'mattwyskiel.plugins.telescope', -- Fuzzy finder
  require 'mattwyskiel.plugins.telescope-file-browser', -- File browser for telescope
  require 'mattwyskiel.plugins.autopairs', -- Autopairs for brackets, quotes, etc.
  -- require 'mattwyskiel.plugins.indent_line', -- Indent line for showing indentation levels
  require 'mattwyskiel.plugins.lazydev', -- LazyDev for lazy loading plugins
  require 'mattwyskiel.plugins.lspconfig', -- LSP configuration
  'b0o/schemastore.nvim', -- JSON schema store
  require 'mattwyskiel.plugins.conform', -- LSP formatter
  require 'mattwyskiel.plugins.lint', -- Linting
  require 'mattwyskiel.plugins.blink-cmp', -- Completion engine

  require 'mattwyskiel.plugins.tokyonight', -- Colorscheme
  require 'mattwyskiel.plugins.todo-comments', -- Highlight todo, notes, etc in comments
  require 'mattwyskiel.plugins.mini', -- Mini.nvim for various small plugins
  require 'mattwyskiel.plugins.treesitter', -- Treesitter for syntax highlighting

  require 'mattwyskiel.plugins.markdown',
  require 'mattwyskiel.plugins.copilot', -- GitHub Copilot
  require 'mattwyskiel.plugins.codecompanion', -- Code Companion for AI assistance
  require 'mattwyskiel.plugins.mcp',
}, {
  ui = require 'mattwyskiel.lazy.ui', -- UI for lazy.nvim
})

require 'mattwyskiel.plugins.lint.autocmd'

-- The line beneath this is called `modeline`. See `:help modeline`
-- vim: ts=2 sts=2 sw=2 et
