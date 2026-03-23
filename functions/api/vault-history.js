/**
 * /api/vault-history
 * GET — fetch grouped vault history from historical_activity table
 */
import { ensureTablesExist } from '../db-init.js';

export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  await ensureTablesExist(env);

  if (request.method === 'GET') {
    try {
      // 1. Get minimum vault level from settings
      const minVaultLevelSetting = await env.DB
        .prepare("SELECT value FROM settings WHERE key = 'min_vault_level'")
        .first();
      const minVaultLevel = parseInt(minVaultLevelSetting?.value, 10) || 272;

      // 2. Fetch all historical activity sorted by period_id DESC
      const { results } = await env.DB
        .prepare("SELECT period_id, data FROM historical_activity ORDER BY period_id DESC")
        .all();

      const raidWeeks = results.map(row => {
        const data = JSON.parse(row.data);
        const characters = data.characters || [];
        
        // Extract start_date if available in the historical_data blob
        // Note: WoWAudit historical_data usually includes period info
        const startDate = data.period?.start_date || `Period ${row.period_id}`;

        const groups = {
          no_vault: [],
          vault_1: [],
          vault_2: [],
          vault_3: []
        };

        characters.forEach(char => {
          const dungeons = char.data?.vault_options?.dungeons || {};
          let slotsFilled = 0;
          
          if (dungeons.option_1 >= minVaultLevel) slotsFilled++;
          if (dungeons.option_2 >= minVaultLevel) slotsFilled++;
          if (dungeons.option_3 >= minVaultLevel) slotsFilled++;

          if (slotsFilled === 0) groups.no_vault.push(char.name);
          else if (slotsFilled === 1) groups.vault_1.push(char.name);
          else if (slotsFilled === 2) groups.vault_2.push(char.name);
          else if (slotsFilled === 3) groups.vault_3.push(char.name);
        });

        // Sort names alphabetically
        Object.keys(groups).forEach(key => groups[key].sort());

        return {
          period_id: row.period_id,
          date: startDate,
          groups
        };
      });

      return new Response(JSON.stringify({
        success: true,
        raid_weeks: raidWeeks
      }), { headers });

    } catch (err) {
      console.error('Vault history API error:', err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
