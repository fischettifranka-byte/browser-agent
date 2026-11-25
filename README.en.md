# 🔍 Browser Agent

> A real Chrome browser, exposed as an HTTP API for AI agents and automation scripts.

**v1.0.0** · 92 endpoints · every one tested individually

[中文说明 →](README.md)

---

## What it is

When an AI agent scrapes the web with `curl` / `wget`, it only gets the HTML skeleton — JS-rendered content, login walls, lazy-loaded lists and bot challenges are all invisible. Browser Agent takes the other route:

**It runs a real Chromium locally (or on a server) and exposes every browser capability as 92 HTTP endpoints.**

Agents call it over HTTP, exactly like a human clicking. This is not fingerprint spoofing — it is actually driving Chrome.

## What's in v1.0.0

**New: web scraping**

- `POST /scrape` — single page: render it for real, then extract the article. Returns title, clean Markdown, plain text and an excerpt. If Readability fails, it falls back to the full visible text instead of returning nothing.
- `POST /crawl` — whole site: asynchronous job, same-host BFS link following with depth and page caps. Progress via `GET /crawl/status?id=`.

**New: human takeover**

When automation hits something it cannot pass — a login, a captcha, a consent flow — `POST /takeover/start` brings up VNC and hands you a one-time noVNC link (auto-expires in 15 minutes). Drive that same Chrome from your own browser, then `POST /takeover/stop` to hand control back.

**5 endpoints fixed**

| Endpoint | Bug |
|---|---|
| `/watch` | referenced an undefined variable, so the observer never started |
| `/structure` | crashed while walking SVG elements |
| `/paginate` | lost the execution context on full-page navigation and stopped extracting |
| `/batch` | internal sub-calls omitted auth, so every one returned 401 |
| `/submit` | occasional 500 when the page navigated after submit (the action itself always worked) |

Also fixed: when the service started through its "restore existing pages" path, the default page did not get the shared UA and viewport settings.

## Anti-bot results (measured)

Full pre-release run with a real browser and a residential egress:

| Site | Result |
|---|---|
| X / Google / TikTok / ChatGPT | opens and renders normally, no challenge interstitial |
| Reddit (www) | post feed reads fine; the JS challenge is solved automatically by the real browser, so a challenge frame may flash on first visit |
| Reddit (old.reddit.com) | requires login |
| Instagram | login wall (no content without auth — platform policy) |

## Quick start

Requirements: **Node.js 18+** and **Chrome / Chromium**.

```bash
unzip browser-agent-1.0.0.zip
cd browser-agent-1.0.0

cp .env.example .env      # set BA_TOKEN (optional but strongly recommended)
./start.sh                # installs deps and starts
```

Manual:

```bash
npm install
BA_TOKEN=your-token node server.js
```

The service listens on `http://127.0.0.1:9223`. Sanity check:

```bash
curl http://127.0.0.1:9223/status
# {"ok":true,"running":true,"browser":true,"pages":1,...}
```

### Authentication

With `BA_TOKEN` set, **every endpoint except `GET /status`** requires:

```bash
curl -H 'Authorization: Bearer your-token' http://127.0.0.1:9223/pages
```

Without a token there is no authentication at all — trusted local use only.

### Environment variables

| Variable | Purpose |
|---|---|
| `BA_TOKEN` | API bearer token (optional) |
| `QWEN_API_KEY` | only `/ocr` needs it — Alibaba DashScope (qwen-vl-max) |
| `PORT` | fixed at 9223 in this version; edit `const PORT` in `server.js` |

### Start behind a proxy

```bash
node server.js --proxy socks5://127.0.0.1:1080
node server.js --proxy http://127.0.0.1:10809
```

### Headless server (systemd + Xvfb)

```ini
[Unit]
Description=Browser Agent (Puppeteer HTTP API)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/data/apps/browser-agent
Environment=BA_TOKEN=your-token
Environment=DISPLAY=:98
ExecStart=/usr/bin/node server.js --proxy socks5://127.0.0.1:1080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Companion virtual display:

```bash
Xvfb :98 -screen 0 1440x900x24 &
```

## API reference (92)

> Unless marked `GET`, every endpoint is `POST` with a JSON body. Page-level endpoints accept `pageId` to target a specific tab; omit it to use the current default page.

### Pages

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/open` | `{url, waitMs?, pageId?}` |
| POST | `/page/new` | new tab |
| GET | `/pages` | list tabs |
| POST | `/page/close` | `{pageId}` |
| POST | `/reload` | reload |
| POST | `/back` | navigate back |
| POST | `/forward` | navigate forward |
| POST | `/url` | current URL |
| POST | `/viewport` | `{width, height, deviceScaleFactor?, isMobile?, hasTouch?}` |
| POST | `/close` | shut the browser down |

