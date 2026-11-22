// Entry point: node src/index.js   (development: npm run dev, see dev.env)
import { config } from './config.js';
import { TiltPiApp } from './app.js';
import { createServer } from './http/server.js';

async function createScanner() {
  if (config.scanner === 'mock') {
    const { MockScanner } = await import('./ble/mockScanner.js');
    return new MockScanner();
  }
  if (config.scanner === 'none') return undefined;
  const { NobleScanner } = await import('./ble/nobleScanner.js');
  return new NobleScanner();
}

const app = new TiltPiApp(config, { scanner: await createScanner() });
await app.start();
const server = createServer(app, config);
server.listen(config.port, () => {
  console.log(`Tilt Pi listening on http://localhost:${config.port}/ui (data: ${config.dataDir}, scanner: ${config.scanner}${config.dryRun ? ', dry-run' : ''})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    app.stop();
    server.close();
    process.exit(0);
  });
}
