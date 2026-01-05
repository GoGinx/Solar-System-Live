import { BODY_BY_ID, BodyId } from '../config/bodies';
import { fetchPlanetStateVector } from '../nasa/horizonsClient';
import { logError, logInfo, logWarn } from '../observability/logger';

export interface BodyEphemerisPayload {
  id: BodyId;
  timestamp: string;
  x_au: number;
  y_au: number;
  z_au: number;
  vx?: number;
  vy?: number;
  vz?: number;
  velocityUnit?: string;
  referenceFrame?: string;
  source?: string;
  range_au?: number;
  range_rate_km_s?: number;
  light_time_minutes?: number;
  solar_elongation_deg?: number;
  phase_angle_deg?: number;
  illumination_fraction?: number;
  apparent_magnitude?: number;
  metadata?: {
    cacheStatus?: 'HIT' | 'MISS' | 'FROZEN';
    cacheAgeMs?: number;
    cacheExpiresInMs?: number;
    responseTimeMs?: number;
    requestId?: string;
    frozenSnapshot?: boolean;
    freezeReason?: string;
  };
}

interface CacheEntry {
  payload: BodyEphemerisPayload;
  cachedAt: number;
  expiresAt: number;
}

export const BODY_CACHE_TTL_MS = Number(process.env.BODY_CACHE_TTL_MS ?? process.env.CACHE_TTL_MS ?? 60_000);

const cache = new Map<BodyId, CacheEntry>();
const inflight = new Map<BodyId, Promise<BodyEphemerisPayload>>();

function getFromCache(id: BodyId): CacheEntry | null {
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

async function fetchFresh(id: BodyId, correlationId?: string): Promise<BodyEphemerisPayload> {
  const cfg = BODY_BY_ID.get(id);
  if (!cfg) {
    throw new Error(`Corps inconnu: ${id}`);
  }

  const started = Date.now();
  const vec = await fetchPlanetStateVector(cfg.horizonsId, cfg.displayName, {
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

export async function getBodyEphemeris(options: {
  id: BodyId;
  forceRefresh?: boolean;
  correlationId?: string;
}): Promise<BodyEphemerisPayload> {
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
        cacheExpiresInMs: BODY_CACHE_TTL_MS
      }
    };
  }

  const p = fetchFresh(id, options.correlationId)
    .then((payload) => {
      cache.set(id, {
        payload,
        cachedAt: Date.now(),
        expiresAt: Date.now() + BODY_CACHE_TTL_MS
      });
      logInfo('body_ephemeris_refresh', { id, requestId: options.correlationId });
      return payload;
    })
    .catch((err: any) => {
      logError('body_ephemeris_refresh_failed', {
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
        cacheExpiresInMs: BODY_CACHE_TTL_MS
      }
    };
  } catch (err: any) {
    const cached = cache.get(id);
    if (cached) {
      const ageMs = now - cached.cachedAt;
      logWarn('body_ephemeris_frozen', {
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