### Extraction

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/content` | `{maxChars?}` page text |
| POST | `/html` | `{maxChars?}` page HTML |
| POST | `/info` | title + URL + excerpt |
| POST | `/links` | `[{text, href}]` |
| POST | `/images` | `[{src, alt, width, height}]` |
| POST | `/structure` | DOM tree (SVG-safe) |
| POST | `/timing` | DNS/TCP/TTFB/DOM timings |
| POST | `/exists` | `{selector}` element exists |
| POST | `/test-selector` | `{selector}` match count |
| POST | `/diff` | `{url?, waitMs?}` text diff against a page |

### Scraping

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/scrape` | `{url, waitMs?=2000, screenshot?}` → `{title, markdown, text, excerpt, length, screenshot?}` |
| POST | `/crawl` | `{url, maxDepth?=2 (cap 5), maxPages?=20 (cap 50), waitMs?}` → `{jobId}`; same-host BFS, max 2 jobs at once |
| GET | `/crawl/status` | `?id=jobId` → `{state, done, total, queued, pages[], errors[]}` |
| POST | `/paginate` | `{nextSelector, contentSelector, maxPages}` paginated extraction |

### Interaction

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/click` | `{selector}` |
| POST | `/click-text` | `{text}` click by visible text (CJK-friendly) |
| POST | `/type` | `{selector, text}` |
| POST | `/fill` | `{fields:{sel:val}, submit?}` |
| POST | `/hover` | `{selector}` |
| POST | `/select` | `{selector, value}` |
| POST | `/enter` | `{selector?, waitMs?}` |
| POST | `/submit` | `{selector}` (survives full-page navigation) |
| POST | `/keypress` | `{key}` or `{combo:['Ctrl','A']}` |
| POST | `/scroll` | `{pixels}` |
| POST | `/scroll-bottom` | scroll until the end (infinite feeds) |
| POST | `/drag` | slider drag simulation |
| POST | `/tap` | touch tap (mobile) |
| POST | `/swipe` | `{from:{x,y}, to:{x,y}, steps?}` |
| POST | `/wait` | `{selector, timeout?}` wait for an element |
| POST | `/upload` | `{selector, filePath}` |
| POST | `/dismiss-dialogs` | auto-dismiss dialogs |
| POST | `/eval` | `{code}` run JS |

### Screenshots & export

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/screenshot` | full page → PNG file |
| POST | `/screenshot-base64` | screenshot → base64 |
| POST | `/element-screenshot` | `{selector}` |
| POST | `/pdf` | `{format?}` |
| POST | `/export` | `{data, format:"json"\|"csv", filename?}` |
| GET | `/downloads` | downloaded / exported files |

### Anti-detection & emulation

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/stealth` | hides webdriver, patches fingerprint surfaces |
| POST | `/emulate` | `{device:"auto"\|"iPhone13"\|"Pixel6"\|...}` |
| GET | `/device` | real host device info |
| POST | `/canvas-noise` | canvas fingerprint noise |
| POST | `/geolocation` | `{lat, lng}` |
| POST | `/headers` | `{headers:{...}}` |
| POST | `/inject` | `{js?, css?, url?}` |
| POST | `/cache/clear` | clear cache |

### Network & debugging

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/network/start` | `{captureBody?, bodyFilter?}` |
| POST | `/network/stop` | `{filter?}` stop and return |
| GET | `/network` | captured requests |
| POST | `/intercept/set` | `{rules:[{urlPattern, action:"block"}]}` |
| POST | `/intercept/clear` | clear rules |
| POST | `/block-resources` | `{types:["image","font"]}` |
| POST | `/block-resources/clear` | clear |
| POST | `/ws/start` | start WebSocket capture |
| POST | `/ws/messages` | read WS messages |
| POST | `/console/start` | start console capture |
| POST | `/console` | read console logs |
| POST | `/console/clear` | clear logs |
| POST | `/watch` | `{selector?, timeout?}` DOM mutation watch |
| POST | `/watch/poll` | poll for changes |

### iframes

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/iframe/list` | list frames |
| POST | `/iframe/eval` | `{code, index?}` eval inside a frame |
| POST | `/iframe/content` | `{index?}` frame text |

### Storage & cookies

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/storage/get` | read localStorage / sessionStorage |
| POST | `/storage/set` | `{type, key, value}` |
| POST | `/storage/clear` | clear storage |
| GET | `/cookies` | view cookies |
| POST | `/cookies/set` | set a cookie |
| POST | `/cookies/import` | import cookies (Netscape / JSON) |
| POST | `/clipboard/write` | write clipboard |
| POST | `/clipboard/read` | read clipboard |

