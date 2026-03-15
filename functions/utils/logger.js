export async function logEvent(env, level, category, message, details = null) {
  try {
    // Check if logging is enabled (defaults to false)
    const { results } = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'enable_logging'"
    ).all();
    
    // Default to false if not strictly 'true'
    if (!results || results.length === 0 || results[0].value !== 'true') {
      // Logging disabled, skip DB insertion
      return;
    }

    const timestamp = new Date().toISOString();
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    
    await env.DB.prepare(
      `INSERT INTO system_logs (timestamp, level, category, message, details) VALUES (?, ?, ?, ?, ?)`
    ).bind(timestamp, level, category, message, detailsStr).run();
    
    console.log(`[${category}] ${level.toUpperCase()}: ${message}`);
  } catch (err) {
    console.error(`Failed to write to system_logs:`, err);
  }
}
