#!/bin/bash
# 恢复 Claude Desktop 原版文件并移除本补丁。
set -e
cd "$(dirname "$0")"

NODE="$(command -v node || true)"
for p in /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -z "$NODE" ] && [ -x "$p" ] && NODE="$p"
done
if [ -z "$NODE" ]; then
  echo "未检测到 Node.js（需要 18 或更高版本）。"
  read -r -p "按回车退出" _
  exit 1
fi

APP="/Applications/Claude.app"
if [ -w "$APP/Contents/Resources" ]; then
  "$NODE" bin/claude-zh.js restore --kill
else
  echo "恢复应用文件需要管理员权限，请输入 Mac 登录密码："
  sudo "$NODE" bin/claude-zh.js restore --kill
fi

echo "原版 Claude Desktop 文件已恢复，本补丁已卸载。"
read -r -p "按回车退出" _
