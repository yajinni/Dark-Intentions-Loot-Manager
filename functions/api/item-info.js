/**
 * /api/item-info
 * GET — fetch item information (name, icon, etc.) from WoWhead
 */

// Cache item information to avoid repeated requests
const itemCache = {};
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS pre-flight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // GET — fetch item information
  if (request.method === 'GET') {
    try {
      const url = new URL(request.url);
      const itemId = url.searchParams.get('id');

      if (!itemId || isNaN(parseInt(itemId))) {
        return new Response(
          JSON.stringify({ error: 'Valid item ID required' }),
          { status: 400, headers }
        );
      }

      // Check cache first
      if (itemCache[itemId] && Date.now() - itemCache[itemId].timestamp < CACHE_DURATION) {
        return new Response(
          JSON.stringify(itemCache[itemId].data),
          { headers }
        );
      }

      // Fetch from WoWhead
      const wowheadUrl = `https://www.wowhead.com/item=${itemId}`;
      const response = await fetch(wowheadUrl);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: 'Item not found' }),
          { status: 404, headers }
        );
      }

      const html = await response.text();

      // Extract item name from the page
      // Try multiple patterns to find the item name
      let itemName = null;

      // Pattern 1: Look for the page title
      const titleMatch = html.match(/<title>([^-<]+)/);
      if (titleMatch) {
        itemName = titleMatch[1].trim();
      }

      // Pattern 2: Look for h1 with data attribute or class
      if (!itemName) {
        const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        if (h1Match) {
          itemName = h1Match[1].trim();
        }
      }

      // Pattern 3: Look for script tag with item name data
      if (!itemName) {
        const scriptMatch = html.match(/"name":"([^"]+)"/);
        if (scriptMatch) {
          itemName = scriptMatch[1];
        }
      }

      // If we couldn't extract a name, return item ID as fallback
      if (!itemName) {
        itemName = `Item ${itemId}`;
      }

      // Remove any extra text (e.g., " - Wowhead" from title)
      itemName = itemName.replace(/\s*-\s*Wowhead.*$/i, '').trim();

      const itemData = {
        id: itemId,
        name: itemName,
      };

      // Cache the result
      itemCache[itemId] = {
        data: itemData,
        timestamp: Date.now(),
      };

      return new Response(
        JSON.stringify(itemData),
        { headers }
      );
    } catch (err) {
      console.error('Error fetching item info:', err);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch item information' }),
        { status: 500, headers }
      );
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
