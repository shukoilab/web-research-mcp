# 🎭 MCP Web Research Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript: 5.7+](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Patchright: Undetected](https://img.shields.io/badge/Driver-Patchright-goldenrod.svg)](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
[![Shukoi: Enterprise](https://img.shields.io/badge/Framework-Shukoi-green.svg)](https://github.com/shukoilab/shukoi)

**Enterprise-Grade, Ultra-Fast, and Production-Ready Web Research Model Context Protocol (MCP) Server.**  
Engineered for AI coding agents and autonomous workflows requiring high-accuracy Google Search and high-density, token-efficient webpage content extraction with undetectable anti-bot evasion.

---

## 🌟 Key Architectural Features

- **🎭 Undetectable Anti-Bot Evasion (Patchright + Chrome):** Built on Patchright (patched driver eliminating `Runtime.enable`, `--enable-automation`, and console leaks). Enforces official Google Chrome (`channel: 'chrome'`) with zero-fallback for 100% genuine consumer browser fingerprints.
- **⚡ Pre-Warmed Persistent Pool (<100ms Tab Acquisition):** Browser context is pre-warmed at server boot with a persistent user profile (`launchPersistentContext`), retaining DNS, TLS session tickets, V8 bytecode, and consent cookies for 38–50% faster navigations.
- **🔄 Smart Progressive Auto-Scroll & DOM Convergence:** Handles complex e-commerce, SPA, and XHR-heavy sites (e.g. Tokopedia, Shopee, Reddit). Progressively scrolls, triggers `IntersectionObserver` lazy-loads, auto-clicks content expanders (*"Lihat Selengkapnya"* / *"Read more"*), and stops when DOM height converges.
- **📉 Token-Efficient & High-Density Markdown:** Strips token-wasting avatar images, promotional widgets, and redundant blank lines. Compiles clean GitHub Flavored Markdown via Unified AST (`linkedom` + `@mozilla/readability` + `rehype-remark` + `remark-gfm`).
- **🛡️ Zero-Trust SSRF Defense:** Rejects loopback (`127.0.0.0/8`, `::1`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local metadata (`169.254.169.254`, `metadata.google.internal`), and non-HTTP protocols.
- **🖥️ Cross-Platform Isolation:** Dedicated virtual framebuffer (`DISPLAY=:99`) on Linux; automatic background stealth headless mode on macOS and Windows to prevent desktop window focus-stealing.
- **🏥 Real Liveness & Readiness Probing:** Provides real subsystem health metrics over both MCP STDIO (`healthCheck`) and native HTTP REST (`GET /health` with HTTP 200/503 status codes for Kubernetes / Docker).

---

## 🖥️ Operating System Compatibility Matrix

| Operating System | Support Level | Windowing & Display | GPU / WebGL Backend | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Linux (Ubuntu 24.04 / Debian)** | **✅ TESTED & VERIFIED** | Xvfb Virtual Framebuffer (`:99`) | SwiftShader CPU (`ANGLE`) | Fully tested in production CI and local environments. Zero physical screen pop-ups. |
| **macOS (`darwin`)** | **⚠️ UNTESTED (Architecturally Supported)** | Quartz / WindowServer | Native Apple Metal | Headless defaults to `true` to prevent UI focus-stealing. Architectural code implemented. |
| **Windows (`win32`)** | **⚠️ UNTESTED (Architecturally Supported)** | Desktop Window Manager (DWM) | Native Direct3D11 | Headless defaults to `true`. Cross-platform signal handlers installed. Architectural code implemented. |

> **Notice:** Linux (Ubuntu 24.04 LTS) is the primary verified operating environment. macOS and Windows contain platform-adaptive code paths, but are currently classified as *untested / experimental*.

---

## 📋 Prerequisites & System Requirements

1. **Node.js:** v20.x or v22.x+ (tested on Node v24.16.0)
2. **Package Manager:** `pnpm` (v9+ or v12+)
3. **Google Chrome:** Official Google Chrome binary installed on host:
   ```bash
   npx patchright install chrome
   # Or install Google Chrome via standard apt/rpm package
   ```
4. **Xvfb (Linux only):** Virtual display running on `:99` (recommended systemd unit below).

### Example Linux Xvfb Systemd Service (`/etc/systemd/system/xvfb.service`)

```ini
[Unit]
Description=Single-Instance X Virtual Framebuffer (Display :99)
After=network.target systemd-tmpfiles-setup.service
Requires=systemd-tmpfiles-setup.service

[Service]
Type=simple
User=xvfb
Group=xvfb
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac +extension GLX +render -noreset
ExecStartPost=/bin/sh -c 'for i in $(seq 1 30); do /usr/bin/xdpyinfo -display :99 >/dev/null 2>&1 && exit 0; sleep 0.2; done; exit 1'
Restart=always
RestartSec=2
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
```

---

## ⚙️ 12-Factor Configuration Reference

All settings can be configured via environment variables. Universal defaults are applied automatically if unset:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `BROWSER_DISPLAY` | `string` | `":99"` (Linux) | X11 virtual display target for Linux automation. |
| `HEADLESS` | `boolean` | `false` (Linux) / `true` (macOS/Win) | Browser headless flag. Defaults to `false` on Linux (for Xvfb) and `true` on macOS/Windows. |
| `HTTP_PROXY` | `string` | `undefined` | Optional HTTP/HTTPS proxy URI (e.g. `http://user:pass@host:port`). |
| `BROWSER_USER_DATA_DIR` | `string` | `~/.cache/mcp-web-research/chrome-profile` | Persistent directory storing Chrome cache, cookies, and session state. |
| `BROWSER_TIMEOUT_MS` | `integer` | `30000` | Default navigation timeout in milliseconds. |
| `MAX_CONCURRENT_PAGES` | `integer` | `5` | Maximum simultaneous browser tabs allowed by semaphore. |
| `MAX_REQUESTS_BEFORE_RECYCLE` | `integer` | `1000` | Lifetime requests before background browser restart to prevent RAM fragmentation. |
| `MAX_CONTENT_LENGTH` | `integer` | `5242880` (5MB) | Upper bound memory guard against massive HTML payloads. |
| `NETWORK_IDLE_TIMEOUT_MS` | `integer` | `5000` | Maximum wait time in ms for initial network stabilization before scrolling. |
| `SCROLL_DELAY_MS` | `integer` | `500` | Debounce delay in ms after each scroll step (increase to 1000-2000 for slow networks). |
| `SCROLL_STEP_PX` | `integer` | `1000` | Distance in pixels per scroll increment. |
| `SCROLL_SETTLE_TIMEOUT_MS` | `integer` | `500` | Final quiet period in ms after scroll loop completes. |
| `MAX_SCROLL_STEPS` | `integer` | `6` | Default maximum scroll loop iterations before convergence termination. |
| `SEARCH_WAIT_TIMEOUT_MS` | `integer` | `10000` | Maximum wait time in ms for Google SERP cards to render. |
| `READABILITY_CHAR_THRESHOLD` | `integer` | `20` | Minimum character length for Mozilla Readability article scoring. |

---

## 🚀 Client Installation & Setup Guide

### 1. Claude Desktop
Add to your `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "web-research": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-web-research/dist/entries/mcp-stdio.js"],
      "env": {
        "BROWSER_DISPLAY": ":99",
        "SCROLL_DELAY_MS": "500",
        "MAX_SCROLL_STEPS": "6"
      }
    }
  }
}
```

### 2. Cursor IDE
Add to `~/.cursor/mcp.json` (or via **Cursor Settings > Features > MCP**):

```json
{
  "mcpServers": {
    "web-research": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-web-research/dist/entries/mcp-stdio.js"],
      "env": {
        "BROWSER_DISPLAY": ":99"
      }
    }
  }
}
```

### 3. OpenCode
Add to your `opencode.json` (or profile config):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "web-research": {
      "type": "local",
      "command": ["node", "/absolute/path/to/mcp-web-research/dist/entries/mcp-stdio.js"],
      "environment": {
        "BROWSER_DISPLAY": ":99"
      }
    }
  }
}
```

### 4. VS Code (Cline / Roo Code / Claude Dev)
Add to your MCP Settings configuration file:

```json
{
  "mcpServers": {
    "web-research": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-web-research/dist/entries/mcp-stdio.js"],
      "env": {
        "BROWSER_DISPLAY": ":99"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 5. Windsurf IDE
Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "web-research": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-web-research/dist/entries/mcp-stdio.js"],
      "env": {
        "BROWSER_DISPLAY": ":99"
      }
    }
  }
}
```

### 6. HTTP / Self-Hosted Deployment (Docker / Kubernetes)
Run as a standalone network service:

```bash
# Build the project
pnpm run build

# Start the Streamable HTTP server on port 3000
pnpm run start
```

- **MCP Endpoint:** `http://localhost:3000/mcp` (Streamable HTTP transport)
- **Kubernetes / Docker Healthcheck:** `GET http://localhost:3000/health` (Returns HTTP 200 / 503 with subsystem metrics)

---

## 🛠️ MCP Tools Catalog

### 1. `google_search` (`googleSearchAction`)
Executes organic web search on Google using stealth Chrome with automatic consent dialog bypass, breadcrumb canonicalization, and rich snippet extraction.

**Input Parameters:**
- `query` (*string, required, 1..500 chars*): Search keywords or phrases.
- `limit` (*integer, optional, 1..50, default: 10*): Maximum organic results.
- `language` (*string, optional, default: "en"*): Language code (e.g. `"en"`, `"id"`).
- `country` (*string, optional, default: "us"*): Geolocation region code (e.g. `"us"`, `"id"`).
- `safeSearch` (*boolean, optional, default: true*): SafeSearch adult filter.

**Example Tool Response:**
```json
{
  "query": "typescript documentation",
  "totalReturned": 2,
  "results": [
    {
      "title": "The starting point for learning TypeScript",
      "url": "https://www.typescriptlang.org/docs",
      "redirectUrl": "https://www.google.com/goto?url=...",
      "snippet": "TypeScript extends JavaScript by adding types to the language..."
    }
  ],
  "timestamp": "2026-11-20T00:00:00.000Z"
}
```

---

### 2. `web_extract` (`webExtractAction`)
Navigates to any target URL, executes intelligent progressive scrolling to trigger lazy XHR/SPA content (prices, reviews, specs), auto-clicks expanders (*"Lihat Selengkapnya"*), and serializes dense GitHub Flavored Markdown.

**Input Parameters:**
- `url` (*string, required, format: "uri", 1..2048 chars*): Target website URL (`http://` or `https://`).
- `smartScroll` (*boolean, optional, default: true*): Enable automated progressive scroll and XHR stabilization.
- `scrollDelayMs` (*integer, optional, 100..5000, default: 500*): Jeda debounce scroll per langkah. Naikkan ke 1000–2000ms jika koneksi internet lambat.
- `maxScrolls` (*integer, optional, 0..20, default: 6*): Batas iterasi scroll. Naikkan untuk halaman katalog atau ulasan yang sangat panjang.
- `timeoutMs` (*integer, optional, 1000..60000, default: 30000*): Maximum navigation deadline.

**Example Tool Response:**
```json
{
  "url": "https://www.tokopedia.com/kyo-official/ssd-kyo-kaizen-m-2-nvme-512gb-pcie-gen3-x4-2280-ssd-nvme-gen-3",
  "title": "SSD KYO KAIZEN M.2 NVMe 512GB PCIe Gen3 x4 2280 SSD NVMe Gen 3",
  "byline": "KYO Indonesia",
  "excerpt": "KAIZEN diambil dari bahasa Jepang untuk perbaikan berkelanjutan...",
  "markdown": "## SSD KYO KAIZEN M.2 NVMe 512GB...\n\n**Harga:** Rp1.626.050\n**Stok:** 451\n\n### Spesifikasi Lengkap:\n- Tipe: M.2 NVMe PCIe 3 x4\n- Kapasitas: 512GB\n\n## ULASAN PEMBELI\n- **Andri:** Barang diterima dengan baik dan cepat...",
  "timestamp": "2026-11-20T00:00:00.000Z"
}
```

---

### 3. `healthCheck` (`healthAction`)
Inspects real-time subsystem readiness, browser pool connectivity, active concurrency, and memory consumption.

**Example Output:**
```json
{
  "status": "healthy",
  "timestamp": "2026-11-20T00:00:00.000Z",
  "uptimeSec": 1240,
  "browser": {
    "connected": true,
    "prewarmed": true,
    "activeTabs": 0,
    "maxCapacity": 5,
    "requestCount": 42,
    "userDataDir": "/home/shukoi/.cache/mcp-web-research/chrome-profile"
  },
  "display": ":99",
  "memory": {
    "heapUsedMb": 64.25,
    "rssMb": 182.10
  }
}
```

---

## 🧪 Testing & Verification

Run the full automated verification pipeline:

```bash
# Execute unit and live integration tests (56+ tests)
pnpm test

# Verify strict TypeScript type-safety (0 errors)
pnpm run typecheck

# Check formatting and static quality (Biome)
pnpm run lint

# Compile production build to ./dist
pnpm run build
```

---

## 🙏 Acknowledgements & Open-Source Credits

This project is built on top of an incredible open-source ecosystem. Sincere gratitude and credits go to the creators and maintainers of the following foundations:

- **[Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)** — Undetected browser automation driver eliminating CDP leaks, `--enable-automation`, and runtime flags for genuine consumer fingerprints.
- **[Shukoi Framework](https://github.com/shukoilab/shukoi)** (`@shukoi/core`, `@shukoi/mcp`, `@shukoi/selfhost`) — Modular TypeScript runtime framework powering MCP action dispatching and self-hosted HTTP server lifecycles.
- **[Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)** — Official TypeScript SDK implementing the MCP specification across STDIO and Streamable HTTP transports.
- **[Mozilla Readability](https://github.com/mozilla/readability)** — Standalone content extraction engine from Mozilla Firefox's Reader View for clean, token-efficient article parsing.
- **[LinkeDOM](https://github.com/WebReflection/linkedom)** — High-performance, lightweight server-side DOM implementation with near-zero memory footprint.
- **[Unified Ecosystem](https://unifiedjs.com/)** (`unified`, `rehype-parse`, `rehype-remark`, `remark-gfm`, `remark-stringify`) — Composable syntax tree (AST) pipeline transforming HTML into high-density GitHub Flavored Markdown.
- **[TypeBox](https://github.com/sinclairzx81/typebox)** — High-performance JSON Schema Type Builder with static type inference enforcing strict input/output contracts.
- **[Hono](https://hono.dev/)** — Ultrafast, lightweight web framework driving native HTTP REST and Kubernetes health check endpoints.
- **[jose](https://github.com/panva/jose)** — Universal Web Cryptography library for secure token validation and cryptographic operations.
- **[Biome](https://biomejs.dev/) & [Vitest](https://vitest.dev/)** — Modern development toolchains delivering blazing-fast linting, formatting, and automated testing.

---

## 📄 License

MIT © [Shukoi Lab](https://github.com/shukoilab)
