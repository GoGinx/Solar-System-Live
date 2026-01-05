"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BODY_CACHE_TTL_MS = void 0;
exports.getBodyEphemeris = getBodyEphemeris;
const bodies_1 = require("../config/bodies");
const horizonsClient_1 = require("../nasa/horizonsClient");
const logger_1 = require("../observability/logger");
exports.BODY_CACHE_TTL_MS = Number(process.env.BODY_CACHE_TTL_MS ?? process.env.CACHE_TTL_MS ?? 60000);
const cache = new Map();
const inflight = new Map();
function getFromCache(id) {
    const entry = cache.get(id);
    if (!entry) {
        return null;
    }
    if (Date.now() >= entry.expiresAt) {
        cache.delete(id);
        return null;
    }
    return entry;
}
async function fetchFresh(id, correlationId) {
    const cfg = bodies_1.BODY_BY_ID.get(id);
    if (!cfg) {
        throw new Error(`Corps inconnu: ${id}`);
    }
    const started = Date.now();
    const vec = await (0, horizonsClient_1.fetchPlanetStateVector)(cfg.horizonsId, cfg.displayName, {
        correlationId,
        includeObserver: true
    });
    const responseTimeMs = Date.now() - started;
    return {
        id,
        timestamp: vec.timestamp ?? new Date().toISOString(),
        x_au: vec.x_au,
        y_au: vec.y_au,
        z_au: vec.z_au,
        vx: vec.vx_au_per_day,
        vy: vec.vy_au_per_day,
        vz: vec.vz_au_per_day,
        velocityUnit: vec.velocityUnit,
        referenceFrame: vec.referenceFrame,
        source: vec.source,
        range_au: vec.range_au,
        range_rate_km_s: vec.range_rate_km_s,
        light_time_minutes: vec.light_time_minutes,
        solar_elongation_deg: vec.solar_elongation_deg,
        phase_angle_deg: vec.phase_angle_deg,
        illumination_fraction: vec.illumination_fraction,
        apparent_magnitude: vec.apparent_magnitude,
        metadata: {
            responseTimeMs,
            requestId: correlationId
        }
    };
}
async function getBodyEphemeris(options) {
    const id = options.id;
    const now = Date.now();
    if (!options.forceRefresh) {
        const cached = getFromCache(id);
        if (cached) {
            const ageMs = now - cached.cachedAt;
            return {
                ...cached.payload,
                metadata: {
                    ...cached.payload.metadata,
                    cacheStatus: 'HIT',
                    cacheAgeMs: ageMs,
                    cacheExpiresInMs: Math.max(0, cached.expiresAt - now),
                    requestId: options.correlationId ?? cached.payload.metadata?.requestId
                }
            };
        }
    }
    const existing = inflight.get(id);
    if (existing) {
        const payload = await existing;
        return {
            ...payload,
            metadata: {
                ...payload.metadata,
                cacheStatus: 'MISS',
                cacheAgeMs: 0,
                cacheExpiresInMs: exports.BODY_CACHE_TTL_MS
            }
        };
    }
    const p = fetchFresh(id, options.correlationId)
        .then((payload) => {
        cache.set(id, {
            payload,
            cachedAt: Date.now(),
            expiresAt: Date.now() + exports.BODY_CACHE_TTL_MS
        });
        (0, logger_1.logInfo)('body_ephemeris_refresh', { id, requestId: options.correlationId });
        return payload;
    })
        .catch((err) => {
        (0, logger_1.logError)('body_ephemeris_refresh_failed', {
            id,
            requestId: options.correlationId,
            error: err?.message ?? String(err)
        });
        throw err;
    })
        .finally(() => {
        inflight.delete(id);
    });
    inflight.set(id, p);
    try {
        const payload = await p;
        return {
            ...payload,
            metadata: {
                ...payload.metadata,
                cacheStatus: 'MISS',
                cacheAgeMs: 0,
                cacheExpiresInMs: exports.BODY_CACHE_TTL_MS
            }
        };
    }
    catch (err) {
        const cached = cache.get(id);
        if (cached) {
            const ageMs = now - cached.cachedAt;
            (0, logger_1.logWarn)('body_ephemeris_frozen', {
                id,
                requestId: options.correlationId,
                cacheAgeMs: ageMs,
                error: err?.message ?? String(err)
            });
            return {
                ...cached.payload,
                metadata: {
                    ...cached.payload.metadata,
                    cacheStatus: 'FROZEN',
                    cacheAgeMs: ageMs,
                    cacheExpiresInMs: 0,
                    frozenSnapshot: true,
                    freezeReason: err?.message ?? 'Erreur inconnue lors du fetch Horizons',
                    requestId: options.correlationId ?? cached.payload.metadata?.requestId
                }
            };
        }
        throw err;
    }
}
