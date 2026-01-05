export type StarId = 'sun';

export interface Star {
  id: StarId;
  displayName: string;
  color: string;
  radiusKm: number;
  massKg: number;
  info: string;
  meanSurfaceTempK?: number;
  referenceUrl?: string;
}

