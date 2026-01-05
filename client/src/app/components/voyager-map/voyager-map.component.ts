import { ChangeDetectorRef, Component, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription, animationFrames, interval, sampleTime, startWith, switchMap } from 'rxjs';

import { VoyagerData, VoyagerSnapshot } from '../../models/voyager';
import { VoyagerService } from '../../services/voyager.service';
import { TimeScrubberService } from '../../services/time-scrubber.service';
import { I18nService } from '../../services/i18n.service';

type ContextKind = 'region' | 'star' | 'galaxy';

interface ContextNode {
  id: string;
  kind: ContextKind;
  titleKey: string;
  shortKey: string;
  longKey: string;
  angleDeg: number;
  distanceAu?: number;
  notToScale?: boolean;
}

interface PlottedNode extends ContextNode {
  x: number;
  y: number;
}

interface TrailPoint {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  timestamp: string;
}

interface MissionFacts {
  launchDate: string;
  flybys: Array<{ body: string; year: number }>;
  statusKey: string;
  instruments: string[];
  links: { nasa: string; jpl: string; instruments: string };
}

interface InstrumentItem {
  code: string;
  label: string;
  tooltip: string;
}

@Component({
  selector: 'app-voyager-map',
  templateUrl: './voyager-map.component.html',
  styleUrls: ['./voyager-map.component.css']
})
export class VoyagerMapComponent implements OnInit, OnDestroy {
  @Input() id: 'voyager1' | 'voyager2' | string = 'voyager1';

  width = 800;
  height = 800;
  centerX = 400;
  centerY = 400;
  readonly miniSize = 140;
  readonly miniCenter = 70;

  readonly refreshIntervalMs = 5_000;
  private readonly trailDays = 3650;
  private readonly trailSteps = 36;
  private readonly maxTrailPoints = 140;
  private readonly trailHistory = new Map<VoyagerData['id'], TrailPoint[]>();
  private readonly daysPerYear = 365.25;
  private readonly heliopauseAu = 120;
  private readonly graphWidth = 210;
  private readonly graphHeight = 64;
  private readonly graphPadding = 6;
  readonly graphMonths = 12;
  readonly graphYTicks = [0, 0.5, 1];
  private readonly auPerLightYear = 63_241;
  private readonly scaleYears = 30;
  showComparison = true;
  private readonly instrumentMeta: Record<string, { code: string; tooltipKey: string }> = {
    'instrument.magnetometer': { code: 'MAG', tooltipKey: 'instrument.magnetometer.short' },
    'instrument.plasma': { code: 'PLS', tooltipKey: 'instrument.plasma.short' },
    'instrument.cosmicRays': { code: 'CRS', tooltipKey: 'instrument.cosmicRays.short' },
    'instrument.plasmaWaves': { code: 'PWS', tooltipKey: 'instrument.plasmaWaves.short' }
  };
  private readonly missionFactsById: Record<'voyager1' | 'voyager2', MissionFacts> = {
    voyager1: {
      launchDate: '1977-09-05',
      flybys: [
        { body: 'jupiter', year: 1979 },
        { body: 'saturn', year: 1980 }
      ],
      statusKey: 'status.voyager.interstellar',
      instruments: [
        'instrument.magnetometer',
        'instrument.plasma',
        'instrument.cosmicRays',
        'instrument.plasmaWaves'
      ],
      links: {
        nasa: 'https://www.nasa.gov/mission_pages/voyager/index.html',
        jpl: 'https://voyager.jpl.nasa.gov/',
        instruments: 'https://voyager.jpl.nasa.gov/mission/science/'
      }
    },
    voyager2: {
      launchDate: '1977-08-20',
      flybys: [
        { body: 'jupiter', year: 1979 },
        { body: 'saturn', year: 1981 },
        { body: 'uranus', year: 1986 },
        { body: 'neptune', year: 1989 }
      ],
      statusKey: 'status.voyager.interstellar',
      instruments: [
        'instrument.magnetometer',
        'instrument.plasma',
        'instrument.cosmicRays',
        'instrument.plasmaWaves'
      ],
      links: {
        nasa: 'https://www.nasa.gov/mission_pages/voyager/index.html',
        jpl: 'https://voyager.jpl.nasa.gov/',
        instruments: 'https://voyager.jpl.nasa.gov/mission/science/'
      }
    }
  };

