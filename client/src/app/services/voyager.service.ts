import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { VoyagerSnapshot } from '../models/voyager';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class VoyagerService {
  private readonly baseUrl = (() => {
    const base = environment.apiBaseUrl || 'http://localhost:3000/api/ephemeris';
    // Si l’URL pointe déjà sur /api/ephemeris, on remonte d’un niveau.
    return base.replace(/\/ephemeris\/?$/, '');
  })();

  constructor(private http: HttpClient) {}

  getVoyagers(options?: { forceRefresh?: boolean }): Observable<VoyagerSnapshot> {
    return this.http.get<VoyagerSnapshot>(`${this.baseUrl}/voyagers`, {
      params: options?.forceRefresh ? { refresh: '1' } : undefined
    });
  }
}
