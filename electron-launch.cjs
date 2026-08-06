const { spawn } = require('node:child_process');

const electronBinary = require('electron');
const appDir = __dirname;
const extraArgs = process.argv.slice(2);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

env.ELECTRON_NO_ATTACH_CONSOLE = env.ELECTRON_NO_ATTACH_CONSOLE || '1';

const child = spawn(electronBinary, [appDir, ...extraArgs], {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
