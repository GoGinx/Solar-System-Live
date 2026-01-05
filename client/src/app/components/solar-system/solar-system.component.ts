import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import {
  Subscription,
  animationFrames,
  catchError,
  distinctUntilChanged,
  forkJoin,
  interval,
  of,
  sampleTime,
  startWith,
  switchMap
} from 'rxjs';

import { BodyEphemerisPayload } from '../../models/body-ephemeris';
import { Moon } from '../../models/moon';
import { Planet, PlanetPosition, EphemerisSnapshot } from '../../models/planet';
import { Star } from '../../models/star';
import { RealEphemerisService } from '../../services/real-ephemeris.service';
import { SolarSystemCatalogService } from '../../services/solar-system-catalog.service';
import { TimeScrubberService } from '../../services/time-scrubber.service';
import { I18nService } from '../../services/i18n.service';

interface DisplayPlanet {
  planet: Planet;
  x: number;
  y: number;
  radiusPx: number;
  textureRotationDeg: number;
  textureUrl: string;
  sunDirX: number;
  sunDirY: number;
  gradFx: string;
  gradFy: string;
  lightColor: string;
  baseColor: string;
  darkColor: string;
  subsolarLatitudeDeg: number | null;
  northPoleLit: boolean | null;
  southPoleLit: boolean | null;
  isSelected: boolean;
}

interface DisplaySatellite {
  moon: Moon;
  x: number;
  y: number;
  isSelected: boolean;
}

type SelectedBody =
  | { kind: 'star'; star: Star }
  | { kind: 'planet'; planet: Planet }
  | { kind: 'moon'; planet: Planet; moon: Moon };

@Component({
  selector: 'app-solar-system',
  templateUrl: './solar-system.component.html',
  styleUrls: ['./solar-system.component.css']
})
export class SolarSystemComponent implements OnInit, OnDestroy {
  planets: Planet[] = [];
  displayPlanets: DisplayPlanet[] = [];

  star: Star | null = null;
  focusedPlanet: Planet | null = null;
  displaySatellites: DisplaySatellite[] = [];

  selected: SelectedBody | null = null;
  selectedEphemeris: PlanetPosition | BodyEphemerisPayload | null = null;

  width = 800;
  height = 800;
  centerX = 400;
  centerY = 400;

  private maxSemiMajorAxisAu = 30.1;
  private lastSnapshot: EphemerisSnapshot | null = null;
  private sub?: Subscription;
  private catalogSub?: Subscription;
  private sunSub?: Subscription;
  private moonsSub?: Subscription;
  private timeSub?: Subscription;
  private frameSub?: Subscription;
  private offsetDays = 0;
  private nowMs = Date.now();
  private sunEphemerisRaw: BodyEphemerisPayload | null = null;

  private readonly moonEphemerides = new Map<string, BodyEphemerisPayload>();
  private readonly planetStyleCache = new Map<
    string,
    { textureUrl: string; lightColor: string; baseColor: string; darkColor: string }
  >();

  readonly refreshIntervalMs = 5_000;
  readonly selectedPlanetScale = 2.1;
  private readonly rotationEpochMs = Date.UTC(2025, 0, 1);
  private readonly orbitEpochMs = Date.UTC(2025, 0, 1);
  private readonly textureByPlanet: Record<Planet['name'], string> = {
    mercury: 'assets/textures/mercury.png',
    venus: 'assets/textures/venus.png',
    earth: 'assets/textures/earth.png',
    mars: 'assets/textures/mars.png',
    jupiter: 'assets/textures/jupiter.png',
    saturn: 'assets/textures/saturn.png',
    uranus: 'assets/textures/uranus.png',
    neptune: 'assets/textures/neptune.png',
    pluto: 'assets/textures/pluto.png'
  };

  constructor(
    private catalog: SolarSystemCatalogService,
    private ephemerisService: RealEphemerisService,
    private time: TimeScrubberService,
    private i18n: I18nService
  ) {}

  trackByPlanetName(_: number, dp: DisplayPlanet): string {
    return dp.planet.name;
  }

  trackByMoonId(_: number, s: DisplaySatellite): string {
    return s.moon.id;
  }

  private isSelectedPlanet(
    selected: SelectedBody | null
  ): selected is { kind: 'planet'; planet: Planet } {
    return !!selected && selected.kind === 'planet';
  }

