"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPlanetStateVector = fetchPlanetStateVector;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../observability/logger");
// Nouvelle URL publique Horizons (l'ancien sous-domaine ssd-api renvoie 404)
const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const AU_IN_KM = 149597870.7;
const SECONDS_PER_DAY = 86400;
function formatUtcDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const year = d.getUTCFullYear();
    const month = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const hour = pad(d.getUTCHours());
    const minute = pad(d.getUTCMinutes());
    // Horizons API 1.2 n'accepte plus l'espace entre date et heure (considéré
    // comme deux constantes) : utiliser un séparateur "T" façon ISO-8601.
    return `${year}-${month}-${day}T${hour}:${minute}`;
}
async function fetchPlanetStateVector(horizonsId, name, options) {
    const requestStarted = Date.now();
    const now = new Date();
    const start = formatUtcDate(now);
    const stopDate = new Date(now.getTime() + 60 * 60 * 1000);
    const stop = formatUtcDate(stopDate);
    const params = {
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
    const observerParams = {
        format: 'json',
        COMMAND: horizonsId,
        EPHEM_TYPE: 'OBSERVER',
        CENTER: '500@399', // géocentrique
        START_TIME: start,
        STOP_TIME: stop,
        STEP_SIZE: '1d',
        QUANTITIES: "'1,9,10,20,21,23,24'",
        CSV_FORMAT: 'YES'
    };
    const parseVectorFromResult = (resultText) => {
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
        // Nouveaux retours Horizons (CSV) n'ont plus les "X = ...".
        const csvLine = block
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('$$'))[0];
        const csvFields = csvLine?.split(',').map((v) => v.trim());
        const csvX = csvFields && csvFields.length > 2 ? parseFloat(csvFields[2]) : NaN;
        const csvY = csvFields && csvFields.length > 3 ? parseFloat(csvFields[3]) : NaN;
        const csvZ = csvFields && csvFields.length > 4 ? parseFloat(csvFields[4]) : NaN;
        const csvVx = csvFields && csvFields.length > 5 ? parseFloat(csvFields[5]) : NaN;
        const csvVy = csvFields && csvFields.length > 6 ? parseFloat(csvFields[6]) : NaN;
        const csvVz = csvFields && csvFields.length > 7 ? parseFloat(csvFields[7]) : NaN;
        if (!matchX && Number.isNaN(csvX)) {
            throw new Error('Coordonnées X/Y/Z manquantes dans la réponse Horizons');
        }
        const rawUnit = /Output units\s*:\s*([^\n]+)/.exec(resultText)?.[1]?.trim();
        const positionUnit = rawUnit?.toUpperCase().includes('KM') ? 'KM' : 'AU';
        const velocityUnit = rawUnit?.toUpperCase().includes('KM') ? 'KM/S' : 'AU/D';
        const toAu = (km) => (positionUnit === 'KM' ? km / AU_IN_KM : km);
        const toAuPerDay = (vx) => {
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
            x_au: toAu(matchX ? parseFloat(matchX[1]) : csvX),
            y_au: toAu(matchY ? parseFloat(matchY[1]) : csvY),
            z_au: toAu(matchZ ? parseFloat(matchZ[1]) : csvZ),
            vx_au_per_day: matchVx ? toAuPerDay(parseFloat(matchVx[1])) : Number.isFinite(csvVx) ? toAuPerDay(csvVx) : undefined,
            vy_au_per_day: matchVy ? toAuPerDay(parseFloat(matchVy[1])) : Number.isFinite(csvVy) ? toAuPerDay(csvVy) : undefined,
            vz_au_per_day: matchVz ? toAuPerDay(parseFloat(matchVz[1])) : Number.isFinite(csvVz) ? toAuPerDay(csvVz) : undefined,
            velocityUnit: 'AU/day',
            referenceFrame: 'J2000-ECLIPTIC',
            source: 'NASA-JPL-Horizons',
            timestamp: timestampLine?.trim() || new Date().toISOString()
        };
    };
    const parseObserverFromResult = (resultText) => {
        const block = resultText.split('$$SOE')[1]?.split('$$EOE')[0];
        if (!block) {
            throw new Error('Réponse Horizons OBSERVER sans bloc $$SOE/$$EOE');
        }
        const line = block
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith('$$'));
        if (!line) {
            throw new Error('Ligne OBSERVER introuvable');
        }
        const fields = line.split(',').map((v) => v.trim());
        // Indices basés sur l'ordre CSV Horizons quand QUANTITIES='1,9,10,20,21,23,24'
        const apMag = parseFloat(fields[5] ?? '');
        const illumPercent = parseFloat(fields[7] ?? '');
        const rangeAu = parseFloat(fields[8] ?? '');
        const rangeRateKmS = parseFloat(fields[9] ?? '');
        const lightTimeMinutes = parseFloat(fields[10] ?? '');
        const solarElongationDeg = parseFloat(fields[11] ?? '');
        const phaseAngleDeg = parseFloat(fields[13] ?? '');
        return {
            apparent_magnitude: Number.isFinite(apMag) ? apMag : undefined,
            illumination_fraction: Number.isFinite(illumPercent) ? illumPercent / 100 : undefined,
            range_au: Number.isFinite(rangeAu) ? rangeAu : undefined,
            range_rate_km_s: Number.isFinite(rangeRateKmS) ? rangeRateKmS : undefined,
            light_time_minutes: Number.isFinite(lightTimeMinutes) ? lightTimeMinutes : undefined,
            solar_elongation_deg: Number.isFinite(solarElongationDeg) ? solarElongationDeg : undefined,
            phase_angle_deg: Number.isFinite(phaseAngleDeg) ? phaseAngleDeg : undefined
        };
    };
    try {
        const [vectorResponse, observerResponse] = await Promise.all([
            axios_1.default.get(HORIZONS_URL, { params }),
            axios_1.default.get(HORIZONS_URL, { params: observerParams })
        ]);
        const latencyMs = Date.now() - requestStarted;
        const data = vectorResponse.data;
        const observerData = typeof observerResponse?.data?.result === 'string'
            ? observerResponse.data.result
            : typeof observerResponse?.data === 'string'
                ? observerResponse.data
                : undefined;
        const observerExtras = observerData ? parseObserverFromResult(observerData) : undefined;
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
            (0, logger_1.logInfo)('horizons_fetch', { name, horizonsId, latencyMs, requestId: options?.correlationId });
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
                timestamp: vec.calendar_date || now.toISOString(),
                ...observerExtras
            };
        }
        // Nouvelle structure (texte dans data.result)
        const resultText = typeof data?.result === 'string'
            ? data.result
            : typeof data === 'string'
                ? data
                : undefined;
        if (!resultText) {
            throw new Error('Réponse Horizons invalide ou vide');
        }
        const parsed = parseVectorFromResult(resultText);
        (0, logger_1.logInfo)('horizons_fetch', {
            name,
            horizonsId,
            latencyMs,
            requestId: options?.correlationId,
            parser: 'text-block'
        });
        return {
            ...parsed,
            ...observerExtras
        };
    }
    catch (error) {
        const latencyMs = Date.now() - requestStarted;
        const status = error?.response?.status;
        const responseBody = error?.response?.data;
        (0, logger_1.logError)('horizons_fetch_error', {
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
