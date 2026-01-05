export interface VoyagerPositionVector {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface VoyagerVelocityVector {
  vx: number | null;
  vy: number | null;
  vz: number | null;
}

export interface VoyagerData {
  id: 'voyager1' | 'voyager2';
  name: string;
  horizonsId: string;
  positionAu: VoyagerPositionVector;
  positionKm: VoyagerPositionVector | null;
  positionMiles: VoyagerPositionVector | null;
  velocityAuPerDay: VoyagerVelocityVector;
  velocityKmPerS: VoyagerVelocityVector | null;
  velocityMilesPerS: VoyagerVelocityVector | null;
  distanceFromSun: { au: number | null; km: number | null; miles: number | null };
  distanceFromEarth?: { au: number | null; km: number | null; miles: number | null };
  speed: { auPerDay: number | null; kmPerS: number | null; milesPerS: number | null };
  lightTime?: {
    oneWaySeconds: number | null;
    oneWayMinutes: number | null;
    twoWayMinutes: number | null;
  };
  trajectory?: {
    eclipticLatDeg: number | null;
    eclipticLonDeg: number | null;
    velocityAzimuthDeg: number | null;
    velocityLatDeg: number | null;
  };
  timestamp: string;
  referenceFrame?: string;
  source?: string;
  velocityUnit?: string;
}

export interface VoyagerSnapshot {
  timestamp: string;
  requestId?: string;
  metadata?: {
    source?: string;
    unitDistanceBase?: string;
    unitVelocityBase?: string;
    unitDistanceConverted?: string[];
    unitVelocityConverted?: string[];
  };
  voyagers: VoyagerData[];
}