  snapshot: VoyagerSnapshot | null = null;
  voyagers: VoyagerData[] = [];
  active: VoyagerData | null = null;
  other: VoyagerData | null = null;

  // Log scale max distance: ~4.75 ly (300k AU) keeps Voyager visible.
  readonly maxDistanceAu = 300_000;
  private sub?: Subscription;
  private timeSub?: Subscription;
  private frameSub?: Subscription;
  private langSub?: Subscription;
  private offsetDays = 0;
  private nowMs = Date.now();

  selectedPanel: { kind: 'voyager'; voyager: VoyagerData } | { kind: 'node'; node: ContextNode } | null =
    null;
  expanded = false;

  private readonly baseNodes: ContextNode[] = [
    {
      id: 'kuiper',
      kind: 'region',
      titleKey: 'context.kuiper.title',
      angleDeg: 210,
      distanceAu: 45,
      shortKey: 'context.kuiper.short',
      longKey: 'context.kuiper.long'
    },
    {
      id: 'heliopause',
      kind: 'region',
      titleKey: 'context.heliopause.title',
      angleDeg: 320,
      distanceAu: 120,
      shortKey: 'context.heliopause.short',
      longKey: 'context.heliopause.long'
    },
    {
      id: 'oort',
      kind: 'region',
      titleKey: 'context.oort.title',
      angleDeg: 30,
      distanceAu: 50_000,
      shortKey: 'context.oort.short',
      longKey: 'context.oort.long'
    },
    {
      id: 'proxima',
      kind: 'star',
      titleKey: 'context.proxima.title',
      angleDeg: 120,
      distanceAu: 268_000,
      shortKey: 'context.proxima.short',
      longKey: 'context.proxima.long'
    },
    {
      id: 'alpha-centauri',
      kind: 'star',
      titleKey: 'context.alpha.title',
      angleDeg: 150,
      distanceAu: 276_000,
      shortKey: 'context.alpha.short',
      longKey: 'context.alpha.long'
    },
    {
      id: 'milky-way',
      kind: 'galaxy',
      titleKey: 'context.milky.title',
      angleDeg: 260,
      notToScale: true,
      shortKey: 'context.milky.short',
      longKey: 'context.milky.long'
    },
    {
      id: 'andromeda',
      kind: 'galaxy',
      titleKey: 'context.andromeda.title',
      angleDeg: 280,
      notToScale: true,
      shortKey: 'context.andromeda.short',
      longKey: 'context.andromeda.long'
    }
  ];

