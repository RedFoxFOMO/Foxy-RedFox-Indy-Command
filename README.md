<div align="center">
  <img src="./public/foxy-indy-banner.jpg" alt="Foxy RedFox Indy Command Banner" width="100%" />
</div>

# Foxy RedFox Indy Command `v2.2.0`

**Turn New Eden's regional markets, public contracts, station spreads, industry slots, and hauling routes into a single automated ISK-making command console.**

**Foxy RedFox Indy Command** connects directly to CCP's 2026 EVE ESI API (`X-Compatibility-Date: 2026-08-18`) to eliminate spreadsheet guesswork, compute exact standing-adjusted NPC broker fees, expose courier bait and thin orderbooks before you undock, and streamline multi-stop hauling and manufacturing—with **zero paywalls, zero real-money gates, and zero developer API tokens required**.

---

## Why Pilots Use Foxy RedFox Indy Command

* **Exact Standing-Adjusted Fees & 2026 ESI Compliance:** Syncs your **Accounting**, **Broker Relations**, **Advanced Broker Relations**, and live **NPC Faction & Corporation Standings** (`esi-characters.read_standings.v1`) across all 5 Empire hubs (`Jita`, `Amarr`, `Dodixie`, `Rens`, `Hek`) alongside Upwell structure custom broker fees and the 0.5% SCC surcharge.
* **Walk the Real Orderbook & Split Thin Tiers:** Walks ascending sell orders for inputs and descending buy orders (respecting `min_volume` and `volume_remain`) for instant fills, generating depth-aware tier-split Multi-Buy/Sell manifests so you never wipe out your margin on a thin book.
* **Spot Profitable Contracts & Avoid Courier Bait:** Evaluates public **Courier**, **Item Exchange**, and **BPC** contracts with depth-walked collateral checks (`Under-Valued` / `Fair` / `Over-Valued` / `Bait`), 3-leg Approach → Job → Return timing, proportional multi-BPC residual profit math, and one-click **Open Contract in EVE**.
* **Trade Your Current Station or All 5 Empire Hubs:** Dedicated **Station Trading** desk scoped to your checked Market Categories with **Standard Margin**, **Insta-Flip**, and **Hybrid** modes, live expandable order books, multi-period `30d / 14d / 7d / 1d` price trend ribbons, and **Station Material Stock** valuation.
* **Plan Multi-Slot Builds, Refining Destinations & Route Lifecycles:** Stack jobs with a priority-ordered **Virtual Hangar Stock Ledger**, configure **3-Stage Refining Location Rules** and per-output max-profit destinations, track **Transport Headroom** & **Route Haul Overrides** (with Undo), commit named routes to a **Completed Archive**, and export via Clipboard, `.txt`/`.csv`/`.json`, clean **Print/PDF**, Share Link, or **Discord Webhook**.
* **Assess Gank Risk Before Undocking:** Dedicated **Gank** tactical tab combining **zKillboard + ESI** pilot intel, a **Ship & Cargo Scanner** paste parser, **Fight vs. Evade** verdicts, and CONCORD-excluded **TTK vs. Time-to-Be-Killed** analysis.

---

## What's New in `v2.2.0`

### 1. Unified Settings Hub, About Info Badge & Locked Info Tips
* **One Unified Settings Modal:** Every connection and preference lives in a single 5-tab **Settings** modal (*Connections & APIs*, *Trading & Fee Defaults*, *Industry & Refining Rules*, *Hauling & Route Cadence*, and *UI & Alerts*), including EVE SSO PKCE, optional BYOK AI keys (Gemini/OpenAI in browser `localStorage`), **Discord Channel Webhook** + **Send Test Ping**, and optional Share/Paste URL.
* **Global Tooltips Toggle & Locked Help Tips:** Switch general tooltips **All On / All Off** from Settings without ever hiding critical **Locked Info Tips** (API setup steps, Remote Order rules, and CONCORD TTK exclusions).
* **Clickable `v2.2.0` Info Badge:** Click the version badge in the top bar or footer for release details, quick-start guidance, in-game contact (`Reccemaster`), and one-click Settings access.

### 2. 2026 ESI Compliance & Exact Standing-Adjusted Broker Fees
* **Unversioned ESI + Compatibility Header:** All requests target unversioned `https://esi.evetech.net/...` routes with `X-Compatibility-Date: 2026-08-18`, `User-Agent: Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)`, `POST /route/{origin}/{destination}` (`Safer`, `Shorter`, `LessSecure`), and live `/status` health checks.
* **True 5-Hub NPC Standing Formula:** Automatically applies `max(1.0%, 3.0% - 0.3% × Broker Relations - 0.03% × Faction Standing - 0.02% × Corp Standing)` per Empire hub using your synced character standings.

### 3. Global Card UX, Multi-Period Trends & DOTLAN Integration
* **30d / 14d / 7d / 1d Price Trend Ribbon:** Color-coded trend bars, exact primary-period `%` delta, and a 5-minute session sparkline across cards, Market Depth, and Station Trading.
* **Universal `+` / `-` Quantity Override & Card Modes:** Adjust batch sizes on every card, toggle **List Orders vs. Instant Fill** individually per card or click **Apply to All Cards** in the toolbar, and jump directly to **DOTLAN** system and multi-hop route maps.

