import { Planet } from './planet';
import { Star } from './star';

export interface SolarSystemCatalog {
  source: string;
  updatedAt: string;
  star: Star;
  planets: Planet[];
}

