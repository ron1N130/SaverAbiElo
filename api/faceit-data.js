// api/faceit-data.js – robust gegen 503, nur 15 Matches, mit Cache‑Versionierung
// -------------------------------------------------
// ◼ Rating-Berechnung näher am Original, NEUE Impact-Formel beibehalten
// ◼ Cache Version erhöht (v3)
// ◼ KAST Berechnung vereinheitlicht
// -------------------------------------------------
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";
// Cache‑Version hochzählen (muss mit update-stats.js übereinstimmen!)
const CACHE_VERSION  = 3; // <<<< Cache-Version erhöht auf 3

// --- Hilfs‑Fetch mit Error‑Throw ----------------------------------------
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
    return res.json();
}

// ============================================================
// NEUE HILFSFUNKTION zur Berechnung des Impact Scores
// (Identisch zu update-stats.js)
// ============================================================
/**
 * Berechnet einen neuen "Proxy" Impact Score basierend auf KPR, ADR und KAST.
 * Versucht, Spieler zu belohnen, die überdurchschnittlich in Kills und Schaden sind,
 * angepasst durch ihre Rundenkonstanz (KAST).
 *
 * @param {number} kpr_avg - Durchschnittliche Kills pro Runde
 * @param {number} adr_avg - Durchschnittlicher Schaden pro Runde (einfacher Durchschnitt pro Match)
 * @param {number} kast_avg - KAST Rate in Prozent (Durchschnitt pro Match)
 * @returns {number} Der berechnete Impact Score
 */
function calculateNewImpact(kpr_avg, adr_avg, kast_avg) {
    // --- Definiere Baselines (Passe diese ggf. an die Durchschnittswerte deiner Spieler an!) ---
    const baseline_kpr = 0.70;
    const baseline_adr = 75.0; // Basis für einfachen Match-ADR Durchschnitt
    const baseline_kast = 68.0;

    // --- Berechne normalisierte Komponenten ---
    const norm_kpr = baseline_kpr !== 0 ? kpr_avg / baseline_kpr : kpr_avg;
    const norm_adr = baseline_adr !== 0 ? adr_avg / baseline_adr : adr_avg;

    // --- Berechne Konsistenz-Modifikator basierend auf KAST ---
    const consistency_modifier = 1.0 + (kast_avg - baseline_kast) * 0.01;
    const clamped_modifier = Math.max(0.7, Math.min(1.3, consistency_modifier));

    // --- Kombiniere Komponenten ---
    const core_impact = (norm_kpr * 0.65) + (norm_adr * 0.4);
    const final_impact = core_impact * clamped_modifier;

    return Math.max(0, final_impact);
}
// ============================================================
// ENDE NEUE HILFSFUNKTION
// ============================================================


// --- Stat Berechnung (Rating näher am Original, Impact neu) ----
/**
 * Berechnet Durchschnittsstatistiken aus einer Liste von Matches.
 * Verwendet die ursprüngliche Rating-Formelstruktur mit dem neuen Impact-Wert.
 * ADR wird als einfacher Durchschnitt pro Match berechnet.
 * KAST wird als einfacher Durchschnitt pro Match berechnet.
 */
