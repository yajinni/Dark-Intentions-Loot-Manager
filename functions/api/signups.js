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
      // Get current raid ID from settings
      const raidSetting = await env.DB.prepare(
        `SELECT value FROM settings WHERE key = 'current_raid_id'`
      ).first();

      let records;
      if (raidSetting?.value) {
        // Only return signups for the current next raid
        records = await env.DB.prepare(
          `SELECT * FROM signups WHERE raid_id = ? ORDER BY character_name ASC`
        ).bind(raidSetting.value).all();
      } else {
        // Fallback: return the most recent raid's signups
        records = await env.DB.prepare(
          `SELECT * FROM signups ORDER BY date DESC, character_name ASC LIMIT 100`
        ).all();
      }

      return new Response(
        JSON.stringify({
          success: true,
          signups: records.results || [],
        }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error('Signups fetch error:', err);
      return new Response(
        JSON.stringify({ error: err.message || 'Failed to fetch signups' }),
        { status: 500, headers }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { status: 405, headers }
  );
}
