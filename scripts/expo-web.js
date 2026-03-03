const { spawn } = require('child_process');
const path = require('path');

const mobileDir = path.join(__dirname, '..', 'apps', 'mobile');
const expo = spawn('npx', ['expo', 'start', '--web', '--port', '8081'], {
  cwd: mobileDir,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    CI: '1',
    EXPO_NO_INTERACTIVITY: '1',
    TERM: 'dumb',
  },
});

expo.stdout.pipe(process.stdout);
expo.stderr.pipe(process.stderr);

expo.on('close', (code) => process.exit(code));
