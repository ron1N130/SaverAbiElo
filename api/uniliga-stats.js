// api/uniliga-stats.js - Strikte ID-zu-Name-Map, kein Fallback auf API-Nickname
// -------------------------------------------------
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad zu utils prüfen!
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Für __dirname in ES Modulen

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 8; // *** Cache-Version erhöhen, um alte Caches sicher zu invalidieren! ***
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

// --- Hilfsfunktionen (delay, fetchFaceitApi) ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFaceitApi(endpoint, retries = 3) {
    // (Code der Funktion fetchFaceitApi bleibt unverändert - siehe vorherige Versionen)
    // Stellt sicher, dass Fehlerbehandlung und Retries vorhanden sind.
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Uniliga] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15);
            if (retries > 0) return fetchFaceitApi(endpoint, retries - 1);
            else throw new Error(`API Rate limit exceeded for ${endpoint}`);
        }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Uniliga] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) {
        console.error(`[API Uniliga] Fetch error for ${endpoint}: ${error.message}`);
        if (retries > 0) { await delay(API_DELAY * (5 - retries + 1)); return fetchFaceitApi(endpoint, retries - 1); }
        else throw error;
    }
}

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
             lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 2, showFriendlyErrorStack: true
            });
        redis.on("error", (err) => { console.error("[Redis Uniliga] Connection error:", err.message); redis = null; });
        console.log("[Redis Uniliga] Client initialized (lazy).");
    } catch (e) { console.error("[Redis Uniliga] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Uniliga] REDIS_URL not set. Caching disabled."); }