  private isSelectedMoon(
    selected: SelectedBody | null
  ): selected is { kind: 'moon'; planet: Planet; moon: Moon } {
    return !!selected && selected.kind === 'moon';
  }

  private isSelectedStar(
    selected: SelectedBody | null
  ): selected is { kind: 'star'; star: Star } {
    return !!selected && selected.kind === 'star';
  }

  ngOnInit(): void {
    this.catalogSub = this.i18n.lang$
      .pipe(
        distinctUntilChanged(),
        switchMap((lang) => this.catalog.getCatalog(lang))
      )
      .subscribe({
        next: (c) => {
          this.star = c.star ?? null;
          this.planets = c.planets ?? [];
          if (this.focusedPlanet) {
            this.focusedPlanet = this.planets.find((p) => p.name === this.focusedPlanet?.name) ?? null;
          }
          const selected = this.selected;
          if (this.isSelectedPlanet(selected)) {
            const updated = this.planets.find((p) => p.name === selected.planet.name);
            if (updated) {
              this.selected = { kind: 'planet', planet: updated };
            }
          } else if (this.isSelectedMoon(selected)) {
            const parent = this.planets.find((p) => p.name === selected.planet.name);
            const moon = parent?.moons?.find((m) => m.id === selected.moon.id);
            if (parent && moon) {
              this.selected = { kind: 'moon', planet: parent, moon };
            }
          } else if (this.isSelectedStar(selected) && this.star) {
            this.selected = { kind: 'star', star: this.star };
          }
          this.maxSemiMajorAxisAu =
            this.planets.reduce((max, p) => (p.semiMajorAxisAU > max ? p.semiMajorAxisAU : max), 0) ||
            30.1;
          this.rebuildPlanetStyleCache();
          this.refreshDisplay();
          this.refreshSatellitesDisplay();
        },
        error: () => {
          // Fallback: le composant peut fonctionner sans catalogue.
        }
      });

    this.updateDimensionsFromWindow();
    this.startPolling();
    this.startAnimationLoop();

    this.timeSub = this.time.offsetDays$.subscribe((days) => {
      this.offsetDays = days;
      this.refreshDisplay();
      this.refreshSelectedEphemeris();
      this.refreshSatellitesDisplay();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.catalogSub?.unsubscribe();
    this.catalogSub = undefined;
    this.sunSub?.unsubscribe();
    this.sunSub = undefined;
    this.moonsSub?.unsubscribe();
    this.moonsSub = undefined;
    this.timeSub?.unsubscribe();
    this.timeSub = undefined;
    this.frameSub?.unsubscribe();
    this.frameSub = undefined;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateDimensionsFromWindow();
    this.refreshDisplay();
    this.refreshSatellitesDisplay();
  }

  private updateDimensionsFromWindow(): void {
    this.width = Math.max(320, window.innerWidth);
    this.height = Math.max(320, window.innerHeight);
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
  }

  private startPolling(): void {
    this.sub?.unsubscribe();
    this.sub = interval(this.refreshIntervalMs)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.ephemerisService
            .getCurrentPlanetPositions({ fullSnapshot: true, forceRefresh: true })
            .pipe(catchError(() => of(null)))
        )
      )
      .subscribe({
        next: (snapshot) => {
          if (!snapshot) return;
          this.lastSnapshot = snapshot;
          this.refreshDisplay();
          this.refreshSelectedEphemeris();
          this.refreshSatellitesDisplay();
        },
        error: () => {
          // On garde la derniere carte affichee si l'API tombe.
        }
      });
  }

  private startAnimationLoop(): void {
    this.frameSub?.unsubscribe();
    this.frameSub = animationFrames()
      .pipe(sampleTime(33))
      .subscribe(() => {
        this.nowMs = Date.now();
        this.refreshDisplay();
        this.refreshSelectedEphemeris();
        this.refreshSatellitesDisplay();
      });
  }

  onSunClick(): void {
    if (!this.star) return;
    this.focusedPlanet = null;
    this.displaySatellites = [];
    this.moonEphemerides.clear();
    this.moonsSub?.unsubscribe();
    this.moonsSub = undefined;
    this.sunEphemerisRaw = null;

    this.selected = { kind: 'star', star: this.star };
    this.displayPlanets = this.displayPlanets.map((dp) => ({ ...dp, isSelected: false }));
    this.selectedEphemeris = null;
    this.startSunPolling();
  }

