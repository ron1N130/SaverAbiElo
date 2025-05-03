// api/uniliga-stats.js - Korrigierte Version mit CommonJS Pfad + Volle Logik

// --- Imports ---
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!
import fs from 'fs';
import path from 'path';
// import { fileURLToPath } from 'url'; // <<< ENTFERNT, da CommonJS

console.log('[API Uniliga - CJS Final] Modul Imports geladen.');

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 9; // Behalte die erhöhte Version
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

console.log('[API Uniliga - CJS Final] Konstanten definiert.');

// --- Hilfsfunktionen (delay, fetchFaceitApi) ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFaceitApi(endpoint, retries = 3) {
    // (Voller Code der Funktion fetchFaceitApi hier einfügen - aus deiner Version)
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Uniliga - CJS Final] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15);
            if (retries > 0) return fetchFaceitApi(endpoint, retries - 1);
            else throw new Error(`API Rate limit exceeded for ${endpoint}`);
        }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Uniliga - CJS Final] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) {
        console.error(`[API Uniliga - CJS Final] Fetch error for ${endpoint}: ${error.message}`);
        if (retries > 0) { await delay(API_DELAY * (5 - retries + 1)); return fetchFaceitApi(endpoint, retries - 1); }
        else throw error;
    }
}

console.log('[API Uniliga - CJS Final] Hilfsfunktionen definiert.');

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
             lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 2, showFriendlyErrorStack: true
            });
        redis.on("error", (err) => { console.error("[Redis Uniliga - CJS Final] Connection error:", err.message); redis = null; });
        console.log("[Redis Uniliga - CJS Final] Client initialized (lazy).");
    } catch (e) { console.error("[Redis Uniliga - CJS Final] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Uniliga - CJS Final] REDIS_URL not set. Caching disabled."); }

// --- Lade Team-Informationen aus JSON (aus Root-Verzeichnis mit CJS __dirname) ---
let teamInfoMap = {};
let jsonLoadError = null;
let calculatedJsonPath = "[Nicht berechnet]";
try {
    // --- KORREKTE CommonJS Pfadlogik ---
    // __dirname ist in CommonJS global verfügbar und zeigt auf das Verzeichnis der aktuellen Datei (/api)
    const jsonPath = path.join(__dirname, '..', "uniliga_teams.json"); // Gehe eine Ebene hoch zum Root
    // --- ENDE KORREKTE Pfadlogik ---
    calculatedJsonPath = jsonPath;

    console.log(`[API Uniliga - CJS Final] Attempting to load JSON from: ${jsonPath}`); // Log 1

    if (!fs.existsSync(jsonPath)) {
        throw new Error(`File not found at calculated path: ${jsonPath}. Resolved: ${path.resolve(jsonPath)}`);
    }

    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    console.log(`[API Uniliga - CJS Final] Successfully read file content (length: ${fileContent.length}).`); // Log 2

    const teamsData = JSON.parse(fileContent);
    console.log(`[API Uniliga - CJS Final] Successfully parsed JSON. Found ${teamsData.length} entries.`); // Log 3

    teamsData.forEach(team => {
        if (team.team_id && team.name) {
            teamInfoMap[team.team_id] = { name: team.name, icon: team.icon };
        } else {
             console.warn(`[API Uniliga - CJS Final] Entry in JSON missing 'team_id' or 'name':`, team);
        }
    });
    console.log(`[API Uniliga - CJS Final] Created teamInfoMap with ${Object.keys(teamInfoMap).length} teams.`); // Log 4
} catch (e) {
    console.error(`[API Uniliga CRITICAL - CJS Final] Failed to load or parse uniliga_teams.json from path '${calculatedJsonPath}':`, e); // Log 5 (Fehler)
    jsonLoadError = e;
    teamInfoMap = {};
}

