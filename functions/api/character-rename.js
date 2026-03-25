import { ensureTablesExist } from '../db-init.js';
import { getUserFromSession } from '../utils/auth.js';
import { logEvent } from '../utils/logger.js';

export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  await ensureTablesExist(env);

  try {
    const user = await getUserFromSession(request, env);
    if (!user || user.is_admin !== 1) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const { oldName, newName } = await request.json();

    if (!oldName || !newName) {
      return new Response(JSON.stringify({ error: 'Source (orphan) and target (roster) names are required' }), { status: 400, headers });
    }

    // 1. Fetch and update historical_activity JSON data (Vault history)
    const { results: activityRows } = await env.DB.prepare("SELECT period_id, data FROM historical_activity").all();
    const historyStatements = [];
    
    for (const row of activityRows || []) {
      const data = JSON.parse(row.data);
      let changed = false;
      if (data.characters && Array.isArray(data.characters)) {
        for (const char of data.characters) {
          if (char.name === oldName) {
            char.name = newName;
            changed = true;
          }
        }
      }
      if (changed) {
        historyStatements.push(
          env.DB.prepare("UPDATE historical_activity SET data = ? WHERE period_id = ?")
            .bind(JSON.stringify(data), row.period_id)
        );
      }
    }

    // 2. Standard table updates
    const statements = [
      // Update EP logs
      env.DB.prepare("UPDATE ep_log SET name = ? WHERE name = ?")
        .bind(newName, oldName),
      
      // Update GP logs
      env.DB.prepare("UPDATE gp_log SET name = ? WHERE name = ?")
        .bind(newName, oldName),
      
      // Update Signups
      env.DB.prepare("UPDATE signups SET character_name = ? WHERE character_name = ?")
        .bind(newName, oldName),
      
      // Update Attendance
      env.DB.prepare("UPDATE attendance SET name = ? WHERE name = ?")
        .bind(newName, oldName),

      // Update Loot History
      env.DB.prepare("UPDATE loot_history SET character_name = ? WHERE character_name = ?")
        .bind(newName, oldName),

      // NEW: Cleanup old roster entry if it exists as an orphan
      env.DB.prepare("DELETE FROM roster WHERE name = ?")
        .bind(oldName),

      // Add all JSON updates to the batch
      ...historyStatements
    ];

    const batchResults = await env.DB.batch(statements);

    const epChanges      = batchResults[0]?.meta?.changes ?? 0;
    const gpChanges      = batchResults[1]?.meta?.changes ?? 0;
    const signupChanges  = batchResults[2]?.meta?.changes ?? 0;
    const attendChanges  = batchResults[3]?.meta?.changes ?? 0;
    const lootChanges    = batchResults[4]?.meta?.changes ?? 0;
    const rosterDeleted  = batchResults[5]?.meta?.changes ?? 0;
    const historyUpdated = historyStatements.length;

    await logEvent(env, 'info', 'Admin', `Merged "${oldName}" into "${newName}" (${epChanges} EP, ${gpChanges} GP, ${signupChanges} signups, ${attendChanges} attendance, ${lootChanges} loot, ${historyUpdated} vault weeks, ${rosterDeleted} roster cleanup).`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Successfully merged ${oldName}'s history into ${newName}` 
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
