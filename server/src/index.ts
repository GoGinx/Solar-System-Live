import express from 'express';
import cors from 'cors';
import ephemerisRouter from './routes/ephemeris';
import {
  getMetricsSnapshot,
  metricsContentType
} from './observability/metrics';
import { logInfo } from './observability/logger';
import { applyRequestTracing } from './observability/requestTracing';
import voyagersRouter from './routes/voyagers';
import path from 'path';
import fs from 'fs';

const app = express();
const port = process.env.PORT || 3000;
const clientDist =
  process.env.CLIENT_DIST || path.resolve(__dirname, '..', 'client', 'dist', 'solar-system-real-client');

app.use(applyRequestTracing());
app.use(cors());
app.use(express.json());

app.use('/api/ephemeris', ephemerisRouter);
app.use('/api/voyagers', voyagersRouter);

app.get('/', (_req, res) => {
  res.send('Solar System Real – API JPL Horizons');
});

app.get('/metrics', async (_req, res) => {
  try {
    const metrics = await getMetricsSnapshot();
    res.setHeader('Content-Type', metricsContentType);
    res.send(metrics);
  } catch (err: any) {
    res.status(500).send(`# Metrics error: ${err?.message ?? String(err)}`);
  }
});

// Sert le front Angular buildé si le dossier existe (un seul serveur pour front+API).
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  logInfo('client_dist_missing', { clientDist });
}

app.listen(port, () => {
  logInfo('api_server_started', { port });
});
