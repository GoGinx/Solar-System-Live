import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { EphemerisSnapshot } from '../models/planet';
import { BodyEphemerisPayload } from '../models/body-ephemeris';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RealEphemerisService {
  private readonly baseUrl = environment.apiBaseUrl || 'http://localhost:3000/api/ephemeris';

  constructor(private http: HttpClient) {}

  getCurrentPlanetPositions(options?: {
    forceRefresh?: boolean;
    fullSnapshot?: boolean;
  }): Observable<EphemerisSnapshot> {
    const path = options?.fullSnapshot ? 'planets/full' : 'planets';
    return this.http.get<EphemerisSnapshot>(`${this.baseUrl}/${path}`, {
      params: options?.forceRefresh ? { refresh: '1' } : undefined
    });
  }

  getBodyEphemeris(id: string, options?: { forceRefresh?: boolean }): Observable<BodyEphemerisPayload> {
    return this.http.get<BodyEphemerisPayload>(`${this.baseUrl}/body/${encodeURIComponent(id)}`, {
      params: options?.forceRefresh ? { refresh: '1' } : undefined
    });
  }
}
