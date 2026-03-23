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

      // 2. Get current period anchor from wowaudit_period
      const periodRow = await env.DB.prepare("SELECT data FROM wowaudit_period ORDER BY id DESC LIMIT 1").first();
      let anchor = null;
      if (periodRow) {
        const pData = JSON.parse(periodRow.data);
        if (pData.current_season) {
          anchor = {
            id: pData.current_season.id,
            date: new Date(pData.current_season.start_date)
          };
        }
      }

      // 3. Fetch all historical activity sorted by period_id DESC
      const { results } = await env.DB
        .prepare("SELECT period_id, data FROM historical_activity ORDER BY period_id DESC")
        .all();

      // 4. Get class mapping from roster for color coding
      const rosterRows = await env.DB.prepare("SELECT name, class FROM roster").all();
      const nameToClass = {};
      (rosterRows.results || []).forEach(r => nameToClass[r.name] = r.class);

      const raidWeeks = results.map(row => {
        const data = JSON.parse(row.data);
        const characters = data.characters || [];
        
        let displayDate = `Period ${row.period_id}`;
        
        // Calculate date: anchor is the current week's Tuesday start.
        // diffWeeks = 0 means current period, 1 = one week ago, etc.
        // Add 7 days so we show the Tuesday that STARTED the week being checked.
        if (anchor) {
          const diffWeeks = anchor.id - row.period_id;
          const weekDate = new Date(anchor.date);
          weekDate.setDate(weekDate.getDate() - (diffWeeks * 7) + 7);
          displayDate = weekDate.toISOString().split('T')[0];
        }

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

          const charObj = { 
            name: char.name, 
            class: nameToClass[char.name] || char.class || 'Unknown' 
          };

          if (slotsFilled === 0) groups.no_vault.push(charObj);
          else if (slotsFilled === 1) groups.vault_1.push(charObj);
          else if (slotsFilled === 2) groups.vault_2.push(charObj);
          else if (slotsFilled === 3) groups.vault_3.push(charObj);
        });

        // Sort names alphabetically
        Object.keys(groups).forEach(key => {
          groups[key].sort((a, b) => a.name.localeCompare(b.name));
        });

        return {
          period_id: row.period_id,
          date: displayDate,
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
