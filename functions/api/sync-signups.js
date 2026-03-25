import { ensureTablesExist } from '../db-init.js';
import { logEvent } from '../utils/logger.js';

export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  await ensureTablesExist(env);

  // Allow GET and POST for cron/testing flexibility
  if (request.method === 'POST' || request.method === 'GET') {
    try {
      // Get keys from settings
      const { results: settingsRows } = await env.DB
        .prepare("SELECT key, value FROM settings WHERE key IN ('wowaudit_api_key', 'signup_ep', 'signup_reason')")
        .all();

      const settings = {};
      settingsRows.forEach(row => settings[row.key] = row.value);
      
      const apiKey = settings.wowaudit_api_key;
      const signupEp = parseInt(settings.signup_ep, 10) || 1;
      const signupReason = settings.signup_reason || 'On Time';

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: 'WoWAudit API key not configured' }),
          { status: 400, headers }
        );
      }

      // Fetch upcoming raids from WoWAudit
      const wowauditUrl = `https://wowaudit.com/v1/raids?include_past=false`;
      const raidResponse = await fetch(wowauditUrl, {
        headers: {
          'accept': 'application/json',
          'Authorization': apiKey,
        },
      });

      if (!raidResponse.ok) {
        let errorDetail = '';
        try {
          const errData = await raidResponse.json();
          errorDetail = errData.message || errData.error || '';
        } catch (e) {
          errorDetail = await raidResponse.text();
        }
        return new Response(
          JSON.stringify({ error: `WoWAudit API error: ${raidResponse.status}${errorDetail ? ' - ' + errorDetail : ''}` }),
          { status: 400, headers }
        );
      }

      const data = await raidResponse.json();
      const raids = data.raids || [];

      if (raids.length === 0) {
        await logEvent(env, 'info', 'API', 'Synced Signups: No upcoming raids found.');
        return new Response(
          JSON.stringify({ success: true, message: 'No upcoming raids found', inserted: 0 }),
          { status: 200, headers }
        );
      }

      // ONLY process the first raid (the next upcoming one)
      const raid = raids[0];
      const raidId = raid.id;
      let raidDate = raid.date;

      // Store current raid ID in settings so the signups API can filter by it
      await env.DB.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('current_raid_id', ?)`
      ).bind(String(raidId)).run();

      let insertedCount = 0;
      let bonusesAwarded = 0;
      const rewardedNames = [];

      // Fetch detailed raid info to get signups
      const detailUrl = `https://wowaudit.com/v1/raids/${raidId}`;
      const detailRes = await fetch(detailUrl, {
        headers: { 'accept': 'application/json', 'Authorization': apiKey }
      });
      
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        const signups = detailData.signups || [];
        raidDate = detailData.date || raidDate;

        for (const signup of signups) {
          const character = signup.character;
          if (!character || !character.name) continue;
          
          const status = signup.status || 'Unknown';

          // Insert or get existing signup
          let epAwarded = 0;
          try {
            const existing = await env.DB.prepare(
              `SELECT ep_awarded FROM signups WHERE raid_id = ? AND character_name = ?`
            ).bind(raidId, character.name).first();

            if (existing) {
              epAwarded = existing.ep_awarded;
              // Update status
              await env.DB.prepare(
                `UPDATE signups SET status = ?, date = ?, class = ? WHERE raid_id = ? AND character_name = ?`
              ).bind(status, raidDate, character.class, raidId, character.name).run();
            } else {
              // Insert new
              await env.DB.prepare(
                `INSERT INTO signups (raid_id, date, character_name, class, status, ep_awarded) VALUES (?, ?, ?, ?, ?, 0)`
              ).bind(raidId, raidDate, character.name, character.class, status).run();
            }
            insertedCount++;

            // Award EP Bonus if status is not 'Unknown', and ep has not been awarded yet.
            if (status !== 'Unknown' && epAwarded === 0) {
              const rosterChar = await env.DB.prepare(
                `SELECT id FROM roster WHERE name = ?`
              ).bind(character.name).first();

              if (rosterChar) {
                const reason = `${signupReason} [${raidDate.split('T')[0]}]`;
                
                await env.DB.prepare(
                  `INSERT INTO ep_log (name, ep, reason, timestamp) VALUES (?, ?, ?, datetime('now'))`
                ).bind(character.name, signupEp, reason).run();

                // Mark EP as awarded for this signup
                await env.DB.prepare(
                  `UPDATE signups SET ep_awarded = ? WHERE raid_id = ? AND character_name = ?`
                ).bind(signupEp, raidId, character.name).run();
                
                bonusesAwarded++;
                rewardedNames.push(character.name);
              }
            }
          } catch (err) {
            console.error(`Error processing signup for ${character.name}:`, err);
          }
        }
      }

      
      // Implement 30 day data retention cleanup policy
      try {
        await env.DB.prepare("DELETE FROM system_logs WHERE timestamp < datetime('now', '-30 days')").run();
        console.log('[Maintenance] Cleaned up system_logs older than 30 days');
      } catch(e) {
        console.error('Failed to prune system_logs:', e);
      }

      // Delete any future raid signups beyond the current next raid (user does not want future data)
      try {
        await env.DB.prepare(
          "DELETE FROM signups WHERE date > ? AND raid_id != ?"
        ).bind(raidDate, String(raidId)).run();
        console.log('[Maintenance] Cleaned up future signup records beyond next raid');
      } catch(e) {
        console.error('Failed to prune future signups:', e);
      }

      const msg = `✓ Updated ${insertedCount} signups. Awarded ${bonusesAwarded} Early Sign Up Bonuses!`;
      const logMsg = `Awarded ${signupEp} EP to ${bonusesAwarded} characters (Reason: ${signupReason})`;
      await logEvent(env, 'success', 'Roster', logMsg, { names: rewardedNames, inserted: insertedCount, bonuses: bonusesAwarded });
      
      // Update last_pr_sync to trigger DI Monitor if any points were awarded
      if (bonusesAwarded > 0) {
        await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'last_pr_sync'").bind(new Date().toISOString()).run();
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: msg,
          inserted: insertedCount,
          bonuses: bonusesAwarded
        }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error('Signups sync error:', err);
      await logEvent(env, 'error', 'API', `Signups sync failed: ${err.message}`);
      return new Response(
        JSON.stringify({ error: err.message || 'Failed to sync signups' }),
        { status: 500, headers }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { status: 405, headers }
  );
}
