const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'coi-serviceworker', 'coi-serviceworker.min.js');
const dest = path.join(__dirname, '..', 'public', 'coi-serviceworker.min.js');

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log('Copied coi-serviceworker.min.js to public/');
} else {
  console.warn('coi-serviceworker not found, skipping copy');
}
