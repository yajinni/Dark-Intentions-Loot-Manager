const sqlite3 = require('sqlite3').verbose();
const dbFile = 'c:\\Users\\Yajinni\\Documents\\Coding Projects\\Dark Intentions\\Dark-Intentions-Loot-Manager\\.wrangler\\state\\v3\\d1\\miniflare-D1DatabaseObject\\e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite';

const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  console.log('--- Table: loot_history ---');
  db.each("PRAGMA table_info(loot_history)", (err, row) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(row.name + ' (' + row.type + ')');
  });

  console.log('\n--- Recent Logs ---');
  db.each("SELECT * FROM system_logs ORDER BY id DESC LIMIT 5", (err, row) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(`[${row.timestamp}] ${row.level} ${row.category}: ${row.message}`);
    if (row.details) console.log(`  Details: ${row.details}`);
  });
});

db.close();
