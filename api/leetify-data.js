import Redis from "ioredis";

const API_BASE_URL = "https://api-public.cs-prod.leetify.com";
const STEAM64_ID_PATTERN = /^\d{17}$/;
const REDIS_URL = process.env.REDIS_URL;
const CACHE_VERSION = 1;
const PROFILE_CACHE_FRESH_SECONDS = 24 * 60 * 60;
const PROFILE_CACHE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const MISSING_CACHE_FRESH_SECONDS = 6 * 60 * 60;
const MISSING_CACHE_RETENTION_SECONDS = 24 * 60 * 60;

let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            showFriendlyErrorStack: true
        });
        redis.on("error", (error) => {
            console.error("[Redis Leetify]", error.message);
        });
    } catch (error) {
        console.error("[Redis Leetify] Initialisierung fehlgeschlagen:", error.message);
        redis = null;
    }
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function pickProfile(data, steam64Id) {
    return {
        available: true,
        name: data.name || null,
        steam64Id,
        profileUrl: `https://leetify.com/public/profile/${steam64Id}`,
        privacyMode: data.privacy_mode || null,
        totalMatches: toFiniteNumber(data.total_matches),
        winRate: toFiniteNumber(data.winrate),
        leetifyRating: toFiniteNumber(data.ranks?.leetify),
        aimRating: toFiniteNumber(data.rating?.aim),
        positioningRating: toFiniteNumber(data.rating?.positioning),
        utilityRating: toFiniteNumber(data.rating?.utility),
        timeToDamage: toFiniteNumber(data.stats?.reaction_time_ms),
        crosshairPlacement: toFiniteNumber(data.stats?.preaim),
        counterStrafing: toFiniteNumber(data.stats?.counter_strafing_good_shots_ratio),
        sprayAccuracy: toFiniteNumber(data.stats?.spray_accuracy)
    };
}

function cacheKey(steam64Id) {
    return `leetify_profile:v${CACHE_VERSION}:${steam64Id}`;
}

async function readCache(key) {
    if (!redis) return null;

    try {
        const raw = await redis.get(key);
        if (!raw) return null;

        const cached = JSON.parse(raw);
        if (
            cached?.version !== CACHE_VERSION
            || !Number.isFinite(cached?.freshUntil)
            || !cached?.data
        ) {
            return null;
        }
        return cached;
    } catch (error) {
        console.error("[Redis Leetify] GET fehlgeschlagen:", error.message);
        return null;
    }
}

async function writeCache(key, cached, retentionSeconds) {
    if (!redis) return;

    try {
        await redis.set(key, JSON.stringify(cached), "EX", retentionSeconds);
    } catch (error) {
        console.error("[Redis Leetify] SET fehlgeschlagen:", error.message);
    }
}

function cachedRecord(data, now) {
    const freshSeconds = data.available
        ? PROFILE_CACHE_FRESH_SECONDS
        : MISSING_CACHE_FRESH_SECONDS;

    return {
        version: CACHE_VERSION,
        cachedAt: new Date(now).toISOString(),
        freshUntil: now + freshSeconds * 1000,
        data
    };
}

function sendResponse(res, status, body, cacheStatus) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Leetify-Cache", cacheStatus);
    return res.status(status).json(body);
}

export function createLeetifyHandler({
    fetchImpl = (...args) => globalThis.fetch(...args),
    cacheReader = readCache,
    cacheWriter = writeCache,
    now = () => Date.now()
} = {}) {
    return async function handler(req, res) {
        if (req.method !== "GET") {
            res.setHeader("Allow", "GET");
            return res.status(405).json({ error: "Methode nicht erlaubt" });
        }

        const steam64Id = String(req.query.steam64_id || "").trim();
        if (!STEAM64_ID_PATTERN.test(steam64Id)) {
            return res.status(400).json({ error: "Gültige Steam64-ID erforderlich" });
        }

        const key = cacheKey(steam64Id);
        const cached = await cacheReader(key);
        if (cached && cached.freshUntil > now()) {
            return sendResponse(res, 200, cached.data, "HIT");
        }

        const headers = { Accept: "application/json" };
        if (process.env.LEETIFY_API_KEY) {
            headers.Authorization = `Bearer ${process.env.LEETIFY_API_KEY}`;
        }

        try {
            const response = await fetchImpl(
                `${API_BASE_URL}/v3/profile?steam64_id=${encodeURIComponent(steam64Id)}`,
                {
                    headers,
                    signal: AbortSignal.timeout(10000)
                }
            );
            const data = await response.json().catch(() => null);

            if (response.status === 404) {
                const missingProfile = {
                    available: false,
                    reason: "Für diesen Spieler ist kein öffentliches Leetify-Profil verfügbar."
                };
                await cacheWriter(
                    key,
                    cachedRecord(missingProfile, now()),
                    MISSING_CACHE_RETENTION_SECONDS
                );
                return sendResponse(res, 200, missingProfile, cached ? "REFRESH" : "MISS");
            }

            if (!response.ok || !data) {
                if (cached?.data) {
                    return sendResponse(res, 200, cached.data, "STALE");
                }

                const message = response.status === 429
                    ? "Leetify-Limit erreicht. Bitte später erneut versuchen."
                    : "Leetify-Daten konnten nicht geladen werden.";
                return sendResponse(
                    res,
                    response.status >= 400 ? response.status : 502,
                    { error: message },
                    "MISS"
                );
            }

            const profile = pickProfile(data, steam64Id);
            await cacheWriter(
                key,
                cachedRecord(profile, now()),
                PROFILE_CACHE_RETENTION_SECONDS
            );
            return sendResponse(res, 200, profile, cached ? "REFRESH" : "MISS");
        } catch (error) {
            if (cached?.data) {
                return sendResponse(res, 200, cached.data, "STALE");
            }

            const message = error?.name === "TimeoutError"
                ? "Leetify hat nicht rechtzeitig geantwortet."
                : "Leetify-Daten sind vorübergehend nicht erreichbar.";
            return sendResponse(res, 502, { error: message }, "MISS");
        }
    };
}

export default createLeetifyHandler();
