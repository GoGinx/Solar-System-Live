import { Injectable } from '@angular/core';
import { Planet } from '../models/planet';

@Injectable({ providedIn: 'root' })
export class PlanetService {

  private planets: Planet[] = [
    {
      name: 'mercury',
      displayName: 'Mercure',
      color: '#b0b0b0',
      radiusKm: 2440,
      massKg: 3.3011e23,
      semiMajorAxisAU: 0.387,
      orbitalPeriodDays: 87.97,
      rotationPeriodHours: 1407.5,
      inclinationDeg: 7.0,
      axialTiltDeg: 0.03,
      info: 'Première planète du système solaire, très proche du Soleil.'
    },
    {
      name: 'venus',
      displayName: 'Vénus',
      color: '#e3c16f',
      radiusKm: 6052,
      massKg: 4.8675e24,
      semiMajorAxisAU: 0.723,
      orbitalPeriodDays: 224.70,
      rotationPeriodHours: -5832.5,
      inclinationDeg: 3.39,
      axialTiltDeg: 177.36,
      info: 'Planète tellurique à atmosphère dense, effet de serre extrême.'
    },
    {
      name: 'earth',
      displayName: 'Terre',
      color: '#4a90e2',
      radiusKm: 6371,
      massKg: 5.97237e24,
      semiMajorAxisAU: 1.0,
      orbitalPeriodDays: 365.256,
      rotationPeriodHours: 23.934,
      inclinationDeg: 0,
      axialTiltDeg: 23.44,
      info: 'Planète tellurique avec eau liquide en surface, seule connue abritant la vie.'
    },
    {
      name: 'mars',
      displayName: 'Mars',
      color: '#c1440e',
      radiusKm: 3389,
      massKg: 6.4171e23,
      semiMajorAxisAU: 1.524,
      orbitalPeriodDays: 686.98,
      rotationPeriodHours: 24.623,
      inclinationDeg: 1.85,
      axialTiltDeg: 25.19,
      info: 'Planète rouge, cible majeure de l’exploration robotique.'
    },
    {
      name: 'jupiter',
      displayName: 'Jupiter',
      color: '#d9b58b',
      radiusKm: 69911,
      massKg: 1.8982e27,
      semiMajorAxisAU: 5.203,
      orbitalPeriodDays: 4332.59,
      rotationPeriodHours: 9.925,
      inclinationDeg: 1.304,
      axialTiltDeg: 3.13,
      info: 'Géante gazeuse, planète la plus massive du système solaire.'
    },
    {
      name: 'saturn',
      displayName: 'Saturne',
      color: '#f5deb3',
      radiusKm: 58232,
      massKg: 5.6834e26,
      semiMajorAxisAU: 9.537,
      orbitalPeriodDays: 10759.22,
      rotationPeriodHours: 10.656,
      inclinationDeg: 2.485,
      axialTiltDeg: 26.73,
      info: 'Géante gazeuse célèbre pour ses anneaux spectaculaires.'
    },
    {
      name: 'uranus',
      displayName: 'Uranus',
      color: '#9cd6d6',
      radiusKm: 25362,
      massKg: 8.6810e25,
      semiMajorAxisAU: 19.191,
      orbitalPeriodDays: 30688.5,
      rotationPeriodHours: -17.24,
      inclinationDeg: 0.773,
      axialTiltDeg: 97.77,
      info: 'Géante de glace, axe de rotation fortement incliné.'
    },
    {
      name: 'neptune',
      displayName: 'Neptune',
      color: '#4f6fff',
      radiusKm: 24622,
      massKg: 1.02413e26,
      semiMajorAxisAU: 30.07,
      orbitalPeriodDays: 60182,
      rotationPeriodHours: 16.11,
      inclinationDeg: 1.77,
      axialTiltDeg: 28.32,
      info: 'Géante de glace la plus éloignée, vents supersoniques.'
    },
    {
      name: 'pluto',
      displayName: 'Pluton',
      color: '#d7c7ba',
      radiusKm: 1188.3,
      massKg: 1.303e22,
      semiMajorAxisAU: 39.482,
      orbitalPeriodDays: 90560,
      rotationPeriodHours: -153.3,
      eccentricity: 0.2488,
      inclinationDeg: 17.16,
      axialTiltDeg: 122.53,
      category: 'dwarf',
      info: 'Planète naine de la ceinture de Kuiper, orbite excentrique et inclinée.'
    }
  ];

  getPlanets(): Planet[] {
    return this.planets;
  }
}
