return {
  'olimorris/codecompanion.nvim',
  opts = {
    strategies = {
      chat = {
        adapter = 'gemini',
      },
      inline = {
        adapter = 'gemini',
      },
      cmd = {
        adapter = 'gemini',
      },
    },
    extensions = {
      mcphub = {
        callback = 'mcphub.extensions.codecompanion',
        opts = {
          show_result_in_chat = true, -- Show the mcp tool result in the chat buffer
          make_vars = true, -- make chat #variables from MCP server resources
          make_slash_commands = true, -- make /slash_commands from MCP server prompts
        },
      },
    },
  },
  dependencies = {
    'nvim-lua/plenary.nvim',
    'nvim-treesitter/nvim-treesitter',
    -- 'ravitemer/mcphub.nvim',
  },
  init = function()
    vim.keymap.set({ 'n', 'v' }, '<C-a>', '<cmd>CodeCompanionActions<cr>', { noremap = true, silent = true })
    vim.keymap.set({ 'n', 'v' }, '<LocalLeader>a', '<cmd>CodeCompanionChat Toggle<cr>', { noremap = true, silent = true })
    vim.keymap.set('v', 'ga', '<cmd>CodeCompanionChat Add<cr>', { noremap = true, silent = true })

    -- Expand 'cc' into 'CodeCompanion' in the command line
    vim.cmd [[cab cc CodeCompanion]]
  end,
}