  onPlanetClick(planet: Planet): void {
    this.stopSunPolling();
    this.focusedPlanet = planet;
    this.selected = { kind: 'planet', planet };
    this.selectedEphemeris = null;
    this.refreshSelectedEphemeris();
    this.startMoonsPollingForFocusedPlanet();

    this.displayPlanets = this.displayPlanets.map((dp) => ({
      ...dp,
      isSelected: dp.planet.name === planet.name
    }));
  }

  onMoonClick(moon: Moon): void {
    if (!this.focusedPlanet) return;
    this.stopSunPolling();
    this.selected = { kind: 'moon', planet: this.focusedPlanet, moon };
    this.refreshSelectedEphemeris();
    this.refreshSatellitesDisplay();
  }

  onCloseInfo(): void {
    this.selected = null;
    this.selectedEphemeris = null;
    this.focusedPlanet = null;
    this.displaySatellites = [];
    this.moonEphemerides.clear();
    this.sunEphemerisRaw = null;
    this.stopSunPolling();
    this.moonsSub?.unsubscribe();
    this.moonsSub = undefined;
    this.displayPlanets = this.displayPlanets.map((dp) => ({ ...dp, isSelected: false }));
  }

  get selectedCatalogBody(): Planet | Moon | Star | null {
    if (!this.selected) return null;
    if (this.selected.kind === 'planet') return this.selected.planet;
    if (this.selected.kind === 'moon') return this.selected.moon;
    return this.selected.star;
  }

  get selectedKind(): SelectedBody['kind'] {
    return this.selected?.kind ?? 'planet';
  }

  get selectedDisplayPlanet(): DisplayPlanet | null {
    const selected = this.selected;
    if (!selected || selected.kind === 'star') return null;
    return this.displayPlanets.find((dp) => dp.planet.name === selected.planet.name) ?? null;
  }

  get selectedLighting(): { subsolarLatitudeDeg: number | null; northPoleLit: boolean | null; southPoleLit: boolean | null } | null {
    if (this.selected?.kind !== 'planet') return null;
    const dp = this.selectedDisplayPlanet;
    if (!dp) return null;
    return {
      subsolarLatitudeDeg: dp.subsolarLatitudeDeg,
      northPoleLit: dp.northPoleLit,
      southPoleLit: dp.southPoleLit
    };
  }

  getOrbitRadiusPx(planet: Planet): number {
    return this.distanceToPixels(planet.semiMajorAxisAU);
  }

  planetRadiusToPixels(planet: Planet): number {
    const minPx = 3.2;
    const maxPx = 14;
    const log = Math.log10(planet.radiusKm);
    const logMin = Math.log10(1188.3); // Pluton
    const logMax = Math.log10(69911); // Jupiter
    const t = (log - logMin) / (logMax - logMin);
    return minPx + Math.max(0, Math.min(1, t)) * (maxPx - minPx);
  }

  private distanceToPixels(distanceAu: number): number {
    const maxRadiusPx = Math.min(this.width, this.height) / 2 - 40;
    const clamped = Math.max(0, Math.min(distanceAu, this.maxSemiMajorAxisAu));
    const normalized =
      Math.log10(1 + clamped) / Math.log10(1 + Math.max(1e-6, this.maxSemiMajorAxisAu));
    return normalized * maxRadiusPx;
  }

