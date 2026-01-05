export interface BodyEphemerisPayload {
  id: string;
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

