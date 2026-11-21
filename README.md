<div align="center">
  <img src="./public/foxy-indy-banner.jpg" alt="Foxy RedFox Indy Command Banner" width="100%" />
</div>

# Foxy RedFox Indy Command `v2.1.0`

**Turn New Eden's regional markets, industry slots, and hauling routes into a single automated ISK-making command console.**

**Foxy RedFox Indy Command** connects directly to CCP's live ESI API to eliminate spreadsheet drudgery, protect your wallet from thin orderbooks, bad relists, and gatecamps, and compress hours of manual market checking and industry math into a few clicks—with zero paywalls or real-money gates.

---

## Why Pilots Use Foxy RedFox Indy Command

Most EVE tools show you raw top-of-book spreads and leave you to discover slippage, relist fees, stock conflicts, and gank risks the hard way. **Foxy RedFox Indy Command `v2.1.0`** solves the biggest ISK-traps in trading, hauling, and manufacturing:

* **Walk the Real Orderbook Before Spending ISK:** Walks ascending sell orders for inputs and descending buy orders (respecting `min_volume` and `volume_remain`) for instant fills so you see true weighted-average prices, slippage %, and shortfall alerts before committing capital.
* **Stop Losing ISK to Hidden Taxes, Relist Fees & Fake Margins:** Reads your trained **Accounting**, **Broker Relations**, **Advanced Broker Relations**, **Industry**, **Advanced Industry**, and **Mass Production** skills plus live CCP system cost indices and Upwell structure/rig bonuses (**NPC Station, Raitaru, Azbel, Sotiyo, Athanor, Tatara**).
* **Plan Multi-Slot Builds Without Double-Counting Your Hangar:** Priority-ordered **Virtual Hangar Stock Ledger** reserves your owned materials across stacked jobs and shows side-by-side **Buy All (Replacement Cost)** vs. **Buy Missing (Cash Out-of-Pocket)** profits.
* **Cut Hauling & Buying Time by 80%:** Resize quantities/runs interactively with instant client-side recalculation, audit live hub stock inside the **Global Multi-Buy Aggregator**, inspect exact hull trips & Jita fits in the **Hauler & Fit Flyout**, and push pickup-before-dropoff chains straight to your in-game **Autopilot**.
* **Beat Competitors by One Exact EVE Tick:** Copy exact 4-significant-figure EVE price ticks (`1,000,000 → 999,900`, `99.99 → 99.98`) with live skill-adjusted relist modification fee previews and unprofitable-relist warnings.

---

## Full Feature Suite (`v2.1.0`)

### 1. Orderbook Depth-Walking, Interactive Quantity Slicer & Dual Trend Indicators
* **True Depth-Walking Engine:** Walks live hub orderbooks tier-by-tier for both input purchases and instant-fill sales, reporting weighted-average execution prices, slippage %, and depth shortfalls.
* **Interactive Qty / Runs Slicer (Single Source of Truth):** Adjust quantities or blueprint runs via numeric input, `−`/`+` steppers, or the **"Max Profitable"** reset button with instant client-side recalculation (zero ESI re-fetches) that propagates automatically into the Build Queue, Multi-Buy Shopping List, and Route Planner.
* **Dual Trend Arrows in Market Depth:** Inside the Market Depth panel, compare long-term 24h direction against yesterday's ESI daily average (large saturated green/red arrow) alongside the recent 5-minute session tick (smaller soft pastel arrow).
* **Quantitative Price Projection Pop-Out & Optional BYOK AI Commentary:** Launch from the Pinned Watchlist, Category SKU Inspector, or any Action Card to view 7d/30d moving averages, momentum scores, volume spike checks, thin-market alerts, and a 7-day statistical price band—running 100% locally with **0 API keys required**, plus an optional Settings toggle to enable **Bring Your Own API Key** (Gemini or OpenAI, stored strictly in browser `localStorage`) commentary.

### 2. Multi-Slot Industry Queue, Virtual Hangar Ledger & Global Multi-Buy Aggregator
* **Dual Profit Modes:** Every manufacturing card displays **Buy All (Replacement Cost)** next to **Buy Missing (Cash Out-of-Pocket)** profit using your synced hangar inventory (`esi-assets.read_assets.v1`).
* **Priority-Ordered Virtual Hangar Ledger:** Stack multiple jobs in the **Build Queue**, adjust job priority, and inspect `Reserved / Available` per material row as stock cascades across jobs.
* **Skill- & Structure-Aware Concurrency Planner:** Allocate concurrent slots per blueprint to compare **1-Slot Sequential Time**, **Time Per Slot**, **Concurrent Wall-Clock Time**, and **ISK/hour** across NPC Stations, Raitaru, Azbel, Sotiyo, Athanor, and Tatara rigs.
* **Availability-Checked Global Multi-Buy Aggregator:** Click **Export Total Shopping List** at the bottom of the build queue to combine all Buy Missing inputs across queued jobs, check live hub liquidity (`In Stock`, `Thin Depth / Price Spike`, `Shortfall`), and isolate thin-orderbook materials from safe bulk EVE Multi-Buy exports.

