// api/faceit-data.js – robust gegen 503, nur 15 Matches, mit Cache‑Versionierung
// *** MIT NEUER IMPACT BERECHNUNG ***
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";
// Cache‑Version hochzählen, wenn du das Shape von statsObj änderst (z.B. wegen neuer Impact-Berechnung):
const CACHE_VERSION  = 2; // <<<< Cache-Version erhöht

// --- Hilfs‑Fetch mit Error‑Throw ----------------------------------------
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Workspace ${url} → ${res.status}`);
    return res.json();
}

// ============================================================
// NEUE HILFSFUNKTION zur Berechnung des Impact Scores
// ============================================================
/**
 * Berechnet einen neuen "Proxy" Impact Score basierend auf KPR, ADR und KAST.
 * Versucht, Spieler zu belohnen, die überdurchschnittlich in Kills und Schaden sind,
 * angepasst durch ihre Rundenkonstanz (KAST).
 *
 * @param {number} kpr_avg - Durchschnittliche Kills pro Runde
 * @param {number} adr_avg - Durchschnittlicher Schaden pro Runde
 * @param {number} kast_avg - KAST Rate in Prozent (z.B. 70 für 70%)
 * @returns {number} Der berechnete Impact Score
 */
function calculateNewImpact(kpr_avg, adr_avg, kast_avg) {
    // --- Definiere Baselines (Passe diese ggf. an die Durchschnittswerte deiner Spieler an!) ---
    const baseline_kpr = 0.70; // Geschätzter Durchschnitts-KPR
    const baseline_adr = 75.0; // Geschätzter Durchschnitts-ADR
    const baseline_kast = 68.0; // Geschätzter Durchschnitts-KAST (%)

    // --- Berechne normalisierte Komponenten ---
    // norm_kpr > 1 bedeutet überdurchschnittlicher KPR
    const norm_kpr = kpr_avg / baseline_kpr;
    // norm_adr > 1 bedeutet überdurchschnittlicher ADR
    const norm_adr = adr_avg / baseline_adr;

    // --- Berechne Konsistenz-Modifikator basierend auf KAST ---
    // Ziel: Modifikator ~1.0 bei avg KAST, >1.0 bei überdurchschnittlichem, <1.0 bei unterdurchschnittlichem KAST
    const consistency_modifier = 1.0 + (kast_avg - baseline_kast) * 0.01;
    // Begrenze den Modifikator, um extreme Ausschläge zu verhindern (z.B. zwischen 0.7 und 1.3)
    const clamped_modifier = Math.max(0.7, Math.min(1.3, consistency_modifier));

    // --- Kombiniere Komponenten ---
    // Gewichteter Durchschnitt aus normalisiertem KPR (60%) und ADR (40%)
    const core_impact = (norm_kpr * 0.6) + (norm_adr * 0.4);

    // Wende den Konsistenz-Modifikator an
    const final_impact = core_impact * clamped_modifier;

    // Stelle sicher, dass das Ergebnis nicht negativ ist und gib es zurück
    return Math.max(0, final_impact);
}
// ============================================================
// ENDE NEUE HILFSFUNKTION
// ============================================================


/**
 * Berechnet alle Kennzahlen aus einem Match‑Array.
 * Verwendet jetzt calculateNewImpact für den Impact Score.
 */
function calculateAverageStats(matches) {
    const DMG_PER_KILL = 105;
    const TRADE_PERCENT = 0.2;
    const KAST_FACTOR = 0.45; // Faktor aus alter KAST-Berechnung
    const weight = matches.length; // Anzahl der Matches

    if (weight === 0) {
        // Standard-Nullwerte zurückgeben
        return {
            kills: 0, deaths: 0, kd: 0, dpr: 0, kpr: 0, adr: 0, hs: 0, hsp: 0,
            apr: 0, kast: 0, impact: 0, rating: 0, weight: 0
        };
    }

    // Extrahieren der relevanten Rohdaten pro Match
    const matchStats = matches.map(m => {
        const kills     = +m.Kills        || 0;
        const deaths    = +m.Deaths       || 0;
        const rounds    = Math.max(1, +m.Rounds || 1); // Mindestens 1 Runde
        const kpr_match = kills / rounds; // KPR für DIESES Match (für ADR Fallback)
        const adr       = +m.ADR          || (kpr_match * DMG_PER_KILL); // ADR für DIESES Match
        const headshots = +m.Headshots    || 0;
        const assists   = +m.Assists      || 0;
        return { kills, deaths, rounds, adr, headshots, assists };
    });

    // Berechne Summen und einfache Durchschnitte über alle Matches
    const totalKills  = matchStats.reduce((s, x) => s + x.kills, 0);
    const totalDeaths = matchStats.reduce((s, x) => s + x.deaths, 0);
    const totalAssists = matchStats.reduce((s, x) => s + x.assists, 0);
    const totalHeadshots = matchStats.reduce((s, x) => s + x.headshots, 0);
    const totalRounds = matchStats.reduce((s, x) => s + x.rounds, 0);
    const totalAdrSum = matchStats.reduce((s, x) => s + x.adr, 0); // Einfache Summe für ADR-Avg

    // Berechne durchschnittliche Statistiken (Pro Runde oder Gesamt)
    // WICHTIG: Diese Funktion verwendet (anders als die zuvor diskutierte gewichtete Version)
    // weiterhin einfache Durchschnitte über die Matches für KPR, DPR, APR, ADR.
    const kpr = totalRounds > 0 ? totalKills / totalRounds : 0;
    const dpr = totalRounds > 0 ? totalDeaths / totalRounds : 0;
    const apr = totalRounds > 0 ? totalAssists / totalRounds : 0;
    const adr = totalRounds > 0 ? totalAdrSum / totalRounds : 0; // ADR als Durchschnitt pro Runde
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths; // Gesamt K/D
    const hsp = totalKills === 0 ? 0 : (totalHeadshots / totalKills) * 100; // Gesamt HS%

    // KAST-Berechnung (wie vorher in dieser Datei, einfacher Durchschnitt pro Match)
    const kast = matchStats.reduce((sum, x) => {
        const survived = x.rounds - x.deaths;
        const traded = TRADE_PERCENT * x.rounds;
        const raw = (x.kills + x.assists + survived + traded) * KAST_FACTOR;
        // Stelle sicher, dass x.rounds > 0 ist
        const kast_match_percent = x.rounds > 0 ? Math.min((raw / x.rounds) * 100, 100) : 0;
        return sum + kast_match_percent;
    }, 0) / weight; // Durchschnitt über die Anzahl der Matches

    // *** NEUE IMPACT BERECHNUNG ***
    const impact_new = calculateNewImpact(kpr, adr, kast); // Aufruf der neuen Funktion

    // Rating 2.0 Berechnung (verwendet den *neuen* Impact-Wert)
    const ratingRaw =
        0.0073 * kast +
        0.3591 * kpr +
        -0.5329 * dpr +
        0.2372 * impact_new + // <<<< Neuer Impact hier verwendet
        0.0032 * adr +
        0.1587;
    const rating = Math.max(0, ratingRaw); // Sicherstellen, dass Rating nicht negativ ist

    // Rückgabe der berechneten Werte
    return {
        // Beachte: avgk wurde entfernt, da es nur kills/weight war und nicht sehr aussagekräftig
        kills: totalKills,
        deaths: totalDeaths,
        hs: totalHeadshots,
        kd:      +kd.toFixed(2),    // Gesamt K/D
        dpr:     +dpr.toFixed(2),    // Deaths pro Runde (Avg)
        kpr:     +kpr.toFixed(2),    // Kills pro Runde (Avg)
        adr:     +adr.toFixed(1),    // ADR (Avg pro Runde)
        hsp:     +hsp.toFixed(1),    // HS % (Gesamt)
        apr:     +apr.toFixed(2),    // Assists pro Runde (Avg)
        kast:    +kast.toFixed(1),   // KAST % (Avg pro Match)
        impact:  +impact_new.toFixed(2), // <<<< Neuer Impact Wert
        rating:  +rating.toFixed(2), // Rating (basiert auf neuem Impact)
        weight: weight             // Anzahl der berücksichtigten Matches
    };
}

/**
 * Wählt die letzten 15 Matches (nach CreatedAt) und berechnet die Stats
 */
function calculateCurrentFormStats(matches) {
    const recent = matches
        .slice()
        .sort((a,b)=> new Date(b.CreatedAt) - new Date(a.CreatedAt))
        .slice(0, 15); // Nimmt die letzten 15 Matches
    return {
        // Ruft die (jetzt angepasste) calculateAverageStats Funktion auf
        stats: calculateAverageStats(recent),
        matchesCount: recent.length
    };
}

// --- Redis‑Init (optional) --------------------------------------------
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { lazyConnect: true });
    redis.on("error", () => { redis = null; });
}

// --- Haupt‑Handler ----------------------------------------------------
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }

    try {
        const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
        // 1) Basis‑Daten von Faceit
        const details = await fetchJson(
            `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
            headers
        );

        // 2) Grund‑Antwort (Struktur bleibt gleich)
        const resp = {
            nickname: details.nickname,
            avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? "#",
            elo: details.games?.cs2?.faceit_elo ?? "N/A",
            level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
            // Diese Felder werden später aus statsObj befüllt
            calculatedRating: null,
            kd: null,
            dpr: null,
            kpr: null,
            adr: null,
            hsPercent: null,
            kast: null,
            impact: null, // Wird jetzt mit neuem Wert befüllt
            matchesConsidered: 0,
            lastUpdated: null
        };

        // 3) Versuch, aus Cache zu laden – aber nur, wenn Version stimmt
        let statsObj = null;
        if (redis) {
            const cacheKey = `player_stats:${details.player_id}`;
            const raw = await redis.get(cacheKey);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    // Prüfe die Cache-Version
                    if (parsed.version === CACHE_VERSION) {
                        statsObj = parsed;
                        console.log(`[Cache] HIT for ${nickname}`);
                    } else {
                        console.log(`[Cache] Version mismatch for ${nickname} (found ${parsed.version}, expected ${CACHE_VERSION})`);
                    }
                } catch (e) {
                    console.error(`[Cache] Failed to parse cache for ${nickname}:`, e);
                    // Cache ist korrupt, ignoriere ihn
                }
            } else {
                console.log(`[Cache] MISS for ${nickname}`);
            }
        }

        // 4) Live‑Fallback, falls kein valider Cache
        if (!statsObj) {
            console.log(`[API] Fetching live data for ${nickname}`);
            // History holen (max 15, 503s ignorieren)
            let items = [];
            try {
                // Nur die letzten 15 Matches holen, wie vorher
                const hist = await fetchJson(
                    `${API_BASE_URL}/players/${details.player_id}/history?game=cs2&limit=15`,
                    headers
                );
                items = hist.items || [];
            } catch(e) {
                console.warn(`[API] History fetch failed for ${nickname}:`, e.message);
                items = []; // Fahre ohne Matches fort, wenn History fehlschlägt
            }

            // Pro‑Match Detail-Stats holen (503s ignorieren)
            const matchDataPromises = items.map(async h => {
                try {
                    const stat = await fetchJson(
                        `${API_BASE_URL}/matches/${h.match_id}/stats`,
                        headers
                    );
                    const round = stat.rounds?.[0];
                    if (!round) return null; // Runde nicht gefunden
                    const teamData = round.teams.find(team => team.players.some(p => p.player_id === details.player_id));
                    if (!teamData) return null; // Spieler im Match nicht gefunden?
                    const p = teamData.players.find(p => p.player_id === details.player_id);
                    if (!p) return null; // Spieler in Team nicht gefunden?

                    // Sammle Rohdaten für die Berechnung
                    return {
                        Kills:      +p.player_stats.Kills,
                        Deaths:     +p.player_stats.Deaths,
                        Assists:    +p.player_stats.Assists,
                        Headshots:  +p.player_stats.Headshots,
                        "K/R Ratio":+p.player_stats["K/R Ratio"], // Wird für ADR Fallback gebraucht
                        ADR:        +(p.player_stats.ADR ?? p.player_stats["Average Damage per Round"]),
                        Rounds:     +(round.round_stats.Rounds || 1), // Rundenanzahl
                        Win:        round.round_stats.Winner === teamData.team_id ? 1 : 0, // Sieg?
                        CreatedAt:  h.started_at // Für Sortierung in calculateCurrentFormStats
                    };
                } catch (matchErr) {
                    // Ignoriere Fehler beim Holen einzelner Match-Stats (z.B. 503)
                    console.warn(`[API] Failed to fetch stats for match ${h.match_id}:`, matchErr.message);
                    return null;
                }
            });

            // Warte auf alle Match-Stat-Abfragen und filtere fehlgeschlagene raus
            const matchData = (await Promise.all(matchDataPromises)).filter(Boolean);

            // Berechne Stats basierend auf den erfolgreichen Matches
            // calculateCurrentFormStats ruft die angepasste calculateAverageStats auf
            const { stats, matchesCount } = calculateCurrentFormStats(matchData);

            // Erstelle das Objekt zum Speichern/Zurückgeben
            // Beachte: Die Feldnamen (impact, rating, kd etc.) müssen mit denen in `resp` übereinstimmen
            statsObj = {
                version:          CACHE_VERSION,      // Wichtig für Cache-Invalidierung
                calculatedRating: stats.rating,      // Rating (basiert auf neuem Impact)
                kd:               stats.kd,
                dpr:              stats.dpr,
                kpr:              stats.kpr,
                adr:              stats.adr,
                hsPercent:        stats.hsp,          // hsPercent = hsp
                kast:             stats.kast,
                impact:           stats.impact,       // <<<< Neuer Impact Wert
                matchesConsidered: matchesCount,      // Anzahl der tatsächlich berücksichtigten Matches
                lastUpdated:      new Date().toISOString() // Zeitstempel der Berechnung
            };

            // In Redis cachen (1 Woche), wenn Redis verfügbar ist
            if (redis) {
                try {
                    await redis.set(
                        `player_stats:${details.player_id}`,
                        JSON.stringify(statsObj),
                        "EX", // Setze Ablaufzeit
                        7 * 24 * 60 * 60 // 1 Woche in Sekunden
                    );
                    console.log(`[Cache] Stored updated stats for ${nickname}`);
                } catch (redisErr) {
                    console.error(`[Cache] Failed to set cache for ${nickname}:`, redisErr);
                    // Fahre ohne Caching fort, wenn Speichern fehlschlägt
                }
            }
        } // Ende if (!statsObj)

        // 5) In die Antwort übernehmen und senden
        // Überschreibe die Null-Werte in resp mit den Werten aus statsObj
        Object.assign(resp, {
            calculatedRating: statsObj.calculatedRating,
            kd: statsObj.kd,
            dpr: statsObj.dpr,
            kpr: statsObj.kpr,
            adr: statsObj.adr,
            hsPercent: statsObj.hsPercent,
            kast: statsObj.kast,
            impact: statsObj.impact, // Stelle sicher, dass das Feld hier auch impact heisst
            matchesConsidered: statsObj.matchesConsidered,
            lastUpdated: statsObj.lastUpdated
        });

        // Setze Cache-Header für Vercel Edge/CDN
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
        return res.status(200).json(resp);

    } catch (err) {
        // Allgemeiner Fehler-Handler
        console.error(`[api/faceit-data] Error processing ${nickname}:`, err);
        // Gib trotzdem 200 zurück, aber mit Fehlerinfo, damit Frontend dies anzeigen kann
        return res.status(200).json({
          nickname: nickname || req.query.nickname, // Versuche Nickname zu bekommen
          error: err.message || "Unbekannter Fehler bei der Datenverarbeitung"
        });
    }
}