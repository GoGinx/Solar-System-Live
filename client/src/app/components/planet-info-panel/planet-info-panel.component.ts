import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ChangeDetectorRef
} from '@angular/core';
import { Subscription } from 'rxjs';
import { I18nService } from '../../services/i18n.service';

interface CatalogBody {
  id?: string;
  name?: string;
  displayName: string;
  radiusKm: number;
  massKg: number;
  info: string;
  referenceUrl?: string;
  category?: string;
  semiMajorAxisAU?: number;
  orbitalPeriodDays?: number;
  rotationPeriodHours?: number;
  inclinationDeg?: number;
  axialTiltDeg?: number;
  eccentricity?: number;
  moonsCount?: number;
  majorMoons?: string[];
  hasRings?: boolean;
  meanSurfaceTempK?: number;
  meanDensity?: number;
  gravityMs2?: number;
  escapeVelocityKms?: number;
  parentPlanetName?: string;
  horizonsId?: string;
}

interface EphemerisLike {
  x_au: number;
  y_au: number;
  z_au: number;
  vx?: number;
  vy?: number;
  vz?: number;
  timestamp?: string;
  range_au?: number | null;
  range_rate_km_s?: number | null;
  light_time_minutes?: number | null;
  solar_elongation_deg?: number | null;
  phase_angle_deg?: number | null;
  illumination_fraction?: number | null;
  apparent_magnitude?: number | null;
}

export interface LightingTelemetry {
  subsolarLatitudeDeg: number | null;
  northPoleLit: boolean | null;
  southPoleLit: boolean | null;
}

@Component({
  selector: 'app-planet-info-panel',
  templateUrl: './planet-info-panel.component.html',
  styleUrls: ['./planet-info-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlanetInfoPanelComponent implements OnChanges, OnInit, OnDestroy {
  @Input() body!: CatalogBody;
  @Input() kind: 'planet' | 'moon' | 'star' = 'planet';
  @Input() ephemeris: EphemerisLike | null = null;
  @Input() lighting: LightingTelemetry | null = null;

  @Output() close = new EventEmitter<void>();

  readonly auInKm = 149_597_870.7;

  private langSub?: Subscription;

  constructor(
    private i18n: I18nService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.langSub = this.i18n.lang$.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.langSub = undefined;
  }

  heliocentricDistanceAu: number | null = null;
  heliocentricDistanceKm: number | null = null;
  rangeAu: number | null = null;
  rangeKm: number | null = null;
  rangeRateKmS: number | null = null;
  lightTimeMin: number | null = null;
  solarElongationDeg: number | null = null;
  phaseAngleDeg: number | null = null;
  illuminationFraction: number | null = null;
  apparentMagnitude: number | null = null;
  speedAuPerDay: number | null = null;
  speedKmPerS: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ephemeris'] || changes['body']) {
      this.recalculateDerived();
    }
  }

  private recalculateDerived(): void {
    if (!this.ephemeris) {
      this.heliocentricDistanceAu = null;
      this.heliocentricDistanceKm = null;
      this.rangeAu = null;
      this.rangeKm = null;
      this.rangeRateKmS = null;
      this.lightTimeMin = null;
      this.solarElongationDeg = null;
      this.phaseAngleDeg = null;
      this.illuminationFraction = null;
      this.apparentMagnitude = null;
      this.speedAuPerDay = null;
      this.speedKmPerS = null;
      return;
    }

    const { x_au, y_au, z_au, vx, vy, vz } = this.ephemeris;
    const distAu = Math.sqrt(x_au * x_au + y_au * y_au + z_au * z_au);
    this.heliocentricDistanceAu = Number.isFinite(distAu) ? distAu : null;
    this.heliocentricDistanceKm = Number.isFinite(distAu) ? distAu * this.auInKm : null;

    this.rangeAu = this.ephemeris.range_au ?? null;
    this.rangeKm =
      this.ephemeris.range_au !== undefined && this.ephemeris.range_au !== null
        ? this.ephemeris.range_au * this.auInKm
        : null;
    this.rangeRateKmS = this.ephemeris.range_rate_km_s ?? null;

    this.lightTimeMin = this.ephemeris.light_time_minutes ?? null;
    this.solarElongationDeg = this.ephemeris.solar_elongation_deg ?? null;
    this.phaseAngleDeg = this.ephemeris.phase_angle_deg ?? null;
    this.illuminationFraction = this.ephemeris.illumination_fraction ?? null;
    this.apparentMagnitude = this.ephemeris.apparent_magnitude ?? null;

    if (vx !== undefined && vy !== undefined && vz !== undefined) {
      const speedAuPerDay = Math.sqrt(vx * vx + vy * vy + vz * vz);
      this.speedAuPerDay = Number.isFinite(speedAuPerDay) ? speedAuPerDay : null;
      this.speedKmPerS = Number.isFinite(speedAuPerDay) ? (speedAuPerDay * this.auInKm) / 86_400 : null;
    } else {
      this.speedAuPerDay = null;
      this.speedKmPerS = null;
    }
  }

  onClose(): void {
    this.close.emit();
  }

  get displayName(): string {
    const key = this.body?.name || this.body?.id;
    if (key) {
      const translated = this.i18n.t(`name.${key}`);
      if (translated && translated !== `name.${key}`) {
        return translated;
      }
    }
    return this.body?.displayName ?? '';
  }
}