### 4. New "Contracts" Tab (Courier & Item/BPC Evaluator)
* **Courier Contracts:** Depth-walked collateral coverage %, bait/over-valued flags, 3-leg Approach → Job → Return jump calculation, Round-Trip vs. One-Way toggle, hull align/warp + manual click cadence timing, ISK/jump, Income/Job Hr, and Income/Total Hr.
* **Item & BPC Contracts:** Side-by-side Instant Sell, Sell Order, and Reprocess valuation; full-run BPC build cost vs. instant output revenue minus contract price (**Residual Profit**) with proportional multi-BPC allocation, one-click **Open Contract in EVE**, **Copy Contract Verify Manifest**, and **Pin to Route**.

### 5. New "Station Trading" Tab
* **Current Station & 5-Hub Scanner:** Defaults to your synced Current Station (or switches to Jita, Amarr, Dodixie, Rens, or Hek) with **Standard Margin**, **Insta-Flip**, and **Hybrid** modes, Daily Volume / Min ROI / Order Range (`Station`, `1j`, `2j`, `3j`) filters, clickable column sorting, expandable **Green-row** live order books, and a **Station Material Stock** live valuation ledger.

### 6. Industry Transport Headroom, Refining Rules & Route Lifecycle Exports
* **Transport Cost & Route Haul Overrides:** Set per-card transport cost and minimum desired profit to view **Max Absorbed Transport Headroom**; override haul costs directly inside the Route Optimizer and clear overrides with automatic previous-value restoration + **Undo** toast.
* **Inspection vs. Order Book Drawer & Refining Optimizer:** Switch cleanly between **Inspection View** and **Live Order Book View**, enforce **3-Stage Refining Location Rules**, and lock in per-output alternative max-profit destinations when extra-effort profit exceeds your threshold.
* **Route Lifecycle & 5 Export Targets:** Promote a **Live Session** route to a named, timestamped **Committed Route** and archive finished runs into **Completed Archive** with Undo and realized-profit totals. Export depth-aware tier-split manifests via **Clipboard (Text/CSV)**, **File (`.txt`/`.csv`/`.json`)**, clean **Print / PDF**, **Share Link**, or **Discord Webhook Push**.

### 7. New "Gank" Tactical Evaluator Tab
* **Threat vs. Target/Victim Analysis:** Compare your synced ships or catalog hulls against gank threats with live **zKillboard + ESI** pilot intel, a **Ship & Cargo Scanner** paste parser, **Fight vs. Evade** recommendations, Cost-Benefit summary, and **TTK vs. Time-to-Be-Killed** strictly excluding CONCORD (with Locked Info Tip).

---

## Intelligent ESI Caching, ETag Revalidation & Low-Token Watchdog

* **5-Minute CCP Cache Shield (`0 Tokens` While Fresh):** Strictly honors ESI `Cache-Control` / `Expires` windows so fresh reads consume **0 ESI tokens**.
* **Conditional `If-None-Match` (`ETag`) Revalidation:** Unchanged market books return `HTTP 304 Not Modified`, consuming **1 token instead of 2**.
* **Active Sync vs. Background Undercut Watchdog (`document.hidden`):** Minimized or hidden tabs pause general market scans while keeping a lightweight 5-minute watchdog active exclusively for the `type_id`s of your open character orders.

---

## Zero-Install Quick Start (Run in 60 Seconds — No Coding Required)

Deploy your own free private instance in one click and paste your keys directly inside **Settings → Connections & APIs**:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRedFoxFOMO%2FFoxy-RedFox-Indy-Command)

1. **Launch Your Private Instance:** Click **Deploy with Vercel** above (or download the latest release to run locally with `npm install && npm run dev`).
2. **Register a Free EVE App:** Open the [EVE Online Developers Portal](https://developers.eveonline.com/), create an application, and copy your **Client ID**.
3. **Connect in Settings:** Open your app, click **Settings** in the top navigation bar, click **Copy Callback URL** and paste it into your EVE Developer application, then paste your **EVE Client ID** (plus optional Discord Webhook or personal Gemini/OpenAI key) and click **Connect EVE SSO**.

---

## Feature Requests, Feedback & In-Game Contact

Have an idea that would save pilots more time or catch better margins? **Feature requests are actively welcomed!**
* **GitHub Issues:** Open a **Feature Request** or **Bug Report** under the **Issues** tab in this repository.
* **In-Game Contact:** Send an EVE Mail or convo **`Reccemaster`** in-game for development questions, industrial workflow ideas, or feedback.

---

## Copyright & License Notice

**Copyright © 2026 RedFoxFOMO / Reccemaster. All Rights Reserved.**

This software and its source code are provided strictly for personal, non-commercial use by EVE Online players. You may download, deploy, and run an unmodified copy of this application for your own personal gameplay. **You may not modify, fork for redistribution, reverse-engineer, sublicense, or publish derivative versions of this codebase without explicit written permission from the author.** All feature development and official releases are maintained exclusively by the author.
