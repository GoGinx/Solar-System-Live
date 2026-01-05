import type { PlanetName } from './planet';

export interface Moon {
  id: string;
  displayName: string;
  parentPlanetName: PlanetName;
  horizonsId: string;
  radiusKm: number;
  massKg: number;
  info: string;
  referenceUrl?: string;
}
