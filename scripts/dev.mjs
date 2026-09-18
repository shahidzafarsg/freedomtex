// Starts the Vite dev server and launches Electron against it.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const server = await createServer({ configFile: 'vite.config.mjs' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] renderer at ${url}`);

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
