return {
  -- Linting
  'mfussenegger/nvim-lint',
  config = function()
    vim.env.ESLINT_D_PPID = vim.fn.getpid()
    require('lint').linters_by_ft = {
      yaml = { 'yamllint' },
    }
  end,
}
