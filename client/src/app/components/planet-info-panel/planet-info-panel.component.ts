import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnChanges,
  SimpleChanges
} from '@angular/core';

import { Planet, PlanetPosition } from '../../models/planet';

@Component({
  selector: 'app-planet-info-panel',
  templateUrl: './planet-info-panel.component.html',
  styleUrls: ['./planet-info-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlanetInfoPanelComponent implements OnChanges {
  /**
   * Planète sélectionnée pour l’affichage.
   * Doit être fournie par le parent (SolarSystemComponent).
   */
  @Input() planet!: Planet;

  /**
   * Données d’éphémérides en temps réel pour la planète.
   */
  @Input() ephemeris: PlanetPosition | null = null;

  /**
   * Événement émis lorsque l’utilisateur ferme le panneau.
   */
  @Output() close = new EventEmitter<void>();

  readonly auInKm = 149_597_870.7; // 1 UA ≈ 149 597 870.7 km

  heliocentricDistanceAu: number | null = null;
  heliocentricDistanceKm: number | null = null;
  rangeAu: number | null = null;
  rangeKm: number | null = null;
  lightTimeMin: number | null = null;
  solarElongationDeg: number | null = null;
  phaseAngleDeg: number | null = null;
  illuminationFraction: number | null = null;
  apparentMagnitude: number | null = null;
  speedAuPerDay: number | null = null;
  speedKmPerS: number | null = null;

  /**
   * Déclenché à chaque changement d’@Input (notamment la planète sélectionnée).
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ephemeris'] || changes['planet']) {
      this.recalculateDerived();
    }
  }

  /**
   * Recalcule les valeurs dérivées en fonction de la planète courante.
   */
  private recalculateDerived(): void {
    if (!this.ephemeris) {
      this.heliocentricDistanceAu = null;
      this.heliocentricDistanceKm = null;
      this.rangeAu = null;
      this.rangeKm = null;
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
    this.heliocentricDistanceAu = distAu;
    this.heliocentricDistanceKm = Number.isFinite(distAu) ? distAu * this.auInKm : null;

    this.rangeAu = this.ephemeris.range_au ?? null;
    this.rangeKm =
      this.ephemeris.range_au !== undefined && this.ephemeris.range_au !== null
        ? this.ephemeris.range_au * this.auInKm
        : null;

    this.lightTimeMin = this.ephemeris.light_time_minutes ?? null;
    this.solarElongationDeg = this.ephemeris.solar_elongation_deg ?? null;
    this.phaseAngleDeg = this.ephemeris.phase_angle_deg ?? null;
    this.illuminationFraction = this.ephemeris.illumination_fraction ?? null;
    this.apparentMagnitude = this.ephemeris.apparent_magnitude ?? null;

    if (vx !== undefined && vy !== undefined && vz !== undefined) {
      const speedAuPerDay = Math.sqrt(vx * vx + vy * vy + vz * vz);
      this.speedAuPerDay = speedAuPerDay;
      this.speedKmPerS = speedAuPerDay * this.auInKm / 86_400;
    } else {
      this.speedAuPerDay = null;
      this.speedKmPerS = null;
    }
  }

  /**
   * Type de planète (description textuelle simple).
   * Utile si tu veux l’exploiter dans le template (chip, tooltip, etc.).
   */
  get planetTypeLabel(): string {
    const name = this.planet?.name;

    switch (name) {
      case 'mercury':
      case 'venus':
      case 'earth':
      case 'mars':
        return 'Planète tellurique';
      case 'jupiter':
      case 'saturn':
        return 'Géante gazeuse';
      case 'uranus':
      case 'neptune':
        return 'Géante de glace';
      case 'pluto':
        return 'Planète naine';
      default:
        return 'Planète';
    }
  }

  /**
   * Gestion du clic sur le bouton de fermeture.
   */
  onClose(): void {
    this.close.emit();
  }
}
