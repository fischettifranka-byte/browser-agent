# 🔍 Browser Agent

> 把一台真实 Chrome 包装成 HTTP API，给 AI Agent 和自动化脚本用。

**v1.0.0** · 92 个接口 · 全部逐个实测

[English →](README.en.md)

---

## 这是什么

AI Agent 抓网页时，`curl` / `wget` 只能拿到 HTML 骨架：JS 渲染的内容、登录墙、懒加载列表、人机挑战统统拿不到。Browser Agent 的做法是——

**在本机（或服务器）跑一个真实的 Chromium，把所有浏览器能力拆成 92 个 HTTP 接口。**

Agent 用 HTTP 调它，就像人用手点。不是 headless 指纹伪造，是真的在用 Chrome。

## 本版内容（v1.0.0）

**新增网页爬取**

- `POST /scrape` —— 单页爬取：真实渲染后提取正文，返回标题、干净的 Markdown、纯文本、摘要；Readability 提取失败自动回退整页可见文本
- `POST /crawl` —— 整站爬取：异步任务，同域名 BFS 跟链，带深度与页数上限，进度用 `GET /crawl/status?id=` 查

**新增人工接管（takeover）**

自动化卡在登录/验证码这类过不去的坎时，`POST /takeover/start` 拉起 VNC，给你一条一次性 noVNC 链接（15 分钟自动过期），你在自己的浏览器里直接操作这台 Chrome；做完 `POST /takeover/stop` 交还控制。

**修复 5 个接口**

| 接口 | 问题 |
|---|---|
| `/watch` | 引用未定义变量，监听根本起不来 |
| `/structure` | 遍历到 SVG 元素时崩溃 |
| `/paginate` | 整页跳转翻页时执行上下文销毁，提取中断 |
| `/batch` | 内部子调用漏带鉴权，全部返回未授权 |
| `/submit` | 提交后整页跳转时偶发 500（动作本身一直是生效的） |

另修：走「恢复已有页面」路径启动时，默认页未应用统一 UA 与视口设置。

## 过风控实测

发布前跑了一轮全量测试（真实浏览器 + 住宅代理出口）：

| 站点 | 结果 |
|---|---|
| X / Google / TikTok / ChatGPT | 正常打开并渲染，无挑战页拦截 |
| Reddit（www） | 正常读取帖子流；人机挑战由真实浏览器自动解开，首访可能短暂出现挑战画面 |
| Reddit（old.reddit.com） | 需登录后使用 |
| Instagram | 呈现登录墙（未登录不可见内容，平台常规策略） |

## 快速开始

要求：**Node.js 18+** 和 **Chrome / Chromium**。

```bash
unzip browser-agent-1.0.0.zip
cd browser-agent-1.0.0

cp .env.example .env      # 填 BA_TOKEN（可选但强烈建议）
./start.sh                # 装依赖并启动
```

手动方式：

```bash
npm install
BA_TOKEN=你的令牌 node server.js
```

服务监听 `http://127.0.0.1:9223`，先验一下：

```bash
curl http://127.0.0.1:9223/status
# {"ok":true,"running":true,"browser":true,"pages":1,...}
```

### 鉴权

设了 `BA_TOKEN` 后，**除 `GET /status` 外所有接口**都要带：

```bash
curl -H 'Authorization: Bearer 你的令牌' http://127.0.0.1:9223/pages
```

不设令牌则完全无鉴权，只适合完全可信的本机环境。

### 环境变量

| 变量 | 作用 |
|---|---|
| `BA_TOKEN` | API 鉴权令牌（可选） |
| `QWEN_API_KEY` | 仅 `/ocr` 需要，阿里云 DashScope（qwen-vl-max） |
| `PORT` | 当前版本端口固定 9223，改 `server.js` 顶部 `const PORT` |

### 带代理启动

```bash
node server.js --proxy socks5://127.0.0.1:1080
node server.js --proxy http://127.0.0.1:10809
```

### 无桌面环境的服务器（systemd + Xvfb）

```ini
[Unit]
Description=Browser Agent (Puppeteer HTTP API)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/data/apps/browser-agent
Environment=BA_TOKEN=你的令牌
Environment=DISPLAY=:98
ExecStart=/usr/bin/node server.js --proxy socks5://127.0.0.1:1080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

配套虚拟显示：

```bash
Xvfb :98 -screen 0 1440x900x24 &
```

## API 参考（92 个）

> 除标注 `GET` 的接口外均为 `POST` + JSON body。所有页面级接口支持 `pageId` 指定目标标签页，不传则操作当前默认页。

### 页面管理

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/open` | `{url, waitMs?, pageId?}` 打开页面 |
| POST | `/page/new` | 新建标签页 |
| GET | `/pages` | 列出所有标签页 |
| POST | `/page/close` | `{pageId}` 关闭标签页 |
| POST | `/reload` | 刷新 |
| POST | `/back` | 后退 |
| POST | `/forward` | 前进 |
| POST | `/url` | 当前 URL |
| POST | `/viewport` | `{width, height, deviceScaleFactor?, isMobile?, hasTouch?}` |
| POST | `/close` | 关闭整个浏览器 |

