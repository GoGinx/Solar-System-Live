"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ephemeris_1 = __importDefault(require("./routes/ephemeris"));
const metrics_1 = require("./observability/metrics");
const logger_1 = require("./observability/logger");
const requestTracing_1 = require("./observability/requestTracing");
const voyagers_1 = __importDefault(require("./routes/voyagers"));
const catalog_1 = __importDefault(require("./routes/catalog"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
const clientDist = process.env.CLIENT_DIST || path_1.default.resolve(__dirname, '..', 'client', 'dist', 'solar-system-real-client');
app.use((0, requestTracing_1.applyRequestTracing)());
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/ephemeris', ephemeris_1.default);
app.use('/api/voyagers', voyagers_1.default);
app.use('/api/catalog', catalog_1.default);
app.get('/', (_req, res) => {
    res.send('Solar System Real – API JPL Horizons');
});
app.get('/metrics', async (_req, res) => {
    try {
        const metrics = await (0, metrics_1.getMetricsSnapshot)();
        res.setHeader('Content-Type', metrics_1.metricsContentType);
        res.send(metrics);
    }
    catch (err) {
        res.status(500).send(`# Metrics error: ${err?.message ?? String(err)}`);
    }
});
// Sert le front Angular buildé si le dossier existe (un seul serveur pour front+API).
if (fs_1.default.existsSync(clientDist)) {
    app.use(express_1.default.static(clientDist));
    app.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(clientDist, 'index.html'));
    });
}
else {
    (0, logger_1.logInfo)('client_dist_missing', { clientDist });
}
app.listen(port, () => {
    (0, logger_1.logInfo)('api_server_started', { port });
});
