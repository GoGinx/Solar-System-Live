"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalog = getCatalog;
const axios_1 = __importDefault(require("axios"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const planets_1 = require("../config/planets");
const logger_1 = require("../observability/logger");
const AU_IN_KM = 149597870.7;
const CATALOG_FILENAME = 'solar-system-catalog.json';
const CATALOG_CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const LE_SYSTEME_BASE_URL = process.env.LE_SYSTEME_SOLAIRE_API_URL ?? 'https://api.le-systeme-solaire.net/rest';
const LE_SYSTEME_API_KEY = process.env.LE_SYSTEME_SOLAIRE_API_KEY;
const WIKI_LANG_PRIMARY = process.env.WIKI_LANG_PRIMARY ?? 'fr';
const WIKI_LANG_FALLBACK = process.env.WIKI_LANG_FALLBACK ?? 'en';
const WIKI_USER_AGENT = process.env.WIKI_USER_AGENT ?? 'Solar-System-Live/1.0';
const PLANET_NAME_BY_LE_SYSTEME_ID = {
    mercury: 'mercury',
    mercure: 'mercury',
    venus: 'venus',
    earth: 'earth',
    terre: 'earth',
    mars: 'mars',
    jupiter: 'jupiter',
    saturn: 'saturn',
    saturne: 'saturn',
    uranus: 'uranus',
    neptune: 'neptune',
    pluto: 'pluto',
    pluton: 'pluto'
};
const WIKI_PAGE_BY_PLANET = {
    mercury: 'Mercure_(plan%C3%A8te)',
    venus: 'V%C3%A9nus_(plan%C3%A8te)',
    earth: 'Terre_(plan%C3%A8te)',
    mars: 'Mars_(plan%C3%A8te)',
    jupiter: 'Jupiter_(plan%C3%A8te)',
    saturn: 'Saturne_(plan%C3%A8te)',
    uranus: 'Uranus_(plan%C3%A8te)',
    neptune: 'Neptune_(plan%C3%A8te)',
    pluto: 'Pluton_(plan%C3%A8te_naine)'
};
const WIKI_PAGE_BY_STAR = {
    sun: 'Soleil'
};
const HORIZONS_ID_BY_PLANET = new Map(planets_1.PLANETS.map((p) => [p.name, p.horizonsId]));
const PLANET_NAME_SET = new Set(planets_1.PLANETS.map((p) => p.name));
function isPlanetName(value) {
    return PLANET_NAME_SET.has(value);
}
const cacheByLang = new Map();
const inflightByLang = new Map();
function normalizeLeSystemeName(value) {
    if (!value)
        return null;
    const key = value.trim().toLowerCase();
    return PLANET_NAME_BY_LE_SYSTEME_ID[key] ?? null;
}
function normalizeLang(lang) {
    if (!lang)
        return null;
    const normalized = lang.trim().toLowerCase();
    if (normalized.startsWith('fr'))
        return 'fr';
    if (normalized.startsWith('en'))
        return 'en';
    return null;
}
function resolveWikiLangs(lang) {
    const normalized = normalizeLang(lang);
    if (normalized) {
        return {
            primary: normalized,
            fallback: normalized === 'fr' ? 'en' : 'fr',
            key: normalized
        };
    }
    const primary = WIKI_LANG_PRIMARY;
    const fallback = WIKI_LANG_FALLBACK && WIKI_LANG_FALLBACK !== primary ? WIKI_LANG_FALLBACK : undefined;
    const key = normalizeLang(primary) ?? 'fr';
    return { primary, fallback, key };
}
function toMassKg(mass) {
    const value = Number(mass?.massValue);
    const exp = Number(mass?.massExponent);
    if (!Number.isFinite(value) || !Number.isFinite(exp))
        return null;
    return value * Math.pow(10, exp);
}
function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
async function readLocalCatalog() {
    const cwd = process.cwd();
    const candidates = Array.from(new Set([
        process.env.CATALOG_PATH,
        path_1.default.resolve(cwd, 'client', 'src', 'assets', CATALOG_FILENAME),
        path_1.default.resolve(cwd, '..', 'client', 'src', 'assets', CATALOG_FILENAME),
        path_1.default.resolve(cwd, 'client', 'dist', 'solar-system-real-client', 'assets', CATALOG_FILENAME),
        path_1.default.resolve(cwd, '..', 'client', 'dist', 'solar-system-real-client', 'assets', CATALOG_FILENAME),
        path_1.default.resolve(__dirname, '..', '..', '..', 'client', 'src', 'assets', CATALOG_FILENAME),
        path_1.default.resolve(__dirname, '..', '..', '..', 'client', 'dist', 'solar-system-real-client', 'assets', CATALOG_FILENAME)
    ].filter((value) => !!value)));
    let lastError = null;
    for (const filePath of candidates) {
        try {
            const raw = await promises_1.default.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        }
        catch (err) {
            lastError = err;
        }
    }
    if (candidates.length > 0) {
        (0, logger_1.logWarn)('catalog_local_read_failed', {
            error: lastError?.message ?? String(lastError),
            filePath: candidates[0],
            attempted: candidates
        });
    }
    return null;
}
async function fetchLeSystemePlanets() {
    const errors = [];
    const planets = new Map();
    if (!LE_SYSTEME_API_KEY) {
        errors.push({ source: 'le-systeme-solaire', message: 'missing api key' });
        return { planets, star: null, errors };
    }
    const headers = { Authorization: `Bearer ${LE_SYSTEME_API_KEY}` };
    try {
        const res = await axios_1.default.get(`${LE_SYSTEME_BASE_URL}/bodies`, {
            headers,
            params: { 'filter[]': 'isPlanet,eq,true' }
        });
        const bodies = Array.isArray(res.data?.bodies) ? res.data.bodies : [];
        for (const body of bodies) {
            const key = normalizeLeSystemeName(body?.id ?? body?.englishName ?? body?.name);
            if (!key)
                continue;
            const massKg = toMassKg(body?.mass);
            const meanRadius = toNumber(body?.meanRadius ?? body?.equaRadius ?? body?.equatorialRadius);
            const semiMajorAxisKm = toNumber(body?.semimajorAxis ?? body?.semiMajorAxis ?? body?.semimajoraxis);
            const semiMajorAxisAU = semiMajorAxisKm !== null ? semiMajorAxisKm / AU_IN_KM : null;
            const moons = Array.isArray(body?.moons) ? body.moons : [];
            planets.set(key, {
                massKg: massKg ?? undefined,
                radiusKm: meanRadius ?? undefined,
                semiMajorAxisAU: semiMajorAxisAU ?? undefined,
                orbitalPeriodDays: toNumber(body?.sideralOrbit) ?? undefined,
                rotationPeriodHours: toNumber(body?.sideralRotation) ?? undefined,
                inclinationDeg: toNumber(body?.inclination) ?? undefined,
                axialTiltDeg: toNumber(body?.axialTilt) ?? undefined,
                eccentricity: toNumber(body?.eccentricity) ?? undefined,
                meanDensity: toNumber(body?.density) ?? undefined,
                gravityMs2: toNumber(body?.gravity) ?? undefined,
                escapeVelocityKms: toNumber(body?.escape) ?? undefined,
                meanSurfaceTempK: toNumber(body?.avgTemp) ?? undefined,
                moonsCount: moons.length || undefined,
                majorMoons: moons.length ? moons.map((m) => m?.moon).filter(Boolean).slice(0, 8) : undefined
            });
        }
    }
    catch (err) {
        errors.push({ source: 'le-systeme-solaire', message: err?.message ?? String(err) });
        (0, logger_1.logWarn)('le_systeme_solaire_fetch_failed', {
            error: err?.message ?? String(err)
        });
    }
    let star = null;
    try {
        const res = await axios_1.default.get(`${LE_SYSTEME_BASE_URL}/bodies/soleil`, { headers });
        const body = res.data;
        const massKg = toMassKg(body?.mass);
        const meanRadius = toNumber(body?.meanRadius ?? body?.equaRadius ?? body?.equatorialRadius);
        star = {
            massKg: massKg ?? undefined,
            radiusKm: meanRadius ?? undefined,
            meanSurfaceTempK: toNumber(body?.avgTemp) ?? undefined
        };
    }
    catch {
        try {
            const res = await axios_1.default.get(`${LE_SYSTEME_BASE_URL}/bodies/sun`, { headers });
            const body = res.data;
            const massKg = toMassKg(body?.mass);
            const meanRadius = toNumber(body?.meanRadius ?? body?.equaRadius ?? body?.equatorialRadius);
            star = {
                massKg: massKg ?? undefined,
                radiusKm: meanRadius ?? undefined,
                meanSurfaceTempK: toNumber(body?.avgTemp) ?? undefined
            };
        }
        catch (err) {
            errors.push({ source: 'le-systeme-solaire', message: err?.message ?? String(err) });
            (0, logger_1.logWarn)('le_systeme_solaire_sun_failed', {
                error: err?.message ?? String(err)
            });
        }
    }
    return { planets, star, errors };
}
async function fetchWikiSummary(page, lang) {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${page}`;
    try {
        const res = await axios_1.default.get(url, {
            headers: {
                'User-Agent': WIKI_USER_AGENT,
                Accept: 'application/json'
            }
        });
        const extract = res.data?.extract;
        const link = res.data?.content_urls?.desktop?.page ?? res.data?.content_urls?.mobile?.page ?? null;
        if (!extract || !link)
            return null;
        return { extract, url: link };
    }
    catch (err) {
        (0, logger_1.logWarn)('wiki_summary_failed', { url, error: err?.message ?? String(err) });
        return null;
    }
}
async function applyWikipediaSummaries(catalog, langs) {
    const sources = [];
    const langPrimary = langs.primary;
    const langFallback = langs.fallback;
    const planetTasks = catalog.planets.map(async (planet) => {
        const name = String(planet.name ?? '');
        const page = WIKI_PAGE_BY_PLANET[name];
        if (!page)
            return;
        const primary = await fetchWikiSummary(page, langPrimary);
        const fallback = primary || !langFallback ? null : await fetchWikiSummary(page, langFallback);
        const summary = primary ?? fallback;
        if (summary) {
            planet.info = summary.extract;
            planet.referenceUrl = summary.url;
            sources.push(`wikipedia-${primary ? langPrimary : langFallback}`);
        }
    });
    const starTask = async () => {
        const page = WIKI_PAGE_BY_STAR['sun'];
        const star = catalog.star;
        if (!page || !star)
            return;
        const primary = await fetchWikiSummary(page, langPrimary);
        const fallback = primary || !langFallback ? null : await fetchWikiSummary(page, langFallback);
        const summary = primary ?? fallback;
        if (summary) {
            star.info = summary.extract;
            star.referenceUrl = summary.url;
            sources.push(`wikipedia-${primary ? langPrimary : langFallback ?? langPrimary}`);
        }
    };
    await Promise.all([Promise.allSettled(planetTasks), starTask()]);
    return { catalog, sources: Array.from(new Set(sources)) };
}
function mergePlanet(localPlanet, external) {
    if (!external)
        return localPlanet;
    return {
        ...localPlanet,
        ...external,
        moons: localPlanet.moons ?? external.moons,
        majorMoons: external.majorMoons ?? localPlanet.majorMoons
    };
}
async function getCatalog(options) {
    const now = Date.now();
    const langs = resolveWikiLangs(options?.lang);
    const cacheKey = langs.key;
    const cached = cacheByLang.get(cacheKey);
    if (!options?.forceRefresh && cached && now < cached.expiresAt) {
        return cached.payload;
    }
    if (!inflightByLang.has(cacheKey)) {
        const inflight = (async () => {
            const errors = [];
            const sources = {
                catalog: ['local'],
                descriptions: []
            };
            const localCatalog = (await readLocalCatalog()) ?? {
                source: 'fallback',
                updatedAt: new Date().toISOString(),
                star: {
                    id: 'sun',
                    displayName: 'Soleil',
                    color: '#ffcc33',
                    radiusKm: 695700,
                    massKg: 1.9885e30,
                    info: 'Etoile du systeme solaire.'
                },
                planets: []
            };
            const leSysteme = await fetchLeSystemePlanets();
            errors.push(...leSysteme.errors);
            if (leSysteme.planets.size > 0 || leSysteme.star) {
                sources.catalog.push('le-systeme-solaire');
            }
            const mergedPlanets = localCatalog.planets.map((planet) => {
                const key = String(planet.name ?? '');
                const external = leSysteme.planets.get(key);
                const merged = mergePlanet(planet, external);
                const horizonsId = isPlanetName(key) ? HORIZONS_ID_BY_PLANET.get(key) : undefined;
                if (horizonsId && !merged.horizonsId) {
                    merged.horizonsId = horizonsId;
                }
                return merged;
            });
            const star = leSysteme.star ? { ...localCatalog.star, ...leSysteme.star } : localCatalog.star;
            let payload = {
                ...localCatalog,
                updatedAt: new Date().toISOString(),
                source: sources.catalog.join('+'),
                star,
                planets: mergedPlanets,
                metadata: {
                    sources,
                    errors: errors.length ? errors : undefined
                }
            };
            const wiki = await applyWikipediaSummaries(payload, langs);
            if (wiki.sources.length) {
                sources.descriptions.push(...wiki.sources);
                payload = {
                    ...payload,
                    metadata: {
                        sources,
                        errors: errors.length ? errors : undefined
                    }
                };
            }
            (0, logger_1.logInfo)('catalog_built', { requestId: options?.requestId, sources, lang: langs.primary });
            return payload;
        })().finally(() => {
            inflightByLang.delete(cacheKey);
        });
        inflightByLang.set(cacheKey, inflight);
    }
    const payload = await inflightByLang.get(cacheKey);
    cacheByLang.set(cacheKey, {
        payload,
        expiresAt: Date.now() + CATALOG_CACHE_TTL_MS
    });
    return payload;
}
