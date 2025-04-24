vim.api.nvim_create_autocmd({ 'BufWritePost' }, {
  callback = function()
    require('lint').try_lint()
  end,
})

vim.api.nvim_create_autocmd({ 'InsertLeave' }, {
  callback = function()
    -- require('lint').try_lint 'eslint_d'
  end,
})
