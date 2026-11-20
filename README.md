<div align="center">
  <img src="./public/foxy-indy-banner.jpg" alt="Foxy RedFox Indy Command Banner" width="100%" />
</div>

# Foxy RedFox Indy Command

**An end-to-end EVE Online fleet logistics, regional market arbitrage, and industrial command suite powered by CCP's live ESI API.**

**Live App:** [Foxy RedFox Indy Command](https://new-eden-trade-indy-command-502218736450.europe-west3.run.app/)

---

## Overview

Most EVE Online market tools highlight theoretical price spreads between trade hubs—leaving pilots to manually calculate taxes, check order-book depth, verify ship cargo capacities, and plot safe waypoints. **Foxy RedFox Indy Command** connects your character's skills, hangars, liquid wallet, and active market orders into a single automated workflow from market discovery to in-game execution.

---

## Core Capabilities

### 1. Dynamic 19-Category ESI Market Scanner
* **Full New Eden Catalog:** Dynamically traverses EVE Online's official Market Groups tree across **Charges & Fuel**, **Rigs, Drones & Hulls**, and **Resources & Planetary Interaction (P0–P4)**—cached in `localStorage` for instant reloads.
* **Live Order-Book & Liquidity Guard:** Inspects top regional Ask/Bid order books alongside 7-day trading volume history, automatically capping batch quantities to real destination buy-order depth so you never over-buy an illiquid market.
* **Built-In ESI Rate-Limit Protection:** Enforces CCP's 5-minute market cache timers and monitors `X-ESI-Error-Limit-Remain` / `X-Ratelimit-Remaining` headers to prevent accidental rate-limit blocks (`420` / `429`).

### 2. Skill-Adjusted Net Profit & Remote Buy Range
* **True After-Tax Accounting:** Reads your trained **Accounting** and **Broker Relations** skills via ESI to deduct real sales taxes and NPC broker fees from every spread.
* **Active Order Conflict Alerts:** Cross-references your open character market orders and flags items you already have listed in the destination region.
* **Remote Procurement Check:** Evaluates your **Procurement** skill level against pickup jump distance to tell you when you can place a remote buy order in-game before undocking.

### 3. Fitted-Ship Hangar & Cargo Bay Analyzer
* **Live Fleet Inspection:** Scans your owned ships across hangars via ESI assets, accounting for fitted Expanded Cargoholds, Cargo Rigs, and specialized bays (**Kryos**, **Miasmos**, **Epithal**, **Hoarder**, **Squall/Deluge/Torrent/Avalanche**, **Blockade Runners**, **DSTs**, **Orca**, **Bowhead**, and **Freighters**).
* **Prep Step 0 Detection:** Automatically flags when your selected hauler is docked in a different station and inserts a pickup step at the start of your route.

### 4. "Auto-Fill Best Loop" Knapsack Route Solver & Threat Intel
* **Automated Load & Route Optimization:** Packs the highest **Net ISK-per-Jump** combination of trades that fits 100% inside your ship's specialized + general cargo bays, liquid wallet balance, start/end hub anchors, and ISK gank-risk ceiling.
* **Live Gatecamp & Kill Feed Intel:** Cross-references every jump along your route against ESI's live system kill feed (`system_kills`) with one-click zKillboard verification links.

### 5. One-Click In-Game EVE Execution
* **EVE Multibuy Export:** Copies any station's shopping list to your clipboard in plain `<Item Name>\t<Quantity>` format for instant pasting into EVE's in-game Multibuy window.
* **In-Game Market Popups:** Triggers `POST /ui/openwindow/marketdetails/` to open any manifest item's Regional Market window directly inside your active EVE client.
* **Autopilot Waypoint Push:** Injects your complete multi-stop pickup-before-dropoff sequence directly into your EVE client's autopilot (`POST /ui/autopilot/waypoint/`).

### 6. Full Blueprint Vault & Quartermaster AI
* **Complete BPO/BPC Library:** Paginates through all `X-Pages` of your character's blueprints with ME/TE filtering, paired with an integrated **Quartermaster AI** assistant for industrial planning.

---

## Quick Start & Usage Guide

1. **Sign In with EVE SSO:** Click **Connect with EVE SSO** and authorize your character through CCP's official OAuth portal.
2. **Select Your Market Scope:** Tick any combination of the 19 market categories (or inspect exact tracked SKUs by clicking the item count badge) and run a scan.
3. **Choose Your Hull & Optimize:** Open the **Fleet Logistics & Route Optimizer** sidebar, select a hauler from your hangars, set an optional return hub or max cargo ISK cap, and click **Auto-Fill Best Loop** (or manually tick cards in the main grid).
4. **Execute In-Game:**
   * Click **Copy for EVE Multibuy** at your pickup station and paste (`Ctrl+V`) into EVE's Multibuy window.
   * Click **Push Full Loop to EVE Autopilot** to load all waypoints in sequence.
   * Use **Open in EVE** next to manifest items to pop open market windows as you dock.

---

## Local Development & Deployment

### Prerequisites
* Node.js 18+
* A registered application in the [EVE Online Developers Portal](https://developers.eveonline.com/) with your callback URL configured
* A Google Gemini API key (for Quartermaster AI features)

### Environment Variables
Configure the following secrets in your hosting environment (such as Google AI Studio Secrets or Google Cloud Run environment variables)—**never commit secrets directly to Git**:

```env
GEMINI_API_KEY=your_gemini_api_key
EVE_CLIENT_ID=your_eve_sso_client_id