console.log('[API Uniliga - CJS Final] Vor Handler Definition.');

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga - CJS Final] Handler invoked. Request URL: ${req.url}`); // Log 6

    if (jsonLoadError) {
        console.error("[API Uniliga - CJS Final] Handler continues execution despite previous JSON load error.");
    } else if (Object.keys(teamInfoMap).length === 0 && !jsonLoadError) { // Nur warnen, wenn kein Ladefehler vorlag
        console.warn("[API Uniliga - CJS Final] Handler continues execution, but teamInfoMap is empty (JSON loaded but maybe no valid entries?).");
    } else if (!jsonLoadError) {
         console.log(`[API Uniliga - CJS Final] Handler executing with ${Object.keys(teamInfoMap).length} teams mapped.`); // Log 7 (Erfolg JSON Laden)
    }

    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}_v${CACHE_VERSION}`; // Version im Key

    // 1. Cache prüfen
    // (Cache-Logik bleibt wie in deiner Version)
    if (!req.url.includes('noCache=true') && redis && (redis.status === 'ready' || redis.status === 'connecting')) {
        try {
            console.log(`[API Uniliga - CJS Final] Checking cache for key: ${cacheKey}`);
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                console.log(`[API Uniliga - CJS Final] Cache HIT.`);
                const parsedData = JSON.parse(cachedData);
                res.setHeader("X-Cache-Status", "HIT");
                res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
                return res.status(200).json(parsedData);
            } else {
                console.log("[API Uniliga - CJS Final] Cache MISS.");
                res.setHeader("X-Cache-Status", "MISS");
            }
        } catch (err) {
            console.error("[API Uniliga - CJS Final] Redis GET error:", err);
            res.setHeader("X-Cache-Status", "ERROR");
        }
    } else {
         const reason = req.url.includes('noCache=true') ? 'noCache flag' : (redis ? `Redis Status: ${redis.status}` : 'No REDIS_URL');
         console.log(`[API Uniliga - CJS Final] Skipping cache check (${reason}).`);
         res.setHeader("X-Cache-Status", "SKIPPED");
     }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga - CJS Final] Fetching live data for championship: ${championshipId}`);
        // Match-Fetching
        let allMatches = [];
        let offset = 0;
        const limit = 100;
        let fetchMore = true;
        while (fetchMore && allMatches.length < MAX_MATCHES_TO_FETCH) {
            const matchResponse = await fetchFaceitApi(`/championships/${championshipId}/matches?type=past&offset=${offset}&limit=${limit}`);
            if (!matchResponse?.items?.length) { fetchMore = false; }
            else { allMatches.push(...matchResponse.items); offset += matchResponse.items.length; if (matchResponse.items.length < limit || allMatches.length >= MAX_MATCHES_TO_FETCH) fetchMore = false; }
        }
        console.log(`[API Uniliga - CJS Final] Total matches found: ${allMatches.length}. Fetching details...`);


        const playerMatchStats = {};
        const teamStats = {};
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
                        const teamId = team.team_id;
                        const apiTeamName = team.nickname;
                        const localTeamInfo = teamInfoMap[teamId]; // <<< Lookup

                        let finalTeamName;
                        if (localTeamInfo) {
                            finalTeamName = localTeamInfo.name; // <<< Name aus JSON
                        } else {
                            // Striktes Fallback
                            finalTeamName = `Unbekanntes Team (ID: ${teamId.substring(0, 8)}...)`;
                            console.warn(`[API Uniliga WARN - CJS Final] Match ${matchId}, Team ID ${teamId} not found in local map! API Name was '${apiTeamName}'. Using fallback: '${finalTeamName}'`);
                        }

                        // Initialisieren/Aktualisieren mit finalem Namen
                        if (!teamStats[teamId]) { teamStats[teamId] = { name: finalTeamName, wins: 0, losses: 0, matchesPlayed: 0, players: new Set() }; }
                        else { teamStats[teamId].name = finalTeamName; }

                        // Zählung
                         teamStats[teamId].matchesPlayed += 1 / roundData.teams.length;
                         const isWinner = teamId === winningTeamId;
                         if (winningTeamId) { if (isWinner) teamStats[teamId].wins += 1 / roundData.teams.length; else teamStats[teamId].losses += 1 / roundData.teams.length; }

                        // Spieler verarbeiten
                        for (const player of team.players) {
                           const playerId = player.player_id;
                           const playerStats = player.player_stats;
                           if (!playerStats || Object.keys(playerStats).length === 0) { continue; }
                           if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' };
                           teamStats[teamId].players.add(playerId);
                           if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];
                           playerMatchStats[playerId].push({
                                Kills: +(playerStats["Kills"] ?? 0), Deaths: +(playerStats["Deaths"] ?? 0), Assists: +(playerStats["Assists"] ?? 0), Headshots: +(playerStats["Headshots"] ?? 0),
                                KR_Ratio: +(playerStats["K/R Ratio"] ?? 0), KD_Ratio: +(playerStats["K/D Ratio"] ?? 0), ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds, Win: winningTeamId ? (isWinner ? 1 : 0) : 0, MatchId: matchId
                           });
                        }
                    } // Ende Team-Schleife
                    return true;
                } catch (matchError) {
                    console.error(`[API Uniliga ERROR - CJS Final] Processing Match ${matchId}: ${matchError.message}`);
                    skippedMatchCount++; return null;
                }
            }); // Ende batchPromises.map
            await Promise.all(batchPromises);
        } // Ende Batch-Schleife
        console.log(`[API Uniliga - CJS Final] Finished processing details. Processed: ${processedMatchCount}, Skipped: ${skippedMatchCount}`);

        // c) Spielerstatistiken aggregieren
        // (Logik bleibt gleich)
         console.log("[API Uniliga - CJS Final] Aggregating player statistics...");
         const aggregatedPlayerStats = {};
         for (const playerId in playerMatchStats) { const calculatedStats = calculateAverageStats(playerMatchStats[playerId]); if (calculatedStats && calculatedStats.matchesPlayed > 0) { aggregatedPlayerStats[playerId] = { ...playerDetails[playerId], ...calculatedStats }; } }
         const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken finalisieren
        // (Logik bleibt gleich, nutzt jetzt korrekten Namen aus teamStats[teamId].name)
         console.log("[API Uniliga - CJS Final] Aggregating final team statistics...");
         const aggregatedTeamStats = {};
         for (const teamId in teamStats) {
              const team = teamStats[teamId]; const matchesPlayedCorrected = Math.round(team.matchesPlayed * 2); const winsCorrected = Math.round(team.wins * 2); const lossesCorrected = Math.round(team.losses * 2); const winRate = matchesPlayedCorrected > 0 ? (winsCorrected / matchesPlayedCorrected) * 100 : 0; let avgTeamRating = 0; let playerCount = 0; team.players.forEach(playerId => { if (aggregatedPlayerStats[playerId]?.rating) { avgTeamRating += aggregatedPlayerStats[playerId].rating; playerCount++; } }); avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;
              aggregatedTeamStats[teamId] = { id: teamId, name: team.name, matchesPlayed: matchesPlayedCorrected, wins: winsCorrected, losses: lossesCorrected, winRate: +winRate.toFixed(1), avgRating: +avgTeamRating.toFixed(2) };
          }
         const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => { const wrDiff = (b.winRate ?? 0) - (a.winRate ?? 0); if (wrDiff !== 0) return wrDiff; return (b.avgRating ?? 0) - (a.avgRating ?? 0); });

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION, lastUpdated: new Date().toISOString(), championshipId: championshipId,
            players: sortedPlayerStats, teams: sortedTeamStats
        };

        // f) Im Cache speichern
        // (Logik bleibt gleich)
        if (redis && (redis.status === 'ready' || redis.status === 'connecting')) { try { await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS); console.log(`[API Uniliga - CJS Final] Stored aggregated stats in Redis (Key: ${cacheKey}).`); } catch (err) { console.error("[API Uniliga - CJS Final] Redis SET error:", err); } }

        // g) Erfolgreiche Antwort senden
        console.log("[API Uniliga - CJS Final] Sending calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga CRITICAL - CJS Final] Unhandled error in handler:", error);
        return res.status(500).json({ error: "Fehler beim Verarbeiten der Uniliga-Daten.", details: error.message });
    }
}

console.log('[API Uniliga - CJS Final] Modul Ende erreicht.'); // Log am Ende