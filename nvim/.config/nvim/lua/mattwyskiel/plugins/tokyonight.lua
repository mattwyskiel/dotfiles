return { -- You can easily change to a different colorscheme.
  -- Change the name of the colorscheme plugin below, and then
  -- change the command in the config to whatever the name of that colorscheme is.
  --
  -- If you want to see what colorschemes are already installed, you can use `:Telescope colorscheme`.
  'folke/tokyonight.nvim',
  priority = 1000, -- Make sure to load this before all the other start plugins.
  opts = {
    transparent = true,
    styles = {
      comments = { italic = false }, -- Disable italics in comments
      sidebars = 'transparent',
      floats = 'transparent',
    },
  },
  init = function()
    -- Load the colorscheme here.
    vim.cmd.colorscheme 'tokyonight-night'
  end,
}
