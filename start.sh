#!/usr/bin/env bash
# browser-agent 一键启动：装依赖 + 启动服务
set -e
cd "$(dirname "$0")"

# 如存在 .env，加载其中的环境变量（BA_TOKEN / QWEN_API_KEY 等）
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ ! -d node_modules ]; then
  echo "📦 正在安装依赖..."
  npm install
fi

echo "🚀 启动 browser-agent → http://127.0.0.1:9223"
exec node server.js "$@"
