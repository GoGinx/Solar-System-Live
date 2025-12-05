import { createClient, RedisClientType } from 'redis';

import { PLANETS } from '../config/planets';
import { fetchPlanetStateVector } from '../nasa/horizonsClient';
import {
  CacheBackend,
  CacheState,
  recordCacheHit,
  recordCacheMiss,
  recordHorizonsLatency
} from '../observability/metrics';
import { logError, logInfo, logWarn } from '../observability/logger';

export interface EphemerisBody {
  name: string;
  x_au: number;
  y_au: number;
  z_au: number;
  vx?: number;
  vy?: number;
  vz?: number;
  velocityUnit?: string;
  timestamp?: string;
  range_au?: number;
  range_rate_km_s?: number;
  light_time_minutes?: number;
  solar_elongation_deg?: number;
  phase_angle_deg?: number;
  illumination_fraction?: number;
  apparent_magnitude?: number;
}

export interface EphemerisSnapshot {
  timestamp: string;
  metadata: {
    source?: string;
    referenceFrame?: string;
    distanceUnit?: string;
    velocityUnit?: string;
    responseTimeMs?: number;
    cacheStatus?: string;
    cacheBackend?: CacheBackend;
    cacheAgeMs?: number;
    cacheExpiresInMs?: number;
    cacheStale?: boolean;
    generatedAt?: string;
    frozenSnapshot?: boolean;
    freezeReason?: string;
    requestId?: string;
  };
  bodies: EphemerisBody[];
}

interface CacheRecord {
  payload: EphemerisSnapshot;
  cachedAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface SnapshotResult {
  payload: EphemerisSnapshot;
  cacheState: 'HIT' | 'MISS' | 'STALE' | 'FROZEN';
  cacheBackend: CacheBackend;
  cacheAgeMs: number;
}

const CACHE_KEY = 'ephemeris:planets:v1';
export const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 120_000);
const STALE_WHILE_REVALIDATE_MS = Number(
  process.env.CACHE_STALE_MS ?? Math.floor(CACHE_TTL_MS * 0.5)
);
const PREWARM_INTERVAL_MS = Number(
  process.env.CACHE_WARM_INTERVAL_MS ??
    (CACHE_TTL_MS > 0 ? Math.max(30_000, Math.floor(CACHE_TTL_MS * 0.8)) : 0)
);

let redisClient: RedisClientType | null = null;
let redisReady: Promise<RedisClientType | null> | null = null;

// Cache mémoire local (fallback ou si Redis désactivé)
let memoryCache: CacheRecord | null = null;
let inflightPromise: Promise<SnapshotResult> | null = null;

function initRedisClient(): void {
  if (!process.env.REDIS_URL) {
    return;
  }

  redisClient = createClient({ url: process.env.REDIS_URL });

  redisClient.on('error', (err) => {
    logWarn('redis_error', { error: err?.message ?? String(err) });
  });

  redisReady = redisClient
    .connect()
    .then(() => {
      logInfo('redis_connected', { url: process.env.REDIS_URL });
      return redisClient;
    })
    .catch((err) => {
      logWarn('redis_connect_failed', { error: err?.message ?? String(err) });
      redisClient = null;
      return null;
    });
}

initRedisClient();

async function getRedisClient(): Promise<RedisClientType | null> {
  if (!redisReady) {
    return null;
  }

  return redisReady;
}

async function readCache(): Promise<CacheRecord | null> {
  const client = await getRedisClient();
  if (client) {
    try {
      const raw = await client.get(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CacheRecord;
        memoryCache = parsed;
        return parsed;
      }
    } catch (err: any) {
      logWarn('redis_read_failed', { error: err?.message ?? String(err) });
    }
  }

  return memoryCache;
}

async function writeCache(record: CacheRecord, backend: CacheBackend): Promise<void> {
  memoryCache = record;

  const client = await getRedisClient();
  if (client && backend === 'redis') {
    try {
      await client.set(CACHE_KEY, JSON.stringify(record), {
        PX: record.staleUntil - record.cachedAt
      });
    } catch (err: any) {
      logWarn('redis_write_failed', { error: err?.message ?? String(err) });
    }
  }
}