### 内容提取

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/content` | `{maxChars?}` 页面文本 |
| POST | `/html` | `{maxChars?}` HTML 源码 |
| POST | `/info` | 标题 + URL + 摘要 |
| POST | `/links` | 所有链接 `[{text, href}]` |
| POST | `/images` | 所有图片 `[{src, alt, width, height}]` |
| POST | `/structure` | DOM 结构树（SVG 安全） |
| POST | `/timing` | 性能计时 DNS/TCP/TTFB/DOM |
| POST | `/exists` | `{selector}` 元素是否存在 |
| POST | `/test-selector` | `{selector}` 选择器命中数 |
| POST | `/diff` | `{url?, waitMs?}` 页面文本差异对比 |

### 爬取

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/scrape` | `{url, waitMs?=2000, screenshot?}` → `{title, markdown, text, excerpt, length, screenshot?}` |
| POST | `/crawl` | `{url, maxDepth?=2（上限5）, maxPages?=20（上限50）, waitMs?}` → `{jobId}`；同域名 BFS，最多 2 个任务并发 |
| GET | `/crawl/status` | `?id=任务ID` → `{state, done, total, queued, pages[], errors[]}` |
| POST | `/paginate` | `{nextSelector, contentSelector, maxPages}` 自动翻页提取 |

### 交互

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/click` | `{selector}` 点击 |
| POST | `/click-text` | `{text}` 按可见文本点击（中文友好） |
| POST | `/type` | `{selector, text}` 输入 |
| POST | `/fill` | `{fields:{sel:val}, submit?}` 自动填表 |
| POST | `/hover` | `{selector}` 悬停 |
| POST | `/select` | `{selector, value}` 下拉选择 |
| POST | `/enter` | `{selector?, waitMs?}` 回车 |
| POST | `/submit` | `{selector}` 表单提交（抗整页跳转） |
| POST | `/keypress` | `{key}` 或 `{combo:['Ctrl','A']}` |
| POST | `/scroll` | `{pixels}` |
| POST | `/scroll-bottom` | 滚到底（无限加载） |
| POST | `/drag` | 滑块拖拽模拟 |
| POST | `/tap` | 触摸点击（移动端） |
| POST | `/swipe` | `{from:{x,y}, to:{x,y}, steps?}` |
| POST | `/wait` | `{selector, timeout?}` 等元素出现 |
| POST | `/upload` | `{selector, filePath}` 文件上传 |
| POST | `/dismiss-dialogs` | 自动关弹窗 |
| POST | `/eval` | `{code}` 执行 JS |

### 截图与导出

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/screenshot` | 全屏 → PNG 文件 |
| POST | `/screenshot-base64` | 截图 → base64 |
| POST | `/element-screenshot` | `{selector}` 元素截图 |
| POST | `/pdf` | `{format?}` 导出 PDF |
| POST | `/export` | `{data, format:"json"\|"csv", filename?}` |
| GET | `/downloads` | 下载/导出文件列表 |

### 反检测与模拟

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/stealth` | 反检测套件（隐藏 webdriver、伪装指纹） |
| POST | `/emulate` | `{device:"auto"\|"iPhone13"\|"Pixel6"\|...}` 设备模拟 |
| GET | `/device` | 本机真实设备信息 |
| POST | `/canvas-noise` | Canvas 指纹加噪 |
| POST | `/geolocation` | `{lat, lng}` 位置模拟 |
| POST | `/headers` | `{headers:{...}}` 自定义请求头 |
| POST | `/inject` | `{js?, css?, url?}` 注入脚本/样式 |
| POST | `/cache/clear` | 清空缓存 |

### 网络与调试

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/network/start` | `{captureBody?, bodyFilter?}` 开始抓包 |
| POST | `/network/stop` | `{filter?}` 停止并取回 |
| GET | `/network` | 抓包结果 |
| POST | `/intercept/set` | `{rules:[{urlPattern, action:"block"}]}` |
| POST | `/intercept/clear` | 清除拦截规则 |
| POST | `/block-resources` | `{types:["image","font"]}` 拦资源加速 |
| POST | `/block-resources/clear` | 清除资源拦截 |
| POST | `/ws/start` | 开始捕获 WebSocket |
| POST | `/ws/messages` | 读取 WS 消息 |
| POST | `/console/start` | 开始捕获 console |
| POST | `/console` | 读 console 日志 |
| POST | `/console/clear` | 清空日志 |
| POST | `/watch` | `{selector?, timeout?}` DOM 变化监听 |
| POST | `/watch/poll` | 轮询 DOM 变化 |

### iframe

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/iframe/list` | 列出 iframe |
| POST | `/iframe/eval` | `{code, index?}` 在 iframe 内执行 JS |
| POST | `/iframe/content` | `{index?}` 取 iframe 文本 |

### 存储与 Cookie

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/storage/get` | 读 localStorage / sessionStorage |
| POST | `/storage/set` | `{type, key, value}` |
| POST | `/storage/clear` | 清除存储 |
| GET | `/cookies` | 查看 Cookie |
| POST | `/cookies/set` | 设置 Cookie |
| POST | `/cookies/import` | 导入 Cookie（Netscape / JSON） |
| POST | `/clipboard/write` | 写剪贴板 |
| POST | `/clipboard/read` | 读剪贴板 |