  private refreshDisplay(): void {
    const positions = new Map<string, PlanetPosition>();
    if (this.lastSnapshot?.bodies?.length) {
      for (const b of this.lastSnapshot.bodies) {
        positions.set(b.name, b);
      }
    }

    this.displayPlanets = this.planets.map((planet, idx) => {
      const style = this.getPlanetStyle(planet);
      const fallback = this.computeFallbackOrbitPosition(planet, idx);
      let vec = fallback;

      const pos = positions.get(planet.name);
      if (pos && this.isFinitePosition(pos)) {
        const advanced = this.advanceStateVector(
          pos,
          pos.timestamp || this.lastSnapshot?.timestamp,
          planet
        );
        if (this.isFiniteVector(advanced)) {
          vec = advanced;
        }
      }

      const { x, y, z } = vec;

      const rAu = Math.sqrt(x * x + y * y + z * z) || 1e-6;
      const angle = Math.atan2(y, x);
      const rPx = this.distanceToPixels(rAu);
      const screenX = this.centerX + rPx * Math.cos(angle);
      const screenY = this.centerY + rPx * Math.sin(angle);
      const radiusPx = this.planetRadiusToPixels(planet);

      const sunDx = this.centerX - screenX;
      const sunDy = this.centerY - screenY;
      const sunLen = Math.sqrt(sunDx * sunDx + sunDy * sunDy) || 1e-9;
      const sunDirX = sunDx / sunLen;
      const sunDirY = sunDy / sunLen;
      const gradFx = `${(this.clamp01(0.5 + sunDirX * 0.33) * 100).toFixed(1)}%`;
      const gradFy = `${(this.clamp01(0.5 + sunDirY * 0.33) * 100).toFixed(1)}%`;

      const lighting = this.computePlanetPoleLighting(planet, { x_au: x, y_au: y, z_au: z });

      return {
        planet,
        x: screenX,
        y: screenY,
        radiusPx,
        textureRotationDeg: this.computeTextureRotationDeg(planet),
        textureUrl: style.textureUrl,
        sunDirX,
        sunDirY,
        gradFx,
        gradFy,
        lightColor: style.lightColor,
        baseColor: style.baseColor,
        darkColor: style.darkColor,
        subsolarLatitudeDeg: lighting?.subsolarLatitudeDeg ?? null,
        northPoleLit: lighting?.northPoleLit ?? null,
        southPoleLit: lighting?.southPoleLit ?? null,
        isSelected:
          (this.selected?.kind === 'planet' && this.selected.planet.name === planet.name) ||
          (this.selected?.kind === 'moon' && this.selected.planet.name === planet.name)
      };
    });
  }

  private refreshSelectedEphemeris(): void {
    const selected = this.selected;
    if (!selected) {
      this.selectedEphemeris = null;
      return;
    }

    if (selected.kind === 'planet') {
      if (!this.lastSnapshot) {
        this.selectedEphemeris = null;
        return;
      }

      const targetPlanet = selected.planet;
      const ephem = this.lastSnapshot.bodies.find((b) => b.name === targetPlanet.name) ?? null;
      if (!ephem) {
        this.selectedEphemeris = null;
        return;
      }

      const advanced = this.advanceStateVector(
        ephem,
        ephem.timestamp || this.lastSnapshot.timestamp,
        targetPlanet
      );
      const baseTs = Date.parse(ephem.timestamp || this.lastSnapshot.timestamp || '');
      const ts = Number.isFinite(baseTs)
        ? new Date(baseTs + this.effectiveDaysFromTimestamp(ephem.timestamp || this.lastSnapshot.timestamp) * 86_400_000).toISOString()
        : ephem.timestamp;

      this.selectedEphemeris = { ...ephem, x_au: advanced.x, y_au: advanced.y, z_au: advanced.z, timestamp: ts };
      return;
    }

    if (selected.kind === 'moon') {
      const raw = this.moonEphemerides.get(selected.moon.id) ?? null;
      this.selectedEphemeris = raw ? this.adjustBodyEphemeris(raw) : null;
      return;
    }

    if (selected.kind === 'star') {
      this.selectedEphemeris = this.sunEphemerisRaw ? this.adjustBodyEphemeris(this.sunEphemerisRaw) : null;
      return;
    }
  }

