import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { Planet } from '../models/planet';
import { SolarSystemCatalog } from '../models/solar-system-catalog';
import { Star } from '../models/star';
import { PlanetService } from './planet.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SolarSystemCatalogService {
  private readonly catalogByLang = new Map<string, Observable<SolarSystemCatalog>>();

  constructor(
    private http: HttpClient,
    private planetService: PlanetService
  ) {
  }

  getCatalog(lang?: string): Observable<SolarSystemCatalog> {
    const key = lang || 'default';
    const existing = this.catalogByLang.get(key);
    if (existing) return existing;

    const catalogUrl = environment.catalogUrl || 'assets/solar-system-catalog.json';
    const urlWithLang = this.withLangParam(catalogUrl, lang);

    const stream = this.http.get<SolarSystemCatalog>(urlWithLang).pipe(
      catchError(() =>
        this.http.get<SolarSystemCatalog>('assets/solar-system-catalog.json').pipe(
          catchError(() => of(this.buildFallbackCatalog()))
        )
      ),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.catalogByLang.set(key, stream);
    return stream;
  }

  getPlanets(lang?: string): Observable<Planet[]> {
    return this.getCatalog(lang).pipe(map((c) => c.planets));
  }

  getStar(lang?: string): Observable<Star> {
    return this.getCatalog(lang).pipe(map((c) => c.star));
  }

  private buildFallbackCatalog(): SolarSystemCatalog {
    return {
      source: 'fallback-hardcoded',
      updatedAt: new Date().toISOString(),
      star: {
        id: 'sun',
        displayName: 'Soleil',
        color: '#ffcc33',
        radiusKm: 695700,
        massKg: 1.9885e30,
        meanSurfaceTempK: 5772,
        referenceUrl: 'https://en.wikipedia.org/wiki/Sun',
        info: "Etoile au centre du Systeme solaire."
      },
      planets: this.planetService.getPlanets()
    };
  }

  private withLangParam(url: string, lang?: string): string {
    if (!lang) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}lang=${encodeURIComponent(lang)}`;
  }
}