### Batch & scheduled jobs

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/batch` | `{operations:[{endpoint, method?, body?}]}` serial batch (auth carried internally) |
| POST | `/cron/add` | `{name, cron, url, actions}` |
| GET | `/cron/list` | list jobs |
| POST | `/cron/remove` | `{id}` |
| POST | `/cron/run` | `{id}` run once now |
| POST | `/cron/toggle` | `{id, enabled?}` |

cron format `min hour dom mon dow` (`*` `*/n` `a-b` `a,b`); actions: `open` `wait` `click` `type` `fill` `eval` `screenshot`; jobs persist to `cron-jobs.json` and survive restarts.

```bash
curl -X POST localhost:9223/cron/add -H 'Content-Type: application/json' -d '{
  "name": "daily check-in", "cron": "0 8 * * *",
  "url": "https://example.com/signin",
  "actions": [
    {"type":"wait","ms":3000},
    {"type":"click","selector":"#sign-btn"},
    {"type":"screenshot"}
  ]
}'
```

### Human takeover

| Method | Endpoint | Params / notes |
|---|---|---|
| POST | `/takeover/start` | starts x11vnc + noVNC, returns a one-time link (valid 15 min) |
| POST | `/takeover/stop` | end takeover now |
| GET | `/takeover/status` | `{active, expiresAt}` |

### Misc

| Method | Endpoint | Params / notes |
|---|---|---|
| GET | `/status` | service status (the only unauthenticated endpoint) |
| POST | `/ocr` | `{selector?}` image / captcha OCR (needs `QWEN_API_KEY`) |

## Examples

```bash
# open, search, screenshot
curl -X POST :9223/open  -d '{"url":"https://www.baidu.com"}'
curl -X POST :9223/type  -d '{"selector":"#kw","text":"AI Agent"}'
curl -X POST :9223/enter -d '{"selector":"#kw","waitMs":2000}'
curl -X POST :9223/screenshot

# one page → Markdown
curl -X POST :9223/scrape -d '{"url":"https://example.com","waitMs":2500}'

# crawl a site, 20 pages
curl -X POST :9223/crawl -d '{"url":"https://example.com","maxDepth":2,"maxPages":20}'
curl ":9223/crawl/status?id=1"

# capture JSON API traffic
curl -X POST :9223/network/start -d '{"captureBody":true,"bodyFilter":"api"}'
curl -X POST :9223/open -d '{"url":"https://example.com","waitMs":3000}'
curl -X POST :9223/network/stop -d '{"filter":"api"}'

# anti-detection browsing
curl -X POST :9223/stealth
curl -X POST :9223/emulate -d '{"device":"auto"}'
curl -X POST :9223/canvas-noise

# batch
curl -X POST :9223/batch -d '{"operations":[
  {"endpoint":"open","body":{"url":"https://github.com"}},
  {"endpoint":"screenshot"},
  {"endpoint":"links"}]}'
```

## Reliability

- **Self-healing**: if Chrome is killed or crashes, state is cleaned up and the next call relaunches it
- **Tab cap**: 8 tabs, oldest closed first
- **Global guards**: uncaught errors never take the service down
- **Serialized page operations**: per-page queue, no concurrent stomping
- **Crawl throttling**: max 2 concurrent `/crawl` jobs, 70s per-page timeout

## Known limitations

- `/ocr` depends on Alibaba DashScope — set `QWEN_API_KEY` yourself; that single endpoint is unavailable otherwise
- Port is fixed at 9223; Chrome path defaults to `/usr/bin/google-chrome-stable` (edit constants atop `server.js`)
- Headed mode by default — headless servers need Xvfb or explicit headless flags
- Some site restrictions are platform policy, not tool bugs: old.reddit.com needs login, Instagram shows a login wall when signed out
- Takeover needs `x11vnc` + `websockify` + a noVNC static dir, and the reverse proxy must forward `/websockify` and `/vnc.html` to `127.0.0.1:6080`

## Layout

```
browser-agent/
├── server.js          # the service (92 endpoints)
├── start.sh           # one-shot start (installs deps, loads .env)
├── .env.example       # env template
├── browser.sh         # one-line CLI helper
├── test.sh            # regression tests
├── chrome-profile/    # persistent profile (logins, cookies)
├── screenshots/       # screenshot output
├── downloads/         # downloads / PDFs / exports
└── cron-jobs.json     # scheduled job persistence
```

## Stack

Node.js 18+ · Express 5 · puppeteer-core · Chrome DevTools Protocol · Readability + Turndown · x11vnc + noVNC

## License

MIT © Qiyue & Qingwan
