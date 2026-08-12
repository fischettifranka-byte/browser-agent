#!/data/data/com.termux/files/usr/bin/bash
B="http://127.0.0.1:9223"
P=0; F=0; SKIP=0
T() {
  n="$1"; m="$2"; e="$3"; d="$4"
  r=$( [ "$m" = "GET" ] && curl -s --max-time 15 "$B/$e" || curl -s --max-time 15 -X POST "$B/$e" -H "Content-Type: application/json" -d "$d" )
  ok=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok','?'))" 2>/dev/null)
  if [ "$ok" = "True" ]; then
    echo "  ✅ $n"; P=$((P+1))
  elif [ "$ok" = "?" ]; then
    echo "  ⚠️ $n — 无响应"; SKIP=$((SKIP+1))
  else
    err=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','?'))" 2>/dev/null)
    echo "  ❌ $n — $err"; F=$((F+1))
  fi
}

echo "🔍 Browser Agent — 全覆盖回归测试"
echo "===================================="

# 先打开一个页面
echo "📄 打开测试页..."
curl -s -X POST "$B/open" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.baidu.com","waitMs":5000}' > /dev/null

echo ""
echo "📄 页面管理 (6)"
T "打开" POST "open" '{"url":"https://www.baidu.com","waitMs":5000}'
T "新建标签" POST "page/new" '{}'
T "列出页面" GET "pages"
T "刷新" POST "reload" '{}'
T "后退" POST "back" '{}'
T "前进" POST "forward" '{}'

echo ""
echo "📸 截图 (4)"
T "全屏截图" POST "screenshot" '{}'
T "base64截图" POST "screenshot-base64" '{}'
T "元素截图" POST "element-screenshot" '{"selector":"body"}'
T "PDF导出" POST "pdf" '{}'

echo ""
echo "📖 内容提取 (5)"
T "文本内容" POST "content" '{"maxChars":500}'
T "HTML源码" POST "html" '{"maxChars":2000}'
T "页面信息" POST "info" '{}'
T "所有链接" POST "links" '{}'
T "所有图片" POST "images" '{}'

echo ""
echo "🖱️ 交互操作 (10)"
T "点击" POST "click" '{"selector":"#su","timeout":3000}'
T "输入文字" POST "type" '{"selector":"#kw","text":"test","clearFirst":false}'
T "悬停" POST "hover" '{"selector":"#su"}'
T "回车" POST "enter" '{"selector":"#su","waitMs":1500}'
T "按键" POST "keypress" '{"key":"Escape"}'
T "提交" POST "submit" '{"selector":"#su","waitMs":2000}'
T "滚动" POST "scroll" '{"pixels":200}'
T "选择下拉" POST "select" '{"selector":"select","value":""}'
T "等待元素" POST "wait" '{"selector":"body","timeout":3000}'
T "执行JS" POST "eval" '{"code":"1+1"}'

echo ""
echo "💉 注入/模拟 (4)"
T "JS注入" POST "inject" '{"js":"window.__t=42"}'
T "CSS注入" POST "inject" '{"css":"body{outline:1px solid red}"}'
T "模拟auto" POST "emulate" '{"device":"auto"}'
T "模拟iPhone" POST "emulate" '{"device":"iPhone13"}'

echo ""
echo "🛡️ 反检测/拦截 (3)"
T "stealth" POST "stealth" '{}'
T "geolocation" POST "geolocation" '{"lat":31.2,"lng":121.4}'
T "headers" POST "headers" '{"headers":{"X-Test":"1"}}'

echo ""
echo "🌐 网络 (3)"
T "开始抓包" POST "network/start" '{}'
curl -s -X POST "$B/open" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.baidu.com","waitMs":2000}' > /dev/null
sleep 1
T "停止抓包" POST "network/stop" '{}'
T "抓包状态" GET "network"

echo ""
echo "💾 存储 (3)"
T "写Storage" POST "storage/set" '{"key":"_t","value":"ok"}'
T "读Storage" POST "storage/get" '{}'
T "清Storage" POST "storage/clear" '{"type":"local"}'

echo ""
echo "📋 Console (2)"
T "开启Console" POST "console/start" '{}'
T "读取Console" POST "console" '{}'

echo ""
echo "🎯 高级 (7)"
T "选择器测试" POST "test-selector" '{"selector":"input"}'
T "性能计时" POST "timing" '{}'
T "结构分析" POST "structure" '{}'
T "iframe列表" POST "iframe/list" '{}'
T "弹窗消除" POST "dismiss-dialogs" '{}'
T "滚动到底" POST "scroll-bottom" '{"maxScrolls":2,"waitMs":500}'
T "WS监听" POST "ws/start" '{}'

echo ""
echo "📊 数据 (4)"
T "批量操作" POST "batch" '{"operations":[{"endpoint":"status","method":"GET"},{"endpoint":"info"}]}'
T "导出JSON" POST "export" '{"data":[{"x":1}],"format":"json"}'
T "导出CSV" POST "export" '{"data":[{"a":1,"b":2}],"format":"csv"}'
T "剪贴板写" POST "clipboard/write" '{"text":"test"}'

echo ""
echo "🍪 Cookie (2)"
T "查看Cookie" GET "cookies"
T "设置Cookie" POST "cookies/set" '{"cookies":{"name":"_t","value":"1","domain":".baidu.com"}}'

echo ""
echo "===================================="
echo "  ✅ $P  ⚠️ $SKIP  ❌ $F"
echo "===================================="
