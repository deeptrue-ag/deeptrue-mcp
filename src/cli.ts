import { loadConfig } from './config.js';
import { startHttpServer } from './transports/http.js';
import { startStdioServer } from './transports/stdio.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args[0] === 'serve') {
    const portIdx = args.indexOf('--port');
    if (portIdx >= 0 && args[portIdx + 1]) {
      config.port = Number(args[portIdx + 1]);
    }
    await startHttpServer(config);
    return;
  }

  await startStdioServer(config);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