function calculateAverageStats(matches) {
    const totalMatches = matches.length;
    if (totalMatches === 0) {
        // Standard-Nullwerte zurückgeben
        return {
            kd: 0, dpr: 0, kpr: 0, adr: 0, hsp: 0, winRate: 0, apr: 0,
            kast: 0, impact: 0, rating: 0, weight: 0,
            // Füge auch Rohwerte hinzu, falls benötigt
            kills: 0, deaths: 0, hs: 0, assists: 0
        };
    }

    // Konstanten für Berechnungen
    const DMG_PER_KILL = 105;
    const TRADE_PERCENT = 0.2;
    const KAST_FACTOR = 0.45;

    // Summen initialisieren
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let totalHeadshots = 0;
    let totalWins = 0; // Annahme: Win-Info ist nicht direkt in `matches` hier, wird nicht berechnet
    let totalRounds = 0;
    let simpleTotalAdrSum = 0; // Summe der ADR-Werte pro Match
    let totalKastPercentSum = 0; // Summe der KAST-Prozente pro Match

    // Daten extrahieren und Summen bilden
    matches.forEach(m => {
        const kills = +m.Kills || 0;
        const deaths = +m.Deaths || 0;
        const rounds = Math.max(1, +m.Rounds || 1);
        const kpr_match = kills / rounds;
        // ADR für dieses Match (aus Daten oder Fallback)
        const adr_match = +m.ADR || (kpr_match * DMG_PER_KILL);
        const headshots = +m.Headshots || 0;
        const assists = +m.Assists || 0;
        // const win = +m.Win || 0; // Win-Info fehlt hier standardmäßig

        totalKills += kills;
        totalDeaths += deaths;
        totalAssists += assists;
        totalHeadshots += headshots;
        // totalWins += win; // Kann nicht berechnet werden ohne Win-Info
        totalRounds += rounds;
        simpleTotalAdrSum += adr_match; // Addiere Match-ADR

        // KAST % für dieses Match berechnen
        const survived = rounds - deaths;
        const traded = TRADE_PERCENT * rounds;
        const kastRaw = (kills + assists + survived + traded) * KAST_FACTOR;
        const kast_match_percent = rounds > 0 ? Math.min((kastRaw / rounds) * 100, 100) : 0;
        totalKastPercentSum += kast_match_percent;
    });

    // --- Berechne durchschnittliche Statistiken ---
    // Durchschnitt pro Runde
    const kpr_avg = totalRounds > 0 ? totalKills / totalRounds : 0;
    const dpr_avg = totalRounds > 0 ? totalDeaths / totalRounds : 0;
    const apr_avg = totalRounds > 0 ? totalAssists / totalRounds : 0;

    // ADR als einfacher Durchschnitt pro Match
    const adr_avg_simple = simpleTotalAdrSum / totalMatches;

    // Gesamt oder Durchschnitt pro Match
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths; // Gesamt K/D
    const hsp = totalKills === 0 ? 0 : (totalHeadshots / totalKills) * 100; // Gesamt HS%
    // const winRate = (totalWins / totalMatches) * 100; // WinRate nicht verfügbar
    const kast_avg = totalKastPercentSum / totalMatches; // KAST % (Avg pro Match)

    // *** NEUE IMPACT BERECHNUNG (verwendet einfachen ADR-Avg) ***
    const impact_new = calculateNewImpact(kpr_avg, adr_avg_simple, kast_avg);

    // *** Rating Berechnung: Original-Formelstruktur mit akt. Avg-Werten & NEUEM Impact ***
    const ratingRaw = Math.max(
        0,
        0.0073 * kast_avg +       // KAST Avg (pro Match)
        0.3591 * kpr_avg +      // KPR Avg (pro Runde)
        -0.5329 * dpr_avg +       // DPR Avg (pro Runde)
        0.2372 * impact_new +     // <<<< NEUER Impact Wert
        0.0032 * adr_avg_simple + // <<<< Einfacher ADR Avg Wert
        0.1587
    );
    const rating_final = Math.max(0, ratingRaw);

    // Gib berechnete Stats zurück (inkl. Rohwerte)
    return {
        kills: totalKills,
        deaths: totalDeaths,
        hs: totalHeadshots,
        assists: totalAssists,
        kd:      +kd.toFixed(2),
        dpr:     +dpr_avg.toFixed(2),
        kpr:     +kpr_avg.toFixed(2),
        adr:     +adr_avg_simple.toFixed(1), // ADR (Avg pro Match)
        hsp:     +hsp.toFixed(1),
        apr:     +apr_avg.toFixed(2),
        kast:    +kast_avg.toFixed(1),
        impact:  +impact_new.toFixed(2),    // Impact (NEU)
        rating:  +rating_final.toFixed(2), // Rating (Original-Struktur, neue Inputs)
        weight:  totalMatches               // Anzahl berücksichtigter Matches
        // winRate: +winRate.toFixed(1) // Nicht verfügbar
    };
}


/**
 * Wählt die letzten 15 Matches (nach CreatedAt) und berechnet die Stats
 */
function calculateCurrentFormStats(matches) {
    // Sortiere Matches nach Startzeit (neueste zuerst)
    const recent = matches
        .slice() // Erstelle Kopie, um Original nicht zu ändern
        .sort((a,b)=> {
            // Sicherstellen, dass CreatedAt Zahlen sind
            const timeA = new Date(a.CreatedAt).getTime() || 0;
            const timeB = new Date(b.CreatedAt).getTime() || 0;
            return timeB - timeA; // Jüngstes zuerst
        })
        .slice(0, 15); // Nimm die neuesten 15
    return {
        // Ruft die (jetzt angepasste) calculateAverageStats Funktion auf
        stats: calculateAverageStats(recent),
        matchesCount: recent.length // Anzahl der tatsächlich verwendeten Matches (max 15)
    };
}

