import {
  Component,
  OnInit,
  OnDestroy,
  HostListener
} from '@angular/core';
import { Subscription, interval, startWith, switchMap, finalize, Observable } from 'rxjs';

import {
  Planet,
  EphemerisSnapshot,
  PlanetPosition
} from '../../models/planet';
import { PlanetService } from '../../services/planet.service';
import { RealEphemerisService } from '../../services/real-ephemeris.service';
import { VoyagerService } from '../../services/voyager.service';
import { VoyagerData, VoyagerSnapshot } from '../../models/voyager';
import { DsnContact, DsnService } from '../../services/dsn.service';

type ViewMode = '2d' | '3d';
type PlanetNameType = Planet['name'];

interface DisplayPlanet {
  planet: Planet;
  x: number;
  y: number;
  rAu: number;
  isSelected: boolean;
  isFocused: boolean;
  axis?: { x1: number; y1: number; x2: number; y2: number };
  shadow?: { cx: number; cy: number; rx: number; ry: number };
}

interface VoyagerMarker {
  id: VoyagerData['id'];
  name: string;
  x: number;
  y: number;
  rAu: number;
  distanceLabel: string;
  color: string;
}

interface VoyagerView extends VoyagerData {
  distanceFromEarth: {
    au: number | null;
    km: number | null;
    miles: number | null;
    lightTimeMin?: number | null;
    lightTimeHours?: number | null;
  };
  lightTime: Required<NonNullable<VoyagerData['lightTime']>>;
  trajectory: NonNullable<VoyagerData['trajectory']>;
  communication?: DsnContact | null;
  spark24hPath?: string | null;
  spark7dPath?: string | null;
}

const MS_PER_DAY = 86_400_000;
const KM_PER_AU = 149_597_870.7;
const SPEED_OF_LIGHT_KM_S = 299_792.458;
const VOYAGER_COLORS: Record<VoyagerData['id'], string> = {
  voyager1: '#7fe3ff',
  voyager2: '#ffb347'
};

@Component({
  selector: 'app-solar-system',
  templateUrl: './solar-system.component.html',
  styleUrls: ['./solar-system.component.css']
})
export class SolarSystemComponent implements OnInit, OnDestroy {
  /**
   * Métadonnées des planètes (rayon, masse, demi-grand axe…).
   * Fournies par PlanetService (valeurs physiques “moyennes”).
   */
  planets: Planet[] = [];

  /**
   * Planète actuellement sélectionnée (pour affichage dans PlanetInfoPanel).
   */
  selectedPlanet: Planet | null = null;
  selectedEphemeris: PlanetPosition | null = null;

  /**
   * Données projetées sur l’écran (positions en pixels) dérivées
   * des éphémérides réelles fournies par le backend.
   */
  displayPlanets: DisplayPlanet[] = [];

  /**
   * Dimensions logiques du SVG (viewBox).
   * Elles peuvent être ajustées sur resize pour rester responsives.
   */
  width = 800;
  height = 800;
  centerX = this.width / 2;
  centerY = this.height / 2;

  /**
   * Mode de vue : 2D (vue du dessus) ou 3D (projection oblique).
   * Ne modifie que la projection, pas les coordonnées physiques (X,Y,Z).
   */
  viewMode: ViewMode = '2d';

  /**
   * Timelapse : décalage temporel (en jours) appliqué aux éphémérides reçues.
   * Un slider permet d’avancer/reculer d’un an, avec des pas jour/semaine/mois.
   */
  timeOffsetDays = 0;
  readonly maxTimeOffsetDays = 365;
  timeStepDays = 1;

  /**
   * Options d’affichage avancées en vue 3D.
   */
  showOrbitalPlanes = true;
  showPlanetAxes = true;
  showShadows = true;

  /**
   * Angle de caméra utilisé en projection 3D (rotation dans le plan Y–Z).
   */
  cameraAngleRad = Math.PI / 6; // ≈ 30°

  /**
   * Longueur (en pixels) correspondant à 1 UA dans l’échelle radiale compressée.
   * Affichée dans la barre d’échelle.
   */
  oneAuPixels = 0;

  /**
   * Valeur max du demi-grand axe (en UA) parmi les planètes.
   * Sert de référence pour compresser l’échelle radiale (Neptune ~ max).
   */
  private maxSemiMajorAxisAu = 30.1; // valeur par défaut, réajustée en ngOnInit
  focusPlanetName: PlanetNameType | null = null;

  /**
   * Dernier snapshot d’éphémérides reçu (positions réelles).
   * Permet de recalculer l’affichage sur changement de mode ou resize
   * sans réinterroger le backend.
   */
  private lastSnapshot: EphemerisSnapshot | null = null;
  metadata: EphemerisSnapshot['metadata'] | null = null;
  private snapshotReceivedAt: number | null = null;
  private lastLatencyTimestamp: string | null = null;
  autoRefreshEnabled = true;
  readonly refreshIntervalMs = 60_000;
  lastCacheStatus: 'HIT' | 'MISS' | 'STALE' | 'FROZEN' | null = null;
  lastCacheBackend: 'memory' | 'redis' | null = null;
  cacheAgeMs: number | null = null;
  cacheTtlMs: number | null = null;
  currentLatencyMs: number | null = null;
  frozenSnapshot = false;
  freezeReason: string | null = null;
  lastRequestId: string | null = null;
  lastVoyagerRequestId: string | null = null;
  lastVoyagerTimestamp: string | null = null;
  voyagers: VoyagerData[] = [];
  voyagerViews: VoyagerView[] = [];
  voyagerError: string | null = null;
  voyagerLoading = false;
  voyagerMarkers: VoyagerMarker[] = [];
  copyStatus: 'idle' | 'success' | 'error' = 'idle';
  copyMessage: string | null = null;
  private voyagerSub?: Subscription;
  dsnContacts: DsnContact[] = [];
  dsnError: string | null = null;
  private dsnSub?: Subscription;

