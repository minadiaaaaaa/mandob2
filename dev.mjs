// Runs the API (port 4000) and the web dev server (port 5173, proxying /api) together.
import { spawn } from 'node:child_process';
const run = (dir, script) => spawn('pnpm', ['-C', dir, script], { stdio: 'inherit', shell: true });
const procs = [run('server', 'dev'), run('web', 'dev')];
process.on('SIGINT', () => { procs.forEach((p) => p.kill()); process.exit(); });
