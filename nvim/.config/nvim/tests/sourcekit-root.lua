-- Run with: nvim --headless '+luafile ~/.config/nvim/tests/sourcekit-root.lua'
local base = vim.fn.tempname()
vim.fn.mkdir(base .. '/WhiskeyKit/Sources/Feature', 'p')
vim.fn.mkdir(base .. '/WhiskeyKit/Tests/FeatureTests', 'p')
vim.fn.mkdir(base .. '/Whiskey/Whiskey', 'p')
vim.fn.mkdir(base .. '/Whiskey/Whiskey.xcodeproj', 'p')
base = assert(vim.uv.fs_realpath(base))

local function check_root(path, expected)
  local buffer = vim.fn.bufadd(base .. path)
  local actual
  vim.lsp.config.sourcekit.root_dir(buffer, function(root)
    actual = root
  end)
  assert(actual == base .. expected, path .. ': unexpected root ' .. tostring(actual))
  vim.api.nvim_buf_delete(buffer, { force = true })
end

local ok, err = xpcall(function()
  vim.fn.writefile({ '{}' }, base .. '/buildServer.json')
  vim.fn.writefile({ '// swift-tools-version: 6.4' }, base .. '/WhiskeyKit/Package.swift')
  check_root('/WhiskeyKit/Sources/Feature/Feature.swift', '/WhiskeyKit')
  check_root('/WhiskeyKit/Tests/FeatureTests/FeatureTests.swift', '/WhiskeyKit')
  check_root('/WhiskeyKit/Package.swift', '/WhiskeyKit')
  check_root('/Whiskey/Whiskey/App.swift', '')

  -- A more specific build-server root must still take priority over SwiftPM.
  vim.fn.mkdir(base .. '/WhiskeyKit/Sources/.bsp', 'p')
  check_root('/WhiskeyKit/Sources/Feature/Feature.swift', '/WhiskeyKit/Sources')
  vim.fn.delete(base .. '/WhiskeyKit/Sources/.bsp', 'd')
  vim.fn.writefile({ '{}' }, base .. '/WhiskeyKit/Sources/buildServer.json')
  check_root('/WhiskeyKit/Sources/Feature/Feature.swift', '/WhiskeyKit/Sources')

  -- Preserve nvim-lspconfig's Xcode discovery when no explicit build system exists.
  vim.fn.delete(base .. '/buildServer.json')
  check_root('/Whiskey/Whiskey/App.swift', '/Whiskey')
end, debug.traceback)

vim.fn.delete(base, 'rf')
if not ok then
  print(err)
  vim.cmd 'cquit 1'
else
  print 'PASS: SourceKit nearest build-system roots and Xcode fallback'
  vim.cmd 'qa!'
end
