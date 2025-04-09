const fs = require('fs')
const { execSync } = require('child_process')

let version;
try {
  version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (error) {
  version = `unknown-${Date.now()}`;
  console.warn('Git commit hash unavailable, using fallback version:', version);
}

const versionData = { version };
fs.writeFileSync('public/version.json', JSON.stringify(versionData, null, 2));
console.log(`Generated version.json with version: ${version}`);