### 3. Hauling Route Planner, Smart Hull Suggester & Multi-Buy Fit Flyout
* **Instant Logistics Flyout:** Open **Hauler & Fit** from any opportunity card or the build queue to compare raw input m³ vs. packaged output m³, ESI jump count, route minimum security, and owned hauler trip counts.
* **Smart Hull & Gank-Risk Fit Recommender:** Recommends the ideal hull class (`T1 Industrial`, `Blockade Runner`, `Deep Space Transport`, or `Freighter`) with gank-risk rationale, live Jita hull+fit pricing, and one-click **"Copy Hull + Fit for EVE Multi-Buy"**.

### 4. Exact 4-Sig-Fig Tick Undercutter & Real-Time Order Monitor
* **Top-Bar Order Monitor Overlay:** Tracks active Buy and Sell orders (`esi-markets.read_character_orders.v1`) against live hub order books plus realized daily profit from recent wallet transactions (`esi-wallet.read_character_wallet.v1`).
* **One-Click 4-Sig-Fig Tick & Relist Cost Preview:** Copies the exact valid EVE tick to undercut or outbid competitors while displaying your exact skill-adjusted relist modification fee (`Broker Relations` + `Advanced Broker Relations`, 100 ISK minimum), updated net margin, and a flashing warning if relisting makes the order unprofitable.

### 5. Full 5-Hub Empire Network, Pinned Watchlist & Resizable Workspace
* **All 5 Major Hubs & 19 Market Categories:** Scan, chart, and trade across **Jita, Amarr, Dodixie, Rens, and Hek** with 7-day cached ESI Market Group catalogs and a persistent **Pinned Watchlist** with ROI % and ISK/m³ trigger alerts.
* **Resizable Split-Pane & Visual Hierarchy:** Drag the vertical divider between the center workspace and right panel (double-click to reset 50/50, saved to `localStorage`), collapse/expand any card, and track active tabs and selected rows at a glance.

---

## Intelligent ESI Caching, ETag Revalidation & Low-Token Watchdog

**Foxy RedFox Indy Command** is engineered for strict CCP ESI good-citizenship and minimal API token consumption:

* **Descriptive User-Agent:** Every server and serverless ESI request sends `User-Agent: Foxy-RedFox-Indy-Command/2.1.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)`.
* **5-Minute CCP Cache Shield (`0 Tokens` While Fresh):** Market orderbook and aggregate caches strictly honor ESI `Cache-Control` / `Expires` headers (300 seconds), serving fresh reads from memory with **0 ESI tokens spent**.
* **Conditional `If-None-Match` (`ETag`) Revalidation (`1 Token` vs. `2`):** When a cached market entry expires, the fetcher sends the stored `ETag` via `If-None-Match`. Unchanged endpoints return `HTTP 304 Not Modified`, consuming only **1 rate-limit token instead of 2** and refreshing the cache expiry window immediately.
* **Live Rate-Limit & Cache Countdown Telemetry:** Reads `X-Ratelimit-Remaining` and `Retry-After` response headers to automatically throttle if budget runs low and surfaces a live **"Market Cache Refresh"** countdown badge in the top navigation bar.
* **Active Sync vs. Background Undercut Watchdog (`document.hidden`):** When your browser tab is hidden or minimized, general market browsing and history polling pause automatically to save bandwidth and ESI quota, while a lightweight **Undercut Watchdog** continues polling **only** the specific `type_id`s of your open character market orders on the 5-minute CCP cache cadence.

---

## Zero-Install Quick Start (Run in 60 Seconds — No Coding Required)

You do **not** need to install Node.js, Python, or run terminal commands to use this tool. Deploy your own free private instance in one click and paste your keys directly inside the app:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRedFoxFOMO%2FFoxy-RedFox-Indy-Command)

1. **Launch Your Private Instance:** Click **Deploy with Vercel** above (or download the latest release from the **Releases** tab on the right to run locally with `npm install && npm run dev`).
2. **Register a Free EVE App:** Go to the [EVE Online Developers Portal](https://developers.eveonline.com/), create an application, and copy your **Client ID**.
3. **Connect in the App:** Open your deployed app, click **API Setup** in the top navigation bar, click **Copy Callback URL** and paste it into your EVE Developer application, then paste your **EVE Client ID** (and optional personal AI key) into the setup modal and click **Connect with EVE SSO**.

---

## Feature Requests, Feedback & In-Game Contact

Have an idea that would save pilots more time or catch better margins? **Feature requests are actively welcomed!**
* **GitHub Issues:** Open a **Feature Request** or **Bug Report** under the **Issues** tab in this repository.
* **In-Game Contact:** Send an EVE Mail or convo **`Reccemaster`** in-game for development questions, industrial workflow ideas, or feedback.

---

## Copyright & License Notice

**Copyright © 2026 RedFoxFOMO / Reccemaster. All Rights Reserved.**

This software and its source code are provided strictly for personal, non-commercial use by EVE Online players. You may download, deploy, and run an unmodified copy of this application for your own personal gameplay. **You may not modify, fork for redistribution, reverse-engineer, sublicense, or publish derivative versions of this codebase without explicit written permission from the author.** All feature development and official releases are maintained exclusively by the author.
