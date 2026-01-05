"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ephemerisCache_1 = require("../cache/ephemerisCache");
const bodyEphemerisCache_1 = require("../cache/bodyEphemerisCache");
const bodies_1 = require("../config/bodies");
const logger_1 = require("../observability/logger");
const router = (0, express_1.Router)();
function parseForceRefresh(req) {
    const refreshParam = req.query?.refresh;
    const refreshParamValue = typeof refreshParam === 'string'
        ? refreshParam
        : Array.isArray(refreshParam)
            ? refreshParam.find((v) => v === '1' || v === 'true')
            : undefined;
    const refreshHeaderRaw = req.headers['x-refresh-cache'];
    const refreshHeader = Array.isArray(refreshHeaderRaw)
        ? refreshHeaderRaw[0]
        : refreshHeaderRaw;
    return (refreshParamValue === '1' ||
        refreshParamValue === 'true' ||
        refreshHeader === '1' ||
        refreshHeader === 'true');
}
async function handleSnapshotRequest(req, res) {
    const requestId = req.requestId;
    const forceRefresh = parseForceRefresh(req);
    try {
        const { payload, cacheState, cacheBackend, cacheAgeMs } = await (0, ephemerisCache_1.getSnapshot)({
            forceRefresh,
            correlationId: requestId
        });
        if (payload?.metadata?.responseTimeMs !== undefined) {
            res.setHeader('X-Horizons-Latency', payload.metadata.responseTimeMs);
        }
        res.setHeader('X-Horizons-Cache', cacheState);
        res.setHeader('X-Horizons-Cache-Backend', cacheBackend);
        res.setHeader('X-Horizons-Cache-Age', cacheAgeMs.toString());
        res.setHeader('X-Horizons-TTL', ephemerisCache_1.CACHE_TTL_MS.toString());
        const isStale = cacheState === 'STALE' || cacheState === 'FROZEN';
        res.setHeader('X-Horizons-Cache-Stale', isStale ? '1' : '0');
        res.setHeader('X-Horizons-Frozen', payload?.metadata?.frozenSnapshot ? '1' : '0');
        if (payload?.metadata?.requestId || requestId) {
            res.setHeader('X-Request-Id', payload?.metadata?.requestId ?? requestId ?? '');
        }
        res.json(payload);
    }
    catch (err) {
        (0, logger_1.logError)('ephemeris_fetch_failed', {
            error: err?.message ?? String(err),
            requestId,
            query: req.query,
            params: req.params,
            body: req.body
        });
        res
            .status(500)
            .json({ error: 'Erreur lors de la récupération des éphémérides' });
    }
}
router.get('/planets', handleSnapshotRequest);
router.get('/planets/state-vectors', handleSnapshotRequest);
router.get('/body/:id', async (req, res) => {
    const requestId = req.requestId;
    const forceRefresh = parseForceRefresh(req);
    const id = req.params?.id;
    if (!id) {
        res.status(400).json({ error: 'Missing body id' });
        return;
    }
    if (!bodies_1.BODY_BY_ID.has(id)) {
        res.status(404).json({ error: 'Unknown body id' });
        return;
    }
    try {
        const payload = await (0, bodyEphemerisCache_1.getBodyEphemeris)({ id, forceRefresh, correlationId: requestId });
        if (payload?.metadata?.responseTimeMs !== undefined) {
            res.setHeader('X-Horizons-Latency', payload.metadata.responseTimeMs);
        }
        if (payload?.metadata?.cacheStatus) {
            res.setHeader('X-Horizons-Cache', payload.metadata.cacheStatus);
        }
        if (payload?.metadata?.cacheAgeMs !== undefined) {
            res.setHeader('X-Horizons-Cache-Age', payload.metadata.cacheAgeMs.toString());
        }
        if (payload?.metadata?.cacheExpiresInMs !== undefined) {
            res.setHeader('X-Horizons-TTL', payload.metadata.cacheExpiresInMs.toString());
        }
        res.setHeader('X-Horizons-Frozen', payload?.metadata?.frozenSnapshot ? '1' : '0');
        if (payload?.metadata?.requestId || requestId) {
            res.setHeader('X-Request-Id', payload?.metadata?.requestId ?? requestId ?? '');
        }
        res.json(payload);
    }
    catch (err) {
        (0, logger_1.logError)('body_ephemeris_fetch_failed', {
            error: err?.message ?? String(err),
            requestId,
            query: req.query,
            params: req.params
        });
        res.status(500).json({ error: 'Erreur lors de la rＤupＳation des ＱhＮＳides' });
    }
});
exports.default = router;
