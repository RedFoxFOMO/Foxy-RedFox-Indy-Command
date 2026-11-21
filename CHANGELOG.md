# Changelog

All notable changes to **Foxy RedFox Indy Command** are documented in this file.

The format follows [Semantic Versioning](https://semver.org/):
- **MINOR** (`1.0.0` -> `1.1.0`) for new features.
- **PATCH** (`1.1.0` -> `1.1.1`) for fixes, refinements, and tweaks.

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
