# 开发者测试工具：把指定可执行文件路径对应进程的 Claude 主窗口显示出来并截图。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/capture-window.ps1 -PathLike '*zhtest*' -Out shot.png
# 注意：Windows PowerShell 5.1 要求此文件保存为 UTF-8 with BOM。
param(
    [Parameter(Mandatory = $true)][string]$PathLike,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$WaitMs = 6000
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Win {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    public static IntPtr FindTitled(HashSet<uint> pids, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
            if (sb.ToString() == title) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@

$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-Process | Where-Object { $_.Path -like $PathLike } | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
if ($pids.Count -eq 0) { throw "没有匹配 $PathLike 的进程" }

# Claude 主窗口标题为 "Claude"，关闭后会隐藏到托盘，需要先 SW_SHOW
$h = [Win]::FindTitled($pids, "Claude")
if ($h -eq [IntPtr]::Zero) { throw "没有找到 Claude 主窗口" }
[Win]::ShowWindow($h, 5) | Out-Null   # SW_SHOW
[Win]::ShowWindow($h, 3) | Out-Null   # SW_MAXIMIZE
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds $WaitMs

$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
# GPU 合成的 Chromium 窗口用 PrintWindow 常得到黑屏，因此置顶后直接截取屏幕区域
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved {0} ({1}x{2})" -f $Out, $w, $hgt)