// --- Lade Team-Informationen aus JSON (aus Root-Verzeichnis) ---
let teamInfoMap = {};
let jsonLoadError = null; // Variable für Ladefehler
try {
    // Pfad ermitteln (von /api eine Ebene hoch zum Root)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const jsonPath = path.join(__dirname, '..', "uniliga_teams.json");

    console.log(`[API Uniliga] Attempting to load JSON from: ${jsonPath}`); // Log 1: Pfad

    if (!fs.existsSync(jsonPath)) { // Prüfen, ob Datei existiert
        throw new Error(`File not found at calculated path: ${jsonPath}. Resolved: ${path.resolve(jsonPath)}`);
    }

    const teamsData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`[API Uniliga] Successfully read uniliga_teams.json. Found ${teamsData.length} entries.`); // Log 2: Leseerfolg

    teamsData.forEach(team => {
        if (team.team_id && team.name) { // Sicherstellen, dass ID und Name vorhanden sind
            teamInfoMap[team.team_id] = { name: team.name, icon: team.icon };
        } else {
             console.warn(`[API Uniliga] Entry in uniliga_teams.json missing 'team_id' or 'name':`, team);
        }
    });
    console.log(`[API Uniliga] Created teamInfoMap with ${Object.keys(teamInfoMap).length} teams.`); // Log 3: Map-Erstellung
} catch (e) {
    console.error("[API Uniliga CRITICAL] Failed to load or parse uniliga_teams.json:", e); // Log 4: Kritischer Fehler
    jsonLoadError = e; // Fehler speichern für spätere Referenz
    teamInfoMap = {}; // Sicherstellen, dass Map leer ist
}

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    // Log direkt am Anfang des Handlers
    console.log(`[API Uniliga] Handler invoked. Request URL: ${req.url}`);

    // Loggen, ob das Laden der JSON erfolgreich war oder nicht
    if (jsonLoadError) {
        console.error("[API Uniliga] Handler continues execution despite previous JSON load error.");
    } else if (Object.keys(teamInfoMap).length === 0) {
        console.warn("[API Uniliga] Handler continues execution, but teamInfoMap is empty (JSON loaded but maybe no valid entries?).");
    } else {
         console.log(`[API Uniliga] Handler executing with ${Object.keys(teamInfoMap).length} teams mapped.`);
    }


    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}_v${CACHE_VERSION}`; // Version im Key

    // 1. Cache prüfen (Version im Key!)
    if (!req.url.includes('noCache=true') && redis && (redis.status === 'ready' || redis.status === 'connecting')) { // Nur prüfen, wenn nicht explizit deaktiviert
        try {
            console.log(`[API Uniliga] Checking cache for key: ${cacheKey}`);
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                // Kein Versionscheck mehr nötig, da Version im Key ist
                console.log(`[API Uniliga] Cache HIT.`);
                const parsedData = JSON.parse(cachedData);
                res.setHeader("X-Cache-Status", "HIT");
                res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
                return res.status(200).json(parsedData);
            } else {
                console.log("[API Uniliga] Cache MISS.");
                res.setHeader("X-Cache-Status", "MISS");
            }
        } catch (err) {
            console.error("[API Uniliga] Redis GET error:", err);
            res.setHeader("X-Cache-Status", "ERROR");
        }
    } else {
        const reason = req.url.includes('noCache=true') ? 'noCache flag' : (redis ? `Redis Status: ${redis.status}` : 'No REDIS_URL');
        console.log(`[API Uniliga] Skipping cache check (${reason}).`);
        res.setHeader("X-Cache-Status", "SKIPPED");
    }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga] Fetching live data for championship: ${championshipId}`);
        // ... (Match-Fetching Logik bleibt gleich) ...
        let allMatches = [];
        let offset = 0;
        const limit = 100;
        let fetchMore = true;
        while (fetchMore && allMatches.length < MAX_MATCHES_TO_FETCH) {
            const matchResponse = await fetchFaceitApi(`/championships/${championshipId}/matches?type=past&offset=${offset}&limit=${limit}`);
            if (!matchResponse?.items?.length) { fetchMore = false; }
            else { allMatches.push(...matchResponse.items); offset += matchResponse.items.length; if (matchResponse.items.length < limit || allMatches.length >= MAX_MATCHES_TO_FETCH) fetchMore = false; }
        }
        console.log(`[API Uniliga] Total matches found: ${allMatches.length}. Fetching details...`);


        const playerMatchStats = {};
        const teamStats = {};        // Wichtig: Wird mit gemappten Namen befüllt
        const playerDetails = {};
        let processedMatchCount = 0;
        let skippedMatchCount = 0;

        // Match-Details verarbeiten
        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            const batchPromises = batchMatchIds.map(async (matchId) => {
                try {
                    const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                     if (!stats?.rounds?.[0]?.teams || stats.rounds[0].teams.length === 0) { skippedMatchCount++; return null; }
                     const roundData = stats.rounds[0];
                     const winningTeamId = roundData.round_stats?.["Winner"];
                     const matchRounds = parseInt(roundData.round_stats?.["Rounds"], 10);
                     if (isNaN(matchRounds) || matchRounds <= 0) { skippedMatchCount++; return null; }
                     processedMatchCount++;

                    for (const team of roundData.teams) {
                        const teamId = team.team_id; // ID aus der API
                        const apiTeamName = team.nickname; // Nur noch für Debugging interessant
                        const localTeamInfo = teamInfoMap[teamId]; // <<< Lookup in unserer Map

                        let finalTeamName;
                        if (localTeamInfo) {
                            finalTeamName = localTeamInfo.name; // <<< Name aus unserer JSON
                            // console.log(`[API Uniliga DEBUG] Match ${matchId}, Team ID ${teamId}: Mapped to '${finalTeamName}'`); // Optional: Erfolgslog
                        } else {
                            // *** Strikt: Kein Fallback auf apiTeamName ***
                            finalTeamName = `Unbekanntes Team (ID: ${teamId.substring(0, 8)}...)`; // Klarer Fallback-Name
                            console.warn(`[API Uniliga WARN] Match ${matchId}, Team ID ${teamId} not found in local map! API Name was '${apiTeamName}'. Using fallback: '${finalTeamName}'`);
                        }

                        // Initialisiere oder aktualisiere Team-Statistiken mit dem finalen Namen
                        if (!teamStats[teamId]) {
                            teamStats[teamId] = { name: finalTeamName, wins: 0, losses: 0, matchesPlayed: 0, players: new Set() };
                        } else {
                            // Stelle sicher, dass der Name korrekt ist (falls Team schon mal mit Fallback auftauchte)
                            teamStats[teamId].name = finalTeamName;
                        }

                         // Zählung für Wins/Losses/MatchesPlayed
                         teamStats[teamId].matchesPlayed += 1 / roundData.teams.length;
                         const isWinner = teamId === winningTeamId;
                         if (winningTeamId) { if (isWinner) teamStats[teamId].wins += 1 / roundData.teams.length; else teamStats[teamId].losses += 1 / roundData.teams.length; }

                        // Spieler-Verarbeitung bleibt gleich...
                        for (const player of team.players) {
                           const playerId = player.player_id;
                           const playerStats = player.player_stats;
                           if (!playerStats || Object.keys(playerStats).length === 0) { continue; }
                           if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' }; else { /* Optional: Avatar/Nick aktualisieren */ }
                           teamStats[teamId].players.add(playerId);
                           if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];
                           playerMatchStats[playerId].push({ /* ... Spieler-Match-Stats ... */
                                Kills: +(playerStats["Kills"] ?? 0), Deaths: +(playerStats["Deaths"] ?? 0), Assists: +(playerStats["Assists"] ?? 0), Headshots: +(playerStats["Headshots"] ?? 0),
                                KR_Ratio: +(playerStats["K/R Ratio"] ?? 0), KD_Ratio: +(playerStats["K/D Ratio"] ?? 0), ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds, Win: winningTeamId ? (isWinner ? 1 : 0) : 0, MatchId: matchId
                           });
                        }
                    } // Ende Team-Schleife
                    return true;
                } catch (matchError) {
                    console.error(`[API Uniliga ERROR] Processing Match ${matchId}: ${matchError.message}`);
                    skippedMatchCount++;
                    return null;
                }
            }); // Ende batchPromises.map
            await Promise.all(batchPromises);
        } // Ende Batch-Schleife
        console.log(`[API Uniliga] Finished processing details. Processed: ${processedMatchCount}, Skipped: ${skippedMatchCount}`);

        // c) Spielerstatistiken aggregieren
        console.log("[API Uniliga] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) {
            const calculatedStats = calculateAverageStats(playerMatchStats[playerId]);
            if (calculatedStats && calculatedStats.matchesPlayed > 0) {
                aggregatedPlayerStats[playerId] = { ...playerDetails[playerId], ...calculatedStats };
            } else { /* Optional: Warnung loggen */ }
        }
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken finalisieren
        console.log("[API Uniliga] Aggregating final team statistics...");
        const aggregatedTeamStats = {};
        for (const teamId in teamStats) {
             const team = teamStats[teamId]; // <<< Enthält jetzt 'finalTeamName'
             const matchesPlayedCorrected = Math.round(team.matchesPlayed * 2);
             const winsCorrected = Math.round(team.wins * 2);
             const lossesCorrected = Math.round(team.losses * 2);
             const winRate = matchesPlayedCorrected > 0 ? (winsCorrected / matchesPlayedCorrected) * 100 : 0;
             let avgTeamRating = 0; let playerCount = 0;
             team.players.forEach(playerId => { if (aggregatedPlayerStats[playerId]?.rating) { avgTeamRating += aggregatedPlayerStats[playerId].rating; playerCount++; } });
             avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;

             aggregatedTeamStats[teamId] = {
                  id: teamId,
                  name: team.name, // <<< Nimmt den (hoffentlich) korrekt gemappten Namen
                  matchesPlayed: matchesPlayedCorrected, wins: winsCorrected, losses: lossesCorrected,
                  winRate: +winRate.toFixed(1), avgRating: +avgTeamRating.toFixed(2),
             };
         }
        // Sortiere Teams
         const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => { /* ... Deine Sortierlogik ... */
             const wrDiff = (b.winRate ?? 0) - (a.winRate ?? 0); if (wrDiff !== 0) return wrDiff; return (b.avgRating ?? 0) - (a.avgRating ?? 0);
          });

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION, // Version aus Konstante
            lastUpdated: new Date().toISOString(),
            championshipId: championshipId,
            players: sortedPlayerStats,
            teams: sortedTeamStats // <<< Sollte jetzt korrekte Namen enthalten
        };

        // f) Im Cache speichern
        if (redis && (redis.status === 'ready' || redis.status === 'connecting')) {
            try {
                await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS);
                console.log(`[API Uniliga] Stored aggregated stats in Redis (Key: ${cacheKey}).`);
            } catch (err) { console.error("[API Uniliga] Redis SET error:", err); }
        }

        // g) Erfolgreiche Antwort senden
        console.log("[API Uniliga] Sending calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga CRITICAL] Unhandled error in handler:", error);
        return res.status(500).json({ error: "Fehler beim Verarbeiten der Uniliga-Daten.", details: error.message });
    }
}