  /**
   * Abonnement au flux de mise à jour périodique des éphémérides.
   */
  private ephemerisSub?: Subscription;
  private animationFrameId: number | null = null;
  enableInertialPlayback = true;
  private readonly msPerDay = 86_400_000;
  private latencySumMs = 0;
  private latencyCount = 0;
  private lastPanX = 0;
  private lastPanY = 0;

  /**
   * Indicateur de chargement (optionnel, au cas où tu veux l’exploiter dans le template).
   */
  isLoading = false;

  /**
   * Message d’erreur éventuel lors de l’appel au backend.
   */
  errorMessage: string | null = null;

  /**
   * Timestamp de la dernière mise à jour (vient du backend).
   */
  lastUpdateTimestamp: string | null = null;

  constructor(
    private planetService: PlanetService,
    private ephemerisService: RealEphemerisService,
    private voyagerService: VoyagerService,
    private dsnService: DsnService
  ) {}

  // ---------------------------------------------------------------------------
  // Cycle de vie
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.planets = this.planetService.getPlanets();

    // Détermine le plus grand demi-grand axe pour l’échelle
    this.maxSemiMajorAxisAu =
      this.planets.reduce(
        (max, p) => (p.semiMajorAxisAU > max ? p.semiMajorAxisAU : max),
        0
      ) || 30.1;

    // Initialisation des dimensions (responsive basique)
    this.updateDimensionsFromWindow();
    this.oneAuPixels = this.distanceToPixels(1);

