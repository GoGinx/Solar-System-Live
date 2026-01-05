export interface EphemerisVector {
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

