import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, isInstalled, setting } from './db.js';
import { errorHandler } from './http.js';
import { upgrade } from './seed.js';
import { authenticate } from './auth.js';
import { attachmentsRouter } from './files.js';
import { scansRouter } from './scans.js';
import { setupRouter } from './routes/setup.js';
import { accountRouter, publicRouter } from './routes/account.js';
import { accessRouter } from './routes/access.js';
import { companiesRouter } from './routes/companies.js';
import { ridersRouter } from './routes/riders.js';
import { applicantsRouter } from './routes/applicants.js';
import { fleetRouter } from './routes/fleet.js';
import { fleet2Router } from './routes/fleet2.js';
import { systemRouter } from './routes/system.js';
import { docsRouter } from './routes/docs.js';
import { leavesRouter } from './routes/leaves.js';
import { absencesRouter } from './routes/absences.js';
import { advancesRouter } from './routes/advances.js';
import { requestsRouter } from './routes/requests.js';
import { issuesRouter } from './routes/issues.js';
import { financeRouter } from './routes/finance.js';
import { dashboardRouter } from './routes/dashboard.js';

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => { req.rid = randomBytes(8).toString('hex'); next(); });

// Before installation every visit goes to the wizard; afterwards the wizard is closed.
app.use('/api/setup', setupRouter);
let installed = false;
app.use('/api', async (_req: Request, res: Response, next: NextFunction) => {
  if (!installed && (installed = await isInstalled())) await upgrade();
  if (!installed) return res.status(503).json({ error: 'setup_required', setup: true });
  next();
});

app.use('/api', publicRouter);
app.use('/api', authenticate);

// Maintenance mode blocks every signed-in user except administrators.
app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/me' || !req.user) return next();
  if ((await setting('org.maintenance')) === '1' && !req.user.perms.has('system_settings.update')) {
    return res.status(503).json({ error: 'maintenance', params: { message: await setting('org.maintenance_message') } });
  }
  next();
});

app.use('/api', accountRouter);
app.use('/api', accessRouter);
app.use('/api', companiesRouter);
app.use('/api', ridersRouter);
app.use('/api', applicantsRouter);
app.use('/api', fleetRouter);
app.use('/api', fleet2Router);
app.use('/api', systemRouter);
app.use('/api', docsRouter);
app.use('/api', leavesRouter);
app.use('/api', absencesRouter);
app.use('/api', advancesRouter);
app.use('/api', requestsRouter);
app.use('/api', issuesRouter);
app.use('/api', financeRouter);
app.use('/api', dashboardRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/scans', scansRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// The built web app (admin panel, rider portal, public site) is served from the same origin.
const web = join(ROOT, '..', 'web', 'dist');
if (existsSync(web)) {
  app.use(express.static(web, { index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(web, 'index.html')));
}

app.use(errorHandler);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Logistics Services Platform API on http://localhost:${port}`));
