const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'client')) &&
      fs.existsSync(path.join(dir, 'server'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

const root = findRepoRoot(process.cwd());
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const server = spawn(npmCmd, ['--prefix', path.join(root, 'server'), 'run', 'dev'], {
  stdio: 'inherit'
});

const client = spawn(
  npmCmd,
  ['--prefix', path.join(root, 'client'), 'run', 'start', '--', '--port', '4201'],
  { stdio: 'inherit' }
);

const shutdown = (code) => {
  if (!server.killed) server.kill();
  if (!client.killed) client.kill();
  process.exit(code ?? 0);
};

server.on('exit', (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

client.on('exit', (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