  constructor(
    private voyagerService: VoyagerService,
    private time: TimeScrubberService,
    private i18n: I18nService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.updateDimensionsFromWindow();
    this.startPolling();
    this.startAnimationLoop();

    this.timeSub = this.time.offsetDays$.subscribe((days) => {
      this.offsetDays = days;
    });

    this.langSub = this.i18n.lang$.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.timeSub?.unsubscribe();
    this.timeSub = undefined;
    this.frameSub?.unsubscribe();
    this.frameSub = undefined;
    this.langSub?.unsubscribe();
    this.langSub = undefined;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateDimensionsFromWindow();
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
        switchMap(() => this.voyagerService.getVoyagers({ forceRefresh: true }))
      )
      .subscribe({
        next: (snapshot) => {
          this.snapshot = snapshot;
          this.voyagers = snapshot.voyagers ?? [];
          this.updateTrailHistory(snapshot);
          this.pickActive();
        },
        error: () => {
          // Garde la derniere valeur si l'API tombe.
        }
      });
  }

  private startAnimationLoop(): void {
    this.frameSub?.unsubscribe();
    this.frameSub = animationFrames()
      .pipe(sampleTime(33))
      .subscribe(() => {
        this.nowMs = Date.now();
      });
  }

  private pickActive(): void {
    const wanted = (this.id === 'voyager2' ? 'voyager2' : 'voyager1') as VoyagerData['id'];
    const v1 = this.voyagers.find((v) => v.id === 'voyager1') ?? null;
    const v2 = this.voyagers.find((v) => v.id === 'voyager2') ?? null;
    this.active = wanted === 'voyager1' ? v1 : v2;
    this.other = wanted === 'voyager1' ? v2 : v1;
  }

  private updateTrailHistory(snapshot: VoyagerSnapshot): void {
    for (const v of snapshot.voyagers ?? []) {
      const pos = v.positionAu;
      if (
        !Number.isFinite(pos?.x) ||
        !Number.isFinite(pos?.y) ||
        !Number.isFinite(pos?.z)
      ) {
        continue;
      }
      const list = this.trailHistory.get(v.id) ?? [];
      const last = list[list.length - 1];
      if (last?.timestamp === v.timestamp) {
        continue;
      }
      list.push({
        x: pos.x as number,
        y: pos.y as number,
        z: pos.z as number,
        vx: this.finiteOrZero(v.velocityAuPerDay?.vx),
        vy: this.finiteOrZero(v.velocityAuPerDay?.vy),
        vz: this.finiteOrZero(v.velocityAuPerDay?.vz),
        timestamp: v.timestamp
      });
      if (list.length > this.maxTrailPoints) {
        list.splice(0, list.length - this.maxTrailPoints);
      }
      this.trailHistory.set(v.id, list);
    }
  }

  get ringsAu(): number[] {
    return [1, 10, 100, 1_000, 10_000, 50_000, 100_000, 300_000];
  }

  miniRadiusPx(au: number): number {
    const maxRadiusPx = this.miniSize / 2 - 16;
    const d = Math.max(0, au);
    const max = Math.max(1, this.maxDistanceAu);
    const t = Math.log10(1 + d) / Math.log10(1 + max);
    return t * maxRadiusPx;
  }

  miniPoint(v: VoyagerData): { x: number; y: number } {
    const pos = this.projectedPositionAu(v);
    const theta = Math.atan2(pos.y, pos.x);
    const rAu = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 0;
    const rPx = this.miniRadiusPx(rAu);
    return {
      x: this.miniCenter + rPx * Math.cos(theta),
      y: this.miniCenter + rPx * Math.sin(theta)
    };
  }

  auToRadiusPx(au: number): number {
    const maxRadiusPx = Math.min(this.width, this.height) / 2 - 70;
    const d = Math.max(0, au);
    const max = Math.max(1, this.maxDistanceAu);
    const t = Math.log10(1 + d) / Math.log10(1 + max);
    return t * maxRadiusPx;
  }

  voyagerX(v: VoyagerData): number {
    return this.screenPointFromPosition(this.projectedPositionAu(v)).x;
  }

  voyagerY(v: VoyagerData): number {
    return this.screenPointFromPosition(this.projectedPositionAu(v)).y;
  }

  voyagerTrailPath(v: VoyagerData): string {
    const history = this.trailHistory.get(v.id);
    if (history && history.length > 1) {
      const basePath = this.trailPathFromHistory(history);
      const livePoint = this.screenPointFromPosition(this.projectedPositionAu(v));
      return `${basePath} L ${livePoint.x} ${livePoint.y}`;
    }
    if (this.trailSteps <= 0 || this.trailDays <= 0) return '';
    const stepDays = this.trailDays / this.trailSteps;
    const baseDays = this.effectiveDaysFromTimestamp(v.timestamp);
    let path = '';
    for (let i = this.trailSteps; i >= 0; i -= 1) {
      const daysOffset = baseDays - i * stepDays;
      const pos = this.projectedPositionAuAt(v, daysOffset);
      const point = this.screenPointFromPosition(pos);
      path += i === this.trailSteps ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`;
    }
    return path;
  }

  private trailPathFromHistory(history: TrailPoint[]): string {
    let path = '';
    for (let i = 0; i < history.length; i += 1) {
      const pos = this.advanceTrailPoint(history[i]);
      const point = this.screenPointFromPosition(pos);
      path += i === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`;
    }
    return path;
  }

  private advanceTrailPoint(point: TrailPoint): { x: number; y: number; z: number } {
    const offset = this.offsetDays;
    return {
      x: point.x + point.vx * offset,
      y: point.y + point.vy * offset,
      z: point.z + point.vz * offset
    };
  }

  voyagerHeadingDeg(v: VoyagerData): number {
    const vx = this.finiteOrZero(v.velocityAuPerDay?.vx);
    const vy = this.finiteOrZero(v.velocityAuPerDay?.vy);
    if (vx !== 0 || vy !== 0) {
      return (Math.atan2(vy, vx) * 180) / Math.PI;
    }
    const pos = this.projectedPositionAu(v);
    return (Math.atan2(pos.y, pos.x) * 180) / Math.PI;
  }

  probeTransform(v: VoyagerData): string {
    const pos = this.screenPointFromPosition(this.projectedPositionAu(v));
    const heading = this.voyagerHeadingDeg(v);
    const scale = this.isSelectedVoyager(v) ? 1.5 : 1;
    return `translate(${pos.x} ${pos.y}) rotate(${heading}) scale(${scale})`;
  }

  trackByVoyagerId(_: number, v: VoyagerData): string {
    return v.id;
  }

  private projectedPositionAu(v: VoyagerData): { x: number; y: number; z: number } {
    return this.projectedPositionAuAt(v, this.effectiveDaysFromTimestamp(v.timestamp));
  }

  private projectedPositionAuAt(v: VoyagerData, offsetDays: number): { x: number; y: number; z: number } {
    const x0 = this.finiteOrZero(v.positionAu?.x);
    const y0 = this.finiteOrZero(v.positionAu?.y);
    const z0 = this.finiteOrZero(v.positionAu?.z);
    const vx = this.finiteOrZero(v.velocityAuPerDay?.vx);
    const vy = this.finiteOrZero(v.velocityAuPerDay?.vy);
    const vz = this.finiteOrZero(v.velocityAuPerDay?.vz);
    return {
      x: x0 + vx * offsetDays,
      y: y0 + vy * offsetDays,
      z: z0 + vz * offsetDays
    };
  }

  private screenPointFromPosition(pos: { x: number; y: number; z: number }): { x: number; y: number } {
    const theta = Math.atan2(pos.y, pos.x);
    const rAu = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 0;
    const rPx = this.auToRadiusPx(rAu || 0);
    return {
      x: this.centerX + rPx * Math.cos(theta),
      y: this.centerY + rPx * Math.sin(theta)
    };
  }

  private effectiveDaysFromTimestamp(timestamp?: string): number {
    const baseTs = Date.parse(timestamp || '');
    const liveDays = Number.isFinite(baseTs) ? (this.nowMs - baseTs) / 86_400_000 : 0;
    return this.offsetDays + liveDays;
  }

  private finiteOrZero(value: number | null | undefined): number {
    return Number.isFinite(value) ? (value as number) : 0;
  }

  projectedDistanceFromSunAu(v: VoyagerData): number | null {
    const p = this.projectedPositionAu(v);
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    return Number.isFinite(r) ? r : null;
  }

  missionFacts(v: VoyagerData): MissionFacts | null {
    return this.missionFactsById[v.id] ?? null;
  }

  instrumentLabels(facts: MissionFacts): string[] {
    return facts.instruments.map((key) => this.i18n.t(key));
  }

  instrumentItems(facts: MissionFacts): InstrumentItem[] {
    return facts.instruments.map((key) => {
      const meta = this.instrumentMeta[key] ?? { code: 'INS', tooltipKey: key };
      return {
        code: meta.code,
        label: this.i18n.t(key),
        tooltip: this.i18n.t(meta.tooltipKey)
      };
    });
  }

  formatMissionDate(dateIso: string): string {
    const lang = this.i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    const date = new Date(dateIso);
    if (!Number.isFinite(date.getTime())) return dateIso;
    return new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date);
  }

  formatFlybys(facts: MissionFacts): string {
    return facts.flybys
      .map((flyby) => `${this.i18n.t(`name.${flyby.body}`)} ${flyby.year}`)
      .join(', ');
  }

  graphMonthLabels(): string[] {
    const labels: string[] = [];
    for (let i = this.graphMonths; i >= 0; i -= 1) {
      labels.push(`M-${i}`);
    }
    return labels;
  }

  toggleComparison(): void {
    this.showComparison = !this.showComparison;
  }

  heliopauseDeltaLabel(v: VoyagerData): string {
    const distAu = this.projectedDistanceFromSunAu(v);
    if (!Number.isFinite(distAu)) return '-';
    const delta = (distAu as number) - this.heliopauseAu;
    const sign = delta >= 0 ? '+' : '-';
    const abs = Math.abs(delta).toFixed(1);
    const statusKey = delta >= 0 ? 'label.beyondHeliopause' : 'label.insideHeliopause';
    return `${sign}${abs} AU | ${this.i18n.t(statusKey)}`;
  }

  heliopauseProgress(v: VoyagerData): { percent: number; beyond: boolean; distAu: number | null } {
    const distAu = this.projectedDistanceFromSunAu(v);
    if (!Number.isFinite(distAu)) {
      return { percent: 0, beyond: false, distAu: null };
    }
    const ratio = (distAu as number) / this.heliopauseAu;
    return { percent: Math.min(ratio, 1) * 100, beyond: ratio >= 1, distAu: distAu as number };
  }

  heliopauseLyLabel(v: VoyagerData): string {
    const distAu = this.projectedDistanceFromSunAu(v);
    if (!Number.isFinite(distAu)) return '-';
    const deltaAu = (distAu as number) - this.heliopauseAu;
    const deltaLy = deltaAu / this.auPerLightYear;
    const sign = deltaLy >= 0 ? '+' : '-';
    return `${sign}${Math.abs(deltaLy).toFixed(4)} ly`;
  }

  signalDelayText(v: VoyagerData): string | null {
    const one = v.lightTime?.oneWayMinutes;
    const two = v.lightTime?.twoWayMinutes;
    if (!Number.isFinite(one) || !Number.isFinite(two)) return null;
    return `${(one as number).toFixed(1)} min / ${(two as number).toFixed(1)} min`;
  }

  distanceGraph(v: VoyagerData): {
    path: string;
    currentX: number;
    currentY: number;
    minAu: number;
    maxAu: number;
    gridX: number[];
    currentLabel: string;
  } | null {
    const now = Date.now();
    const start = now - 365 * 86_400_000;
    const history = this.trailHistory.get(v.id) ?? [];
    const points = history
      .map((p) => ({ t: Date.parse(p.timestamp), d: Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.d) && p.t >= start && p.t <= now);

    const currentDist = this.projectedDistanceFromSunAu(v);
    if (Number.isFinite(currentDist)) {
      points.push({ t: now, d: currentDist as number });
    }
    if (points.length === 0) return null;

    const minAu = Math.min(...points.map((p) => p.d));
    const maxAu = Math.max(...points.map((p) => p.d));
    const span = Math.max(1e-6, maxAu - minAu);

    const mapX = (t: number) =>
      this.graphPadding +
      ((t - start) / (now - start)) * (this.graphWidth - this.graphPadding * 2);
    const mapY = (d: number) =>
      this.graphHeight - this.graphPadding - ((d - minAu) / span) * (this.graphHeight - this.graphPadding * 2);

    const sorted = points.sort((a, b) => a.t - b.t);
    let path = '';
    sorted.forEach((p, idx) => {
      const x = mapX(p.t);
      const y = mapY(p.d);
      path += idx === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    const currentX = mapX(now);
    const currentY = mapY(points[points.length - 1].d);

    const gridX: number[] = [];
    const spanX = this.graphWidth - this.graphPadding * 2;
    for (let i = 0; i <= this.graphMonths; i += 1) {
      gridX.push(this.graphPadding + (spanX * i) / this.graphMonths);
    }
    const currentLabel = `${points[points.length - 1].d.toFixed(1)} AU`;

    return { path, currentX, currentY, minAu, maxAu, gridX, currentLabel };
  }

  distanceGraphCompare(
    v: VoyagerData,
    base: { minAu: number; maxAu: number }
  ): { path: string } | null {
    const other = this.voyagers.find((o) => o.id !== v.id);
    if (!other) return null;
    const now = Date.now();
    const start = now - 365 * 86_400_000;
    const history = this.trailHistory.get(other.id) ?? [];
    const points = history
      .map((p) => ({ t: Date.parse(p.timestamp), d: Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.d) && p.t >= start && p.t <= now);
    const currentDist = this.projectedDistanceFromSunAu(other);
    if (Number.isFinite(currentDist)) {
      points.push({ t: now, d: currentDist as number });
    }
    if (points.length === 0) return null;

    const span = Math.max(1e-6, base.maxAu - base.minAu);
    const mapX = (t: number) =>
      this.graphPadding +
      ((t - start) / (now - start)) * (this.graphWidth - this.graphPadding * 2);
    const mapY = (d: number) =>
      this.graphHeight - this.graphPadding - ((d - base.minAu) / span) * (this.graphHeight - this.graphPadding * 2);

    const sorted = points.sort((a, b) => a.t - b.t);
    let path = '';
    sorted.forEach((p, idx) => {
      const x = mapX(p.t);
      const y = mapY(p.d);
      path += idx === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    return { path };
  }

  travelScaleUnits(v: VoyagerData): number | null {
    const distAu = this.projectedDistanceFromSunAu(v);
    const speedAuPerDay = v.speed?.auPerDay ?? null;
    if (!Number.isFinite(distAu) || !Number.isFinite(speedAuPerDay) || speedAuPerDay === 0) {
      return null;
    }
    const days = (distAu as number) / (speedAuPerDay as number);
    const years = days / this.daysPerYear;
    return years / this.scaleYears;
  }

  isSelectedVoyager(v: VoyagerData): boolean {
    return this.selectedPanel?.kind === 'voyager' && this.selectedPanel.voyager.id === v.id;
  }

  projectedTimestamp(v: VoyagerData): string {
    const base = Date.parse(v.timestamp || '');
    if (!Number.isFinite(base)) return v.timestamp;
    return new Date(base + this.offsetDays * 86_400_000).toISOString();
  }

  get plottedNodes(): PlottedNode[] {
    const maxRadiusPx = Math.min(this.width, this.height) / 2 - 70;

    return this.baseNodes.map((n) => {
      const angle = (n.angleDeg * Math.PI) / 180;
      const rPx = n.distanceAu !== undefined ? this.auToRadiusPx(n.distanceAu) : maxRadiusPx * 0.92;
      return {
        ...n,
        x: this.centerX + rPx * Math.cos(angle),
        y: this.centerY + rPx * Math.sin(angle)
      };
    });
  }

  openVoyager(v: VoyagerData): void {
    this.selectedPanel = { kind: 'voyager', voyager: v };
    this.expanded = false;
  }

  openNode(n: ContextNode): void {
    this.selectedPanel = { kind: 'node', node: n };
    this.expanded = false;
  }

  closePanel(): void {
    this.selectedPanel = null;
    this.expanded = false;
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  get activeTitle(): string {
    return this.active?.id === 'voyager2' ? 'Voyager 2' : 'Voyager 1';
  }

  formatDistanceLabelAu(au: number | null | undefined): string {
    if (au === null || au === undefined || !Number.isFinite(au)) return '-';
    if (au >= 100_000) return `${(au / 1000).toFixed(0)}k UA`;
    if (au >= 1000) return `${au.toFixed(0)} UA`;
    return `${au.toFixed(1)} UA`;
  }
}
