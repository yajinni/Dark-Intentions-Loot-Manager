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
      const records = await env.DB.prepare(
        `SELECT * FROM signups ORDER BY date DESC, character_name ASC`
      ).all();

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
