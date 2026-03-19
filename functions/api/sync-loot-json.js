import { ensureTablesExist } from '../db-init.js';
import { logEvent } from '../utils/logger.js';

export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });
  }

  await ensureTablesExist(env);

  try {
    const rawData = await request.json();
    
    // The JSON structure is: { "Player-Realm": [ { item1 }, { item2 } ], ... }
    if (!rawData || typeof rawData !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid JSON format. Expected an object with character keys.' }), { status: 400, headers });
    }

    // 1. Fetch Roster to map "Player-Realm" to character_id and name
    const { results: rosterRows } = await env.DB.prepare("SELECT character_id, name, realm FROM roster").all();
    const characterMap = new Map(); // Key: "name-realm" (normalized), Value: { id, name }
    for (const row of rosterRows) {
      const key = `${row.name}-${row.realm}`.toLowerCase();
      characterMap.set(key, { id: row.character_id, name: row.name });
    }

    // 2. Fetch Gear Values for GP mapping
    const { results: gearRows } = await env.DB.prepare("SELECT slot_name, point_value FROM epgp_gear_values").all();
    const gearMap = new Map();
    for (const row of gearRows) {
      gearMap.set(row.slot_name.toLowerCase(), row.point_value);
    }

    // 3. Fetch existing RCLootCouncil IDs to avoid duplicates
    const { results: existingLoot } = await env.DB.prepare("SELECT rclootcouncil_id FROM loot_history").all();
    const existingIds = new Set(existingLoot.map(l => l.rclootcouncil_id));

    let insertedCount = 0;
    let gpAwardedCount = 0;
    const now = new Date().toISOString();
    const errors = [];

    // 4. Process the data
    const batchStatements = [];
    const gpStatements = [];

    for (const [charKey, items] of Object.entries(rawData)) {
      if (!Array.isArray(items)) continue;

      const charInfo = characterMap.get(charKey.toLowerCase());
      
      for (const item of items) {
        // Map RCLootCouncil fields
        // Note: RCLC doesn't always have a single 'id', so we construct a unique one if missing
        const rclcId = item.id || item.lootCouncilID || `${charKey}-${item.itemID || item.itemID}-${item.date}-${item.time}`;
        
        if (existingIds.has(rclcId)) continue;
        
        // Skip Normal difficulty if specified (RCLC usually has 'difficulty' field)
        const difficulty = item.difficulty || item.difficultyID || '';
        if (typeof difficulty === 'string' && difficulty.toLowerCase() === 'normal') {
          continue;
        }

        try {
          // Normalize fields
          const itemName = item.itemName || 'Unknown Item';
          const itemId = item.itemID || 0;
          const itemIcon = item.itemIcon || '';
          const itemSlot = item.itemSlot || '';
          const itemQuality = item.itemQuality || '';
          const instance = item.instance || item.zone || '';
          const boss = item.boss || item.encounter || '';
          const response = item.response || '';
          const discarded = item.isDiscarded || false;
          
          // Parse date/time (Format: MM/DD/YY and HH:MM:SS)
          let awardedAt = '';
          if (item.date && item.time) {
             // Standardize MM/DD/YY HH:MM:SS to something ISO-ish if possible
             // But we'll just store the string for now or convert to 20YY-MM-DD
             const [m, d, y] = item.date.split('/');
             const year = y && y.length === 2 ? `20${y}` : y;
             awardedAt = `${year}-${m}-${d} ${item.time}`;
          }

          // GP Award
          const slotKey = itemSlot.toLowerCase();
          const gpAmount = gearMap.get(slotKey) || 0;

          if (charInfo && gpAmount > 0) {
            gpStatements.push(
              env.DB.prepare(`
                INSERT INTO gp_log (name, gp, reason, timestamp)
                VALUES (?, ?, ?, ?)
              `).bind(charInfo.name, gpAmount, `Awarded ${itemName} (Loot History)`, now)
            );
            gpAwardedCount++;
          }

          batchStatements.push(
            env.DB.prepare(`
              INSERT OR REPLACE INTO loot_history (
                rclootcouncil_id, item_id, name, icon, slot, quality, 
                character_id, awarded_by_name, awarded_at, 
                difficulty, instance, boss, discarded, response_type
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              rclcId,
              itemId,
              itemName,
              itemIcon,
              itemSlot,
              itemQuality,
              charInfo ? charInfo.id : 0,
              item.awardedBy || '',
              awardedAt,
              difficulty,
              instance,
              boss,
              discarded ? 1 : 0,
              response
            )
          );
          insertedCount++;
          existingIds.add(rclcId); // Avoid duplicate in the same batch
        } catch (e) {
          errors.push(`Error processing item ${itemId} for ${charKey}: ${e.message}`);
        }
      }
    }

    // 5. Execute Batch
    if (batchStatements.length > 0) {
      await env.DB.batch([...gpStatements, ...batchStatements]);
    }

    await logEvent(env, 'success', 'Loot', `Imported ${insertedCount} loot items from JSON file (${gpAwardedCount} GP awards)`, { insertedCount, gpAwardedCount, errors });

    return new Response(JSON.stringify({
      success: true,
      message: `✓ Successfully imported ${insertedCount} loot items and awarded GP for ${gpAwardedCount} items.`,
      inserted: insertedCount,
      gpAwarded: gpAwardedCount,
      errors: errors.length > 0 ? errors : null
    }), { headers });

  } catch (err) {
    await logEvent(env, 'error', 'API', `JSON Loot Import failed: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
