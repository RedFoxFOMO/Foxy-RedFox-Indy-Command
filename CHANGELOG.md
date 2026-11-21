# Changelog

All notable changes to **Foxy RedFox Indy Command** are documented in this file.

The format follows [Semantic Versioning](https://semver.org/):
- **MINOR** (`1.0.0` -> `1.1.0`) for new features.
- **PATCH** (`1.1.0` -> `1.1.1`) for fixes, refinements, and tweaks.

## [2.1.0] - 2026-11-20

### Added
- **ESI Rate-Limit & Cache Shield (Active Sync vs. Low-Token Background Watchdog)**:
  - Standardized all ESI fetchers and serverless proxies on the descriptive `User-Agent: Foxy-RedFox-Indy-Command/2.1.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)`.
  - Enforced CCP's 5-minute market cache (`Cache-Control` / `Expires`) so fresh cached endpoints consume **0 API tokens**, and added `If-None-Match` (`ETag`) conditional revalidation on expiry so `304 Not Modified` responses consume **1 token instead of 2**.
  - Added live `X-Ratelimit-Remaining` / `Retry-After` telemetry and a live **"Market Cache Refresh"** countdown badge in the top bar.
  - Added `document.hidden` visibility throttling: hidden tabs pause general market browsing and history polling while keeping a lightweight **"Undercut Watchdog"** running on the 5-minute schedule strictly for the `type_id`s of open character orders.
- **True Orderbook Depth-Walking Cost & Revenue Engine**:
  - Replaced top-of-book estimates with live ascending sell-order walking for buying inputs (weighted-average unit price, total ISK, slippage %, shortfall warnings) and descending buy-order walking (respecting `min_volume` and `volume_remain`) for instant-selling outputs.
- **Interactive Quantity / Runs Slicer (Single Source of Truth)**:
  - Added editable `Qty / Runs` numeric inputs, `−` / `+` steppers, and a **"Max Profitable"** reset button on trade and blueprint cards with zero-ESI-refetch client-side recalculation of depth-walked cost/revenue, net profit, ISK/hour, cargo volume m³, and slot duration.
  - Automatically propagates committed quantities into the Build Queue, Multi-Buy Shopping List, and Hauling Route Planner.
- **Dual Profit Modes ("Buy All" vs. "Buy Missing") & Virtual Hangar Stock Ledger**:
  - Displays side-by-side **Buy All (Replacement Cost)** and **Buy Missing (Cash Out-of-Pocket)** profits on blueprint cards.
  - Added a priority-ordered **Multi-Slot Build Queue & Virtual Hangar Stock Ledger** showing `Reserved / Available` per material row across stacked jobs, automatically cascading depleted hangar stock into Buy Missing requirements.
- **Skill- & Location-Specific Blueprint Time & Multi-Slot Concurrency Planner**:
  - Syncs live ESI skills (`Industry`, `Advanced Industry`, `Reactions`, `Mass Production`, `Advanced Mass Production`, `Laboratory Operation`, `Advanced Laboratory Operation`, `Advanced Broker Relations`), Blueprint ME/TE, active job counts, and Upwell structure/rig bonuses (**NPC Station, Raitaru, Azbel, Sotiyo, Athanor, Tatara**).
  - Lets pilots allocate concurrent slots per job to view **1-Slot Sequential Time**, **Time Per Slot**, and **Concurrent Wall-Clock Time** alongside live ISK/hour.
- **Hauling Route Planner, Smart Hull Suggester & Multi-Buy Fit Flyout**:
  - Added slide-over **Hauler & Fit** flyout showing raw material m³, packaged output m³, ESI jump count & security checks, owned hauler trip counts from ESI assets, optimal hull class recommendations (`T1 Industrial`, `Blockade Runner`, `DST`, `Freighter`) with gank-risk rationale, live Jita hull+fit pricing, and one-click **"Copy Hull + Fit for EVE Multi-Buy"**.
- **Exact 4-Sig-Fig Tick Undercutter & Relist Cost Preview**:
  - Added one-click **"Copy Tick Price"** next to competitor prices computing the exact next valid 4-significant-figure EVE tick (e.g., `1,000,000 -> 999,900`, `99.99 -> 99.98`), exact skill-adjusted relist modification fee (`Broker Relations` + `Advanced Broker Relations`, 100 ISK minimum), updated net margin, and an unprofitable-relist alert.
- **Availability-Checked Global Multi-Buy Aggregator**:
  - Added **"Export Total Shopping List"** modal at the bottom of the multi-slot build queue combining all Buy Missing materials across queued jobs, auditing live hub orderbook stock (`In Stock`, `Thin Depth / Price Spike`, `Shortfall`), and isolating thin-orderbook materials from safe bulk Multi-Buy exports.
- **Dual Trend Arrows in Market Depth & Price Projection Pop-Out**:
  - Added dual directional price indicators inside **Market Depth** (`LiveOrderBookPanel`): a large saturated arrow (`#10B981` / `#EF4444`) for 24h trend vs. yesterday's ESI average plus a smaller soft pastel arrow (`#86EFAC` / `#FCA5A5`) for the recent 5-minute session tick.
  - Added a **Price Projection Pop-Out** modal accessible from Pinned Watchlist, Category SKU Inspector, and Action Cards featuring a 0-API-key client-side quantitative analyzer (7d/30d MAs, momentum, volume spikes, thin-market checks) and an optional **Bring Your Own API Key** AI commentary mode (Gemini or OpenAI, stored strictly in browser `localStorage`).
- **Workspace UI Refinements**:
  - Added a click-and-drag resizable vertical split-pane divider between the center workspace and right docked panel (with double-click 50/50 reset and `localStorage` persistence).
  - Enhanced active top-navigation tab elevation (raised drop-shadow, border highlight, bottom accent indicator) and persistent selected-row / selected-card styling (left cyan accent bar, soft tint, subtle inner shadow).

## [2.0.0] - 2026-11-20

### Added
- **Active Industry Jobs & Slot Monitor**:
  - Added `esi-industry.read_character_jobs.v1` EVE SSO scope and `/characters/{id}/industry/jobs/` scanner.
  - Added live 1-second countdown timers for running Manufacturing, Invention, Copying, and Research jobs, active vs. max slot utilization badges, idle-slot alerts, and an automated "Next Best BPO/BPC to Start" recommendation prompt.
- **Live System Cost Indices & Upwell Structure Rig Bonuses**:
  - Added live CCP `/industry/systems/` cost index and `/markets/prices/` adjusted-price synchronization.
  - Added NPC Station, Raitaru, Azbel, and Sotiyo structure selector controls with T1/T2 ME, TE, and Job Cost rig toggles that dynamically recalculate Ishisomo, Jita, or custom-system build margins and installation fees.
- **Hangar Stock Deductor for Multibuy**:
  - Cross-checks Consolidated Shopping Lists and blueprint Bills of Materials against Jita and Ishisomo hangar inventory (`esi-assets.read_assets.v1`).
  - Added an interactive **Deduct Hangar Stock** toggle next to Multibuy controls to switch between gross requirements and net-to-buy quantities before copying to EVE Multibuy.
- **Full 5-Hub Empire Trade Network**:
  - Expanded regional market scanning, charts, and trade manifests across all five Empire hubs: **Jita, Amarr, Dodixie, Rens, and Hek**, with selectable source/destination hub pairs and instant swap controls.
- **Undercut & Fill Monitor Overlay**:
  - Added an **Order Monitor** tab in the top navigation bar opening a dedicated overlay drawer.
  - Compares active Buy and Sell orders (`esi-markets.read_character_orders.v1`) against live hub order books to flag undercuts, calculate the exact ISK adjustment to reclaim top-of-book, and compute realized daily profit from recent wallet transactions (`esi-wallet.read_character_wallet.v1`).
- **Pinned Watchlist & Margin Triggers**:
  - Added persistent `localStorage` Watchlist allowing players to pin SKUs or blueprints with custom minimum ROI % and ISK/m³ trigger thresholds that highlight automatically on live market hits.
- **Collapsible Cards Across the Interface**:
  - Added persisted chevron (`^` / `v`) collapse/expand toggles to every dashboard panel, chart, and opportunity card, preserving layout state across browser refreshes.
- **Vercel Serverless Compatibility**:
  - Added lightweight Vercel `/api/*` serverless handlers alongside client-side direct EVE ESI / Fuzzwork fallbacks so 1-click Vercel deployments run live market scans, order books, cost indices, routes, and EVE SSO while preserving the Express server for Cloud Run and local development.

## [1.0.0] - 2026-11-20

### Added
- **Semantic Versioning & Zero-Terminal API Setup ("Bring Your Own Keys")**:
  - Added in-app **API Setup** modal accessible from the top navigation bar (and auto-opened when clicking **Connect EVE SSO** without an EVE Client ID configured).
  - Added env-first configuration (`EVE_CLIENT_ID`, `GEMINI_API_KEY`) with automatic browser `localStorage` fallback (`foxy_custom_eve_client_id`, `foxy_custom_gemini_key`) so players can self-host without a terminal or `.env` file.
  - Added one-click **Copy Callback URL** (`window.location.origin + window.location.pathname`) for `developers.eveonline.com` and subtle footer version badge (`v1.0.0`).
- **5 EVE Online Decision Engines & Dynamic 19-Category Market Catalog**:
  - Live ESI & Fuzzwork market scanning across all 19 official EVE ESI Market Group categories with 7-day catalog caching and built-in ESI rate-limit protection.
  - True skill-adjusted Sales Tax (Accounting) and NPC Broker Fee (Broker Relations) math with Instant Fill vs. Limit Order execution toggles, destination order-book depth caps, and wallet/active-order guards.
- **Expandable Live Order Book & Remote Buy Range**:
  - Live top-8 Sell Orders at the Buy Hub and top-8 Buy Orders at the Sell Hub per opportunity card with depth-fill highlighting and Procurement/Marketing remote order range checks.
- **Fleet Logistics, Threat Intel & Route Optimizer**:
  - Bidirectional card route queue selection, **Auto-Fill Best Loop** solver, live ESI system-kills gatecamp alerts, interactive 2D Visual Route Map using real EVE `(x, z)` coordinates, and one-click **Copy for EVE Multibuy** export.
- **EVE SSO PKCE & Direct In-Game Client Controls**:
  - Full `X-Pages` personal & corporation blueprint scanner, live ship/cargo/skills/wallet sync, one-click in-game Autopilot waypoints (`esi-ui.write_waypoint.v1`), and direct **Open Market in EVE** triggers (`esi-ui.open_window.v1`).
- **Optional Strategic AI Advisor**:
  - Context-aware Gemini advisor sidebar with interactive shopping-list and engine-navigation actions (completely optional; all market, blueprint, cargo, and logistics engines run independently).
