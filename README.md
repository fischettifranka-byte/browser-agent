# 🔍 Browser Agent

> HTTP API 驱动的 headless Chromium，给 AI Agent 用的手机端浏览器自动化工具

跑在 Android Termux 上，把 Puppeteer 的能力全包装成 HTTP API。给 AI 调用，替代桌面端 Puppeteer。

60 秒内启动，PM2 托管，Profile 持久化，70+ API 全覆盖。

---

## 为什么需要它

AI Agent 搜网页时，curl/wget 拿不到 JS 渲染的内容。企查查付费页、裁判文书网、谷歌地图——这些需要真实浏览器。

Browser Agent 在手机上跑一个 headless Chromium，AI 通过 HTTP API 操控它，就像桌面上的 Puppeteer。

## 快速开始

```bash
# 1. 安装依赖（Termux 环境）
pkg install chromium nodejs -y
git clone https://github.com/fischettifranka-byte/browser-agent
cd browser-agent
npm install

# 2. 启动
node server.js

# 3. 测试
curl http://127.0.0.1:9223/status
```

**带代理启动：**
```bash
node server.js --proxy http://127.0.0.1:10809
```

**PM2 后台运行（推荐）：**
```bash
npm install -g pm2
pm2 start server.js --name browser-agent
pm2 save
```

---

## API 参考

> 所有 POST 接口支持 `pageId` 参数指定目标页面，不传则操作默认页面。

### 📄 页面管理
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/open` | 打开 URL `{url, waitMs?, pageId?}` |
| POST | `/page/new` | 新建标签页 |
| GET | `/pages` | 列出所有页面 |
| POST | `/page/close` | 关闭标签页 `{pageId}` |
| POST | `/reload` | 刷新当前页 |
| POST | `/back` | 后退 |
| POST | `/forward` | 前进 |

### 📸 截图
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/screenshot` | 全屏截图 → PNG 文件 |
| POST | `/screenshot-base64` | 截图 → base64 字符串 |
| POST | `/element-screenshot` | 元素截图 `{selector}` |

### 📖 内容提取
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/content` | 页面文本 `{maxChars?}` |
| POST | `/html` | HTML 源码 `{maxChars?}` |
| POST | `/info` | 标题+URL+摘要 |
| POST | `/links` | 所有链接 `[{text, href}]` |
| POST | `/images` | 所有图片 `[{src, alt, width, height}]` |
| POST | `/structure` | DOM 结构树分析 |
| POST | `/pdf` | 导出 PDF `{format?}` |
| POST | `/timing` | 页面性能计时 (DNS/TCP/TTFB/DOM) |

### 🖱️ 交互操作
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/click` | 点击元素 `{selector}` |
| POST | `/type` | 输入文字 `{selector, text}` |
| POST | `/hover` | 鼠标悬停 `{selector}` |
| POST | `/drag` | 拖拽模拟（滑块验证码） |
| POST | `/tap` | 触摸点击（移动端） |
| POST | `/swipe` | 触摸滑动 `{from, to}` |
| POST | `/select` | 下拉框选择 `{selector, value}` |
| POST | `/enter` | 按回车 `{selector?}` |
| POST | `/submit` | 表单提交 `{selector}` |
| POST | `/keypress` | 键盘按键 `{key}` 或组合键 `{combo:['Ctrl','A']}` |
| POST | `/scroll` | 滚动 `{pixels}` |
| POST | `/scroll-bottom` | 自动滚到底（无限加载） |
| POST | `/eval` | 执行 JS `{code}` |
| POST | `/upload` | 文件上传 `{selector, filePath}` |
| POST | `/fill` | 自动填表 `{fields:{selector:value}, submit?}` |

### 💉 注入与模拟
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/inject` | 注入 JS/CSS/外部脚本 `{js?, css?, url?}` |
| POST | `/emulate` | 设备模拟 `{device:"auto"\|"iPhone13"\|"Pixel6"\|...}` |
| GET | `/device` | 读取本机真实设备信息 |
| POST | `/stealth` | 反检测套件（隐藏 webdriver/伪装指纹） |
| POST | `/geolocation` | GPS 位置模拟 `{lat, lng}` |
| POST | `/headers` | 自定义请求头 `{headers:{...}}` |
| POST | `/canvas-noise` | Canvas 指纹加噪声 |

### 🌐 网络
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/network/start` | 开始抓包 `{captureBody?, bodyFilter?}` |
| POST | `/network/stop` | 停止抓包 `{filter?}` |
| GET | `/network` | 查看抓包结果 |
| POST | `/intercept/set` | 拦截请求 `{rules:[{urlPattern, action:"block"}]}` |
| POST | `/intercept/clear` | 清除拦截规则 |
| POST | `/block-resources` | 拦截资源加速 `{types:["image","font"]}` |
| POST | `/block-resources/clear` | 清除资源拦截 |
| POST | `/ws/start` | 开始捕获 WebSocket 消息 |
| POST | `/ws/messages` | 读取 WS 消息 |

