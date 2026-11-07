# Claude Desktop 中文补丁 - Windows 交互菜单
# 注意：Windows PowerShell 5.1 要求此文件保存为 UTF-8 with BOM。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $ProjectDir 'bin\claude-zh.js'

function Find-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$node = Find-Node
if (-not $node) {
    Write-Host '未检测到 Node.js（需要 18 或更高版本）。' -ForegroundColor Yellow
    Write-Host '可以执行：winget install OpenJS.NodeJS.LTS   或前往 https://nodejs.org 下载安装后重新运行。'
    $ans = Read-Host '现在用 winget 自动安装吗？(y/N)'
    if ($ans -match '^[yY]') {
        winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
        $node = Find-Node
    }
    if (-not $node) { exit 1 }
}

function Invoke-Cli([string[]]$CliArgs) {
    & $node $Cli @CliArgs | Out-Host
    return $LASTEXITCODE
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '        Claude Desktop 中文补丁（Windows）' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Invoke-Cli @('status') | Out-Null
Write-Host ''
Write-Host '  1. 安装 简体中文'
Write-Host '  2. 安装 繁體中文（台灣）'
Write-Host '  3. 安装 繁體中文（香港）'
Write-Host '  4. 恢复官方原版（卸载补丁）'
Write-Host '  5. 查看翻译覆盖率'
Write-Host '  0. 退出'
Write-Host ''
$choice = Read-Host '请选择'

$langs = @{ '1' = 'zh-CN'; '2' = 'zh-TW'; '3' = 'zh-HK' }
switch ($choice) {
    { $langs.ContainsKey($_) } {
        Write-Host ''
        Write-Host '安装过程会自动关闭正在运行的 Claude Desktop，请先保存好正在进行的工作。' -ForegroundColor Yellow
        $hc = Read-Host '是否同时汉化前端硬编码文案？覆盖更全，但客户端更新后风险略高 (y/N)'
        $cliArgs = @('install', '--lang', $langs[$choice], '--kill')
        if ($hc -match '^[yY]') { $cliArgs += '--hardcoded' }
        $code = Invoke-Cli $cliArgs
        if ($code -eq 0) {
            $open = Read-Host '是否现在启动 Claude Desktop？(Y/n)'
            if ($open -notmatch '^[nN]') {
                $pkg = Get-AppxPackage | Where-Object { $_.Name -match '(^|\.)Claude$' } | Select-Object -First 1
                if ($pkg) {
                    # 商店 / MSIX 版需要通过 AppsFolder 启动，才能带上包标识
                    Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!Claude" -ErrorAction SilentlyContinue
                } else {
                    $exe = Get-ChildItem "$env:LOCALAPPDATA\AnthropicClaude\claude.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($exe) { Start-Process $exe.FullName }
                }
            }
        }
    }
    '4' { Invoke-Cli @('restore', '--kill') | Out-Null }
    '5' { Invoke-Cli @('coverage') | Out-Null }
    default { }
}
