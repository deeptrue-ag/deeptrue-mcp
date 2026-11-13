#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'cli.js');
const src = join(root, 'src', 'cli.ts');

if (existsSync(dist)) {
  await import(pathToFileURL(dist).href);
} else {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', src, ...process.argv.slice(2)],
    { stdio: 'inherit', cwd: root, env: process.env },
  );
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}