    this.startAutoRefresh();
    this.startVoyagerAutoRefresh();
    this.startDsnAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.stopInertialAnimation();
    this.stopVoyagerAutoRefresh();
    this.stopDsnAutoRefresh();
  }

  // ---------------------------------------------------------------------------
  // Rafraîchissement / appels API
  // ---------------------------------------------------------------------------

  private fetchSnapshot(options?: { forceRefresh?: boolean }): Observable<EphemerisSnapshot> {
    this.isLoading = true;
    this.errorMessage = null;

    return this.ephemerisService
      .getCurrentPlanetPositions(options)
      .pipe(finalize(() => (this.isLoading = false)));
  }

  private handleSnapshot(snapshot: EphemerisSnapshot): void {
    this.errorMessage = null;
    this.lastSnapshot = snapshot;
    this.snapshotReceivedAt = Date.now();
    this.metadata = snapshot.metadata ?? null;
    this.lastUpdateTimestamp = snapshot.timestamp || new Date().toISOString();
    this.frozenSnapshot = !!snapshot.metadata?.frozenSnapshot;
    this.freezeReason = snapshot.metadata?.freezeReason ?? null;
    this.lastRequestId = snapshot.metadata?.requestId ?? null;
    this.trackLatency(snapshot);
    this.trackCache(snapshot);
    this.updateDisplayFromSnapshot(snapshot);
    this.startInertialAnimation();
    this.refreshSelectedEphemeris();
    this.enrichVoyagerViews();
  }

  private handleSnapshotError(err: unknown): void {
    console.error('Erreur éphémérides:', err);
    this.errorMessage =
      'Erreur lors de la récupération des positions réelles des planètes.';
    if (this.lastSnapshot) {
      this.frozenSnapshot = true;
      this.freezeReason = 'Dernière réponse Horizons indisponible. Données précédentes affichées.';
    }
  }

  private fetchVoyagers(): Observable<VoyagerSnapshot> {
    this.voyagerLoading = true;
    this.voyagerError = null;
    return this.voyagerService.getVoyagers().pipe(finalize(() => (this.voyagerLoading = false)));
  }

  private handleVoyagers(snapshot: VoyagerSnapshot): void {
    this.voyagerError = null;
    this.voyagers = snapshot.voyagers ?? [];
    this.lastVoyagerRequestId = snapshot.requestId ?? this.lastVoyagerRequestId;
    this.lastRequestId = snapshot.requestId ?? this.lastRequestId;
    this.lastVoyagerTimestamp = snapshot.timestamp ?? this.lastVoyagerTimestamp;
    this.enrichVoyagerViews();
  }

  private handleVoyagerError(err: unknown): void {
    console.error('Erreur Voyager:', err);
    this.voyagerError = 'Impossible de récupérer les données Voyager pour le moment.';
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.autoRefreshEnabled = true;

    this.ephemerisSub = interval(this.refreshIntervalMs)
      .pipe(
        startWith(0),
        switchMap(() => this.fetchSnapshot())
      )
      .subscribe({
        next: (snapshot) => this.handleSnapshot(snapshot),
        error: (err) => this.handleSnapshotError(err)
      });
  }

  private stopAutoRefresh(): void {
    this.ephemerisSub?.unsubscribe();
    this.ephemerisSub = undefined;
  }

  private startVoyagerAutoRefresh(): void {
    this.stopVoyagerAutoRefresh();
    this.voyagerSub = interval(this.refreshIntervalMs * 5)
      .pipe(
        startWith(0),
        switchMap(() => this.fetchVoyagers())
      )
      .subscribe({
        next: (snapshot) => this.handleVoyagers(snapshot),
        error: (err) => this.handleVoyagerError(err)
      });
  }

  private stopVoyagerAutoRefresh(): void {
    this.voyagerSub?.unsubscribe();
    this.voyagerSub = undefined;
  }

  private startDsnAutoRefresh(): void {
    this.stopDsnAutoRefresh();
    this.dsnSub = interval(this.refreshIntervalMs * 5)
      .pipe(
        startWith(0),
        switchMap(() => this.dsnService.getContacts())
      )
      .subscribe({
        next: (contacts) => {
          this.dsnError = null;
          this.dsnContacts = contacts;
          this.enrichVoyagerViews();
        },
        error: (err) => {
          console.error('Erreur DSN:', err);
          this.dsnError = 'Statut DSN indisponible pour le moment.';
        }
      });
  }

  private stopDsnAutoRefresh(): void {
    this.dsnSub?.unsubscribe();
    this.dsnSub = undefined;
  }

  toggleAutoRefresh(): void {
    if (this.autoRefreshEnabled) {
      this.autoRefreshEnabled = false;
      this.stopAutoRefresh();
    } else {
      this.startAutoRefresh();
    }
  }

  triggerManualRefresh(forceNetwork = false): void {
    this.fetchSnapshot({ forceRefresh: forceNetwork }).subscribe({
      next: (snapshot) => this.handleSnapshot(snapshot),
      error: (err) => this.handleSnapshotError(err)
    });

    // Rafraîchit aussi les données Voyager pour garder la cohérence temporelle
    this.fetchVoyagers().subscribe({
      next: (snapshot) => this.handleVoyagers(snapshot),
      error: (err) => this.handleVoyagerError(err)
    });

    this.dsnService.getContacts().subscribe({
      next: (contacts) => {
        this.dsnContacts = contacts;
        this.dsnError = null;
        this.enrichVoyagerViews();
      },
      error: (err) => {
        console.error('Erreur DSN:', err);
        this.dsnError = 'Statut DSN indisponible pour le moment.';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Gestion de la fenêtre (responsivité)
  // ---------------------------------------------------------------------------

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateDimensionsFromWindow();
    this.oneAuPixels = this.distanceToPixels(1);

    // Si on a déjà des données d’éphémérides, on recalcule les positions
    if (this.lastSnapshot) {
      this.updateDisplayFromSnapshot(this.lastSnapshot);
    }
  }

  /**
   * Ajuste la largeur/hauteur du SVG en fonction de la taille de la fenêtre,
   * en gardant un canvas carré centré et une marge raisonnable.
   */
  private updateDimensionsFromWindow(): void {
    const viewportWidth = window.innerWidth || 1024;
    const maxSvg = 800;

    // Petite marge latérale pour ne pas coller au bord de la fenêtre
    const targetWidth = Math.min(viewportWidth - 64, maxSvg);

    this.width = targetWidth > 320 ? targetWidth : 320;
    this.height = this.width; // carré

    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
  }

  // ---------------------------------------------------------------------------
  // Échelle & projection
  // ---------------------------------------------------------------------------

  /**
   * Conversion d’une distance en UA vers une distance en pixels,
   * en utilisant une compression radiale (sqrt) pour garder les planètes
   * externes visibles dans le même cadre.
   */
  private distanceToPixels(au: number): number {
    if (au <= 0) {
      return 0;
    }

    const maxRadiusPx = Math.min(this.width, this.height) / 2 - 40;
    const focus = this.focusPlanetName
      ? this.planets.find(p => p.name === this.focusPlanetName)?.semiMajorAxisAU
      : undefined;
    const effectiveMaxAu = focus ? Math.max(focus * 1.6, 0.5) : this.maxSemiMajorAxisAu;
    const maxAu = effectiveMaxAu || 30.1;

    // Compression radiale : sqrt(au / maxAu) * rayon_max
    const normalized = Math.sqrt(au / maxAu);
    return normalized * maxRadiusPx;
  }

  /**
   * Rayon visuel des planètes en pixels (tres compressé pour les géantes).
   * Ici, on reste arbitraire sur le "style", mais toujours déterministe.
   */
  planetRadiusToPixels(planet: Planet): number {
    const base = 4;
    const scale = 0.0005;
    return base + planet.radiusKm * scale;
  }

  /**
   * Rayon visuel des orbites, basé directement sur le demi-grand axe en UA.
   */
  getOrbitRadiusPx(planet: Planet): number {
    return this.distanceToPixels(planet.semiMajorAxisAU);
  }

  /**
   * Changement de mode de vue (2D vs 3D).
   * On ne change que la projection, pas les données physiques.
   */
  setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) {
      return;
    }
    this.viewMode = mode;

    // Si on dispose déjà d’un snapshot, on recalcule l’affichage
    if (this.lastSnapshot) {
      this.updateDisplayFromSnapshot(this.lastSnapshot);
    }
  }

  /**
   * Ajuste le pas du slider (1j / 7j / 30j).
   */
  setTimeStep(days: number): void {
    this.timeStepDays = days;
  }

  /**
   * Mise à jour du décalage temporel via le slider.
   */
  onTimeOffsetChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.timeOffsetDays = Number.isFinite(value) ? value : 0;

    this.refreshDisplay();
  }

  /**
   * Réinitialise le décalage temporel (retour à l’horodatage réel).
   */
  resetTimeOffset(): void {
    this.timeOffsetDays = 0;
    this.refreshDisplay();
  }

  // ---------------------------------------------------------------------------
  // Rendu à partir des éphémérides réelles
  // ---------------------------------------------------------------------------

  /**
   * Met à jour les positions affichées à partir d’un snapshot d’éphémérides.
   * Les coordonnées (x, y, z) sont interprétées comme héliocentriques en UA.
   */
  private updateDisplayFromSnapshot(snapshot: EphemerisSnapshot): void {
    if (!snapshot || !snapshot.bodies || snapshot.bodies.length === 0) {
      this.displayPlanets = [];
      this.voyagerMarkers = [];
      return;
    }

    const positionsByName = new Map<string, PlanetPosition>();
    for (const body of snapshot.bodies) {
      positionsByName.set(body.name, body);
    }

    let display: DisplayPlanet[] = [];
    const deltaDays = this.timeOffsetDays + this.computeDriftDays(snapshot);

    for (const planet of this.planets) {
      const pos = positionsByName.get(planet.name);
      if (!pos) {
        continue;
      }

      const { x: xOrbit, y: yOrbit, z: zOrbitRaw } = this.computePositionWithOffset(
        pos,
        planet,
        deltaDays
      );
      let zOrbit = zOrbitRaw;
      const baseRadiusAu =
        Math.sqrt(
          xOrbit * xOrbit +
            yOrbit * yOrbit +
            zOrbit * zOrbit
        ) || planet.semiMajorAxisAU || 1e-6;

      if (!this.hasVelocity(pos)) {
        const incRad = (planet.inclinationDeg || 0) * Math.PI / 180;
        const angle = Math.atan2(yOrbit, xOrbit);
        const tiltRadius = Math.max(baseRadiusAu, planet.semiMajorAxisAU || baseRadiusAu);
        zOrbit += tiltRadius * Math.sin(incRad) * Math.sin(angle);
      }

      const rAu =
        Math.sqrt(
          xOrbit * xOrbit +
            yOrbit * yOrbit +
            zOrbit * zOrbit
        ) || planet.semiMajorAxisAU || 1e-6;
      const rPx = this.distanceToPixels(rAu);
      const scale = rPx / rAu || 1;
      const planetRadiusPx = this.planetRadiusToPixels(planet);

      let xScreen: number;
      let yScreen: number;

      if (this.viewMode === '2d') {
        // Vue du dessus : projection dans le plan (x, y)
        xScreen = this.centerX + xOrbit * scale;
        yScreen = this.centerY + yOrbit * scale;
      } else {
        // Vue pseudo-3D : même position physique (x, y, z),
        // projection oblique autour de l’axe X.
        const projected = this.project3dPoint(xOrbit, yOrbit, zOrbit, scale);
        xScreen = projected.x;
        yScreen = projected.y;
      }

      // Axe planétaire (vue 3D uniquement)
      let axis: DisplayPlanet['axis'];
      if (this.viewMode === '3d' && this.showPlanetAxes) {
        const tiltRad = (planet.axialTiltDeg || 0) * Math.PI / 180;
        const axisHalfPx = planetRadiusPx * 1.5;
        const axisHalfAu = axisHalfPx / (scale || 1);

        const axisY = Math.sin(tiltRad) * axisHalfAu;
        const axisZ = Math.cos(tiltRad) * axisHalfAu;

        const start = this.project3dPoint(xOrbit, yOrbit - axisY, zOrbit - axisZ, scale);
        const end = this.project3dPoint(xOrbit, yOrbit + axisY, zOrbit + axisZ, scale);

        axis = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
      }

      // Ombre portée simple (ellipse aplatie sous la planète)
      let shadow: DisplayPlanet['shadow'];
      if (this.viewMode === '3d' && this.showShadows) {
        shadow = {
          cx: xScreen,
          cy: yScreen + planetRadiusPx * 0.6,
          rx: planetRadiusPx * 1.4,
          ry: planetRadiusPx * 0.65
        };
      }

      display.push({
        planet,
        x: xScreen,
        y: yScreen,
        rAu,
        isSelected: !!this.selectedPlanet && this.selectedPlanet.name === planet.name,
        isFocused: this.focusPlanetName === planet.name,
        axis,
        shadow
      });
    }

    // Optionnel : recalcule l'échelle 1 UA (utile après focus)
    this.oneAuPixels = this.distanceToPixels(1);

    let panX = 0;
    let panY = 0;

    // Si on doit centrer sur une planète, calcule un décalage global
    if (this.focusPlanetName) {
      const focused = display.find(dp => dp.planet.name === this.focusPlanetName);
      if (focused) {
        panX = this.centerX - focused.x;
        panY = this.centerY - focused.y;

        display = display.map(dp => ({
          ...dp,
          x: dp.x + panX,
          y: dp.y + panY,
          axis: dp.axis
            ? {
                x1: dp.axis.x1 + panX,
                y1: dp.axis.y1 + panY,
                x2: dp.axis.x2 + panX,
                y2: dp.axis.y2 + panY
              }
            : undefined,
          shadow: dp.shadow
            ? {
                ...dp.shadow,
                cx: dp.shadow.cx + panX,
                cy: dp.shadow.cy + panY
              }
            : undefined
        }));
      }
    }

    this.displayPlanets = display;
    this.lastPanX = panX;
    this.lastPanY = panY;
    this.voyagerMarkers = this.buildVoyagerMarkers(deltaDays, panX, panY);
  }

  /**
   * Bascule des options d’affichage en vue 3D.
   */
  onToggleOrbitPlanes(checked: boolean): void {
    this.showOrbitalPlanes = checked;
    this.refreshDisplay();
  }

  onTogglePlanetAxes(checked: boolean): void {
    this.showPlanetAxes = checked;
    this.refreshDisplay();
  }

  onToggleShadows(checked: boolean): void {
    this.showShadows = checked;
    this.refreshDisplay();
  }

  /**
   * Recalcule l’affichage depuis le dernier snapshot si disponible.
   */
  private refreshDisplay(): void {
    if (this.lastSnapshot) {
      this.updateDisplayFromSnapshot(this.lastSnapshot);
    }
  }

  /**
   * Compression visuelle des plans orbitaux en vue 3D.
   */
  orbitPlaneCompression(planet: Planet): number {
    const incRad = (planet.inclinationDeg || 0) * Math.PI / 180;
    const base = Math.cos(this.cameraAngleRad);
    const tilt = Math.cos(incRad);
    return Math.max(0.2, base * tilt);
  }

  /**
   * Projection oblique d’un point 3D (en UA) vers l’écran (px).
   */
  private project3dPoint(xAu: number, yAu: number, zAu: number, scale: number): { x: number; y: number } {
    const x = xAu * scale;
    const y = yAu * scale;
    const z = zAu * scale;
    const phi = this.cameraAngleRad;
    const yProj = y * Math.cos(phi) - z * Math.sin(phi);

    return {
      x: this.centerX + x,
      y: this.centerY + yProj
    };
  }

  // ---------------------------------------------------------------------------
  // Lecture inertielle & interpolation temporelle
  // ---------------------------------------------------------------------------

  onToggleInertialPlayback(checked: boolean): void {
    this.enableInertialPlayback = checked;
    if (checked) {
      this.startInertialAnimation();
      this.refreshDisplay();
    } else {
      this.stopInertialAnimation();
    }
  }

  private startInertialAnimation(): void {
    if (!this.enableInertialPlayback || this.animationFrameId !== null) {
      return;
    }

    const tick = () => {
      this.animationFrameId = null;
      if (this.enableInertialPlayback) {
        this.refreshDisplay();
        this.animationFrameId = requestAnimationFrame(tick);
      }
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  private stopInertialAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private trackLatency(snapshot: EphemerisSnapshot): void {
    if (this.lastLatencyTimestamp === snapshot.timestamp) {
      return;
    }
    const latency = snapshot.metadata?.responseTimeMs;
    if (latency !== undefined && Number.isFinite(latency)) {
      this.latencySumMs += latency;
      this.latencyCount += 1;
      this.lastLatencyTimestamp = snapshot.timestamp;
      this.currentLatencyMs = latency;
    }
  }

  private trackCache(snapshot: EphemerisSnapshot): void {
    const meta = snapshot.metadata;
    if (!meta) {
      return;
    }

    this.lastCacheStatus =
      (meta.cacheStatus as typeof this.lastCacheStatus) ?? this.lastCacheStatus;
    this.lastCacheBackend =
      (meta.cacheBackend as typeof this.lastCacheBackend) ?? this.lastCacheBackend;

    this.cacheAgeMs =
      meta.cacheAgeMs !== undefined && Number.isFinite(meta.cacheAgeMs)
        ? meta.cacheAgeMs
        : this.cacheAgeMs;

    this.cacheTtlMs =
      meta.cacheExpiresInMs !== undefined && Number.isFinite(meta.cacheExpiresInMs)
        ? meta.cacheExpiresInMs
        : this.cacheTtlMs;

    if (meta.responseTimeMs !== undefined && Number.isFinite(meta.responseTimeMs)) {
      this.currentLatencyMs = meta.responseTimeMs;
    }

    if (meta.frozenSnapshot) {
      this.frozenSnapshot = true;
      this.freezeReason = meta.freezeReason ?? this.freezeReason;
    } else {
      this.frozenSnapshot = false;
      this.freezeReason = null;
    }

    if (meta.requestId) {
      this.lastRequestId = meta.requestId;
    }
  }

  private computeDriftDays(snapshot: EphemerisSnapshot): number {
    if (!this.enableInertialPlayback) {
      return 0;
    }

    const refFromSnapshot = Date.parse(snapshot.timestamp);
    const referenceMs = Number.isFinite(refFromSnapshot)
      ? refFromSnapshot
      : this.snapshotReceivedAt ?? Date.now();
    const now = Date.now();

    const driftMs = now - referenceMs;
    return Math.max(0, driftMs) / this.msPerDay;
  }

  private enrichVoyagerViews(): void {
    const earth = this.lastSnapshot?.bodies?.find((b) => b.name === 'earth');
    this.voyagerViews = (this.voyagers ?? []).map((v) => this.buildVoyagerView(v, earth));
    this.refreshVoyagerMarkers();
  }

  private buildVoyagerView(v: VoyagerData, earth?: PlanetPosition): VoyagerView {
    const earthDistanceKm = this.computeEarthDistanceKm(v, earth);
    const distanceFromEarth = {
      au: earthDistanceKm !== null ? earthDistanceKm / KM_PER_AU : v.distanceFromEarth?.au ?? null,
      km: earthDistanceKm ?? v.distanceFromEarth?.km ?? null,
      miles: earthDistanceKm !== null ? earthDistanceKm * 0.621371 : v.distanceFromEarth?.miles ?? null,
      lightTimeMin:
        earthDistanceKm !== null ? earthDistanceKm / SPEED_OF_LIGHT_KM_S / 60 : v.lightTime?.oneWayMinutes ?? null,
      lightTimeHours:
        earthDistanceKm !== null ? earthDistanceKm / SPEED_OF_LIGHT_KM_S / 3600 : null
    };

    const lightTime = this.computeLightTime(v, earthDistanceKm);
    const trajectory = v.trajectory ?? this.computeTrajectoryFromVector(v);
    const communication = this.findDsnContact(v);

    const distanceForTrend = distanceFromEarth.km ?? v.distanceFromSun.km ?? null;
    const speedKmS = v.speed.kmPerS ?? null;
    const spark24hPath = this.buildSparklinePath(distanceForTrend, speedKmS, 24);
    const spark7dPath = this.buildSparklinePath(distanceForTrend, speedKmS, 24 * 7);

    return {
      ...v,
      distanceFromEarth,
      lightTime,
      trajectory,
      communication,
      spark24hPath,
      spark7dPath
    };
  }

  private computeEarthDistanceKm(v: VoyagerData, earth?: PlanetPosition): number | null {
    if (v.distanceFromEarth?.km !== undefined && v.distanceFromEarth?.km !== null) {
      return v.distanceFromEarth.km;
    }
    if (!earth || !Number.isFinite(earth.x_au) || !Number.isFinite(earth.y_au) || !Number.isFinite(earth.z_au)) {
      return null;
    }
    const distAu = Math.sqrt(
      Math.pow((v.positionAu?.x ?? 0) - earth.x_au, 2) +
        Math.pow((v.positionAu?.y ?? 0) - earth.y_au, 2) +
        Math.pow((v.positionAu?.z ?? 0) - earth.z_au, 2)
    );
    return distAu * KM_PER_AU;
  }

  private computeLightTime(v: VoyagerData, earthDistanceKm: number | null): Required<NonNullable<VoyagerData['lightTime']>> {
    if (v.lightTime?.oneWaySeconds !== undefined && v.lightTime.oneWaySeconds !== null) {
      return {
        oneWaySeconds: v.lightTime.oneWaySeconds,
        oneWayMinutes: v.lightTime.oneWayMinutes ?? v.lightTime.oneWaySeconds / 60,
        twoWayMinutes: v.lightTime.twoWayMinutes ?? (v.lightTime.oneWaySeconds * 2) / 60
      };
    }
    if (earthDistanceKm === null) {
      return { oneWaySeconds: null, oneWayMinutes: null, twoWayMinutes: null };
    }
    const oneWaySeconds = earthDistanceKm / SPEED_OF_LIGHT_KM_S;
    return {
      oneWaySeconds,
      oneWayMinutes: oneWaySeconds / 60,
      twoWayMinutes: (oneWaySeconds * 2) / 60
    };
  }

  private computeTrajectoryFromVector(v: VoyagerData): NonNullable<VoyagerData['trajectory']> {
    const r = Math.sqrt(
      (v.positionAu?.x ?? 0) * (v.positionAu?.x ?? 0) +
        (v.positionAu?.y ?? 0) * (v.positionAu?.y ?? 0) +
        (v.positionAu?.z ?? 0) * (v.positionAu?.z ?? 0)
    );
    const eclipticLatDeg = r ? (Math.asin((v.positionAu?.z ?? 0) / r) * 180) / Math.PI : null;
    const eclipticLonDeg = r ? this.normalizeAngleDeg((Math.atan2(v.positionAu?.y ?? 0, v.positionAu?.x ?? 0) * 180) / Math.PI) : null;
    const speed = Math.sqrt(
      (v.velocityAuPerDay?.x ?? 0) * (v.velocityAuPerDay?.x ?? 0) +
        (v.velocityAuPerDay?.y ?? 0) * (v.velocityAuPerDay?.y ?? 0) +
        (v.velocityAuPerDay?.z ?? 0) * (v.velocityAuPerDay?.z ?? 0)
    );
    const velocityLatDeg =
      speed > 0 && v.velocityAuPerDay?.z !== undefined
        ? (Math.asin(v.velocityAuPerDay.z / speed) * 180) / Math.PI
        : null;
    const velocityAzimuthDeg =
      speed > 0 && v.velocityAuPerDay?.x !== undefined && v.velocityAuPerDay?.y !== undefined
        ? this.normalizeAngleDeg((Math.atan2(v.velocityAuPerDay.y, v.velocityAuPerDay.x) * 180) / Math.PI)
        : null;

    return { eclipticLatDeg, eclipticLonDeg, velocityAzimuthDeg, velocityLatDeg };
  }

  private refreshVoyagerMarkers(): void {
    if (!this.lastSnapshot) {
      this.voyagerMarkers = [];
      return;
    }
    const deltaDays = this.timeOffsetDays + this.computeDriftDays(this.lastSnapshot);
    this.voyagerMarkers = this.buildVoyagerMarkers(deltaDays, this.lastPanX, this.lastPanY);
  }

  private getVelocityComponent(vec: VoyagerData['velocityAuPerDay'] | undefined, key: 'x' | 'y' | 'z'): number | null {
    if (!vec) {
      return null;
    }
    const altKey = key === 'x' ? 'vx' : key === 'y' ? 'vy' : 'vz';
    const value = (vec as any)[key] ?? (vec as any)[altKey];
    return Number.isFinite(value) ? Number(value) : null;
  }

  private computeVoyagerPosition(v: VoyagerData, deltaDays: number): { x: number; y: number; z: number } {
    const base = {
      x: v.positionAu?.x ?? 0,
      y: v.positionAu?.y ?? 0,
      z: v.positionAu?.z ?? 0
    };

    if (!this.enableInertialPlayback) {
      return base;
    }

    const vx = this.getVelocityComponent(v.velocityAuPerDay, 'x') ?? 0;
    const vy = this.getVelocityComponent(v.velocityAuPerDay, 'y') ?? 0;
    const vz = this.getVelocityComponent(v.velocityAuPerDay, 'z') ?? 0;

    return {
      x: base.x + vx * deltaDays,
      y: base.y + vy * deltaDays,
      z: base.z + vz * deltaDays
    };
  }

  private findDsnContact(v: VoyagerData): DsnContact | null {
    const match = this.dsnContacts.find(
      (c) =>
        c.spacecraft.toUpperCase().includes(v.id === 'voyager1' ? 'VGR1' : 'VGR2') ||
        c.spacecraftId === (v.id === 'voyager1' ? '31' : '32')
    );
    return match ?? null;
  }

  private buildSparklinePath(distanceKm: number | null, speedKmS: number | null, horizonHours: number): string | null {
    if (distanceKm === null || speedKmS === null) {
      return null;
    }
    const points: { x: number; y: number }[] = [];
    const steps = 12;
    const horizonSeconds = horizonHours * 3600;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const secondsAgo = horizonSeconds * t;
      const projected = distanceKm - speedKmS * secondsAgo;
      points.push({ x: (1 - t) * 100, y: projected });
    }

    const min = Math.min(...points.map((p) => p.y));
    const max = Math.max(...points.map((p) => p.y));
    const span = max - min || 1;
    const height = 30;

    const normalized = points.map((p) => ({
      x: p.x,
      y: height - ((p.y - min) / span) * height
    }));

    return normalized
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
  }

  private buildVoyagerMarkers(deltaDays: number, panX = 0, panY = 0): VoyagerMarker[] {
    if (!this.voyagers?.length) {
      return [];
    }

    const maxRadius = Math.min(this.width, this.height) / 2 - 12;

    return this.voyagers
      .map((v) => {
        const pos = this.computeVoyagerPosition(v, deltaDays);
        const rAu = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 0;
        const rPxRaw = rAu ? this.distanceToPixels(rAu) : 0;
        const rPx = Math.min(rPxRaw, maxRadius);
        const scale = rAu ? rPx / rAu : 0;

        let x: number;
        let y: number;

        if (this.viewMode === '3d') {
          const projected = this.project3dPoint(pos.x, pos.y, pos.z, scale);
          x = projected.x;
          y = projected.y;
        } else {
          x = this.centerX + pos.x * scale;
          y = this.centerY + pos.y * scale;
        }

        return {
          id: v.id,
          name: v.name,
          x: x + panX,
          y: y + panY,
          rAu,
          distanceLabel: rAu ? `${rAu.toFixed(1)} UA` : '',
          color: VOYAGER_COLORS[v.id]
        };
      })
      .filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y));
  }

  copyVoyagerSnapshotAsJson(): void {
    try {
      const payload = {
        timestamp: this.lastVoyagerTimestamp ?? new Date().toISOString(),
        requestId: this.lastVoyagerRequestId,
        voyagers: this.voyagerViews
      };
      const text = JSON.stringify(payload, null, 2);
      this.copyText(text, 'Snapshot copié (JSON)');
    } catch (err) {
      console.error('copy json failed', err);
      this.copyStatus = 'error';
      this.copyMessage = 'Échec de la copie JSON';
    }
  }

  exportVoyagerCsv(): void {
    if (!this.voyagerViews.length) {
      this.copyStatus = 'error';
      this.copyMessage = 'Aucune donnée Voyager à exporter';
      return;
    }
    const header = [
      'name',
      'id',
      'timestamp',
      'distanceSunKm',
      'distanceEarthKm',
      'speedKmS',
      'eclipticLatDeg',
      'eclipticLonDeg'
    ];
    const rows = this.voyagerViews.map((v) => [
      v.name,
      v.id,
      v.timestamp,
      v.distanceFromSun.km ?? '',
      v.distanceFromEarth.km ?? '',
      v.speed.kmPerS ?? '',
      v.trajectory.eclipticLatDeg ?? '',
      v.trajectory.eclipticLonDeg ?? ''
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    this.copyText(csv, 'Export CSV copié dans le presse-papiers');
  }

  private copyText(text: string, successMsg: string): void {
    const done = () => {
      this.copyStatus = 'success';
      this.copyMessage = successMsg;
      setTimeout(() => (this.copyStatus = 'idle'), 2000);
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch((err) => {
        console.error('clipboard error', err);
        this.copyStatus = 'error';
        this.copyMessage = 'Impossible de copier dans le presse-papiers';
      });
    } else {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        done();
      } catch (err) {
        console.error('copy fallback failed', err);
        this.copyStatus = 'error';
        this.copyMessage = 'Impossible de copier le texte';
      }
    }
  }

  private normalizeAngleDeg(deg: number): number {
    const wrapped = deg % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
  }

  private hasVelocity(pos: PlanetPosition): pos is PlanetPosition & Required<Pick<PlanetPosition, 'vx' | 'vy' | 'vz'>> {
    return (
      pos.vx !== undefined &&
      pos.vy !== undefined &&
      pos.vz !== undefined &&
      Number.isFinite(pos.vx) &&
      Number.isFinite(pos.vy) &&
      Number.isFinite(pos.vz)
    );
  }

  /**
   * Calcule la position décalée temporellement d’une planète.
   * - Si des vitesses vx/vy/vz sont présentes, on interpole linéairement en UA.
   * - Sinon, on retombe sur l’approximation orbitale existante (période + inclinaison).
   */
  private computePositionWithOffset(
    pos: PlanetPosition,
    planet: Planet,
    deltaDays: number
  ): { x: number; y: number; z: number } {
    if (deltaDays !== 0 && this.hasVelocity(pos)) {
      return {
        x: pos.x_au + pos.vx * deltaDays,
        y: pos.y_au + pos.vy * deltaDays,
        z: pos.z_au + pos.vz * deltaDays
      };
    }

    if (deltaDays === 0) {
      return { x: pos.x_au, y: pos.y_au, z: pos.z_au };
    }

    // Fallback : approximation orbitale simple si pas de vx/vy/vz.
    const baseRAu =
      Math.sqrt(
        pos.x_au * pos.x_au +
          pos.y_au * pos.y_au +
          pos.z_au * pos.z_au
      ) || planet.semiMajorAxisAU || 1e-6;

    const orbitalPeriod = planet.orbitalPeriodDays || 365.25;
    const baseAngle = Math.atan2(pos.y_au, pos.x_au);
    const deltaAngle = (2 * Math.PI * deltaDays) / orbitalPeriod;
    const targetAngle = baseAngle + deltaAngle;
    const orbitalRadiusAu = Math.max(baseRAu, planet.semiMajorAxisAU || baseRAu);
    const incRad = (planet.inclinationDeg || 0) * Math.PI / 180;

    return {
      x: orbitalRadiusAu * Math.cos(targetAngle),
      y: orbitalRadiusAu * Math.sin(targetAngle),
      z: pos.z_au + orbitalRadiusAu * Math.sin(incRad) * Math.sin(targetAngle)
    };
  }

  // ---------------------------------------------------------------------------
  // Interaction utilisateur
  // ---------------------------------------------------------------------------

  /**
   * Gestion du clic sur une planète dans le SVG.
   */
  onPlanetClick(planet: Planet): void {
    this.selectedPlanet = planet;
    this.updateSelectionFlags(planet);
    this.refreshSelectedEphemeris();
  }

  /**
   * Gestion de la fermeture du panneau d’info.
   */
  onCloseInfo(): void {
    this.selectedPlanet = null;
    this.selectedEphemeris = null;

    // Nettoie le flag de sélection visuelle
    this.updateSelectionFlags(null);
  }

  get voyagerSourceBadge(): string | null {
    if (!this.lastVoyagerTimestamp && !this.lastVoyagerRequestId) {
      return null;
    }
    const freshness = this.lastVoyagerTimestamp ? this.freshnessFrom(this.lastVoyagerTimestamp) : null;
    const req = this.lastVoyagerRequestId ? `req #${this.lastVoyagerRequestId}` : null;
    const parts = ['Horizons', freshness ? `mis à jour ${freshness}` : null, req].filter(Boolean);
    return parts.join(' • ');
  }

  private freshnessFrom(timestamp: string): string | null {
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts)) {
      return null;
    }
    const diffMs = Date.now() - ts;
    if (diffMs < 0) {
      return 'à l’instant';
    }
    const diffMin = diffMs / 60000;
    if (diffMin < 1) return 'il y a < 1 min';
    if (diffMin < 60) return `il y a ${Math.round(diffMin)} min`;
    const diffH = diffMin / 60;
    if (diffH < 24) return `il y a ${diffH.toFixed(1)} h`;
    return `il y a ${(diffH / 24).toFixed(1)} j`;
  }

  /**
   * Centre et zoome sur la planète sélectionnée.
   */
  centerOnSelected(): void {
    if (!this.selectedPlanet) {
      return;
    }
    this.focusPlanetName = this.selectedPlanet.name;
    this.refreshDisplay();
  }

  clearFocus(): void {
    this.focusPlanetName = null;
    this.refreshDisplay();
  }

  onLegendSelect(planet: Planet): void {
    this.selectedPlanet = planet;
    this.focusPlanetName = planet.name;
    this.updateSelectionFlags(planet);
    this.refreshSelectedEphemeris();
    this.refreshDisplay();
  }

  get focusedPlanet(): Planet | null {
    if (!this.focusPlanetName) {
      return null;
    }
    return this.planets.find((p) => p.name === this.focusPlanetName) ?? null;
  }

  get averageLatencyMs(): number | null {
    if (this.latencyCount === 0) {
      return null;
    }
    return this.latencySumMs / this.latencyCount;
  }

  private updateSelectionFlags(planet: Planet | null): void {
    this.displayPlanets = this.displayPlanets.map((dp) => ({
      ...dp,
      isSelected: !!planet && dp.planet.name === planet.name
    }));
  }

  /**
   * Récupère l’éphéméride associée à la planète sélectionnée.
   */
  private refreshSelectedEphemeris(): void {
    if (!this.selectedPlanet || !this.lastSnapshot) {
      this.selectedEphemeris = null;
      return;
    }
    const ephem = this.lastSnapshot.bodies.find(
      (b) => b.name === this.selectedPlanet?.name
    );
    this.selectedEphemeris = ephem ?? null;
  }

  /**
   * Libellé de fraîcheur des données (ex: "< 5 min").
   */
  get freshnessLabel(): string | null {
    if (!this.lastUpdateTimestamp) {
      return null;
    }
    const ts = Date.parse(this.lastUpdateTimestamp);
    if (Number.isNaN(ts)) {
      return null;
    }
    const diffMs = Date.now() - ts;
    if (diffMs < 0) {
      return 'à l’instant';
    }
    const diffMin = diffMs / 60000;
    if (diffMin < 1) return '< 1 min';
    if (diffMin < 5) return '< 5 min';
    if (diffMin < 15) return '< 15 min';
    if (diffMin < 60) return `${Math.round(diffMin)} min`;
    const diffH = diffMin / 60;
    if (diffH < 24) return `${diffH.toFixed(1)} h`;
    return `${(diffH / 24).toFixed(1)} j`;
  }
}
