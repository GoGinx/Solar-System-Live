import axios from 'axios';
import { PlanetName } from '../config/planets';
import { logError, logInfo } from '../observability/logger';

export interface PlanetStateVector {
  name: PlanetName | string;
  x_au: number;
  y_au: number;
  z_au: number;
  vx_au_per_day?: number;
  vy_au_per_day?: number;
  vz_au_per_day?: number;
  velocityUnit?: string;
  referenceFrame?: string;
  source?: string;
  timestamp: string;
}

// Nouvelle URL publique Horizons (l'ancien sous-domaine ssd-api renvoie 404)
const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const AU_IN_KM = 149_597_870.7;
const SECONDS_PER_DAY = 86_400;

function formatUtcDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hour = pad(d.getUTCHours());
  const minute = pad(d.getUTCMinutes());
  // Horizons API 1.2 n'accepte plus l'espace entre date et heure (considéré
  // comme deux constantes) : utiliser un séparateur "T" façon ISO-8601.
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export async function fetchPlanetStateVector(
  horizonsId: string,
  name: PlanetName | string,
  options?: { correlationId?: string }
): Promise<PlanetStateVector> {
  const requestStarted = Date.now();
  const now = new Date();
  const start = formatUtcDate(now);
  const stopDate = new Date(now.getTime() + 60 * 60 * 1000);
  const stop = formatUtcDate(stopDate);

  const params: Record<string, string> = {
    // L'API 1.2 renvoie toujours un corps JSON avec un champ `result` texte.
    // On garde `format=json` pour éviter un contenu pur texte.
    format: 'json',
    COMMAND: horizonsId,
    EPHEM_TYPE: 'VECTORS',
    CENTER: '@0',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    START_TIME: start,
    STOP_TIME: stop,
    STEP_SIZE: '1d', // nouvelle API tolère "1d" ("1 d" provoque une erreur)
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    // La V1.2 refuse "TEXT" : CSV_FORMAT doit être un booléen.
    CSV_FORMAT: 'YES'
  };

  const parseVectorFromResult = (resultText: string): PlanetStateVector => {
    const soeIndex = resultText.indexOf('$$SOE');
    const eoeIndex = resultText.indexOf('$$EOE');
    if (soeIndex === -1 || eoeIndex === -1 || eoeIndex <= soeIndex) {
      throw new Error('Réponse Horizons sans bloc $$SOE/$$EOE');
    }

    const block = resultText.slice(soeIndex, eoeIndex);

    const matchX = block.match(/X\s*=\s*([-+\d.Ee]+)/);
    const matchY = block.match(/Y\s*=\s*([-+\d.Ee]+)/);
    const matchZ = block.match(/Z\s*=\s*([-+\d.Ee]+)/);
    const matchVx = block.match(/VX\s*=\s*([-+\d.Ee]+)/);
    const matchVy = block.match(/VY\s*=\s*([-+\d.Ee]+)/);
    const matchVz = block.match(/VZ\s*=\s*([-+\d.Ee]+)/);

    if (!matchX || !matchY || !matchZ) {
      throw new Error('Coordonnées X/Y/Z manquantes dans la réponse Horizons');
    }

    const rawUnit = /Output units\s*:\s*([^\n]+)/.exec(resultText)?.[1]?.trim();
    const positionUnit = rawUnit?.toUpperCase().includes('KM') ? 'KM' : 'AU';
    const velocityUnit = rawUnit?.toUpperCase().includes('KM') ? 'KM/S' : 'AU/D';

    const toAu = (km: number) => (positionUnit === 'KM' ? km / AU_IN_KM : km);
    const toAuPerDay = (vx: number) => {
      if (velocityUnit === 'KM/S') {
        return (vx * SECONDS_PER_DAY) / AU_IN_KM;
      }
      return vx; // déjà en AU/day
    };

    const timestampLine = block
      .split('\n')
      .find((line) => line.trim().length && !line.includes('$$SOE'));

    return {
      name,
      x_au: toAu(parseFloat(matchX[1])),
      y_au: toAu(parseFloat(matchY[1])),
      z_au: toAu(parseFloat(matchZ[1])),
      vx_au_per_day: matchVx ? toAuPerDay(parseFloat(matchVx[1])) : undefined,
      vy_au_per_day: matchVy ? toAuPerDay(parseFloat(matchVy[1])) : undefined,
      vz_au_per_day: matchVz ? toAuPerDay(parseFloat(matchVz[1])) : undefined,
      velocityUnit: 'AU/day',
      referenceFrame: 'J2000-ECLIPTIC',
      source: 'NASA-JPL-Horizons',
      timestamp: timestampLine?.trim() || new Date().toISOString()
    };
  };

  try {
    const response = await axios.get(HORIZONS_URL, { params });
    const latencyMs = Date.now() - requestStarted;

    const data = response.data;

    // Ancienne structure (si jamais l’API fournit encore un tableau `vectors`).
    if (data && data.result && Array.isArray(data.result.vectors) && data.result.vectors.length > 0) {
      const vec = data.result.vectors[0];
      const x = parseFloat(vec.X);
      const y = parseFloat(vec.Y);
      const z = parseFloat(vec.Z);
      const vx = vec.VX !== undefined ? parseFloat(vec.VX) : undefined;
      const vy = vec.VY !== undefined ? parseFloat(vec.VY) : undefined;
      const vz = vec.VZ !== undefined ? parseFloat(vec.VZ) : undefined;

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error('Vecteur Horizons invalide (X, Y, Z)');
      }

      const referenceFrame = `${params.REF_SYSTEM}-${params.REF_PLANE}`; // ex: J2000-ECLIPTIC
      const velocityUnit = 'AU/day';

      logInfo('horizons_fetch', { name, horizonsId, latencyMs, requestId: options?.correlationId });

      return {
        name,
        x_au: x,
        y_au: y,
        z_au: z,
        vx_au_per_day: Number.isFinite(vx) ? vx : undefined,
        vy_au_per_day: Number.isFinite(vy) ? vy : undefined,
        vz_au_per_day: Number.isFinite(vz) ? vz : undefined,
        velocityUnit,
        referenceFrame,
        source: 'NASA-JPL-Horizons',
        timestamp: vec.calendar_date || now.toISOString()
      };
    }

    // Nouvelle structure (texte dans data.result)
    const resultText: string | undefined =
      typeof data?.result === 'string'
        ? data.result
        : typeof data === 'string'
        ? data
        : undefined;

    if (!resultText) {
      throw new Error('Réponse Horizons invalide ou vide');
    }

    const parsed = parseVectorFromResult(resultText);

    logInfo('horizons_fetch', {
      name,
      horizonsId,
      latencyMs,
      requestId: options?.correlationId,
      parser: 'text-block'
    });

    return parsed;
  } catch (error: any) {
    const latencyMs = Date.now() - requestStarted;
    const status = error?.response?.status;
    const responseBody = error?.response?.data;

    logError('horizons_fetch_error', {
      name,
      horizonsId,
      latencyMs,
      status,
      params,
      responseBody,
      requestId: options?.correlationId,
      error: error?.message ?? String(error)
    });

    throw error;
  }
}
