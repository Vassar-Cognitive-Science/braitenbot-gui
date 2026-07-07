import { createRelayServer } from './server.js';

// Entry point: `node relay/dist/index.js` or `tsx relay/src/index.ts`.
// Port comes from the RELAY_PORT (or PORT) env var, default 1234.
const port = Number(process.env.RELAY_PORT ?? process.env.PORT ?? 1234);
const host = process.env.RELAY_HOST;
// Set RELAY_TRUST_PROXY=1 only when a reverse proxy in front of the relay
// overwrites X-Forwarded-For; see RelayOptions.trustProxy.
const trustProxy = process.env.RELAY_TRUST_PROXY === '1';

// Last-resort guards: a stray exception from one connection must never take
// down every room on the relay. Per-message handlers already catch; this
// covers anything that slips through.
process.on('uncaughtException', (err) => {
  console.error('[relay] uncaught exception (continuing):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[relay] unhandled rejection (continuing):', reason);
});

createRelayServer({ port, host, trustProxy })
  .then((relay) => {
    console.log(`[relay] Braitenbot collaboration relay listening on port ${relay.port}`);
    const shutdown = () => {
      relay.close().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('[relay] failed to start:', err);
    process.exit(1);
  });
