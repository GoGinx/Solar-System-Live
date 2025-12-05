"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL_MS = void 0;
exports.getSnapshot = getSnapshot;
const redis_1 = require("redis");
const planets_1 = require("../config/planets");
const horizonsClient_1 = require("../nasa/horizonsClient");
const metrics_1 = require("../observability/metrics");
const logger_1 = require("../observability/logger");
const CACHE_KEY = 'ephemeris:planets:v1';
exports.CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 120000);
const STALE_WHILE_REVALIDATE_MS = Number(process.env.CACHE_STALE_MS ?? Math.floor(exports.CACHE_TTL_MS * 0.5));
const PREWARM_INTERVAL_MS = Number(process.env.CACHE_WARM_INTERVAL_MS ??
    (exports.CACHE_TTL_MS > 0 ? Math.max(30000, Math.floor(exports.CACHE_TTL_MS * 0.8)) : 0));
let redisClient = null;
let redisReady = null;
// Cache mémoire local (fallback ou si Redis désactivé)
let memoryCache = null;
let inflightPromise = null;
function initRedisClient() {
    if (!process.env.REDIS_URL) {
        return;
    }
    redisClient = (0, redis_1.createClient)({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => {
        (0, logger_1.logWarn)('redis_error', { error: err?.message ?? String(err) });
    });
    redisReady = redisClient
        .connect()
        .then(() => {
        (0, logger_1.logInfo)('redis_connected', { url: process.env.REDIS_URL });
        return redisClient;
    })
        .catch((err) => {
        (0, logger_1.logWarn)('redis_connect_failed', { error: err?.message ?? String(err) });
        redisClient = null;
        return null;
    });
}
initRedisClient();
async function getRedisClient() {
    if (!redisReady) {
        return null;
    }
    return redisReady;
}
async function readCache() {
    const client = await getRedisClient();
    if (client) {
        try {
            const raw = await client.get(CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                memoryCache = parsed;
                return parsed;
            }
        }
        catch (err) {
            (0, logger_1.logWarn)('redis_read_failed', { error: err?.message ?? String(err) });
        }
    }
    return memoryCache;
}
async function writeCache(record, backend) {
    memoryCache = record;
    const client = await getRedisClient();
    if (client && backend === 'redis') {
        try {
            await client.set(CACHE_KEY, JSON.stringify(record), {
                PX: record.staleUntil - record.cachedAt
            });
        }
        catch (err) {
            (0, logger_1.logWarn)('redis_write_failed', { error: err?.message ?? String(err) });
        }
    }
}
async function buildPlanetSnapshot(correlationId) {
    const started = Date.now();
    const results = await Promise.all(planets_1.PLANETS.map((cfg) => (0, horizonsClient_1.fetchPlanetStateVector)(cfg.horizonsId, cfg.name, { correlationId })));
    const latencyMs = Date.now() - started;
    (0, metrics_1.recordHorizonsLatency)(latencyMs);
    const timestamp = results[0]?.timestamp ?? new Date().toISOString();
    return {
        timestamp,
        metadata: {
            source: 'NASA-JPL-Horizons',
            referenceFrame: results[0]?.referenceFrame ?? 'J2000-ECLIPTIC',
            distanceUnit: 'AU',
            velocityUnit: results[0]?.velocityUnit ?? 'AU/day',
            responseTimeMs: latencyMs
        },
        bodies: results.map((r) => ({
            name: r.name,
            x_au: r.x_au,
            y_au: r.y_au,
            z_au: r.z_au,
            vx: r.vx_au_per_day,
            vy: r.vy_au_per_day,
            vz: r.vz_au_per_day,
            velocityUnit: r.velocityUnit,
            timestamp: r.timestamp,
            range_au: r.range_au,
            range_rate_km_s: r.range_rate_km_s,
            light_time_minutes: r.light_time_minutes,
            solar_elongation_deg: r.solar_elongation_deg,
            phase_angle_deg: r.phase_angle_deg,
            illumination_fraction: r.illumination_fraction,
            apparent_magnitude: r.apparent_magnitude
        }))
    };
}
async function refreshSnapshot(reason, correlationId) {
    const backend = (await getRedisClient()) ? 'redis' : 'memory';
    const payload = await buildPlanetSnapshot(correlationId);
    const now = Date.now();
    const record = {
        payload,
        cachedAt: now,
        expiresAt: now + exports.CACHE_TTL_MS,
        staleUntil: now + exports.CACHE_TTL_MS + STALE_WHILE_REVALIDATE_MS
    };
    await writeCache(record, backend);
    (0, metrics_1.recordCacheMiss)(backend, reason, payload.metadata.responseTimeMs);
    const cacheAgeMs = 0;
    payload.metadata = {
        ...payload.metadata,
        cacheStatus: 'MISS',
        cacheBackend: backend,
        cacheAgeMs,
        cacheExpiresInMs: exports.CACHE_TTL_MS,
        cacheStale: false,
        generatedAt: new Date(now).toISOString(),
        requestId: correlationId
    };
    (0, logger_1.logInfo)('ephemeris_refresh', {
        backend,
        reason,
        responseTimeMs: payload.metadata.responseTimeMs,
        requestId: correlationId
    });
    return {
        payload,
        cacheState: 'MISS',
        cacheBackend: backend,
        cacheAgeMs
    };
}
function decoratePayloadMetadata(payload, cacheState, backend, cacheAgeMs, correlationId) {
    const baseMetadata = payload.metadata ?? {};
    return {
        ...payload,
        metadata: {
            ...baseMetadata,
            cacheStatus: cacheState,
            cacheBackend: backend,
            cacheAgeMs,
            cacheExpiresInMs: Math.max(0, exports.CACHE_TTL_MS - cacheAgeMs),
            cacheStale: cacheState === 'STALE',
            requestId: correlationId ?? baseMetadata.requestId,
            generatedAt: baseMetadata.generatedAt ?? new Date(Date.now() - cacheAgeMs).toISOString()
        }
    };
}
async function getSnapshot(options) {
    const backend = (await getRedisClient()) ? 'redis' : 'memory';
    const now = Date.now();
    if (!options?.forceRefresh) {
        const cached = await readCache();
        if (cached) {
            const cacheAgeMs = now - cached.cachedAt;
            const isFresh = cacheAgeMs < exports.CACHE_TTL_MS;
            const isStaleButAllowed = !isFresh && cacheAgeMs < exports.CACHE_TTL_MS + STALE_WHILE_REVALIDATE_MS;
            if (isFresh || isStaleButAllowed) {
                const cacheState = isFresh ? 'HIT' : 'STALE';
                (0, metrics_1.recordCacheHit)(backend, isFresh ? 'fresh' : 'stale', cacheAgeMs);
                if (isStaleButAllowed && !inflightPromise) {
                    inflightPromise = refreshSnapshot('stale-revalidate').finally(() => {
                        inflightPromise = null;
                    });
                }
                return {
                    payload: decoratePayloadMetadata(cached.payload, cacheState, backend, cacheAgeMs, options?.correlationId),
                    cacheState,
                    cacheBackend: backend,
                    cacheAgeMs
                };
            }
        }
    }
    if (!inflightPromise) {
        inflightPromise = refreshSnapshot(options?.forceRefresh ? 'manual-refresh' : 'miss', options?.correlationId);
    }
    try {
        const result = await inflightPromise;
        const payload = decoratePayloadMetadata(result.payload, result.cacheState, result.cacheBackend, result.cacheAgeMs, options?.correlationId ?? result.payload?.metadata?.requestId);
        return {
            ...result,
            payload
        };
    }
    catch (err) {
        const cached = memoryCache ?? (await readCache());
        if (cached) {
            const cacheAgeMs = now - cached.cachedAt;
            const payload = decoratePayloadMetadata(cached.payload, 'FROZEN', backend, cacheAgeMs, options?.correlationId);
            payload.metadata = {
                ...payload.metadata,
                cacheStale: true,
                cacheExpiresInMs: 0,
                frozenSnapshot: true,
                freezeReason: err?.message ?? 'Erreur inconnue lors du fetch Horizons',
                requestId: options?.correlationId
            };
            (0, logger_1.logWarn)('ephemeris_snapshot_frozen', {
                backend,
                cacheAgeMs,
                requestId: options?.correlationId,
                error: err?.message ?? String(err)
            });
            return {
                payload,
                cacheState: 'FROZEN',
                cacheBackend: backend,
                cacheAgeMs
            };
        }
        (0, logger_1.logError)('ephemeris_refresh_failed', {
            backend,
            requestId: options?.correlationId,
            error: err?.message ?? String(err)
        });
        throw err;
    }
    finally {
        inflightPromise = null;
    }
}
// Pré-calcule périodiquement les données pour lisser les pics de charge.
if (exports.CACHE_TTL_MS > 0 &&
    PREWARM_INTERVAL_MS > 0 &&
    Number.isFinite(PREWARM_INTERVAL_MS)) {
    setInterval(() => {
        if (!inflightPromise) {
            inflightPromise = refreshSnapshot('background-prewarm').finally(() => {
                inflightPromise = null;
            });
        }
    }, PREWARM_INTERVAL_MS).unref();
}