async function buildPlanetSnapshot(correlationId?: string): Promise<EphemerisSnapshot> {
  const started = Date.now();
  const results = await Promise.all(
    PLANETS.map((cfg) => fetchPlanetStateVector(cfg.horizonsId, cfg.name, { correlationId }))
  );
  const latencyMs = Date.now() - started;

  recordHorizonsLatency(latencyMs);

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

async function refreshSnapshot(reason: string, correlationId?: string): Promise<SnapshotResult> {
  const backend: CacheBackend = (await getRedisClient()) ? 'redis' : 'memory';
  const payload = await buildPlanetSnapshot(correlationId);
  const now = Date.now();

  const record: CacheRecord = {
    payload,
    cachedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + CACHE_TTL_MS + STALE_WHILE_REVALIDATE_MS
  };

  await writeCache(record, backend);
  recordCacheMiss(backend, reason, payload.metadata.responseTimeMs);

  const cacheAgeMs = 0;

  payload.metadata = {
    ...payload.metadata,
    cacheStatus: 'MISS',
    cacheBackend: backend,
    cacheAgeMs,
    cacheExpiresInMs: CACHE_TTL_MS,
    cacheStale: false,
    generatedAt: new Date(now).toISOString(),
    requestId: correlationId
  };

  logInfo('ephemeris_refresh', {
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

function decoratePayloadMetadata(
  payload: EphemerisSnapshot,
  cacheState: SnapshotResult['cacheState'],
  backend: CacheBackend,
  cacheAgeMs: number,
  correlationId?: string
): EphemerisSnapshot {
  const baseMetadata = payload.metadata ?? {};

  return {
    ...payload,
    metadata: {
      ...baseMetadata,
      cacheStatus: cacheState,
      cacheBackend: backend,
      cacheAgeMs,
      cacheExpiresInMs: Math.max(0, CACHE_TTL_MS - cacheAgeMs),
      cacheStale: cacheState === 'STALE',
      requestId: correlationId ?? baseMetadata.requestId,
      generatedAt:
        baseMetadata.generatedAt ?? new Date(Date.now() - cacheAgeMs).toISOString()
    }
  };
}

export async function getSnapshot(options?: {
  forceRefresh?: boolean;
  correlationId?: string;
}): Promise<SnapshotResult> {
  const backend: CacheBackend = (await getRedisClient()) ? 'redis' : 'memory';
  const now = Date.now();

  if (!options?.forceRefresh) {
    const cached = await readCache();
    if (cached) {
      const cacheAgeMs = now - cached.cachedAt;
      const isFresh = cacheAgeMs < CACHE_TTL_MS;
      const isStaleButAllowed =
        !isFresh && cacheAgeMs < CACHE_TTL_MS + STALE_WHILE_REVALIDATE_MS;

      if (isFresh || isStaleButAllowed) {
        const cacheState: SnapshotResult['cacheState'] = isFresh ? 'HIT' : 'STALE';
        recordCacheHit(backend, isFresh ? 'fresh' : 'stale', cacheAgeMs);

        if (isStaleButAllowed && !inflightPromise) {
          inflightPromise = refreshSnapshot('stale-revalidate').finally(() => {
            inflightPromise = null;
          });
        }

        return {
          payload: decoratePayloadMetadata(
            cached.payload,
            cacheState,
            backend,
            cacheAgeMs,
            options?.correlationId
          ),
          cacheState,
          cacheBackend: backend,
          cacheAgeMs
        };
      }
    }
  }

  if (!inflightPromise) {
    inflightPromise = refreshSnapshot(
      options?.forceRefresh ? 'manual-refresh' : 'miss',
      options?.correlationId
    );
  }

  try {
    const result = await inflightPromise;
    const payload = decoratePayloadMetadata(
      result.payload,
      result.cacheState,
      result.cacheBackend,
      result.cacheAgeMs,
      options?.correlationId ?? result.payload?.metadata?.requestId
    );

    return {
      ...result,
      payload
    };
  } catch (err: any) {
    const cached = memoryCache ?? (await readCache());
    if (cached) {
      const cacheAgeMs = now - cached.cachedAt;
      const payload = decoratePayloadMetadata(
        cached.payload,
        'FROZEN',
        backend,
        cacheAgeMs,
        options?.correlationId
      );

      payload.metadata = {
        ...payload.metadata,
        cacheStale: true,
        cacheExpiresInMs: 0,
        frozenSnapshot: true,
        freezeReason: err?.message ?? 'Erreur inconnue lors du fetch Horizons',
        requestId: options?.correlationId
      };

      logWarn('ephemeris_snapshot_frozen', {
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

    logError('ephemeris_refresh_failed', {
      backend,
      requestId: options?.correlationId,
      error: err?.message ?? String(err)
    });

    throw err;
  } finally {
    inflightPromise = null;
  }
}

// Pré-calcule périodiquement les données pour lisser les pics de charge.
if (
  CACHE_TTL_MS > 0 &&
  PREWARM_INTERVAL_MS > 0 &&
  Number.isFinite(PREWARM_INTERVAL_MS)
) {
  setInterval(() => {
    if (!inflightPromise) {
      inflightPromise = refreshSnapshot('background-prewarm').finally(() => {
        inflightPromise = null;
      });
    }
  }, PREWARM_INTERVAL_MS).unref();
}
