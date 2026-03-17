/**
 * /api/character-delete
 * POST — permanently deletes a single character and all their related data
 *
 * Query params:
 * - name: character name to delete
 *
 * Deletes:
 * - Character from roster table
 * - All entries from ep_log table for that character
 * - All entries from gp_log table for that character
 */
import { ensureTablesExist } from '../db-init.js';
import { logEvent } from '../utils/logger.js';

export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS pre-flight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Ensure database tables exist on first use
  await ensureTablesExist(env);

  // ── POST — delete a single character ────────────────────────────
  if (request.method === 'POST') {
    try {
      const url = new URL(request.url);
      const characterName = url.searchParams.get('name');

      if (!characterName || characterName.trim() === '') {
        return new Response(
          JSON.stringify({ error: 'Character name is required' }),
          { status: 400, headers }
        );
      }

      let deletedCounts = {};

      const statements = [
        env.DB.prepare('DELETE FROM ep_log WHERE name = ?').bind(characterName),
        env.DB.prepare('DELETE FROM gp_log WHERE name = ?').bind(characterName),
        env.DB.prepare('DELETE FROM signups WHERE character_name = ?').bind(characterName),
        env.DB.prepare('DELETE FROM attendance WHERE name = ?').bind(characterName),
        env.DB.prepare('DELETE FROM loot_history WHERE name = ?').bind(characterName),
        env.DB.prepare('DELETE FROM roster WHERE name = ?').bind(characterName)
      ];

      // Execute as batch
      const results = await env.DB.batch(statements);
      
      deletedCounts.ep_log = results[0].meta.changes ?? 0;
      deletedCounts.gp_log = results[1].meta.changes ?? 0;
      deletedCounts.signups = results[2].meta.changes ?? 0;
      deletedCounts.attendance = results[3].meta.changes ?? 0;
      deletedCounts.loot_history = results[4].meta.changes ?? 0;
      deletedCounts.roster = results[5].meta.changes ?? 0;

      // Log the character deletion
      await logEvent(env, 'warning', 'Admin', `Permanently deleted character "${characterName}" (${deletedCounts.ep_log + deletedCounts.gp_log} EP/GP logs)`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `✓ Character "${characterName}" and all related data permanently deleted`,
          deleted: deletedCounts,
        }),
        { headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err.message
        }),
        { status: 500, headers }
      );
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
