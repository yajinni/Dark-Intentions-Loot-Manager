/**
 * /api/roster-delete
 * POST — permanently deletes all roster data and related logs
 *
 * Deletes:
 * - All characters from roster table
 * - All entries from ep_log table
 * - All entries from gp_log table
 */
import { ensureTablesExist } from '../db-init.js';
import { logEvent } from '../utils/logger.js';

export async function onRequest({ request, env }) {
  const headers = { 'Content-Type': 'application/json' };

  // Ensure database tables exist on first use
  await ensureTablesExist(env);

  // ── POST — delete all roster data ────────────────────────────
  if (request.method === 'POST') {
    try {
      const tablesToClear = [
        'roster',
        'ep_log',
        'gp_log',
        'signups',
        'attendance',
        'loot_history',
        'historical_activity',
        'wowaudit_period'
      ];

      const statements = tablesToClear.map(table => env.DB.prepare(`DELETE FROM ${table}`));
      await env.DB.batch(statements);

      // Log the mass deletion
      await logEvent(env, 'warning', 'Admin', `Permanently deleted entire roster and all related logs (signups, attendance, loot, vault data)`);

      return new Response(
        JSON.stringify({
          success: true,
          message: '✓ Roster and all related data (Sign Ups, On Time, Loot, Vault) permanently deleted',
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
