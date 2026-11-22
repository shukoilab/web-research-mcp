# 🎭 MCP Web Research Server

[![Version: 2.2.0](https://img.shields.io/badge/Version-2.2.0-blue.svg)](package.json)
[![Docker: Universal](https://img.shields.io/badge/Docker-Universal-blue.svg)](https://ghcr.io/shukoilab/web-research-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript: 5.7+](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Patchright: Undetected](https://img.shields.io/badge/Driver-Patchright-goldenrod.svg)](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
[![Shukoi: Enterprise](https://img.shields.io/badge/Framework-Shukoi-green.svg)](https://github.com/shukoilab/shukoi)

**Enterprise-Grade, Ultra-Fast, and Production-Ready Web Research Model Context Protocol (MCP) Server.**  
Engineered for AI coding agents and autonomous workflows requiring high-accuracy Google Search and high-density, token-efficient webpage content extraction with undetectable anti-bot evasion.

---

## 🌟 Key Architectural Features

- **🎭 100% Undetectable Headed Stealth on Display :99:** Built on Patchright (patched driver eliminating `Runtime.enable`, `--enable-automation`, and console leaks). Enforces official Google Chrome in genuine headed mode (`headless: false`) inside an isolated X11 virtual framebuffer (`:99`) adhering strictly to Patchright's official Zero-Injection Best Practice (zero custom args, zero custom user-agent, zero header tampering). Guarantees 100% authentic consumer browser window metrics and extensions state with zero desktop window pop-ups or focus-stealing on the host OS.
- **⚡ Pre-Warmed Persistent Pool (<100ms Tab Acquisition):** Browser context is pre-warmed at server boot with a persistent user profile (`launchPersistentContext`), retaining DNS, TLS session tickets, V8 bytecode, and consent cookies for 38–50% faster navigations.
- **🔄 Universal Regex-Free Semantic DOM Unfolding & Auto-Scroll:** Handles complex e-commerce, SPA, and XHR-heavy sites (e.g. Tokopedia, Shopee, Reddit). Progressively scrolls, triggers `IntersectionObserver` lazy-loads, unfolds collapsed sections using universal W3C WAI-ARIA standards (`aria-expanded="false"`, `data-state="closed"`, `aria-controls`) and native HTML5 `<details>` disclosures with zero language-locking, unclamps CSS line-clamping, and stops when DOM height converges.
- **📉 Token-Efficient & High-Density Markdown:** Strips token-wasting avatar images, promotional widgets, and redundant blank lines. Compiles clean GitHub Flavored Markdown via Unified AST (`linkedom` + `@mozilla/readability` + `rehype-remark` + `remark-gfm`).
- **🛡️ Zero-Trust SSRF Defense:** Rejects loopback (`127.0.0.0/8`, `::1`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local metadata (`169.254.169.254`, `metadata.google.internal`), and non-HTTP protocols.
- **🌍 Universal Cross-Platform Architecture:** Runs identically across macOS, Windows, and Linux via Docker with zero host dependencies and zero physical screen interference.
- **🏥 Real Liveness & Readiness Probing:** Provides real subsystem health metrics over both MCP STDIO (`healthCheck`) and native HTTP REST (`GET /health` with HTTP 200/503 status codes for Kubernetes / Docker).

---

## 🌍 Universal Cross-Platform Execution

Thanks to hermetic Docker containerization, `mcp-web-research` runs with **100% feature parity** across all operating systems without any host configuration:

| Host Platform | Support Level | Display & Stealth Engine | Window Behavior |
| :--- | :--- | :--- | :--- |
| **macOS (Apple Silicon & Intel)** | **✅ Universal** | Virtual Framebuffer (`:99`) + Zero-Injection Stealth | Zero Desktop Pop-ups (Rendered in container) |
| **Windows (10 / 11 / Server)** | **✅ Universal** | Virtual Framebuffer (`:99`) + Zero-Injection Stealth | Zero Desktop Pop-ups (Rendered in container) |
| **Linux (Ubuntu / Debian / RHEL)** | **✅ Universal** | Virtual Framebuffer (`:99`) + Zero-Injection Stealth | Zero Desktop Pop-ups (Rendered in container) |

> **Anti-Bot Invariant:** The browser strictly runs in genuine headed mode (`headless: false`) inside the virtual framebuffer `:99`. End users will never see desktop pop-up windows, yet anti-bot inspection systems detect 100% authentic consumer desktop Chrome behavior.

---

## ⚙️ 12-Factor Configuration Reference

All settings can be configured via environment variables. Universal defaults are applied automatically if unset:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `HOST` | `string` | `0.0.0.0` | Network interface address to bind HTTP service on VPS/host. |
| `PORT` | `integer` | `3000` | HTTP port for streamable MCP and health check endpoints. |
| `ALLOWED_HOSTS` | `string` | `*` | Comma-separated list or wildcard (`*`) of allowed Host headers for DNS-rebinding protection. |
| `ALLOWED_ORIGINS` | `string` | `*` | Comma-separated list or wildcard (`*`) of allowed Origin headers for CORS security. |
| `MCP_API_KEY` / `API_KEY` | `string` | `undefined` | Optional secret token(s) for HTTP API protection (comma-separated for key rotation). If unset, auth is disabled. |
| `HTTP_PROXY` | `string` | `undefined` | Optional HTTP/HTTPS proxy URI (e.g. `http://user:pass@host:port`). |
| `BROWSER_USER_DATA_DIR` | `string` | `~/.cache/mcp-web-research/chrome-profile` | Persistent directory storing Chrome cache, cookies, and session state. |
| `BROWSER_TIMEOUT_MS` | `integer` | `30000` | Default navigation timeout in milliseconds. |
| `MAX_CONCURRENT_PAGES` | `integer` | `5` | Maximum simultaneous browser tabs allowed by semaphore. |
| `MAX_REQUESTS_BEFORE_RECYCLE` | `integer` | `1000` | Lifetime requests before background browser restart to prevent RAM fragmentation. |
| `MAX_CONTENT_LENGTH` | `integer` | `5242880` (5MB) | Upper bound memory guard against massive HTML payloads. |
| `NETWORK_IDLE_TIMEOUT_MS` | `integer` | `5000` | Maximum wait time in ms for initial network stabilization before scrolling. |
| `SCROLL_DELAY_MS` | `integer` | `500` | Debounce delay in ms after each scroll step and semantic unfolding pass (increase to 1000–2000 for slow networks). |
| `SCROLL_STEP_PX` | `integer` | `1000` | Distance in pixels per scroll increment. |
| `SCROLL_SETTLE_TIMEOUT_MS` | `integer` | `500` | Final quiet period in ms after scroll loop completes. |
| `MAX_SCROLL_STEPS` | `integer` | `6` | Maximum scroll loop iterations for lazy content hydration, semantic unfolding, and DOM convergence. |
| `SEARCH_WAIT_TIMEOUT_MS` | `integer` | `10000` | Maximum wait time in ms for Google SERP cards to render before parsing results. |
| `READABILITY_CHAR_THRESHOLD` | `integer` | `20` | Minimum character length for Mozilla Readability article scoring. |

---

## 🚀 Client Installation & Setup Guide

### Option 1: Docker Streamable HTTP Service (Recommended for Remote Agents, VPS & Teams)

#### 1. Quick Start (Default Settings)
Run as an isolated, persistent network service on any machine:

```bash
docker run -d -p 3000:3000 --shm-size=1gb --name web-research-mcp --restart unless-stopped ghcr.io/shukoilab/web-research-mcp:latest
```

> **Tip on Custom Host Ports:** If port 3000 is occupied on your host, forward your desired host port to container port 3000 (e.g. `-p 3031:3000`), or override the internal port via environment variable (e.g. `-p 3031:3031 -e PORT=3031`).

#### 2. Production VPS Deployment with Full Configuration Knobs
Customize any operational parameter directly at runtime via environment variables (`-e`). You do **not** need to modify or rebuild the `Dockerfile`:

```bash
docker run -d \
  --name web-research-mcp \
  --restart unless-stopped \
  --shm-size=1gb \
  -p 3000:3000 \
  -e HOST="0.0.0.0" \
  -e PORT="3000" \
  -e ALLOWED_HOSTS="*" \
  -e ALLOWED_ORIGINS="*" \
  -e MCP_API_KEY="sk-your-secret-api-key" \
  -e HTTP_PROXY="" \
  -e BROWSER_TIMEOUT_MS="30000" \
  -e MAX_CONCURRENT_PAGES="5" \
  -e MAX_REQUESTS_BEFORE_RECYCLE="1000" \
  -e MAX_CONTENT_LENGTH="5242880" \
  -e NETWORK_IDLE_TIMEOUT_MS="5000" \
  -e SCROLL_DELAY_MS="500" \
  -e SCROLL_STEP_PX="1000" \
  -e SCROLL_SETTLE_TIMEOUT_MS="500" \
  -e MAX_SCROLL_STEPS="6" \
  -e SEARCH_WAIT_TIMEOUT_MS="10000" \
  -e READABILITY_CHAR_THRESHOLD="20" \
  ghcr.io/shukoilab/web-research-mcp:latest
```

#### 3. Using an Environment File (`--env-file`)
Keep sensitive keys and parameters organized in a local `.env` file:

```bash
docker run -d \
  -p 3000:3000 \
  --shm-size=1gb \
  --env-file .env \
  --name web-research-mcp \
  --restart unless-stopped \
  ghcr.io/shukoilab/web-research-mcp:latest
```

#### 4. Docker Compose Deployment (`docker-compose.yml`)
For automated restarts, VPS orchestration, and persistent stacks:

```yaml
version: '3.8'

services:
  web-research-mcp:
    image: ghcr.io/shukoilab/web-research-mcp:latest
    container_name: web-research-mcp
    restart: unless-stopped
    shm_size: 1gb
    ports:
      - "3000:3000"
    environment:
      # Network & Security
      - HOST=0.0.0.0
      - PORT=3000
      - ALLOWED_HOSTS=*
      - ALLOWED_ORIGINS=*
      - MCP_API_KEY=sk-your-secret-api-key
      # Browser Performance & Tuning
      - BROWSER_TIMEOUT_MS=30000
      - MAX_CONCURRENT_PAGES=5
      - MAX_REQUESTS_BEFORE_RECYCLE=1000
      - MAX_CONTENT_LENGTH=5242880
      - NETWORK_IDLE_TIMEOUT_MS=5000
      - SCROLL_DELAY_MS=500
      - SCROLL_STEP_PX=1000
      - SCROLL_SETTLE_TIMEOUT_MS=500
      - MAX_SCROLL_STEPS=6
      - SEARCH_WAIT_TIMEOUT_MS=10000
      - READABILITY_CHAR_THRESHOLD=20
```

- **MCP Endpoint:** `http://localhost:3000/mcp` (Streamable HTTP transport)
- **Healthcheck Probe:** `GET http://localhost:3000/health` (HTTP 200/503)

#### 5. Connecting AI Clients with Optional Authentication

**In Cursor / OpenCode (`opencode.json` / remote MCP settings):**
```json
{
  "type": "remote",
  "url": "http://your-vps-ip:3000/mcp",
  "headers": {
    "Authorization": "Bearer sk-your-secret-api-key"
  }
}
```

**Testing via cURL:**
```bash
# Public liveness healthcheck probe (always unauthenticated)
curl -s http://localhost:3000/health

# MCP request with Bearer Token (or X-API-Key header)
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-secret-api-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-client","version":"1.0.0"}}}'
```

---

### Option 2: Docker Local STDIO Container (Recommended for Claude Desktop)

Runs inside the sealed container without needing Node.js or Chrome installed on the host machine:

#### Claude Desktop
Add to your `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "web-research": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "--shm-size=1gb",
        "ghcr.io/shukoilab/web-research-mcp:latest",
        "node",
        "dist/entries/mcp-stdio.js"
      ]
    }
  }
}
```

#### Cursor IDE
Add to `~/.cursor/mcp.json` (or via **Cursor Settings > Features > MCP**):

```json
{
  "mcpServers": {
    "web-research": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "--shm-size=1gb",
        "ghcr.io/shukoilab/web-research-mcp:latest",
        "node",
        "dist/entries/mcp-stdio.js"
      ]
    }
  }
}
```

#### OpenCode
Add to your `opencode.json` (or profile config):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "web-research": {
      "type": "local",
      "command": [
        "docker",
        "run",
        "-i",
        "--rm",
        "--init",
        "--shm-size=1gb",
        "ghcr.io/shukoilab/web-research-mcp:latest",
        "node",
        "dist/entries/mcp-stdio.js"
      ]
    }
  }
}
```

#### VS Code (Cline / Roo Code / Claude Dev)
```json
{
  "mcpServers": {
    "web-research": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "--shm-size=1gb",
        "ghcr.io/shukoilab/web-research-mcp:latest",
        "node",
        "dist/entries/mcp-stdio.js"
      ],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

---

### Option 3: Local Node.js Development & STDIO Execution

For local development or environments with Node.js 20+ installed:

```bash
# Build the project
pnpm install
pnpm run build

# Start the Streamable HTTP server on port 3000
pnpm run start
```

Or invoke STDIO locally:
```json
{
  "mcpServers": {
    "web-research": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-web-research/dist/entries/mcp-stdio.js"]
    }
  }
}
```

---

## 🛠️ MCP Tools Catalog

### 1. `googleSearch` (`googleSearchAction`)
Executes organic web search on Google using stealth Chrome with automatic consent dialog bypass, breadcrumb canonicalization, and rich snippet extraction. Acts as Step 1 (Discovery & Triage) in agent research workflows, returning candidate URLs and preview snippets.

**Input Parameters:**
- `query` (*string, required, 1..500 chars*): Search keywords or phrases. Supports Google Dorking operators for high-precision queries (e.g. `site:github.com "patchright" inurl:releases`, `filetype:pdf "machine learning"`, `intitle:"API docs"`).
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

### 2. `webExtract` (`webExtractAction`)
Navigates to any target URL, executes intelligent progressive scrolling to trigger lazy XHR/SPA content (prices, reviews, specs), unfolds collapsed content using universal W3C ARIA standards and native HTML5 disclosures, unclamps visual CSS line-clamping, and serializes clean GitHub Flavored Markdown. Acts as Step 2 (Deep Content Reader) following `googleSearch` or as Step 1 for direct URLs.

**Input Parameters:**
- `url` (*string, required, format: "uri", 1..2048 chars*): Target website URL (`http://` or `https://`). Accepts direct URLs or canonical URLs discovered via `googleSearch`.
- `smartScroll` (*boolean, optional, default: true*): Enable automated progressive scroll, semantic unfolding, and XHR stabilization.
- `ultraFast` (*boolean, optional, default: false*): Block images, external CSS, fonts, media, and manifest (JS + XHR still run) for faster extraction on image-heavy pages.
- `scrollDelayMs` (*integer, optional, 100..5000, default: 500*): Debounce wait time in milliseconds after each scroll step (increase to 1000–2000ms for slow networks).
- `maxScrolls` (*integer, optional, 0..20, default: 6*): Maximum scroll step iterations for lazy content hydration and DOM convergence.
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

### 3. `deepResearch` (`deepResearchAction`)
Executes comprehensive, multi-source deep web research in a single call. Conducts Google Search, extracts top-N canonical search results sequentially into clean GitHub Flavored Markdown, filters boilerplate and anti-bot walls, and truncates results within strict per-result and total token budgets.

**When to Use:**
- Use `deepResearch` when you need full article content or synthesis across multiple sources for a research topic in one round-trip.
- Use `googleSearch` when exploring queries, triaging candidate URLs, or needing snippets only.
- Use `webExtract` when the target URL is already known and requires surgical single-page extraction.

**Input Parameters:**
- `query` (*string, required, 1..500 chars*): Search keywords or research query.
- `limit` (*integer, optional, 1..10, default: 5*): Maximum search results to extract sequentially.
- `language` (*string, optional, default: "en"*): Language code (e.g. `"en"`, `"id"`).
- `country` (*string, optional, default: "us"*): Geolocation region code (e.g. `"us"`, `"id"`).
- `safeSearch` (*boolean, optional, default: true*): SafeSearch adult filter.
- `ultraFast` (*boolean, optional, default: true*): Block images, external CSS, fonts, and media. Defaults to `true` for deep research to maximize extraction throughput (set `false` if target pages gate content behind CSS visibility).
- `smartScroll` (*boolean, optional, default: true*): Automatically scroll and wait for lazy-loaded XHR data to settle.
- `scrollDelayMs` (*integer, optional, 100..5000, default: 500*): Debounce wait time in milliseconds after each scroll step.
- `maxScrolls` (*integer, optional, 0..20, default: 6*): Maximum scroll step iterations for lazy content hydration.
- `timeoutMs` (*integer, optional, 1000..60000, default: 30000*): Per-page navigation timeout in milliseconds.
- `maxCharsPerResult` (*integer, optional, 1000..100000, default: 20000*): Maximum character length per extracted article before truncation.
- `maxTotalChars` (*integer, optional, 10000..500000, default: 100000*): Maximum total character budget across all extracted articles.

**Example Tool Response:**
```json
{
  "query": "patchright vs playwright",
  "totalFound": 2,
  "totalReturned": 2,
  "excludedCount": 0,
  "errors": [],
  "results": [
    {
      "title": "Patchright Documentation",
      "url": "https://github.com/Kaliiiiiiiiii-Vinyzu/patchright",
      "markdown": "# Patchright\n\nThe undetected driver for browser automation...",
      "truncated": false
    }
  ],
  "timestamp": "2026-11-22T14:00:00.000Z"
}
```

> **Invariant Guarantee:** `totalReturned + excludedCount === totalFound` is guaranteed on every call. If any URL fails navigation, SSRF verification, or content extraction, it is discarded into `errors[]` with a short coded reason (`ssrf_blocked`, `invalid_url`, `timeout`, `empty_content`, `budget_exceeded`), allowing the remaining batch to complete reliably.

---

### 4. `healthCheck` (`healthAction`)
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
# Execute unit and live integration tests (68+ tests)
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
- **[Shukoi Framework](https://github.com/shukoilab/shukoi)** (`@shukoi/core`, `@shukoi/mcp`) — Modular TypeScript runtime framework powering MCP action dispatching and Web-Standard transport.
- **[Hono](https://hono.dev)** (`hono`, `@hono/node-server`) — Ultra-fast, lightweight Web-Standard HTTP framework powering Streamable HTTP transport and native health probes.
- **[Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)** — Official TypeScript SDK implementing the MCP specification across STDIO and Streamable HTTP transports.
- **[Mozilla Readability](https://github.com/mozilla/readability)** — Standalone content extraction engine from Mozilla Firefox's Reader View for clean, token-efficient article parsing.
- **[LinkeDOM](https://github.com/WebReflection/linkedom)** — High-performance, lightweight server-side DOM implementation with near-zero memory footprint.
- **[Unified Ecosystem](https://unifiedjs.com/)** (`unified`, `rehype-parse`, `rehype-remark`, `remark-gfm`, `remark-stringify`) — Composable syntax tree (AST) pipeline transforming HTML into high-density GitHub Flavored Markdown.
- **[TypeBox](https://github.com/sinclairzx81/typebox)** — High-performance JSON Schema Type Builder with static type inference enforcing strict input/output contracts.
- **[jose](https://github.com/panva/jose)** — Universal Web Cryptography library for secure token validation and cryptographic operations.
- **[Biome](https://biomejs.dev/) & [Vitest](https://vitest.dev/)** — Modern development toolchains delivering blazing-fast linting, formatting, and automated testing.

---

## 📄 License

MIT © [Shukoi Lab](https://github.com/shukoilab)
