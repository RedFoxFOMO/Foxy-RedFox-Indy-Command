<div align="center">
  <img src="./public/foxy-indy-banner.jpg" alt="Foxy RedFox Indy Command Banner" width="100%" />
</div>

# Foxy RedFox Indy Command `v2.0.0`

**Turn New Eden's regional markets, industry slots, and hauling routes into a single automated ISK-making command console.**

**Foxy RedFox Indy Command** connects directly to CCP's live ESI API to eliminate spreadsheet drudgery, protect your wallet from bad trades and gatecamps, and compress hours of manual market checking and industry math into a few clicks.

---

## Why Pilots Use Foxy RedFox Indy Command

Most EVE tools show you raw price differences and leave you to do the real work—and take all the risks—yourself. **Foxy RedFox Indy Command** solves the five biggest time-wasters and ISK-traps in trading, hauling, and manufacturing:

* **Stop Losing ISK to Hidden Taxes & Fake Margins:** Automatically reads your character's trained **Accounting** and **Broker Relations** skills plus live CCP system cost indices and Upwell structure rig bonuses so you see true, net after-tax profit before spending a single ISK.
* **Never Over-Buy an Illiquid Market:** Inspects live top-of-book depth and 7-day trading volume history across all 5 Empire hubs, capping recommended quantities to what buyers will actually absorb.
* **Cut Hauling & Buying Time by 80%:** Automatically packs the highest **ISK-per-Jump** trade loop inside your exact fitted ship's cargo bay, exports ready-to-paste **EVE Multibuy** lists (deducting materials already sitting in your hangars), and pushes the entire multi-stop route straight to your in-game **Autopilot**.
* **Protect High-Value Cargos from Gatecamps:** Cross-references every jump on your route against live ESI system kill feeds (`system_kills`) with 1-click zKillboard checks and configurable ISK gank-risk ceilings.
* **Keep Every Industry Slot & Market Order Earning:** Live 1-second job countdowns alert you the moment a manufacturing, invention, or research slot opens up, while the **Order Monitor** flags undercut orders and calculates the exact ISK needed to reclaim top-of-book.

---

## Full Feature Suite (`v2.0.0`)

### 1. Full 5-Hub Empire Trade Network & 19-Category Market Scanner
* **All 5 Major Hubs:** Scan, chart, and compare live arbitrage spreads across **Jita, Amarr, Dodixie, Rens, and Hek** with instant source/destination swapping.
* **Complete 19-Category Catalog:** Dynamically traverses EVE's official Market Groups tree (Modules, Charges, Rigs, Drones, Hulls, and Planetary Interaction P0–P4) with 7-day local caching and built-in ESI rate-limit protection.
* **Pinned Watchlist & Margin Triggers:** Pin high-value SKUs or blueprints to a persistent Watchlist with custom minimum **ROI %** and **ISK/m³** thresholds that highlight automatically when live scans hit your targets.

### 2. Active Industry Jobs, Slot Monitor & Upwell Structure Math
* **Live Slot & Countdown Tracker:** Syncs your running Manufacturing, Invention, Copying, and Research jobs (`esi-industry.read_character_jobs.v1`) with 1-second countdown timers, slot utilization badges, open-slot alerts, and automated **"Next Best BPO/BPC to Start"** recommendations.
* **Real-Time Structure & System Cost Engine:** Pulls live CCP `/industry/systems/` cost indices and `/markets/prices/` adjusted values, letting you toggle between **NPC Stations, Raitaru, Azbel, and Sotiyo** with T1/T2 ME, TE, and Job Cost rigs.
* **Hangar Stock Deductor for Multibuy:** Cross-checks shopping lists and blueprint Bills of Materials against your Jita and Ishisomo hangars (`esi-assets.read_assets.v1`)—with an instant on/off toggle to switch between gross requirements and net-to-buy quantities before copying to EVE Multibuy.

### 3. Real-Time Undercut & Fill Order Monitor
* **Top-Bar Overlay Drawer:** Open the **Order Monitor** from any screen to compare your active Buy and Sell orders (`esi-markets.read_character_orders.v1`) against live hub order books.
* **Instant Re-Pricing & Daily Profit Tracking:** Flags undercut orders, displays the exact ISK adjustment required to reclaim top-of-book, and tracks realized daily profit directly from your wallet transactions (`esi-wallet.read_character_wallet.v1`).

### 4. Fitted-Ship Hangar Analyzer & "Auto-Fill Best Loop" Solver
* **Exact Ship & Rig Detection:** Scans your docked ships via ESI assets—accounting for fitted Expanded Cargoholds, Cargo Rigs, and specialized bays (**Kryos, Miasmos, Epithal, Hoarder, Squall/Deluge/Torrent/Avalanche, Blockade Runners, DSTs, Orca, Bowhead, and Freighters**)—and flags Prep Step 0 if your hauler is docked elsewhere.
* **Knapsack Route Optimizer & Threat Map:** Solves for the highest-profit multi-stop loop within your cargo m³, liquid wallet, and gank-risk limit, complete with a 2D New Eden route map and live system kill alerts.

### 5. One-Click In-Game EVE Client Execution & Optional Quartermaster AI
* **Direct In-Game Actions:** Export `<Item Name>\t<Quantity>` lists for **EVE Multibuy**, pop open item Regional Market windows directly in your EVE client (`POST /ui/openwindow/marketdetails/`), and push full pickup-before-dropoff waypoint chains straight to your in-game **Autopilot**.
* **Customizable Workspace & Optional AI Advisor:** Collapse or expand any dashboard card (`^` / `v`) to tailor your screen layout, and optionally connect a Gemini key for interactive **Quartermaster AI** build and trade recommendations.

---

## Zero-Install Quick Start (Run in 60 Seconds — No Coding Required)

You do **not** need to install Node.js, Python, or run terminal commands to use this tool. Deploy your own free private instance in one click and paste your keys directly inside the app:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRedFoxFOMO%2FFoxy-RedFox-Indy-Command)

1. **Launch Your Private Instance:** Click **Deploy with Vercel** above (or download the latest release from the **Releases** tab on the right to run locally with `npm install && npm run dev`).
2. **Register a Free EVE App:** Go to the [EVE Online Developers Portal](https://developers.eveonline.com/), create an application, and copy your **Client ID**.
3. **Connect in the App:** Open your deployed app, click **API Setup** in the top navigation bar, click **Copy Callback URL** and paste it into your EVE Developer application, then paste your **EVE Client ID** (and optional **Gemini API Key**) into the setup modal and click **Connect with EVE SSO**.

---

## Feature Requests, Feedback & In-Game Contact

Have an idea that would save pilots more time or catch better margins? **Feature requests are actively welcomed!**
* **GitHub Issues:** Open a **Feature Request** or **Bug Report** under the **Issues** tab in this repository.
* **In-Game Contact:** Send an EVE Mail or convo **`Reccemaster`** in-game for development questions, industrial workflow ideas, or feedback.

---

## Copyright & License Notice

**Copyright © 2026 RedFoxFOMO / Reccemaster. All Rights Reserved.**

This software and its source code are provided strictly for personal, non-commercial use by EVE Online players. You may download, deploy, and run an unmodified copy of this application for your own personal gameplay. **You may not modify, fork for redistribution, reverse-engineer, sublicense, or publish derivative versions of this codebase without explicit written permission from the author.** All feature development and official releases are maintained exclusively by the author.