  private startSunPolling(): void {
    this.stopSunPolling();
    this.sunSub = interval(this.refreshIntervalMs)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.ephemerisService
            .getBodyEphemeris('sun', { forceRefresh: true })
            .pipe(catchError(() => of(null)))
        )
      )
      .subscribe({
        next: (payload) => {
          if (!payload) return;
          if (this.selected?.kind !== 'star') return;
          this.sunEphemerisRaw = payload;
          this.selectedEphemeris = this.adjustBodyEphemeris(payload);
        },
        error: () => {
          // Pas bloquant.
        }
      });
  }

  private stopSunPolling(): void {
    this.sunSub?.unsubscribe();
    this.sunSub = undefined;
  }

  private startMoonsPollingForFocusedPlanet(): void {
    const planet = this.focusedPlanet;
    const moons = planet?.moons ?? [];

    this.moonsSub?.unsubscribe();
    this.moonsSub = undefined;
    this.moonEphemerides.clear();
    this.displaySatellites = [];

    if (!planet || moons.length === 0) {
      return;
    }

    this.moonsSub = interval(this.refreshIntervalMs)
      .pipe(
        startWith(0),
        switchMap(() =>
          forkJoin(
            moons.map((m) =>
              this.ephemerisService
                .getBodyEphemeris(m.id, { forceRefresh: true })
                .pipe(catchError(() => of(null)))
            )
          )
        )
      )
      .subscribe({
        next: (results) => {
          for (const payload of results) {
            if (!payload) continue;
            this.moonEphemerides.set(payload.id, payload);
          }
          this.refreshSatellitesDisplay();
          if (this.selected?.kind === 'moon') {
            this.refreshSelectedEphemeris();
          }
        },
        error: () => {
          // Pas bloquant.
        }
      });
  }

  private refreshSatellitesDisplay(): void {
    const planet = this.focusedPlanet;
    if (!planet) {
      this.displaySatellites = [];
      return;
    }

    const dp = this.displayPlanets.find((d) => d.planet.name === planet.name) ?? null;
    if (!dp) {
      this.displaySatellites = [];
      return;
    }

    const moons = planet.moons ?? [];
    if (moons.length === 0) {
      this.displaySatellites = [];
      return;
    }

    const planetEphem = this.lastSnapshot?.bodies.find((b) => b.name === planet.name) ?? null;
    let planetX = 0;
    let planetY = 0;
    let planetZ = 0;
    let canUseEphem = false;
    if (planetEphem) {
      const advancedPlanet = this.advanceStateVector(
        planetEphem,
        planetEphem.timestamp || this.lastSnapshot?.timestamp,
        planet
      );
      if (this.isFiniteVector(advancedPlanet)) {
        planetX = advancedPlanet.x;
        planetY = advancedPlanet.y;
        planetZ = advancedPlanet.z;
        canUseEphem = true;
      }
    }

    this.displaySatellites = moons
      .map((moon, idx) => {
        if (canUseEphem) {
          const raw = this.moonEphemerides.get(moon.id);
          if (raw) {
            const m = this.adjustBodyEphemeris(raw);
            const dx = m.x_au - planetX;
            const dy = m.y_au - planetY;
            const dz = m.z_au - planetZ;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
            const angle = Math.atan2(dy, dx);

            const planetR = this.planetRadiusToPixels(planet);
            const extra = Math.min(30, Math.max(8, Math.log10(1 + dist * 20_000) * 8));
            const offsetPx = planetR + 8 + extra + (idx % 3) * 1.5;

            return {
              moon,
              x: dp.x + offsetPx * Math.cos(angle),
              y: dp.y + offsetPx * Math.sin(angle),
              isSelected: this.selected?.kind === 'moon' && this.selected.moon.id === moon.id
            } as DisplaySatellite;
          }
        }

        const fallback = this.computeFallbackMoonOffset(planet, idx, moons.length);
        return {
          moon,
          x: dp.x + fallback.x,
          y: dp.y + fallback.y,
          isSelected: this.selected?.kind === 'moon' && this.selected.moon.id === moon.id
        } as DisplaySatellite;
      })
      .filter((v): v is DisplaySatellite => !!v);
  }

  private adjustBodyEphemeris(ephem: BodyEphemerisPayload): BodyEphemerisPayload {
    const { x, y, z } = this.advanceStateVector(ephem, ephem.timestamp);
    const baseTs = Date.parse(ephem.timestamp || '');
    const ts = Number.isFinite(baseTs)
      ? new Date(baseTs + this.effectiveDaysFromTimestamp(ephem.timestamp) * 86_400_000).toISOString()
      : ephem.timestamp;
    return { ...ephem, x_au: x, y_au: y, z_au: z, timestamp: ts };
  }

  private advanceStateVector(
    vec: { x_au: number; y_au: number; z_au: number; vx?: number; vy?: number; vz?: number; timestamp?: string },
    timestampIso?: string,
    planet?: Planet | null
  ): { x: number; y: number; z: number } {
    const days = this.effectiveDaysFromTimestamp(timestampIso);
    if (
      planet &&
      Number.isFinite(planet.orbitalPeriodDays) &&
      (planet.orbitalPeriodDays ?? 0) > 0
    ) {
      const periodDays = planet.orbitalPeriodDays as number;
      const eRaw = planet.eccentricity ?? 0;
      const e = Number.isFinite(eRaw) ? Math.min(Math.max(eRaw, 0), 0.9) : 0;
      const baseAngle = Math.atan2(vec.y_au, vec.x_au);
      const rawR = Math.sqrt(vec.x_au * vec.x_au + vec.y_au * vec.y_au);
      const fallbackR =
        Number.isFinite(rawR) && rawR > 0 ? rawR : planet.semiMajorAxisAU || 1e-6;

      if (e > 0 && Number.isFinite(fallbackR) && fallbackR > 0) {
        const cosTheta0 = Math.cos(baseAngle);
        const sinTheta0 = Math.sin(baseAngle);
        const denom = 1 + e * cosTheta0;
        if (Number.isFinite(denom) && denom !== 0) {
          const sqrtOneMinusESq = Math.sqrt(1 - e * e);
          const cosE0 = (e + cosTheta0) / denom;
          const sinE0 = (sqrtOneMinusESq * sinTheta0) / denom;
          const E0 = Math.atan2(sinE0, cosE0);
          const M0 = E0 - e * Math.sin(E0);
          const meanMotion = (2 * Math.PI) / periodDays;
          const M = this.normalizeAngleRad(M0 + meanMotion * days);
          const E = this.solveKepler(M, e);
          const cosE = Math.cos(E);
          const sinE = Math.sin(E);
          const r = fallbackR * (1 - e * cosE) / (1 - e * Math.cos(E0));
          const denomTheta = 1 - e * cosE;
          if (Number.isFinite(denomTheta) && denomTheta !== 0 && Number.isFinite(r)) {
            const cosTheta = (cosE - e) / denomTheta;
            const sinTheta = (sqrtOneMinusESq * sinE) / denomTheta;
            return { x: r * cosTheta, y: r * sinTheta, z: vec.z_au };
          }
        }
      }

      const angle = baseAngle + (days / periodDays) * 2 * Math.PI;
      return { x: fallbackR * Math.cos(angle), y: fallbackR * Math.sin(angle), z: vec.z_au };
    }
    const x = vec.vx !== undefined ? vec.x_au + vec.vx * days : vec.x_au;
    const y = vec.vy !== undefined ? vec.y_au + vec.vy * days : vec.y_au;
    const z = vec.vz !== undefined ? vec.z_au + vec.vz * days : vec.z_au;
    return { x, y, z };
  }

  private effectiveDaysFromTimestamp(timestampIso?: string): number {
    const baseTs = Date.parse(timestampIso || '');
    const liveDays = Number.isFinite(baseTs) ? (this.nowMs - baseTs) / 86_400_000 : 0;
    return this.offsetDays + liveDays;
  }

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  private isFinitePosition(pos: PlanetPosition): boolean {
    return Number.isFinite(pos.x_au) && Number.isFinite(pos.y_au) && Number.isFinite(pos.z_au);
  }

  private isFiniteVector(vec: { x: number; y: number; z: number }): boolean {
    return Number.isFinite(vec.x) && Number.isFinite(vec.y) && Number.isFinite(vec.z);
  }

  private computeFallbackOrbitPosition(planet: Planet, index: number): { x: number; y: number; z: number } {
    const periodDays =
      Number.isFinite(planet.orbitalPeriodDays) && (planet.orbitalPeriodDays ?? 0) > 0
        ? planet.orbitalPeriodDays!
        : 365.25;
    const daysSinceEpoch = (this.nowMs - this.orbitEpochMs) / 86_400_000;
    const basePhase = (daysSinceEpoch / periodDays) * 2 * Math.PI;
    const offset =
      this.planets.length > 0 ? (index / this.planets.length) * 2 * Math.PI : 0;
    const angle = basePhase + offset;
    const a = planet.semiMajorAxisAU;
    const eRaw = planet.eccentricity ?? 0;
    const e = Number.isFinite(eRaw) ? Math.min(Math.max(eRaw, 0), 0.9) : 0;
    if (a && e > 0) {
      const M = this.normalizeAngleRad(angle);
      const E = this.solveKepler(M, e);
      const cosE = Math.cos(E);
      const sinE = Math.sin(E);
      const r = a * (1 - e * cosE);
      const denomTheta = 1 - e * cosE;
      const sqrtOneMinusESq = Math.sqrt(1 - e * e);
      const cosTheta = (cosE - e) / denomTheta;
      const sinTheta = (sqrtOneMinusESq * sinE) / denomTheta;
      return { x: r * cosTheta, y: r * sinTheta, z: 0 };
    }
    const r = Number.isFinite(a) ? (a as number) : 1e-6;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle), z: 0 };
  }

  private normalizeAngleRad(angle: number): number {
    const twoPi = 2 * Math.PI;
    const wrapped = ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    return wrapped;
  }

  private solveKepler(meanAnomaly: number, e: number): number {
    let E = meanAnomaly;
    for (let i = 0; i < 7; i += 1) {
      const f = E - e * Math.sin(E) - meanAnomaly;
      const fp = 1 - e * Math.cos(E);
      if (fp === 0) break;
      E = E - f / fp;
    }
    return E;
  }

  private computeFallbackMoonOffset(
    planet: Planet,
    index: number,
    count: number
  ): { x: number; y: number } {
    const planetR = this.planetRadiusToPixels(planet);
    const radius = planetR + 14 + index * 4;
    const daysSinceEpoch = (this.nowMs - this.orbitEpochMs) / 86_400_000;
    const speedDays = 7 + index * 3;
    const basePhase = (daysSinceEpoch / speedDays) * 2 * Math.PI;
    const offset = count > 0 ? (index / count) * 2 * Math.PI : 0;
    const angle = basePhase + offset;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }

  private computeTextureRotationDeg(planet: Planet): number {
    const periodHours = planet.rotationPeriodHours ?? 24;
    const periodMs = Math.abs(periodHours) * 3_600_000;
    if (!Number.isFinite(periodMs) || periodMs <= 0) return 0;
    const direction = periodHours < 0 ? -1 : 1;
    const deltaMs = this.nowMs - this.rotationEpochMs + this.offsetDays * 86_400_000;
    const phase = ((deltaMs % periodMs) + periodMs) % periodMs;
    return (phase / periodMs) * 360 * direction;
  }

  private parseHexColor(hex: string): { r: number; g: number; b: number } | null {
    const raw = hex.trim();
    const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(raw);
    if (!m) return null;
    const v = m[1];
    if (v.length === 3) {
      const r = parseInt(v[0] + v[0], 16);
      const g = parseInt(v[1] + v[1], 16);
      const b = parseInt(v[2] + v[2], 16);
      return { r, g, b };
    }
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    return { r, g, b };
  }

  private mixColor(color: string, target: string, t: number): string {
    const a = this.parseHexColor(color);
    const b = this.parseHexColor(target);
    if (!a || !b) return color;
    const tt = this.clamp01(t);
    const r = Math.round(a.r + (b.r - a.r) * tt);
    const g = Math.round(a.g + (b.g - a.g) * tt);
    const bb = Math.round(a.b + (b.b - a.b) * tt);
    return `rgb(${r}, ${g}, ${bb})`;
  }

  private rebuildPlanetStyleCache(): void {
    this.planetStyleCache.clear();
    for (const planet of this.planets) {
      this.planetStyleCache.set(planet.name, {
        textureUrl: this.textureByPlanet[planet.name],
        lightColor: this.mixColor(planet.color, '#ffffff', 0.55),
        baseColor: this.mixColor(planet.color, '#ffffff', 0.08),
        darkColor: this.mixColor(planet.color, '#000000', 0.72)
      });
    }
  }

  private getPlanetStyle(
    planet: Planet
  ): { textureUrl: string; lightColor: string; baseColor: string; darkColor: string } {
    return (
      this.planetStyleCache.get(planet.name) ?? {
        textureUrl: this.textureByPlanet[planet.name],
        lightColor: this.mixColor(planet.color, '#ffffff', 0.55),
        baseColor: this.mixColor(planet.color, '#ffffff', 0.08),
        darkColor: this.mixColor(planet.color, '#000000', 0.72)
      }
    );
  }

  private computePlanetPoleLighting(
    planet: Planet,
    pos: { x_au: number; y_au: number; z_au: number }
  ): { subsolarLatitudeDeg: number; northPoleLit: boolean; southPoleLit: boolean } | null {
    const tilt = planet.axialTiltDeg;
    if (tilt === undefined || tilt === null || !Number.isFinite(tilt)) return null;

    const effectiveTilt = tilt <= 90 ? tilt : 180 - tilt;
    const lambda = Math.atan2(pos.y_au, pos.x_au);
    const subsolarLatitudeDeg = effectiveTilt * Math.sin(lambda);
    const eps = 1e-9;
    return {
      subsolarLatitudeDeg,
      northPoleLit: subsolarLatitudeDeg > eps,
      southPoleLit: subsolarLatitudeDeg < -eps
    };
  }
}
