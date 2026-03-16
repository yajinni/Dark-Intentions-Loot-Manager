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

    const { oldName, newName, newRealm } = await request.json();

    if (!oldName || !newName) {
      return new Response(JSON.stringify({ error: 'Current name and new name are required' }), { status: 400, headers });
    }

    // Start a transaction-like sequence (Cloudflare D1 batch)
    // 1. Update Roster
    // 2. Update EP Log
    // 3. Update GP Log
    // 4. Update Signups
    
    const statements = [
      // Update roster
      env.DB.prepare("UPDATE roster SET name = ?, realm = ?, last_updated = datetime('now') WHERE name = ?")
        .bind(newName, newRealm || null, oldName),
      
      // Update EP logs
      env.DB.prepare("UPDATE ep_log SET name = ? WHERE name = ?")
        .bind(newName, oldName),
      
      // Update GP logs
      env.DB.prepare("UPDATE gp_log SET name = ? WHERE name = ?")
        .bind(newName, oldName),
      
      // Update Signups
      env.DB.prepare("UPDATE signups SET character_name = ? WHERE character_name = ?")
        .bind(newName, oldName)
    ];

    await env.DB.batch(statements);

    await logEvent(env, 'info', 'Admin', `Character renamed from "${oldName}" to "${newName}" (${newRealm || 'no realm change'}).`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Successfully renamed ${oldName} to ${newName}` 
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
