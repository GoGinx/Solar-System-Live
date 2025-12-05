/**
 * Identifiant interne des planètes principales + Pluton.
 * Utilisé pour lier les données physiques, les couleurs et les éphémérides.
 */
export type PlanetName =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto';

/**
 * Classe simple de planète (utile pour les filtres, légendes, styles).
 */
export type PlanetCategory =
  | 'terrestrial'  // Mercure, Vénus, Terre, Mars
  | 'gas-giant'    // Jupiter, Saturne
  | 'ice-giant'    // Uranus, Neptune
  | 'dwarf';       // Pluton et autres planètes naines

/**
 * Métadonnées physiques et “catalogue” pour une planète.
 * Tous les champs ne sont pas forcément remplis, mais la base (radius/mass/a/info)
 * reste obligatoire pour l’affichage.
 */
export interface Planet {
  /**
   * Nom interne stable (clé logique, utilisée dans les services et APIs).
   */
  name: PlanetName;

  /**
   * Nom affiché à l’utilisateur (ex: “Terre”, “Mars”…).
   */
  displayName: string;

  /**
   * Couleur principale de la planète pour le rendu (CSS / SVG).
   */
  color: string;

  /**
   * Rayon moyen (en kilomètres).
   */
  radiusKm: number;

  /**
   * Masse (en kilogrammes).
   */
  massKg: number;

  /**
   * Demi-grand axe moyen de l’orbite (en unités astronomiques).
   * Sert à la fois pour la physique et pour dessiner les orbites à l’écran.
   */
  semiMajorAxisAU: number;

  /**
   * Description textuelle courte, destinée au panneau d’information.
   */
  info: string;

  // ---------------------------------------------------------------------------
  // Champs optionnels – utiles pour enrichir l’affichage
  // (laisser undefined si non renseigné, ça évite de casser le typage existant)
  // ---------------------------------------------------------------------------

  /**
   * Catégorie grossière de la planète (tellurique, géante gazeuse, géante de glace).
   */
  category?: PlanetCategory;

  /**
   * Période orbitale sidérale (en jours).
   * Utile si tu veux afficher une info supplémentaire ou vérifier les données NASA.
   */
  orbitalPeriodDays?: number;

  /**
   * Excentricité orbitale moyenne (sans unité, 0 = cercle parfait).
   */
  eccentricity?: number;

  /**
   * Inclinaison de l’orbite par rapport au plan de l’écliptique (en degrés).
   */
  inclinationDeg?: number;

  /**
   * Obliquité / inclinaison de l’axe de rotation par rapport à la perpendiculaire
   * au plan orbital (en degrés).
   */
  axialTiltDeg?: number;

  /**
   * Période de rotation sur elle-même (jour sidéral, en heures).
   */
  rotationPeriodHours?: number;

  /**
   * Densité moyenne (kg/m³).
   */
  meanDensity?: number;

  /**
   * Gravité de surface (m/s²) au niveau de l’équateur.
   */
  gravityMs2?: number;

  /**
   * Vitesse de libération (km/s).
   */
  escapeVelocityKms?: number;

  /**
   * Nombre de satellites naturels principaux (Lune, Ganymède, Titan, etc.).
   */
  moonsCount?: number;

  /**
   * Indique si la planète possède un système d’anneaux notable.
   */
  hasRings?: boolean;

  /**
   * URL de référence (Wikipedia, NASA factsheet, etc.).
   */
  referenceUrl?: string;
}

/**
 * Position héliocentrique instantanée d’une planète, telle que renvoyée
 * par le backend d’éphémérides (NASA JPL Horizons ou autre).
 *
 * Les coordonnées sont exprimées en unités astronomiques (UA), dans un
 * repère 3D (généralement J2000, plan de l’écliptique).
 */
export interface PlanetPosition {
  /**
   * Nom de la planète, qui fait le lien avec le type PlanetName / Planet.
   */
  name: PlanetName;

  /**
   * Coordonnées héliocentriques en UA.
   */
  x_au: number;
  y_au: number;
  z_au: number;

  // ---------------------------------------------------------------------------
  // Champs optionnels – si ton backend expose aussi les vitesses / autres infos
  // ---------------------------------------------------------------------------

  /**
   * Vitesse dans la direction X (exprimée en UA/jour ou km/s, selon backend).
   * L’unité exacte dépend de ton implémentation d’API – à documenter côté serveur.
   */
  vx?: number;

  /**
   * Vitesse dans la direction Y.
   */
  vy?: number;

  /**
   * Vitesse dans la direction Z.
   */
  vz?: number;

  /**
   * Unité des vitesses (ex: "AU/d" ou "km/s"), si tu veux être explicite.
   */
  velocityUnit?: string;

  /**
   * Horodatage associé au vecteur d’état (si fourni par le backend).
   */
  timestamp?: string;

  /**
   * Distance géocentrique renvoyée par Horizons (si disponible) en UA.
   */
  range_au?: number;

  /**
   * Vitesse radiale géocentrique en km/s (si demandée).
   */
  range_rate_km_s?: number;

  /**
   * Temps de trajet lumière aller simple (minutes) vers l’observateur.
   */
  light_time_minutes?: number;

  /**
   * Élongation Soleil-Observateur-Objet (degrés).
   */
  solar_elongation_deg?: number;

  /**
   * Angle de phase (Soleil-Objet-Observateur), degrés.
   */
  phase_angle_deg?: number;

  /**
   * Fraction éclairée (0–1).
   */
  illumination_fraction?: number;

  /**
   * Magnitude apparente (si disponible).
   */
  apparent_magnitude?: number;
}

/**
 * Snapshot d’éphémérides : jeu cohérent de positions planétaires à un instant donné.
 */
export interface EphemerisSnapshot {
  /**
   * Timestamp ISO de la date à laquelle les données sont valides.
   * (ex: "2025-12-02T15:00:00Z")
   */
  timestamp: string;

  /**
   * Liste des vecteurs de position des planètes.
   * Chaque entrée doit faire correspondre un PlanetName existant.
   */
  bodies: PlanetPosition[];

  /**
   * Métadonnées fournies par le backend (source, repère, unités, latence).
   */
  metadata?: {
    source?: string;
    referenceFrame?: string;
    distanceUnit?: string;
    velocityUnit?: string;
    responseTimeMs?: number;
    cacheStatus?: 'HIT' | 'MISS' | 'STALE' | 'FROZEN';
    cacheBackend?: 'memory' | 'redis';
    cacheAgeMs?: number;
    cacheExpiresInMs?: number;
    cacheStale?: boolean;
    generatedAt?: string;
    frozenSnapshot?: boolean;
    freezeReason?: string;
    requestId?: string;
  };

  // ---------------------------------------------------------------------------
  // Champs optionnels – utiles si tu veux exposer plus de contexte côté backend
  // ---------------------------------------------------------------------------

  /**
   * Indique éventuellement la source utilisée (ex: "NASA-JPL-Horizons").
   */
  source?: string;

  /**
   * Système de référence des coordonnées (ex: "J2000-ecliptic").
   */
  referenceFrame?: string;

  /**
   * Unités des distances (par défaut "AU" dans ce projet).
   */
  distanceUnit?: string;
}
