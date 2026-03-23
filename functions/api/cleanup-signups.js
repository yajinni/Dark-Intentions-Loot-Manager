/**
 * TEMPORARY: One-time cleanup endpoint.
 * DELETE ALL signup records dated 2026-04-01 or later.
 * This file will be removed after the cleanup is complete.
 */
export async function onRequest({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const result = await env.DB.prepare(
      "DELETE FROM signups WHERE date >= '2026-04-01'"
    ).run();

    return new Response(
      JSON.stringify({
        success: true,
        message: `Deleted all signup records dated 2026-04-01 or later.`,
        changes: result.meta?.changes ?? 'unknown',
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers }
    );
  }
}
