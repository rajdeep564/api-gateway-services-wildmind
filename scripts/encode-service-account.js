const fs = require('fs');
const path = require('path');

// Usage:
//   node scripts/encode-service-account.js [path/to/service-account.json] [--env]
// Defaults to ../src/config/credentials/service-account.json if no path is provided

const userPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const wantEnvLine = process.argv.includes('--env');

const defaultPath = path.resolve(__dirname, '../src/config/credentials/service-account.json');
const filePath = userPath ? path.resolve(process.cwd(), userPath) : defaultPath;

try {
  const fileBuffer = fs.readFileSync(filePath);
  const base64 = Buffer.from(fileBuffer).toString('base64');
  const output = wantEnvLine ? `FIREBASE_SERVICE_ACCOUNT_B64=${base64}` : base64;
  process.stdout.write(output + '\n');
} catch (err) {
  console.error(`Failed to read file at ${filePath}: ${err.message}`);
  process.exit(1);
}