### 批量与任务

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/batch` | `{operations:[{endpoint, method?, body?}]}` 串行批处理（带内部鉴权） |
| POST | `/cron/add` | `{name, cron, url, actions}` |
| GET | `/cron/list` | 任务列表 |
| POST | `/cron/remove` | `{id}` |
| POST | `/cron/run` | `{id}` 立即跑一次 |
| POST | `/cron/toggle` | `{id, enabled?}` 启停 |

cron 格式 `分 时 日 月 周`（`*` `*/n` `a-b` `a,b`）；actions 支持 `open` `wait` `click` `type` `fill` `eval` `screenshot`；任务存 `cron-jobs.json`，重启自动恢复。

```bash
curl -X POST localhost:9223/cron/add -H 'Content-Type: application/json' -d '{
  "name": "每日签到", "cron": "0 8 * * *",
  "url": "https://example.com/signin",
  "actions": [
    {"type":"wait","ms":3000},
    {"type":"click","selector":"#sign-btn"},
    {"type":"screenshot"}
  ]
}'
```

### 人工接管

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| POST | `/takeover/start` | 拉起 x11vnc + noVNC，返回一次性链接（15 分钟有效） |
| POST | `/takeover/stop` | 立即结束接管 |
| GET | `/takeover/status` | `{active, expiresAt}` |

### 其他

| 方法 | 端点 | 参数 / 说明 |
|---|---|---|
| GET | `/status` | 服务状态（唯一免鉴权接口） |
| POST | `/ocr` | `{selector?}` 图片/验证码识别（需 `QWEN_API_KEY`） |

## 使用示例

```bash
# 打开 + 搜索 + 截图
curl -X POST :9223/open  -d '{"url":"https://www.baidu.com"}'
curl -X POST :9223/type  -d '{"selector":"#kw","text":"AI Agent"}'
curl -X POST :9223/enter -d '{"selector":"#kw","waitMs":2000}'
curl -X POST :9223/screenshot

# 单页转 Markdown
curl -X POST :9223/scrape -d '{"url":"https://example.com","waitMs":2500}'

# 整站爬取 20 页
curl -X POST :9223/crawl -d '{"url":"https://example.com","maxDepth":2,"maxPages":20}'
curl ":9223/crawl/status?id=1"

# 抓接口数据
curl -X POST :9223/network/start -d '{"captureBody":true,"bodyFilter":"api"}'
curl -X POST :9223/open -d '{"url":"https://example.com","waitMs":3000}'
curl -X POST :9223/network/stop -d '{"filter":"api"}'

# 反检测浏览
curl -X POST :9223/stealth
curl -X POST :9223/emulate -d '{"device":"auto"}'
curl -X POST :9223/canvas-noise

# 批量
curl -X POST :9223/batch -d '{"operations":[
  {"endpoint":"open","body":{"url":"https://github.com"}},
  {"endpoint":"screenshot"},
  {"endpoint":"links"}]}'
```

## 稳定性

- **崩溃自愈**：Chrome 被杀或崩溃后自动清状态，下次调用自动重启
- **页面上限**：最多 8 个标签页，超出关最旧的
- **全局兜底**：未捕获异常不拖垮服务
- **串行锁**：同一页面的操作自动排队，避免并发踩踏
- **爬取限流**：`/crawl` 最多 2 个任务并发，单页 70s 超时

## 已知事项

- `/ocr` 依赖阿里云 DashScope，需自行申请 `QWEN_API_KEY`，未设置时仅该接口不可用
- 端口固定 9223；Chrome 路径默认 `/usr/bin/google-chrome-stable`，不同环境改 `server.js` 顶部常量
- 默认有头模式，无桌面环境需 Xvfb 等虚拟显示
- 部分站点限制属平台策略，与工具无关：old.reddit.com 需登录、Instagram 未登录只见登录墙
- 接管功能依赖 `x11vnc` + `websockify` + noVNC 静态目录，反向代理需把 `/websockify` 与 `/vnc.html` 转发到 `127.0.0.1:6080`

## 目录结构

```
browser-agent/
├── server.js          # 主服务（92 接口）
├── start.sh           # 一键启动（自动装依赖 + 加载 .env）
├── .env.example       # 环境变量样例
├── browser.sh         # 单行调用脚本
├── test.sh            # 回归测试
├── chrome-profile/    # 持久化 Profile（登录态 / Cookie）
├── screenshots/       # 截图输出
├── downloads/         # 下载 / PDF / 导出
└── cron-jobs.json     # 定时任务持久化
```

## 技术栈

Node.js 18+ · Express 5 · puppeteer-core · Chrome DevTools Protocol · Readability + Turndown · x11vnc + noVNC

## License

MIT © 栖月 & 清绾
