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
    partial?: boolean;
    fallbackBodies?: string[];
    missingBodies?: string[];
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

type SnapshotMode = 'state-vectors' | 'full';

const CACHE_KEY_BY_MODE: Record<SnapshotMode, string> = {
  'state-vectors': 'ephemeris:planets:v1',
  full: 'ephemeris:planets:full:v1'
};
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
const memoryCache = new Map<SnapshotMode, CacheRecord>();
const inflightByMode = new Map<SnapshotMode, Promise<SnapshotResult>>();

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

function setInflight(
  mode: SnapshotMode,
  promise: Promise<SnapshotResult>
): Promise<SnapshotResult> {
  inflightByMode.set(mode, promise);
  promise.finally(() => {
    const current = inflightByMode.get(mode);
    if (current === promise) {
      inflightByMode.delete(mode);
    }
  });
  return promise;
}

async function readCache(mode: SnapshotMode): Promise<CacheRecord | null> {
  const client = await getRedisClient();
  const cacheKey = CACHE_KEY_BY_MODE[mode];
  if (client) {
    try {
      const raw = await client.get(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CacheRecord;
        memoryCache.set(mode, parsed);
        return parsed;
      }
    } catch (err: any) {
      logWarn('redis_read_failed', { error: err?.message ?? String(err) });
    }
  }

  return memoryCache.get(mode) ?? null;
}

async function writeCache(
  record: CacheRecord,
  backend: CacheBackend,
  mode: SnapshotMode
): Promise<void> {
  memoryCache.set(mode, record);

  const client = await getRedisClient();
  if (client && backend === 'redis') {
    try {
      const cacheKey = CACHE_KEY_BY_MODE[mode];
      await client.set(cacheKey, JSON.stringify(record), {
        PX: record.staleUntil - record.cachedAt
      });
    } catch (err: any) {
      logWarn('redis_write_failed', { error: err?.message ?? String(err) });
    }
  }
}

async function buildPlanetSnapshot(
  correlationId?: string,
  includeObserver = false
): Promise<EphemerisSnapshot> {
  const started = Date.now();
  const cached = await readCache(includeObserver ? 'full' : 'state-vectors');
  const fallbackBodies = new Map<string, EphemerisBody>();
  for (const body of cached?.payload?.bodies ?? []) {
    fallbackBodies.set(body.name, body);
  }

  const results: PromiseSettledResult<Awaited<ReturnType<typeof fetchPlanetStateVector>>>[] = [];
  for (const cfg of PLANETS) {
    try {
      const value = await fetchPlanetStateVector(cfg.horizonsId, cfg.name, {
        correlationId,
        includeObserver
      });
      results.push({ status: 'fulfilled', value });
    } catch (err: any) {
      results.push({ status: 'rejected', reason: err });
    }
  }
  const latencyMs = Date.now() - started;

  recordHorizonsLatency(latencyMs);

  const cachedMeta = cached?.payload?.metadata;
  const bodies: EphemerisBody[] = [];
  const usedFallback: string[] = [];
  const missing: string[] = [];
  const timestamps: string[] = [];
  let referenceFrame = cachedMeta?.referenceFrame ?? 'J2000-ECLIPTIC';
  let velocityUnit = cachedMeta?.velocityUnit ?? 'AU/day';

  results.forEach((result, index) => {
    const cfg = PLANETS[index];
    if (result.status === 'fulfilled') {
      const r = result.value;
      referenceFrame = r.referenceFrame ?? referenceFrame;
      velocityUnit = r.velocityUnit ?? velocityUnit;
      if (r.timestamp) {
        timestamps.push(r.timestamp);
      }
      bodies.push({
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
      });
      return;
    }

    const fallback = fallbackBodies.get(cfg.name);
    const errMessage = result.reason?.message ?? String(result.reason);
    if (fallback) {
      usedFallback.push(cfg.name);
      if (fallback.timestamp) {
        timestamps.push(fallback.timestamp);
      }
      bodies.push({ ...fallback });
      logWarn('horizons_body_fallback', {
        name: cfg.name,
        requestId: correlationId,
        error: errMessage
      });
    } else {
      missing.push(cfg.name);
      logWarn('horizons_body_missing', {
        name: cfg.name,
        requestId: correlationId,
        error: errMessage
      });
    }
  });

  if (bodies.length === 0) {
    throw new Error('No Horizons data available');
  }

  const timestamp =
    timestamps[0] ?? cached?.payload?.timestamp ?? new Date().toISOString();

  return {
    timestamp,
    metadata: {
      source: 'NASA-JPL-Horizons',
      referenceFrame,
      distanceUnit: 'AU',
      velocityUnit,
      responseTimeMs: latencyMs,
      partial: usedFallback.length > 0 || missing.length > 0,
      fallbackBodies: usedFallback.length ? usedFallback : undefined,
      missingBodies: missing.length ? missing : undefined
    },
    bodies
  };
}

async function refreshSnapshot(
  reason: string,
  correlationId: string | undefined,
  mode: SnapshotMode
): Promise<SnapshotResult> {
  const backend: CacheBackend = (await getRedisClient()) ? 'redis' : 'memory';
  const payload = await buildPlanetSnapshot(correlationId, mode === 'full');
  const now = Date.now();

  const record: CacheRecord = {
    payload,
    cachedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + CACHE_TTL_MS + STALE_WHILE_REVALIDATE_MS
  };

  await writeCache(record, backend, mode);
  recordCacheMiss(backend, `${reason}:${mode}`, payload.metadata.responseTimeMs);

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
    requestId: correlationId,
    mode
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
  includeObserver?: boolean;
}): Promise<SnapshotResult> {
  const mode: SnapshotMode = options?.includeObserver ? 'full' : 'state-vectors';
  const backend: CacheBackend = (await getRedisClient()) ? 'redis' : 'memory';
  const now = Date.now();

  if (!options?.forceRefresh) {
    const cached = await readCache(mode);
    if (cached) {
      const cacheAgeMs = now - cached.cachedAt;
      const isFresh = cacheAgeMs < CACHE_TTL_MS;
      const isStaleButAllowed =
        !isFresh && cacheAgeMs < CACHE_TTL_MS + STALE_WHILE_REVALIDATE_MS;

      if (isFresh || isStaleButAllowed) {
        const cacheState: SnapshotResult['cacheState'] = isFresh ? 'HIT' : 'STALE';
        recordCacheHit(backend, isFresh ? 'fresh' : 'stale', cacheAgeMs);

        if (isStaleButAllowed && !inflightByMode.get(mode)) {
          setInflight(mode, refreshSnapshot('stale-revalidate', undefined, mode));
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

  let inflight = inflightByMode.get(mode);
  if (!inflight) {
    inflight = setInflight(
      mode,
      refreshSnapshot(
        options?.forceRefresh ? 'manual-refresh' : 'miss',
        options?.correlationId,
        mode
      )
    );
  }

  try {
    const result = await inflight;
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
    const cached = memoryCache.get(mode) ?? (await readCache(mode));
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
      error: err?.message ?? String(err),
      mode
    });

    throw err;
  }
}

// Pré-calcule périodiquement les données pour lisser les pics de charge.
if (
  CACHE_TTL_MS > 0 &&
  PREWARM_INTERVAL_MS > 0 &&
  Number.isFinite(PREWARM_INTERVAL_MS)
) {
  setInterval(() => {
    const mode: SnapshotMode = 'state-vectors';
    if (!inflightByMode.get(mode)) {
      setInflight(mode, refreshSnapshot('background-prewarm', undefined, mode));
    }
  }, PREWARM_INTERVAL_MS).unref();
}
