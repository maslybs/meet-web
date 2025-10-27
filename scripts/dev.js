#!/usr/bin/env node

const { spawn } = require('child_process');

const processes = [];

function runScript(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });

  processes.push({ name, child });

  child.on('exit', (code, signal) => {
    processes
      .filter((proc) => proc.child !== child)
      .forEach((proc) => {
        if (!proc.child.killed) {
          proc.child.kill('SIGINT');
        }
      });

    if (signal !== 'SIGINT' && signal !== 'SIGTERM') {
      process.exitCode = code ?? 0;
    }
  });
}

function shutdown() {
  processes.forEach(({ child }) => {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  });
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

runScript('vite', 'npm', ['run', 'dev:client']);

setTimeout(() => {
  runScript('wrangler', 'npm', ['run', 'dev:server'], { WRANGLER_LOG: 'none' });
}, 500);
