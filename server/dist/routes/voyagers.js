"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const voyagers_1 = require("../config/voyagers");
const horizonsClient_1 = require("../nasa/horizonsClient");
const logger_1 = require("../observability/logger");
const ephemerisCache_1 = require("../cache/ephemerisCache");
const AU_TO_KM = 149597870.7;
const KM_TO_MILES = 0.621371;
const SECONDS_PER_DAY = 86400;
const SPEED_OF_LIGHT_KM_S = 299792.458;
const router = (0, express_1.Router)();
function magnitude(x, y, z) {
    if (x === undefined ||
        y === undefined ||
        z === undefined ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)) {
        return null;
    }
    return Math.sqrt(x * x + y * y + z * z);
}
function deltaMagnitude(ax, ay, az, bx, by, bz) {
    if (ax === undefined ||
        ay === undefined ||
        az === undefined ||
        bx === undefined ||
        by === undefined ||
        bz === undefined) {
        return null;
    }
    return magnitude(ax - bx, ay - by, az - bz);
}
function toDegrees(rad) {
    return (rad * 180) / Math.PI;
}
function normalizeAngleDeg(deg) {
    const wrapped = deg % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}
function computeLightTime(distanceKm) {
    if (distanceKm === null || !Number.isFinite(distanceKm)) {
        return {
            oneWaySeconds: null,
            oneWayMinutes: null,
            twoWayMinutes: null
        };
    }
    const oneWaySeconds = distanceKm / SPEED_OF_LIGHT_KM_S;
    return {
        oneWaySeconds,
        oneWayMinutes: oneWaySeconds / 60,
        twoWayMinutes: (oneWaySeconds * 2) / 60
    };
}
function computeTrajectory(position, velocity) {
    const r = magnitude(position.x, position.y, position.z);
    const eclipticLatDeg = r ? toDegrees(Math.asin(position.z / r)) : null;
    const eclipticLonDeg = r ? normalizeAngleDeg(toDegrees(Math.atan2(position.y, position.x))) : null;
    const speed = magnitude(velocity?.vx, velocity?.vy, velocity?.vz);
    const velocityLatDeg = speed && velocity?.vz !== undefined ? toDegrees(Math.asin(velocity.vz / speed)) : null;
    const velocityAzimuthDeg = speed && velocity?.vx !== undefined && velocity?.vy !== undefined
        ? normalizeAngleDeg(toDegrees(Math.atan2(velocity.vy, velocity.vx)))
        : null;
    return {
        eclipticLatDeg,
        eclipticLonDeg,
        velocityAzimuthDeg,
        velocityLatDeg
    };
}
router.get('/', async (req, res) => {
    const requestId = req.requestId;
    try {
        const earthSnapshot = await (0, ephemerisCache_1.getSnapshot)({ correlationId: requestId });
        const earth = earthSnapshot.payload?.bodies?.find((b) => b.name === 'earth') ?? null;
        const results = await Promise.all(voyagers_1.VOYAGERS.map(async (cfg) => {
            const vec = await (0, horizonsClient_1.fetchPlanetStateVector)(cfg.horizonsId, cfg.displayName, {
                correlationId: requestId,
                includeObserver: false
            });
            const distAu = magnitude(vec.x_au, vec.y_au, vec.z_au);
            const distEarthAu = deltaMagnitude(vec.x_au, vec.y_au, vec.z_au, earth?.x_au, earth?.y_au, earth?.z_au);
            const velAuPerDay = magnitude(vec.vx_au_per_day, vec.vy_au_per_day, vec.vz_au_per_day);
            const distanceKm = distAu ? distAu * AU_TO_KM : null;
            const distanceMiles = distanceKm ? distanceKm * KM_TO_MILES : null;
            const distanceEarthKm = distEarthAu ? distEarthAu * AU_TO_KM : null;
            const distanceEarthMiles = distanceEarthKm ? distanceEarthKm * KM_TO_MILES : null;
            const speedKmPerS = velAuPerDay !== null ? (velAuPerDay * AU_TO_KM) / SECONDS_PER_DAY : null;
            const speedMilesPerS = speedKmPerS !== null ? speedKmPerS * KM_TO_MILES : null;
            const lightTime = computeLightTime(distanceEarthKm);
            const trajectory = computeTrajectory({ x: vec.x_au, y: vec.y_au, z: vec.z_au }, {
                vx: vec.vx_au_per_day,
                vy: vec.vy_au_per_day,
                vz: vec.vz_au_per_day
            });
            return {
                id: cfg.id,
                name: vec.name,
                horizonsId: cfg.horizonsId,
                positionAu: { x: vec.x_au, y: vec.y_au, z: vec.z_au },
                positionKm: distAu !== null
                    ? {
                        x: vec.x_au * AU_TO_KM,
                        y: vec.y_au * AU_TO_KM,
                        z: vec.z_au * AU_TO_KM
                    }
                    : null,
                positionMiles: distAu !== null
                    ? {
                        x: vec.x_au * AU_TO_KM * KM_TO_MILES,
                        y: vec.y_au * AU_TO_KM * KM_TO_MILES,
                        z: vec.z_au * AU_TO_KM * KM_TO_MILES
                    }
                    : null,
                velocityAuPerDay: {
                    vx: vec.vx_au_per_day ?? null,
                    vy: vec.vy_au_per_day ?? null,
                    vz: vec.vz_au_per_day ?? null
                },
                velocityKmPerS: velAuPerDay !== null
                    ? {
                        vx: vec.vx_au_per_day !== undefined
                            ? (vec.vx_au_per_day * AU_TO_KM) / SECONDS_PER_DAY
                            : null,
                        vy: vec.vy_au_per_day !== undefined
                            ? (vec.vy_au_per_day * AU_TO_KM) / SECONDS_PER_DAY
                            : null,
                        vz: vec.vz_au_per_day !== undefined
                            ? (vec.vz_au_per_day * AU_TO_KM) / SECONDS_PER_DAY
                            : null
                    }
                    : null,
                velocityMilesPerS: velAuPerDay !== null
                    ? {
                        vx: vec.vx_au_per_day !== undefined
                            ? ((vec.vx_au_per_day * AU_TO_KM) / SECONDS_PER_DAY) * KM_TO_MILES
                            : null,
                        vy: vec.vy_au_per_day !== undefined
                            ? ((vec.vy_au_per_day * AU_TO_KM) / SECONDS_PER_DAY) * KM_TO_MILES
                            : null,
                        vz: vec.vz_au_per_day !== undefined
                            ? ((vec.vz_au_per_day * AU_TO_KM) / SECONDS_PER_DAY) * KM_TO_MILES
                            : null
                    }
                    : null,
                distanceFromSun: {
                    au: distAu,
                    km: distanceKm,
                    miles: distanceMiles
                },
                distanceFromEarth: {
                    au: distEarthAu,
                    km: distanceEarthKm,
                    miles: distanceEarthMiles
                },
                speed: {
                    auPerDay: velAuPerDay,
                    kmPerS: speedKmPerS,
                    milesPerS: speedMilesPerS
                },
                lightTime,
                trajectory,
                timestamp: vec.timestamp,
                referenceFrame: vec.referenceFrame,
                source: vec.source,
                velocityUnit: vec.velocityUnit
            };
        }));
        (0, logger_1.logInfo)('voyagers_fetch', { requestId, count: results.length });
        res.json({
            timestamp: new Date().toISOString(),
            requestId,
            metadata: {
                source: 'NASA-JPL-Horizons',
                unitDistanceBase: 'AU',
                unitVelocityBase: 'AU/day',
                unitDistanceConverted: ['km', 'miles'],
                unitVelocityConverted: ['km/s', 'miles/s']
            },
            voyagers: results
        });
    }
    catch (err) {
        (0, logger_1.logError)('voyagers_fetch_failed', {
            requestId,
            error: err?.message ?? String(err)
        });
        res.status(500).json({
            error: 'Impossible de récupérer les données Voyager',
            requestId
        });
    }
});
exports.default = router;
