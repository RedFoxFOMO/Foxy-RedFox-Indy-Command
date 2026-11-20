/**
 * Formats an item list strictly for EVE Online's in-game Multibuy window:
 *   <Exact Item Name>\t<Plain Integer Quantity>
 *
 * - Sums quantities if the same item appears multiple times.
 * - Omits ISK prices, thousands commas, m3 volumes, bullets, and headers.
 */
export function formatEveMultibuyText(
  items: { name: string; quantity: number }[]
): { text: string; itemCount: number } {
  const aggregated = new Map<string, { name: string; quantity: number }>();

  for (const item of items) {
    const cleanName = item.name.trim();
    const qty = Math.round(Number(item.quantity));
    if (!cleanName || !Number.isFinite(qty) || qty <= 0) continue;

    const key = cleanName.toLowerCase();
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      aggregated.set(key, { name: cleanName, quantity: qty });
    }
  }

  const lines: string[] = [];
  for (const entry of aggregated.values()) {
    lines.push(`${entry.name}\t${Math.trunc(entry.quantity)}`);
  }

  return {
    text: lines.join('\n'),
    itemCount: lines.length,
  };
}

/**
 * Copies plain text to the system clipboard using the async Clipboard API
 * with a textarea fallback for embedded/iframe contexts.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  return false;
}
