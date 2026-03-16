const crypto = require('crypto');
const hash = crypto.createHash('sha256').update('ewjnamewj').digest('hex');
const sql = `INSERT INTO users (username, password_hash, is_admin) VALUES ('Yajinni', '${hash}', 1);`;

const fs = require('fs');
fs.writeFileSync('seed_admin.sql', sql);
console.log('Created seed_admin.sql');
