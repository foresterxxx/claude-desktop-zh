#!/bin/bash
# Claude Desktop 中文补丁 - macOS 交互菜单（双击运行）
# 实验性支持：macOS 流程尚未在真机上完整验证，安装前会自动整包备份 Claude.app。
set -e
cd "$(dirname "$0")"

NODE="$(command -v node || true)"
for p in /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -z "$NODE" ] && [ -x "$p" ] && NODE="$p"
done
if [ -z "$NODE" ]; then
  echo "未检测到 Node.js（需要 18 或更高版本）。"
  echo "可以执行：brew install node   或前往 https://nodejs.org 下载安装后重新运行。"
  read -r -p "按回车退出" _
  exit 1
fi

APP="/Applications/Claude.app"
run_cli() {
  # /Applications 下的应用通常需要管理员权限才能修改
  if [ -w "$APP/Contents/Resources" ]; then
    "$NODE" bin/claude-zh.js "$@"
  else
    echo "需要管理员权限，请输入 Mac 登录密码："
    sudo "$NODE" bin/claude-zh.js "$@"
  fi
}

echo ""
echo "=============================================="
echo "        Claude Desktop 中文补丁（macOS）"
echo "=============================================="
"$NODE" bin/claude-zh.js status || true
echo ""
echo "  1. 安装 简体中文"
echo "  2. 安装 繁體中文（台灣）"
echo "  3. 安装 繁體中文（香港）"
echo "  4. 恢复官方原版（卸载补丁）"
echo "  5. 查看翻译覆盖率"
echo "  0. 退出"
echo ""
read -r -p "请选择：" choice

case "$choice" in
  1|2|3)
    case "$choice" in 1) LANG_CODE=zh-CN ;; 2) LANG_CODE=zh-TW ;; 3) LANG_CODE=zh-HK ;; esac
    echo "安装过程会自动退出正在运行的 Claude，请先保存好正在进行的工作。"
    read -r -p "是否同时汉化前端硬编码文案？覆盖更全，但客户端更新后风险略高 (y/N)：" hc
    EXTRA=()
    [[ "$hc" =~ ^[yY] ]] && EXTRA+=(--hardcoded)
    if run_cli install --lang "$LANG_CODE" --kill "${EXTRA[@]}"; then
      read -r -p "是否现在打开 Claude？(Y/n)：" o
      [[ "$o" =~ ^[nN] ]] || open -a "$APP"
    fi
    ;;
  4) run_cli restore --kill ;;
  5) "$NODE" bin/claude-zh.js coverage ;;
  *) ;;
esac

echo ""
read -r -p "按回车退出" _
