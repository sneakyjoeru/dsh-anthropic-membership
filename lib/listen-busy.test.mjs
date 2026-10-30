// 2026-10-30: reinstalling this plugin while it was live made the new instance race the old one for
// :8185. The EADDRINUSE 'error' event had no listener, so node turned it into an uncaught exception
// and the whole dsh process exited under two running chats. apply() must survive a busy port.
import { createServer } from 'node:http';

const PORT = 8199;                       // deliberately not 8185: the live plugin owns that here
process.env.DSH_MEMBERSHIP_PORT = String(PORT);
process.env.DSH_MEMBERSHIP_BIND = '127.0.0.1';

const blocker = createServer(() => {});
await new Promise((resolve) => blocker.listen(PORT, '127.0.0.1', resolve));

const mod = await import('./index.js');
mod.apply({ inject: () => () => {}, on: () => () => {}, get: () => undefined });
await new Promise((resolve) => setTimeout(resolve, 400));   // a crash would land here

blocker.close();
await new Promise((resolve) => setTimeout(resolve, 1200));  // retry loop keeps running
console.log('listen-busy: apply() survived a busy port (retrying, never threw)');
process.exit(0);