### 📋 调试
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/console/start` | 开始捕获 console 日志 |
| POST | `/console` | 读取 console 日志 |
| POST | `/console/clear` | 清空日志 |
| POST | `/watch` | DOM 变化监听 `{selector?, timeout?}` |
| POST | `/watch/poll` | 轮询 DOM 变化 |
| POST | `/test-selector` | CSS 选择器测试 `{selector}` |
| POST | `/dismiss-dialogs` | 自动关闭弹窗 |
| POST | `/diff` | 页面文本差异对比 `{url?, waitMs?}` |

### ⓘ iframe
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/iframe/list` | 列出所有 iframe |
| POST | `/iframe/eval` | 在 iframe 中执行 JS |
| POST | `/iframe/content` | 获取 iframe 文本 |

### 💾 存储
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/storage/get` | 读 localStorage/sessionStorage |
| POST | `/storage/set` | 写 `{type, key, value}` |
| POST | `/storage/clear` | 清除 |

### 📊 数据
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/paginate` | 自动翻页提取 `{nextSelector, contentSelector, maxPages}` |
| POST | `/batch` | 批量执行 `{operations:[{endpoint, method, body}]}` |
| POST | `/export` | 导出数据 (JSON/CSV) |
| POST | `/clipboard/write` | 写剪贴板 |
| POST | `/clipboard/read` | 读剪贴板 |

### 🍪 状态
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/status` | 服务状态 |
| GET | `/cookies` | 查看 Cookie |
| POST | `/cookies/set` | 设置 Cookie |
| POST | `/cookies/import` | 导入 Cookie (Netscape/JSON) |
| GET | `/downloads` | 下载文件列表 |
| POST | `/close` | 关闭浏览器 |

---

## 使用示例

```bash
# 搜索并截图
curl -X POST :9223/open -d '{"url":"https://www.baidu.com"}'
curl -X POST :9223/type -d '{"selector":"#kw","text":"AI Agent"}'
curl -X POST :9223/enter -d '{"selector":"#kw","waitMs":2000}'
curl -X POST :9223/screenshot

# 抓取 API 数据
curl -X POST :9223/network/start -d '{"captureBody":true,"bodyFilter":"api"}'
curl -X POST :9223/open -d '{"url":"https://example.com","waitMs":3000}'
curl -X POST :9223/network/stop -d '{"filter":"api"}'

# 反检测浏览
curl -X POST :9223/stealth
curl -X POST :9223/emulate -d '{"device":"auto"}'
curl -X POST :9223/canvas-noise

# 批量操作
curl -X POST :9223/batch -d '{
  "operations":[
    {"endpoint":"open","body":{"url":"https://github.com"}},
    {"endpoint":"screenshot"},
    {"endpoint":"links"}
  ]
}'

# 自动翻页
curl -X POST :9223/paginate -d '{
  "nextSelector":".pagination .next",
  "contentSelector":".item",
  "maxPages":5
}'
```

---

## 快捷脚本

```bash
# browser.sh — 单行调用
bash browser.sh status
bash browser.sh open '{"url":"https://example.com"}'
bash browser.sh screenshot
bash browser.sh content '{"maxChars":5000}'
```

---

## 技术栈

- **Node.js** + Express 5
- **Puppeteer-core** 操控 headless Chromium
- **Chrome DevTools Protocol** (CDP) — 下载管理、网络监听
- **Android Termux** aarch64
- **PM2** 进程管理

## 目录结构

```
browser-agent/
├── server.js           # 主服务 (1911行, 70+ API)
├── package.json
├── browser.sh          # 快捷调用脚本
├── test.sh             # 回归测试
├── chrome-profile/     # 持久化 Profile (Cookie/登录态)
├── screenshots/        # 截屏输出
└── downloads/          # 下载 + PDF + 导出
```

## License

MIT — 栖月 & 清绾
