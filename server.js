#!/usr/bin/env node
/**
 * 🔍 Browser Agent v2 — 手机浏览器自动化服务
 * 给 AI 调用，操控本地 Chromium，替代桌面端 Puppeteer
 * 
 * 用法: node server.js [--proxy http://ip:port]
 * 端口: 9223
 */

const express = require('express');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PORT = 9223;
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const USER_DATA = path.join(__dirname, 'chrome-profile');
const DOWNLOADS = path.join(__dirname, 'downloads');
const SCREENSHOTS = path.join(__dirname, 'screenshots');

// 解析命令行参数
const args = process.argv.slice(2);
const proxyArg = args.find((a, i) => a === '--proxy' && i + 1 < args.length);
const PROXY = proxyArg ? args[args.indexOf('--proxy') + 1] : null;

let browser = null;
const pages = new Map(); // id → { page, title, url, createdAt }
let pageCounter = 0;

fs.mkdirSync(SCREENSHOTS, { recursive: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/screenshots', express.static(SCREENSHOTS));

// ── 启动浏览器 ──
async function ensureBrowser() {
  if (browser) return;
  
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--user-data-dir=${USER_DATA}`,
  ];
  
  if (PROXY) {
    launchArgs.push(`--proxy-server=${PROXY}`);
    console.log(`🌐 使用代理: ${PROXY}`);
  }
  
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: launchArgs,
    acceptInsecureCerts: true,
  });
  
  // 恢复之前的页面或创建新页面
  const existingPages = await browser.pages();
  if (existingPages.length > 0) {
    const p = existingPages[0];
    const id = String(++pageCounter);
    pages.set(id, { page: p, title: await p.title(), url: p.url(), createdAt: Date.now() });
  } else {
    await newPage();
  }
  
  console.log('✅ 浏览器启动成功 (profile持久化)');
}

// 创建新标签页
async function newPage() {
  const p = await browser.newPage();
  await p.setViewport({ width: 412, height: 915 });
  
  // 配置下载行为
  const client = await p.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
  });
  
  const id = String(++pageCounter);
  pages.set(id, { page: p, title: 'about:blank', url: 'about:blank', createdAt: Date.now() });
  return id;
}

// 获取或创建默认页面
async function getDefaultPage() {
  await ensureBrowser();
  if (pages.size === 0) return await newPage();
  return pages.keys().next().value;
}

// ── 本机设备检测 ──
function detectDevice() {
  try {
    const props = [
      'ro.product.model',
      'ro.product.brand',
      'ro.build.version.release',
      'ro.product.cpu.abi',
      'ro.sf.lcd_density',
    ];
    const info = {};
    for (const p of props) {
      try {
        const val = execSync(`getprop ${p}`, { timeout: 2000 }).toString().trim();
        info[p.split('.').pop()] = val;
      } catch (_) {}
    }
    
    // 屏幕尺寸
    try {
      const wm = execSync('wm size', { timeout: 2000 }).toString().trim();
      const m = wm.match(/(\d+)x(\d+)/);
      if (m) {
        info.width = parseInt(m[1]);
        info.height = parseInt(m[2]);
      }
    } catch (_) {}
    
    // DPI
    try {
      const dpi = execSync('wm density', { timeout: 2000 }).toString().trim();
      const m = dpi.match(/density[=:]\s*(\d+)/);
      if (m) info.density = parseInt(m[1]);
    } catch (_) {}
    
    // 构建真实 User-Agent
    const model = info.model || 'Android';
    const release = info.release || '14';
    const brand = info.brand || 'Xiaomi';
    info.userAgent = `Mozilla/5.0 (Linux; Android ${release}; ${brand} ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36`;
    
    return info;
  } catch (_) {
    return null;
  }
}

// 设备信息查询（不修改浏览器状态）
app.get('/device', async (req, res) => {
  const info = detectDevice();
  res.json({ ok: true, detected: !!info, device: info });
});

// 打开 URL
app.post('/open', async (req, res) => {
  try {
    await ensureBrowser();
    const { url, waitMs, pageId } = req.body;
    
    let pid = pageId;
    let entry;
    if (pid && pages.has(pid)) {
      entry = pages.get(pid);
    } else {
      pid = await getDefaultPage();
      entry = pages.get(pid);
    }
    
    await entry.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    
    entry.title = await entry.page.title();
    entry.url = entry.page.url();
    res.json({ ok: true, pageId: pid, title: entry.title, url: entry.url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 截屏
app.post('/screenshot', async (req, res) => {
  try {
    await ensureBrowser();
    const pid = req.body?.pageId || await getDefaultPage();
    const entry = pages.get(pid);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    const filename = `shot_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS, filename);
    await entry.page.screenshot({ path: filepath, fullPage: req.body?.fullPage ?? false });
    res.json({ ok: true, pageId: pid, file: filename, url: `/screenshots/${filename}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取目标页面（辅助） ──
function getPageEntry(req) {
  const pid = req.body?.pageId || [...pages.keys()][0];
  return { pid, entry: pages.get(pid) };
}

// 点击元素
app.post('/click', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, timeout } = req.body;
    await entry.page.waitForSelector(selector, { timeout: timeout || 5000 });
    await entry.page.click(selector);
    res.json({ ok: true, pageId: pid, clicked: selector });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 输入文字
app.post('/type', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, text, timeout, clearFirst } = req.body;
    await entry.page.waitForSelector(selector, { timeout: timeout || 5000 });
    if (clearFirst !== false) {
      try {
        await entry.page.click(selector, { clickCount: 3 });
      } catch (_) {
        // click失败时直接用evaluate清空
        await entry.page.evaluate((sel) => { const el = document.querySelector(sel); if (el && 'value' in el) el.value = ''; }, selector);
      }
    }
    try {
      await entry.page.type(selector, text);
    } catch (_) {
      // type失败时直接设value然后触发input事件
      await entry.page.evaluate((sel, val) => {
        const el = document.querySelector(sel);
        if (el && 'value' in el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, selector, text);
    }
    res.json({ ok: true, pageId: pid, typed: selector });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 获取页面文本内容
app.post('/content', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const text = await entry.page.evaluate(() => document.body.innerText);
    const sliced = text.slice(0, req.body?.maxChars || 10000);
    res.json({ ok: true, pageId: pid, text: sliced, totalChars: text.length, truncated: text.length > sliced.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 获取 HTML
app.post('/html', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const html = await entry.page.content();
    const sliced = html.slice(0, req.body?.maxChars || 50000);
    res.json({ ok: true, pageId: pid, html: sliced, totalChars: html.length, truncated: html.length > sliced.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 执行 JS
app.post('/eval', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const result = await entry.page.evaluate(req.body.code);
    res.json({ ok: true, pageId: pid, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 等待元素
app.post('/wait', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, timeout } = req.body;
    await entry.page.waitForSelector(selector, { timeout: timeout || 10000 });
    res.json({ ok: true, pageId: pid, found: selector });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 滚动
app.post('/scroll', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { pixels } = req.body;
    await entry.page.evaluate((px) => window.scrollBy(0, px), pixels || 500);
    res.json({ ok: true, pageId: pid });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 获取所有链接
app.post('/links', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const links = await entry.page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim().slice(0, 100),
        href: a.href,
      })).filter(l => l.href);
    });
    res.json({ ok: true, pageId: pid, count: links.length, links });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 获取页面标题+基本信息
app.post('/info', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const info = await entry.page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyText: document.body?.innerText?.slice(0, 500) || '',
    }));
    res.json({ ok: true, pageId: pid, ...info });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 多页面管理 ──

// 新建标签页
app.post('/page/new', async (req, res) => {
  try {
    await ensureBrowser();
    const id = await newPage();
    res.json({ ok: true, pageId: id, total: pages.size });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 列出所有页面
app.get('/pages', async (req, res) => {
  try {
    await ensureBrowser();
    const list = [...pages.entries()].map(([id, e]) => ({
      pageId: id,
      title: e.title,
      url: e.url,
      age: Math.round((Date.now() - e.createdAt) / 1000),
    }));
    res.json({ ok: true, count: list.length, pages: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 关闭标签页
app.post('/page/close', async (req, res) => {
  try {
    const { pageId } = req.body;
    const entry = pages.get(pageId);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    await entry.page.close();
    pages.delete(pageId);
    res.json({ ok: true, closed: pageId, remaining: pages.size });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Cookie 管理 ──
app.get('/cookies', async (req, res) => {
  try {
    await ensureBrowser();
    const cookies = await browser.cookies();
    res.json({ ok: true, count: cookies.length, cookies });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/cookies/set', async (req, res) => {
  try {
    await ensureBrowser();
    const { cookies } = req.body; // 数组或单个
    const list = Array.isArray(cookies) ? cookies : [cookies];
    await Promise.all(list.map(c => browser.setCookie(c)));
    res.json({ ok: true, set: list.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 文件下载列表 ──
app.get('/downloads', async (req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOADS).map(f => {
      const stat = fs.statSync(path.join(DOWNLOADS, f));
      return { name: f, size: stat.size, time: stat.mtime };
    });
    res.json({ ok: true, count: files.length, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 服务下载文件
app.use('/downloads', express.static(DOWNLOADS));

// ── 高级交互 ──

// 表单提交（搜索框输入+回车最常用）
app.post('/submit', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector } = req.body;
    await entry.page.$eval(selector, el => el.form ? el.form.submit() : el.closest('form')?.submit());
    await new Promise(r => setTimeout(r, req.body?.waitMs || 2000));
    res.json({ ok: true, pageId: pid, url: entry.page.url() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 按下回车（针对输入框）
app.post('/enter', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector } = req.body;
    if (selector) {
      await entry.page.focus(selector);
    }
    await entry.page.keyboard.press('Enter');
    if (req.body?.waitMs) await new Promise(r => setTimeout(r, req.body.waitMs));
    res.json({ ok: true, pageId: pid });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 键盘快捷键
app.post('/keypress', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { key, selector, combo } = req.body; // key: 'Enter'/'Escape'/'Tab' 或 combo: ['Control','A']
    if (selector) await entry.page.focus(selector);
    if (combo) {
      // 组合键如 Ctrl+A, Ctrl+C
      await entry.page.keyboard.down(combo[0]);
      await entry.page.keyboard.press(combo[1]);
      await entry.page.keyboard.up(combo[0]);
    } else if (key) {
      await entry.page.keyboard.press(key);
    }
    res.json({ ok: true, pageId: pid });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 鼠标悬停
app.post('/hover', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    await entry.page.hover(req.body.selector);
    res.json({ ok: true, pageId: pid, hovered: req.body.selector });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 下拉选择框
app.post('/select', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, value } = req.body;
    await entry.page.select(selector, value);
    res.json({ ok: true, pageId: pid, selected: value });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 文件上传
app.post('/upload', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, filePath } = req.body;
    const input = await entry.page.$(selector);
    await input.uploadFile(filePath);
    res.json({ ok: true, pageId: pid, uploaded: filePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 自动关闭弹窗/alert/confirm/dialog
app.post('/dismiss-dialogs', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    const dismissed = [];
    
    // 监听并自动关闭 dialog
    entry.page.on('dialog', async dialog => {
      const type = dialog.type();
      dismissed.push(type);
      if (type === 'prompt' && req.body?.promptText) {
        await dialog.accept(req.body.promptText);
      } else if (req.body?.accept !== false) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
    
    // 常见弹窗关闭按钮
    const closeSelectors = [
      '.modal-close', '.close', '[aria-label="关闭"]', '[aria-label="Close"]',
      '.dialog-close', '.popup-close', '.overlay-close',
      'button:has-text("关闭")', 'button:has-text("Close")',
      '[class*="close"]', '[class*="Close"]',
    ];
    
    for (const sel of closeSelectors) {
      try {
        const el = await entry.page.$(sel);
        if (el) {
          await el.click();
          dismissed.push(sel);
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (_) {}
    }
    
    res.json({ ok: true, pageId: pid, dismissed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 元素截屏（只截特定区域）
app.post('/element-screenshot', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const el = await entry.page.$(req.body.selector);
    if (!el) return res.status(404).json({ ok: false, error: '元素未找到' });
    const filename = `el_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS, filename);
    await el.screenshot({ path: filepath });
    res.json({ ok: true, pageId: pid, file: filename, url: `/screenshots/${filename}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PDF 导出
app.post('/pdf', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const filename = `page_${Date.now()}.pdf`;
    const filepath = path.join(DOWNLOADS, filename);
    await entry.page.pdf({ path: filepath, format: req.body?.format || 'A4' });
    res.json({ ok: true, pageId: pid, file: filename, url: `/downloads/${filename}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 网络请求拦截（增强：+响应体捕获）──
const capturedRequests = [];
let networkCapture = false;
let networkCaptureBody = false;
let networkBodyFilter = '';
let requestIdCounter = 0;

// 存储 CDP session 用于获取响应体
const cdpSessions = new Map(); // pageId -> CDPSession

app.post('/network/start', async (req, res) => {
  networkCapture = true;
  networkCaptureBody = req.body?.captureBody || false;
  networkBodyFilter = req.body?.bodyFilter || '';
  capturedRequests.length = 0;
  requestIdCounter = 0;
  res.json({ ok: true, capturing: true, captureBody: networkCaptureBody });
});

app.post('/network/stop', async (req, res) => {
  networkCapture = false;
  networkCaptureBody = false;
  
  // 等待一下让 pending 的响应体回来
  await new Promise(r => setTimeout(r, 500));
  
  const filter = req.body?.filter || '';
  let results = [...capturedRequests];
  if (filter) {
    const lower = filter.toLowerCase();
    results = results.filter(r => r.url.toLowerCase().includes(lower));
  }
  // 简化输出，去掉过大的响应体
  const simplified = results.map(r => ({
    ...r,
    responseBody: r.responseBody ? r.responseBody.slice(0, 10000) : null,
  }));
  res.json({ ok: true, total: capturedRequests.length, filtered: simplified.length, requests: simplified });
});

app.get('/network', async (req, res) => {
  const filter = req.query?.filter || '';
  let results = [...capturedRequests];
  if (filter) {
    const lower = filter.toLowerCase();
    results = results.filter(r => r.url.toLowerCase().includes(lower));
  }
  res.json({ ok: true, capturing: networkCapture, total: capturedRequests.length, filtered: results.length, requests: results.map(r => ({ ...r, responseBody: r.responseBody ? r.responseBody.slice(0, 5000) : null })) });
});

// ── 重写 newPage：注入 CDP 网络监听 + 响应体捕获 + Console ──
const _origNewPage = newPage;
newPage = async function() {
  const id = await _origNewPage();
  const entry = pages.get(id);
  
  // Console 监听
  consoleLogs.set(id, []);
  entry.page.on('console', msg => {
    const logs = consoleLogs.get(id);
    if (logs && logs.length < 500) { // 限制最多 500 条
      logs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    }
  });
  
  // 页面错误监听
  entry.page.on('pageerror', err => {
    const logs = consoleLogs.get(id);
    if (logs && logs.length < 500) {
      logs.push({ type: 'pageerror', text: err.message, timestamp: Date.now() });
    }
  });
  
  // CDP 网络监听
  try {
    const cdp = await entry.page.target().createCDPSession();
    cdpSessions.set(id, cdp);
    await cdp.send('Network.enable');
    
    const pendingBodies = new Map();
    
    cdp.on('Network.requestWillBeSent', (params) => {
      if (!networkCapture) return;
      const rid = String(++requestIdCounter);
      const req = {
        id: rid,
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData || null,
        timestamp: Date.now(),
      };
      capturedRequests.push(req);
      pendingBodies.set(params.requestId, req);
    });
    
    cdp.on('Network.responseReceived', (params) => {
      if (!networkCapture) return;
      const req = pendingBodies.get(params.requestId);
      if (req) {
        req.status = params.response.status;
        req.statusText = params.response.statusText;
        req.responseHeaders = params.response.headers;
        req.mimeType = params.response.mimeType;
      }
    });
    
    cdp.on('Network.loadingFinished', async (params) => {
      if (!networkCapture || !networkCaptureBody) {
        pendingBodies.delete(params.requestId);
        return;
      }
      const req = pendingBodies.get(params.requestId);
      pendingBodies.delete(params.requestId);
      if (!req) return;
      if (networkBodyFilter && !req.url.toLowerCase().includes(networkBodyFilter.toLowerCase())) return;
      
      try {
        const { body, base64Encoded } = await cdp.send('Network.getResponseBody', {
          requestId: params.requestId
        });
        req.responseBody = base64Encoded ? `[base64 ${body.length}B]` : body.slice(0, 50000);
        req.responseTruncated = body.length > 50000;
      } catch (_) {
        req.responseBody = '[failed to capture]';
      }
    });
    
    cdp.on('Network.loadingFailed', (params) => {
      const req = pendingBodies.get(params.requestId);
      pendingBodies.delete(params.requestId);
      if (req) req.error = params.errorText;
    });
    
  } catch (_) {}
  
  return id;
};

// ── JS 脚本注入（去付费墙/修改页面）──
app.post('/inject', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { js, css, url } = req.body;
    const results = [];
    
    if (url) {
      // 从 URL 注入外部脚本
      await entry.page.addScriptTag({ url });
      results.push(`script:${url}`);
    }
    if (js) {
      await entry.page.evaluate(js);
      results.push(`js:${js.length}chars`);
    }
    if (css) {
      await entry.page.addStyleTag({ content: css });
      results.push(`css:${css.length}chars`);
    }
    res.json({ ok: true, pageId: pid, injected: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 设备模拟（支持 auto 读取本机）──
app.post('/emulate', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { device, userAgent, viewport } = req.body;
    
    // 预设设备
    const presets = {
      iPhone13: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15', vp: { width: 390, height: 844 }, dpr: 3 },
      iPhoneSE: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15', vp: { width: 375, height: 667 }, dpr: 2 },
      Pixel6:  { ua: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36', vp: { width: 412, height: 915 }, dpr: 2.6 },
      iPad:    { ua: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15', vp: { width: 1024, height: 1366 }, dpr: 2 },
      desktop: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0', vp: { width: 1920, height: 1080 }, dpr: 1 },
    };
    
    let ua, vp, dp;
    let deviceName = device || 'custom';
    
    if (device === 'auto') {
      // 读取本机真实信息
      const real = detectDevice();
      if (real) {
        ua = real.userAgent;
        vp = real.width && real.height ? { width: real.width, height: real.height } : { width: 412, height: 915 };
        dp = real.density || 2;
        deviceName = `auto(${real.model || 'unknown'})`;
      } else {
        ua = presets.Pixel6.ua;
        vp = presets.Pixel6.vp;
        dp = presets.Pixel6.dpr;
        deviceName = 'auto(fallback-Pixel6)';
      }
    } else if (presets[device]) {
      ua = presets[device].ua;
      vp = presets[device].vp;
      dp = presets[device].dpr;
    }
    
    if (userAgent) ua = userAgent;
    if (viewport) vp = viewport;
    
    if (ua) await entry.page.setUserAgent(ua);
    await entry.page.setViewport({ ...vp, deviceScaleFactor: dp || 1 });
    
    // 覆盖 navigator 指纹
    await entry.page.evaluateOnNewDocument((info) => {
      Object.defineProperty(navigator, 'platform', { get: () => info.platform || 'Linux armv8l' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => info.cores || 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => info.memory || 8 });
    }, { platform: 'Linux armv8l', cores: 8, memory: 8 });
    
    res.json({ ok: true, pageId: pid, device: deviceName, userAgent: ua, viewport: vp, devicePixelRatio: dp });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 基础导航 ──
app.post('/reload', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    await entry.page.reload({ waitUntil: req.body?.waitUntil || 'networkidle2' });
    res.json({ ok: true, pageId: pid, url: entry.page.url() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/back', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    await entry.page.goBack({ waitUntil: req.body?.waitUntil || 'networkidle2' });
    res.json({ ok: true, pageId: pid, url: entry.page.url() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/forward', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    await entry.page.goForward({ waitUntil: req.body?.waitUntil || 'networkidle2' });
    res.json({ ok: true, pageId: pid, url: entry.page.url() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 截屏 base64（不存文件，直接返回）──
app.post('/screenshot-base64', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const data = await entry.page.screenshot({ 
      encoding: 'base64',
      fullPage: req.body?.fullPage ?? false,
      type: req.body?.type || 'png',
    });
    res.json({ ok: true, pageId: pid, base64: data, type: req.body?.type || 'png' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Console 日志捕获 ──
const consoleLogs = new Map(); // pageId -> [{type, text, timestamp}]

app.post('/console/start', async (req, res) => {
  try {
    await ensureBrowser();
    const pid = req.body?.pageId || await getDefaultPage();
    if (!consoleLogs.has(pid)) consoleLogs.set(pid, []);
    res.json({ ok: true, pageId: pid, capturing: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/console', async (req, res) => {
  const pid = req.body?.pageId || [...consoleLogs.keys()][0];
  const logs = consoleLogs.get(pid) || [];
  const type = req.body?.type; // 'error' | 'warn' | 'log'
  const filtered = type ? logs.filter(l => l.type === type) : logs;
  res.json({ ok: true, pageId: pid, total: logs.length, filtered: filtered.length, logs: filtered });
});

app.post('/console/clear', async (req, res) => {
  const pid = req.body?.pageId || [...consoleLogs.keys()][0];
  if (pid) consoleLogs.set(pid, []);
  res.json({ ok: true });
});

// ── 页面性能计时 ──
app.post('/timing', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const timing = await entry.page.evaluate(() => {
      const t = performance.timing;
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        // 传统 timing
        dns: t.domainLookupEnd - t.domainLookupStart,
        tcp: t.connectEnd - t.connectStart,
        ttfb: t.responseStart - t.requestStart,
        domReady: t.domContentLoadedEventEnd - t.navigationStart,
        loadComplete: t.loadEventEnd - t.navigationStart,
        // 资源统计
        resources: performance.getEntriesByType('resource').length,
        // 新 API
        ...(nav ? {
          dnsNew: nav.domainLookupEnd - nav.domainLookupStart,
          ttfbNew: nav.responseStart - nav.requestStart,
          domInteractive: nav.domInteractive,
          domComplete: nav.domComplete,
        } : {}),
        memory: performance.memory ? {
          usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
          totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
        } : null,
      };
    });
    res.json({ ok: true, pageId: pid, timing });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 自动滚到底（无限加载页面）──
app.post('/scroll-bottom', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    const maxScrolls = req.body?.maxScrolls || 20;
    const waitMs = req.body?.waitMs || 1500;
    const minNewHeight = req.body?.minNewHeight || 100; // 每次至少新增多少像素才继续
    
    let lastHeight = 0;
    let scrolls = 0;
    
    for (let i = 0; i < maxScrolls; i++) {
      const newHeight = await entry.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return document.body.scrollHeight;
      });
      
      scrolls++;
      
      if (newHeight - lastHeight < minNewHeight) break; // 没有新内容了
      lastHeight = newHeight;
      await new Promise(r => setTimeout(r, waitMs));
    }
    
    res.json({ ok: true, pageId: pid, scrolls, finalHeight: lastHeight });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取所有图片 URL ──
app.post('/images', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const images = await entry.page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src || img.dataset?.src || '',
        alt: img.alt?.slice(0, 100) || '',
        width: img.naturalWidth,
        height: img.naturalHeight,
      })).filter(i => i.src && !i.src.startsWith('data:'));
    });
    res.json({ ok: true, pageId: pid, count: images.length, images });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Web Storage 操作 ──
app.post('/storage/get', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { type, key } = req.body; // type: 'local'|'session', key: 可选，不传取全部
    const storage = type === 'session' ? 'sessionStorage' : 'localStorage';
    const result = await entry.page.evaluate((s, k) => {
      const store = window[s];
      if (k) return { [k]: store.getItem(k) };
      const all = {};
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        all[key] = store.getItem(key);
      }
      return all;
    }, storage, key || null);
    res.json({ ok: true, pageId: pid, type: type || 'local', data: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/storage/set', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { type, key, value } = req.body;
    const storage = type === 'session' ? 'sessionStorage' : 'localStorage';
    await entry.page.evaluate((s, k, v) => window[s].setItem(k, v), storage, key, value);
    res.json({ ok: true, pageId: pid, key, set: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/storage/clear', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { type } = req.body;
    const storage = type === 'session' ? 'sessionStorage' : 'localStorage';
    await entry.page.evaluate(s => window[s].clear(), storage);
    res.json({ ok: true, pageId: pid, cleared: type || 'local' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 地理位置模拟 ──
app.post('/geolocation', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { lat, lng, accuracy } = req.body;
    const coords = [lat || 39.9, lng || 116.4, accuracy || 10];
    
    // 注入 geolocation mock（新文档生效）
    await entry.page.evaluateOnNewDocument((c) => {
      const [la, lo, acc] = c;
      navigator.geolocation.getCurrentPosition = (success) =>
        success({ coords: { latitude: la, longitude: lo, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
      navigator.geolocation.watchPosition = (success) => {
        success({ coords: { latitude: la, longitude: lo, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
        return 1;
      };
    }, coords);
    
    // 对当前页面也注入
    await entry.page.evaluate((c) => {
      const [la, lo, acc] = c;
      navigator.geolocation.getCurrentPosition = (success) =>
        success({ coords: { latitude: la, longitude: lo, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
      navigator.geolocation.watchPosition = (success) => {
        success({ coords: { latitude: la, longitude: lo, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
        return 1;
      };
    }, coords);
    
    // 对非opaque origin才授权权限（about:blank等会报错）
    try {
      const ctx = await entry.page.target().browserContext();
      await ctx.overridePermissions(entry.page.url(), ['geolocation']);
    } catch (_) {}
    
    res.json({ ok: true, pageId: pid, geolocation: { lat: coords[0], lng: coords[1] } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Stealth 反检测套件 ──
app.post('/stealth', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    const fixes = [];
    
    // 隐藏 webdriver 标记
    await entry.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      
      // 覆盖 chrome 对象
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
      
      // 修复 permissions
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    });
    fixes.push('webdriver', 'plugins', 'languages', 'chrome', 'permissions');
    
    // 应用现有页面（reload 后生效）
    await entry.page.evaluate(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    res.json({ ok: true, pageId: pid, stealth: true, fixes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DOM 变化监听 ──
const domWatchers = new Map(); // pageId -> { observer, changes: [] }

app.post('/watch', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, timeout } = req.body;
    
    const changes = [];
    domWatchers.set(pid, { changes });
    
    await entry.page.evaluate((sel) => {
      const target = sel ? document.querySelector(sel) : document.body;
      if (!target) return;
      const observer = new MutationObserver((mutations) => {
        window.__domChanges = window.__domChanges || [];
        for (const m of mutations) {
          window.__domChanges.push({
            type: m.type,
            addedNodes: m.addedNodes.length,
            removedNodes: m.removedNodes.length,
            attributeName: m.attributeName,
            timestamp: Date.now(),
          });
        }
      });
      observer.observe(target, { childList: true, subtree: true, attributes: req.body?.attributes !== false });
      window.__domObserver = observer;
    }, selector || null);
    
    const waitMs = timeout || 5000;
    await new Promise(r => setTimeout(r, waitMs));
    
    // 收集结果
    const result = await entry.page.evaluate(() => {
      const changes = window.__domChanges || [];
      window.__domChanges = [];
      return changes;
    });
    
    res.json({ ok: true, pageId: pid, waited: waitMs, changes: result, count: result.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/watch/poll', async (req, res) => {
  try {
    const pid = req.body?.pageId || [...domWatchers.keys()][0];
    const result = await pages.get(pid)?.page.evaluate(() => {
      const changes = window.__domChanges || [];
      window.__domChanges = [];
      return changes;
    }) || [];
    res.json({ ok: true, pageId: pid, changes: result, count: result.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 自动翻页提取 ──
app.post('/paginate', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    const { nextSelector, contentSelector, maxPages, waitMs } = req.body;
    const max = maxPages || 10;
    const wait = waitMs || 2000;
    const pages_data = [];
    
    for (let i = 0; i < max; i++) {
      // 提取当前页内容
      if (contentSelector) {
        const items = await entry.page.evaluate((sel) => {
          return Array.from(document.querySelectorAll(sel)).map(el => ({
            text: el.innerText?.slice(0, 500),
            html: el.innerHTML?.slice(0, 1000),
          }));
        }, contentSelector);
        pages_data.push({ page: i + 1, url: entry.page.url(), items });
      } else {
        pages_data.push({ page: i + 1, url: entry.page.url() });
      }
      
      // 点击下一页
      if (nextSelector) {
        const nextBtn = await entry.page.$(nextSelector);
        if (!nextBtn) break;
        const isDisabled = await entry.page.evaluate(el => el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true', nextBtn);
        if (isDisabled) break;
        
        await nextBtn.click();
        await new Promise(r => setTimeout(r, wait));
      } else {
        break;
      }
    }
    
    res.json({ ok: true, pageId: pid, totalPages: pages_data.length, pages: pages_data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 请求拦截修改（真正的修改响应）──
const interceptions = new Map(); // pageId -> { enabled, rules: [] }

app.post('/intercept/set', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { rules } = req.body; // [{urlPattern: '/api/test', action: 'block'|'modify', modify: fn}]
    
    await entry.page.setRequestInterception(true);
    
    // 移除旧监听器，设置新的
    entry.page.removeAllListeners('request');
    entry.page.on('request', async (request) => {
      const url = request.url();
      for (const rule of (rules || [])) {
        if (url.includes(rule.urlPattern)) {
          if (rule.action === 'block') {
            await request.abort();
            return;
          }
          if (rule.action === 'abort') {
            await request.abort();
            return;
          }
        }
      }
      await request.continue();
    });
    
    interceptions.set(pid, { enabled: true, rules: rules || [] });
    res.json({ ok: true, pageId: pid, rules: rules?.length || 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/intercept/clear', async (req, res) => {
  try {
    const pid = req.body?.pageId || [...interceptions.keys()][0];
    if (!pid || !pages.has(pid)) return res.status(404).json({ ok: false, error: '页面不存在' });
    const entry = pages.get(pid);
    await entry.page.setRequestInterception(false);
    entry.page.removeAllListeners('request');
    interceptions.delete(pid);
    res.json({ ok: true, pageId: pid, cleared: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── iframe 操作 ──
app.post('/iframe/list', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const frames = entry.page.frames();
    const list = await Promise.all(frames.map(async (f, i) => ({
      index: i,
      url: f.url(),
      name: f.name() || '',
      isMain: f === entry.page.mainFrame(),
    })));
    res.json({ ok: true, pageId: pid, count: list.length, frames: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/iframe/eval', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { frameIndex, code } = req.body;
    const frames = entry.page.frames();
    const frame = frames[frameIndex || 0];
    if (!frame) return res.status(404).json({ ok: false, error: 'iframe 不存在' });
    const result = await frame.evaluate(code);
    res.json({ ok: true, pageId: pid, frameIndex: frameIndex || 0, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/iframe/content', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { frameIndex } = req.body;
    const frames = entry.page.frames();
    const frame = frames[frameIndex || 0];
    if (!frame) return res.status(404).json({ ok: false, error: 'iframe 不存在' });
    const text = await frame.evaluate(() => document.body?.innerText || '');
    const sliced = text.slice(0, req.body?.maxChars || 10000);
    res.json({ ok: true, pageId: pid, frameIndex: frameIndex || 0, text: sliced, totalChars: text.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 拖拽模拟（滑块验证码专用）──
app.post('/drag', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, from, to, steps } = req.body;
    
    if (selector) {
      // 拖拽元素：selector 是滑块，to 是偏移量 {x, y}
      const el = await entry.page.$(selector);
      if (!el) return res.status(404).json({ ok: false, error: '元素未找到' });
      const box = await el.boundingBox();
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      const endX = startX + (to?.x || 300);
      const endY = startY + (to?.y || 0);
      const n = steps || 30;
      
      await entry.page.mouse.move(startX, startY);
      await entry.page.mouse.down();
      for (let i = 1; i <= n; i++) {
        await entry.page.mouse.move(
          startX + (endX - startX) * (i / n) + (Math.random() - 0.5) * 3,
          startY + (endY - startY) * (i / n) + (Math.random() - 0.5) * 2
        );
        await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
      }
      await entry.page.mouse.up();
    } else if (from && to) {
      // 坐标拖拽
      const n = steps || 30;
      await entry.page.mouse.move(from.x, from.y);
      await entry.page.mouse.down();
      for (let i = 1; i <= n; i++) {
        await entry.page.mouse.move(
          from.x + (to.x - from.x) * (i / n),
          from.y + (to.y - from.y) * (i / n)
        );
        await new Promise(r => setTimeout(r, 10));
      }
      await entry.page.mouse.up();
    }
    
    res.json({ ok: true, pageId: pid, dragged: selector || `${JSON.stringify(from)} → ${JSON.stringify(to)}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── WebSocket 消息捕获 ──
const wsMessages = new Map(); // pageId -> [{data, direction, timestamp}]

app.post('/ws/start', async (req, res) => {
  try {
    await ensureBrowser();
    const pid = req.body?.pageId || await getDefaultPage();
    wsMessages.set(pid, []);
    const entry = pages.get(pid);
    
    // 注入 WebSocket 代理
    await entry.page.evaluateOnNewDocument(() => {
      const OrigWebSocket = window.WebSocket;
      window.WebSocket = function(...args) {
        const ws = new OrigWebSocket(...args);
        ws.addEventListener('message', (e) => {
          window.__wsMessages = window.__wsMessages || [];
          window.__wsMessages.push({ data: String(e.data).slice(0, 5000), direction: 'recv', timestamp: Date.now() });
        });
        const origSend = ws.send;
        ws.send = function(data) {
          window.__wsMessages = window.__wsMessages || [];
          window.__wsMessages.push({ data: String(data).slice(0, 5000), direction: 'send', timestamp: Date.now() });
          return origSend.call(this, data);
        };
        return ws;
      };
      window.WebSocket.prototype = OrigWebSocket.prototype;
    });
    
    // 也捕获已存在的 WS（如果页面已加载则需要刷新）
    await entry.page.evaluate(() => { window.__wsMessages = []; });
    
    res.json({ ok: true, pageId: pid, capturing: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/ws/messages', async (req, res) => {
  const pid = req.body?.pageId || [...wsMessages.keys()][0];
  const entry = pid ? pages.get(pid) : null;
  let msgs = [];
  try {
    if (entry) {
      msgs = await entry.page.evaluate(() => {
        const m = window.__wsMessages || [];
        window.__wsMessages = [];
        return m;
      });
    }
  } catch (_) {}
  res.json({ ok: true, pageId: pid, count: msgs.length, messages: msgs });
});

// ── 自动填表 ──
app.post('/fill', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { fields, submit } = req.body; // fields: {selector: value, ...}
    const result = [];
    
    for (const [selector, value] of Object.entries(fields || {})) {
      try {
        await entry.page.waitForSelector(selector, { timeout: 3000 });
        const tag = await entry.page.evaluate(s => document.querySelector(s)?.tagName?.toLowerCase(), selector);
        if (tag === 'select') {
          await entry.page.select(selector, value);
        } else if (tag === 'input') {
          const type = await entry.page.evaluate(s => document.querySelector(s)?.type, selector);
          if (type === 'checkbox' || type === 'radio') {
            if (value) await entry.page.click(selector);
          } else if (type === 'file') {
            const input = await entry.page.$(selector);
            await input.uploadFile(value);
          } else {
            await entry.page.click(selector, { clickCount: 3 });
            await entry.page.type(selector, String(value));
          }
        } else {
          await entry.page.click(selector, { clickCount: 3 });
          await entry.page.type(selector, String(value));
        }
        result.push({ selector, ok: true });
      } catch (e) {
        result.push({ selector, ok: false, error: e.message });
      }
    }
    
    let submitted = false;
    if (submit) {
      try {
        await entry.page.$eval(submit, el => el.form ? el.form.submit() : el.click());
        submitted = true;
        await new Promise(r => setTimeout(r, 2000));
      } catch (_) {}
    }
    
    res.json({ ok: true, pageId: pid, fields: result, submitted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 批量操作 ──
const BATCH_HOST = `http://127.0.0.1:${PORT}`;
app.post('/batch', async (req, res) => {
  try {
    const { operations } = req.body; // [{method, endpoint, body}, ...]
    const results = [];
    
    for (const op of (operations || [])) {
      try {
        const fetchUrl = `${BATCH_HOST}/${op.endpoint.replace(/^\//, '')}`;
        const opts = {
          method: op.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
        };
        if (op.body && opts.method !== 'GET') {
          opts.body = JSON.stringify(op.body);
        }
        const resp = await fetch(fetchUrl, opts);
        const data = await resp.json();
        results.push({ endpoint: op.endpoint, ok: true, data });
      } catch (e) {
        results.push({ endpoint: op.endpoint, ok: false, error: e.message });
      }
    }
    
    res.json({ ok: true, total: operations?.length || 0, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── CSS 选择器测试 ──
app.post('/test-selector', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector } = req.body;
    const result = await entry.page.evaluate((sel) => {
      const els = document.querySelectorAll(sel);
      return {
        count: els.length,
        tagNames: Array.from(els).slice(0, 10).map(e => e.tagName.toLowerCase()),
        texts: Array.from(els).slice(0, 10).map(e => e.innerText?.slice(0, 100)),
        ids: Array.from(els).slice(0, 10).map(e => e.id || '').filter(Boolean),
        classes: Array.from(els).slice(0, 10).map(e => e.className?.slice(0, 100) || ''),
      };
    }, selector);
    res.json({ ok: true, pageId: pid, selector, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 自定义请求头 ──
app.post('/headers', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    await entry.page.setExtraHTTPHeaders(req.body.headers || {});
    res.json({ ok: true, pageId: pid, headers: req.body.headers });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 剪贴板操作 ──
app.post('/clipboard/read', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const text = await entry.page.evaluate(() => navigator.clipboard?.readText().catch(() => ''));
    res.json({ ok: true, pageId: pid, text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/clipboard/write', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    // 需要焦点才能写剪贴板
    await entry.page.bringToFront();
    await entry.page.evaluate((t) => {
      // headless 模式下用 execCommand 作为回退
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }, req.body.text || '');
    res.json({ ok: true, pageId: pid, written: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 页面结构分析 ──
app.post('/structure', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const structure = await entry.page.evaluate(() => {
      const analyze = (el, depth = 0) => {
        if (depth > 5) return null;
        const tag = el.tagName?.toLowerCase();
        if (!tag) return null;
        const children = [];
        for (const child of el.children) {
          const c = analyze(child, depth + 1);
          if (c) children.push(c);
        }
        return {
          tag,
          id: el.id || undefined,
          class: el.className?.slice(0, 100) || undefined,
          text: el.children.length === 0 ? el.innerText?.slice(0, 80) : undefined,
          count: tag === 'a' || tag === 'li' || tag === 'tr' ? 1 : undefined,
          children: children.length > 0 ? children.slice(0, 20) : undefined,
        };
      };
      return analyze(document.body);
    });
    res.json({ ok: true, pageId: pid, structure });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 数据导出 ──
app.post('/export', async (req, res) => {
  try {
    const { data, format, filename } = req.body;
    const name = filename || `export_${Date.now()}`;
    let content, mime, ext;
    
    if (format === 'csv' && Array.isArray(data)) {
      const keys = Object.keys(data[0] || {});
      content = keys.join(',') + '\n' + data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(',')).join('\n');
      mime = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(data, null, 2);
      mime = 'application/json';
      ext = 'json';
    }
    
    const filepath = path.join(DOWNLOADS, `${name}.${ext}`);
    fs.writeFileSync(filepath, content);
    res.json({ ok: true, file: `${name}.${ext}`, url: `/downloads/${name}.${ext}`, size: content.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 触摸事件（移动端页面专用）──
app.post('/tap', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { selector, x, y } = req.body;
    if (selector) {
      await entry.page.tap(selector);
    } else if (x !== undefined && y !== undefined) {
      await entry.page.touchscreen.tap(x, y);
    }
    res.json({ ok: true, pageId: pid, tapped: selector || `${x},${y}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/swipe', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { from, to, steps } = req.body; // {from:{x,y}, to:{x,y}}
    const n = steps || 20;
    await entry.page.touchscreen.touchStart(from.x, from.y);
    for (let i = 1; i <= n; i++) {
      await entry.page.touchscreen.touchMove(
        from.x + (to.x - from.x) * (i / n),
        from.y + (to.y - from.y) * (i / n)
      );
      await new Promise(r => setTimeout(r, 15));
    }
    await entry.page.touchscreen.touchEnd();
    res.json({ ok: true, pageId: pid, swiped: `${from.x},${from.y}→${to.x},${to.y}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 资源拦截加速 ──
app.post('/block-resources', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    const { types } = req.body; // ['image','stylesheet','font','media']
    const block = types || ['image', 'font', 'media'];
    
    await entry.page.setRequestInterception(true);
    entry.page.removeAllListeners('request');
    entry.page.on('request', (request) => {
      if (block.includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    res.json({ ok: true, pageId: pid, blocked: block });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/block-resources/clear', async (req, res) => {
  try {
    const pid = req.body?.pageId || [...pages.keys()][0];
    if (!pid || !pages.has(pid)) return res.status(404).json({ ok: false, error: '页面不存在' });
    const entry = pages.get(pid);
    await entry.page.setRequestInterception(false);
    entry.page.removeAllListeners('request');
    res.json({ ok: true, pageId: pid, cleared: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Cookie 导入（Netscape/JSON格式）──
app.post('/cookies/import', async (req, res) => {
  try {
    await ensureBrowser();
    const { cookies, format, domain } = req.body;
    let list = [];
    
    if (format === 'netscape' && typeof cookies === 'string') {
      // Netscape cookie 格式: domain	flag	path	secure	expires	name	value
      for (const line of cookies.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length >= 7) {
          list.push({
            domain: parts[0].replace(/^\./, ''),
            path: parts[2],
            secure: parts[3] === 'TRUE',
            expires: parseInt(parts[4]) || undefined,
            name: parts[5],
            value: parts[6],
          });
        }
      }
    } else if (Array.isArray(cookies)) {
      list = cookies;
    }
    
    let set = 0;
    for (const c of list) {
      try {
        await browser.setCookie({
          name: c.name,
          value: c.value,
          domain: c.domain || domain,
          path: c.path || '/',
          secure: c.secure || false,
          httpOnly: c.httpOnly || false,
          expires: c.expires,
        });
        set++;
      } catch (_) {}
    }
    
    res.json({ ok: true, total: list.length, set });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 页面 Diff（两个 URL 或时间点的文本差异）──
app.post('/diff', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    const { url, waitMs } = req.body;
    const before = await entry.page.evaluate(() => document.body.innerText.slice(0, 5000));
    
    // 打开新 URL 或等待
    if (url) {
      await entry.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    } else if (waitMs) {
      await new Promise(r => setTimeout(r, waitMs));
    }
    
    const after = await entry.page.evaluate(() => document.body.innerText.slice(0, 5000));
    
    // 简单差异统计
    const changed = before !== after;
    const added = after.length - before.length;
    
    res.json({
      ok: true, pageId: pid, changed,
      beforeLength: before.length, afterLength: after.length,
      addedChars: added > 0 ? added : 0,
      removedChars: added < 0 ? -added : 0,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Canvas 指纹噪声 ──
app.post('/canvas-noise', async (req, res) => {
  try {
    await ensureBrowser();
    const { pid, entry } = getPageEntry(req);
    if (!entry) return res.status(404).json({ ok: false, error: '页面不存在' });
    
    await entry.page.evaluateOnNewDocument(() => {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          // 加微量噪声
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] ^= (Math.random() < 0.001 ? 1 : 0);
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return origToDataURL.apply(this, args);
      };
    });
    
    res.json({ ok: true, pageId: pid, noise: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 状态 ──
app.get('/status', async (req, res) => {
  res.json({
    ok: true,
    running: true,
    browser: !!browser,
    pages: pages.size,
    proxy: PROXY || null,
    uptime: Math.round(process.uptime()),
  });
});

// ── 关闭浏览器（保留profile） ──
app.post('/close', async (req, res) => {
  if (browser) {
    await browser.close();
    browser = null;
    pages.clear();
  }
  res.json({ ok: true, closed: true });
});

// ── 启动 ──
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🔍 Browser Agent v6 已启动: http://127.0.0.1:${PORT}`);
  console.log(`   📄 页面: open/page/reload/back/forward/close  ⓘ iframe: /iframe/list /eval /content`);
  console.log(`   🖱️ 操作: screenshot/content/html/click/type/hover/drag/select/enter/submit/keypress/upload/fill/scroll/scroll-bottom`);
  console.log(`   🔗 提取: links/info/wait/pdf/images/timing/paginate/structure/test-selector`);
  console.log(`   💉 注入: inject  🎭 模拟: emulate(auto)  GET /device  🛡️ 反检测: /stealth`);
  console.log(`   🌐 网络: network/start /stop  🚫 拦截: intercept/set /clear  📡 WS: ws/start /messages`);
  console.log(`   💾 存储: storage/get/set/clear  📋 剪贴板: clipboard/read /write`);
  console.log(`   📍 定位: geolocation  🎛️ 监控: watch/poll  console/start /console /clear`);
  console.log(`   🍪 cookies/set  📥 downloads  📤 export  ⚡ batch  🎯 headers`);
  console.log(`   📊 状态: GET /status  📥 下载: GET /downloads`);
  console.log(`   💾 Profile: ${USER_DATA}`);
  if (PROXY) console.log(`   🌐 代理: ${PROXY}`);
});