// --- Redis‑Init (optional) --------------------------------------------
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 10000, // Kürzerer Timeout für Frontend?
            maxRetriesPerRequest: 2
        });
        redis.on("error", (err) => {
            console.error("[Redis] Connection error in faceit-data:", err.message);
            redis = null; // Bei Fehler Verbindung als nicht verfügbar markieren
        });
         // Kein initialer Connect hier, da lazyConnect=true
        console.log("[Redis] Client initialized for faceit-data.");
    } catch(e) {
        console.error("[Redis] Initialization failed in faceit-data:", e);
        redis = null;
    }
} else {
     console.warn("[Redis] REDIS_URL not set for faceit-data. Caching disabled.");
}

// --- Haupt‑Handler ----------------------------------------------------
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }
    // console.log(`[API faceit-data] Request for: ${nickname}`); // Optional: Logging

    try {
        const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
        // 1) Basis‑Daten von Faceit holen
        const details = await fetchJson(
            `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
            headers
        );
        const playerId = details?.player_id;
        if (!playerId) {
             throw new Error(`Player ${nickname} not found or player_id missing.`);
        }

        // 2) Grund‑Antwort vorbereiten
        const resp = {
            nickname: details.nickname,
            avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? `https://faceit.com/en/players/${details.nickname}`,
            elo: details.games?.cs2?.faceit_elo ?? "N/A",
            level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
            // Felder für berechnete Stats (werden aus Cache oder Live-Berechnung befüllt)
            calculatedRating: null,
            kd: null,
            dpr: null,
            kpr: null,
            adr: null,
            hsPercent: null, // Name muss konsistent sein mit dem, was im Cache steht
            kast: null,
            impact: null,
            matchesConsidered: 0,
            lastUpdated: null,
            cacheStatus: 'miss' // Standardmäßig Cache-Miss
        };

        // 3) Versuch, aus Cache zu laden
        let statsObj = null;
        if (redis) {
            const cacheKey = `player_stats:${playerId}`;
            try {
                const raw = await redis.get(cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    // Prüfe die Cache-Version
                    if (parsed.version === CACHE_VERSION) {
                        statsObj = parsed;
                        resp.cacheStatus = 'hit'; // Cache-Hit
                        // console.log(`[Cache] HIT for ${nickname} (v${CACHE_VERSION})`);
                    } else {
                        resp.cacheStatus = 'stale'; // Veralteter Cache
                        console.log(`[Cache] Version mismatch for ${nickname} (found ${parsed.version}, expected ${CACHE_VERSION})`);
                        // Fahre fort, um Live-Daten zu holen
                    }
                } else {
                     resp.cacheStatus = 'miss'; // Cache-Miss
                     // console.log(`[Cache] MISS for ${nickname}`);
                }
            } catch (e) {
                console.error(`[Cache] Error reading/parsing cache for ${nickname}:`, e);
                resp.cacheStatus = 'error'; // Fehler beim Cache-Zugriff
                // Fahre fort, um Live-Daten zu holen
            }
        } else {
             resp.cacheStatus = 'disabled'; // Redis nicht verfügbar
        }

        // 4) Live‑Fallback, falls kein gültiger Cache-Hit
        if (resp.cacheStatus !== 'hit') {
            console.log(`[API faceit-data] Cache status for ${nickname}: ${resp.cacheStatus}. Fetching live data...`);
            // History holen (max 15 Matches)
            let items = [];
            try {
                const hist = await fetchJson(
                    `${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=15`,
                    headers
                );
                items = hist?.items || []; // Sicherer Zugriff
            } catch (histErr) {
                console.warn(`[API faceit-data] History fetch failed for ${nickname}:`, histErr.message);
                // Wenn History fehlschlägt, können keine Stats berechnet werden
                // Gib bisherige Daten zurück (nur Basis-Infos) oder Fehler?
                // Hier geben wir bisherige Daten zurück, Stats bleiben null.
                items = [];
            }

            // Pro‑Match Stats holen (nur wenn History erfolgreich war)
            let matchData = [];
            if (items.length > 0) {
                const matchDataPromises = items.map(async h => {
                    try {
                        const stat = await fetchJson(
                            `${API_BASE_URL}/matches/${h.match_id}/stats`,
                            headers
                        );
                        const round = stat?.rounds?.[0];
                        if (!round) return null;

                        const teamData = round.teams?.find(team => team.players?.some(p => p.player_id === playerId));
                        if (!teamData) return null;
                        const p = teamData.players.find(p => p.player_id === playerId);
                        if (!p || !p.player_stats) return null;

                        // Sammle Rohdaten für die Berechnung
                        return {
                            Kills:      +p.player_stats.Kills,
                            Deaths:     +p.player_stats.Deaths,
                            Assists:    +p.player_stats.Assists,
                            Headshots:  +p.player_stats.Headshots,
                            "K/R Ratio":+p.player_stats["K/R Ratio"], // Für ADR Fallback
                            ADR:        +(p.player_stats.ADR ?? p.player_stats["Average Damage per Round"]),
                            Rounds:     +(round.round_stats?.Rounds || 1),
                            // Win-Info wird hier nicht benötigt für calculateAverageStats
                            CreatedAt:  h.started_at // Für Sortierung
                        };
                    } catch (matchErr) {
                        // Ignoriere Fehler bei einzelnen Matches stillschweigend im Frontend-API
                        // console.warn(`[API faceit-data] Failed fetch match ${h.match_id} for ${nickname}: ${matchErr.message}`);
                        return null;
                    }
                });
                // Warte auf alle Abfragen und filtere fehlgeschlagene raus
                matchData = (await Promise.all(matchDataPromises)).filter(Boolean);
            }

            // Stats berechnen, nur wenn gültige Match-Daten vorhanden sind
            if (matchData.length > 0) {
                const { stats, matchesCount } = calculateCurrentFormStats(matchData);
                // Erstelle das Objekt mit den berechneten Stats
                statsObj = {
                    version:          CACHE_VERSION, // Wichtig für Cache-Schreiben
                    calculatedRating: stats.rating,
                    kd:               stats.kd,
                    dpr:              stats.dpr,
                    kpr:              stats.kpr,
                    adr:              stats.adr,
                    hsPercent:        stats.hsp, // Name konsistent!
                    kast:             stats.kast,
                    impact:           stats.impact, // Neuer Impact Wert
                    matchesConsidered: matchesCount,
                    lastUpdated:      new Date().toISOString()
                };

                // Optional: Versuche, die neu berechneten Daten zu cachen
                if (redis && resp.cacheStatus !== 'disabled') {
                    try {
                        await redis.set(
                            `player_stats:${playerId}`,
                            JSON.stringify(statsObj),
                            "EX",
                            7 * 24 * 60 * 60 // 1 Woche
                        );
                        // console.log(`[Cache] Stored freshly calculated stats for ${nickname}`);
                    } catch (cacheWriteErr) {
                        console.error(`[Cache] Failed to write updated cache for ${nickname}:`, cacheWriteErr);
                    }
                }
            } else {
                // Keine gültigen Match-Daten gefunden, Stats bleiben null
                 console.log(`[API faceit-data] No valid match data found for ${nickname} to calculate live stats.`);
            }
        } // Ende if (resp.cacheStatus !== 'hit')

        // 5) Berechnete oder gecachte Stats in die Antwort übernehmen (falls vorhanden)
        if (statsObj) {
            Object.assign(resp, {
                calculatedRating: statsObj.calculatedRating,
                kd: statsObj.kd,
                dpr: statsObj.dpr,
                kpr: statsObj.kpr,
                adr: statsObj.adr,
                hsPercent: statsObj.hsPercent, // Name muss konsistent sein!
                kast: statsObj.kast,
                impact: statsObj.impact,
                matchesConsidered: statsObj.matchesConsidered,
                lastUpdated: statsObj.lastUpdated
            });
        }

        // 6) Antwort senden
        // Setze Cache-Header für CDN/Browser (kurze s-maxage für CDN, keine Client-Cache)
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300, max-age=0");
        return res.status(200).json(resp);

    } catch (err) {
        // Allgemeiner Fehler-Handler für diesen Request
        console.error(`[API faceit-data] Error processing ${nickname}:`, err);
        // Gib einen generischen Fehler zurück, aber mit Status 200,
        // damit das Frontend die Fehlermeldung anzeigen kann.
        return res.status(200).json({
          nickname: nickname || req.query.nickname, // Versuche Nickname zu bekommen
          error: err.message || "Unbekannter Serverfehler bei der Datenabfrage.",
          // Setze Stats auf null/N/A, wenn ein Fehler auftritt
          calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null,
          hsPercent: null, kast: null, impact: null, matchesConsidered: 0, lastUpdated: null,
          cacheStatus: 'error'
        });
    }
}