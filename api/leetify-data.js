const API_BASE_URL = "https://api-public.cs-prod.leetify.com";
const STEAM64_ID_PATTERN = /^\d{17}$/;

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

export default async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Methode nicht erlaubt" });
    }

    const steam64Id = String(req.query.steam64_id || "").trim();
    if (!STEAM64_ID_PATTERN.test(steam64Id)) {
        return res.status(400).json({ error: "Gültige Steam64-ID erforderlich" });
    }

    const headers = { Accept: "application/json" };
    if (process.env.LEETIFY_API_KEY) {
        headers.Authorization = `Bearer ${process.env.LEETIFY_API_KEY}`;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/v3/profile?steam64_id=${encodeURIComponent(steam64Id)}`,
            {
                headers,
                signal: AbortSignal.timeout(10000)
            }
        );
        const data = await response.json().catch(() => null);

        if (response.status === 404) {
            res.setHeader("Cache-Control", "no-store");
            return res.status(200).json({
                available: false,
                reason: "Für diesen Spieler ist kein öffentliches Leetify-Profil verfügbar."
            });
        }

        if (!response.ok || !data) {
            const message = response.status === 429
                ? "Leetify-Limit erreicht. Bitte später erneut versuchen."
                : "Leetify-Daten konnten nicht geladen werden.";
            res.setHeader("Cache-Control", "no-store");
            return res.status(response.status >= 400 ? response.status : 502).json({
                error: message
            });
        }

        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json(pickProfile(data, steam64Id));
    } catch (error) {
        const message = error?.name === "TimeoutError"
            ? "Leetify hat nicht rechtzeitig geantwortet."
            : "Leetify-Daten sind vorübergehend nicht erreichbar.";
        res.setHeader("Cache-Control", "no-store");
        return res.status(502).json({ error: message });
    }
}
