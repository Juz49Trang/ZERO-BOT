// Setup script to create the proper directory structure
const fs = require('fs');
const path = require('path');

// Create directories
const dirs = [
  'src',
  'src/config',
  'src/services',
  'src/types',
  'src/utils'
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

console.log('✅ Directory structure created successfully!');
console.log('\nNext steps:');
console.log('1. Copy all the TypeScript files to their respective directories');
console.log('2. Copy .env.example to .env and add your configuration');
console.log('3. Run: npm install');
console.log('4. Run: npm run build');
console.log('5. Run: npm start');