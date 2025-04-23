return {
  -- Linting
  'mfussenegger/nvim-lint',
  lazy = true,
  event = { 'BufWritePost' },
  config = function()
    require('lint').linters_by_ft = {
      yaml = { 'yamllint' },
    }
  end,
}
