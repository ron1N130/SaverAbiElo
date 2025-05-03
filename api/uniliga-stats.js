// api/uniliga-stats.js - Mit Verarbeitung beider Maps und Bo2-Punktelogik

// --- Imports ---
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!
import fs from 'fs';
import path from 'path';

console.log('[API Uniliga - Punkte Final] Modul Imports geladen.');

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 10; // ** Cache-Version für diese Logikänderung **
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

console.log('[API Uniliga - Punkte Final] Konstanten definiert.');

// --- Hilfsfunktionen (delay, fetchFaceitApi) ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) { /* ... Rate Limit Handling ... */ }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Uniliga - Punkte Final] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) { /* ... Error Handling & Retries ... */ throw error; }
}

console.log('[API Uniliga - Punkte Final] Hilfsfunktionen definiert.');

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) { /* ... Redis Init Code ... */ } else { console.warn("[API Uniliga - Punkte Final] REDIS_URL not set."); }

// --- Lade Team-Informationen aus JSON (aus Root mit CJS __dirname) ---
let teamInfoMap = {}; let jsonLoadError = null; let calculatedJsonPath = "[Nicht berechnet]";
try {
    const jsonPath = path.join(__dirname, '..', "uniliga_teams.json"); calculatedJsonPath = jsonPath;
    console.log(`[API Uniliga - Punkte Final] Attempting to load JSON from: ${jsonPath}`);
    if (!fs.existsSync(jsonPath)) { throw new Error(`File not found at calculated path: ${jsonPath}.`); }
    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    const teamsData = JSON.parse(fileContent);
    teamsData.forEach(team => { if (team.team_id && team.name) { teamInfoMap[team.team_id] = { name: team.name, icon: team.icon }; } });
    console.log(`[API Uniliga - Punkte Final] Created teamInfoMap with ${Object.keys(teamInfoMap).length} teams.`);
} catch (e) { console.error(`[API Uniliga CRITICAL - Punkte Final] Failed to load/parse JSON from '${calculatedJsonPath}':`, e); jsonLoadError = e; teamInfoMap = {}; }

console.log('[API Uniliga - Punkte Final] Modul-Setup abgeschlossen.');

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga - Punkte Final] Handler invoked. URL: ${req.url}`);
    if (jsonLoadError) { console.error("[API Uniliga - Punkte Final] JSON Load Error detected."); }
    else { console.log(`[API Uniliga - Punkte Final] Handler using teamInfoMap size: ${Object.keys(teamInfoMap).length}`); }

    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}_v${CACHE_VERSION}`;

    // 1. Cache prüfen
    if (!req.url.includes('noCache=true') && redis && (redis.status === 'ready' || redis.status === 'connecting')) { /* ... Cache Check ... */ }
    else { /* ... Skip cache log ... */ res.setHeader("X-Cache-Status", "SKIPPED"); }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga - Punkte Final] Fetching live data...`);
        let allMatches = []; /* ... Matches füllen ... */
        console.log(`[API Uniliga - Punkte Final] Total matches found: ${allMatches.length}. Fetching details...`);

        const playerMatchStats = {}; const teamStats = {}; const playerDetails = {};
        let processedMatchCount = 0; let skippedMatchCount = 0; let processedMapCount = 0;

        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            const batchPromises = batchMatchIds.map(async (matchId) => {
                try {
                    const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                    const rounds = stats?.rounds; // Array der Karten
                    const roundsFound = rounds?.length ?? 0;

                    if (roundsFound === 0 || !Array.isArray(rounds)) { skippedMatchCount++; return null; }
                    processedMatchCount++;

                    // --- Punkteberechnung für die Begegnung ---
                    let teamId1 = null, teamId2 = null;
                    let team1MapWins = 0, team2MapWins = 0;
                    let teamIdsValidForPoints = false;

                    if (rounds[0]?.teams?.length === 2) {
                        teamId1 = rounds[0].teams[0]?.team_id;
                        teamId2 = rounds[0].teams[1]?.team_id;
                        if (teamId1 && teamId2) teamIdsValidForPoints = true;
                    }

                    if (teamIdsValidForPoints) {
                        for (const roundDataForPoints of rounds) {
                            const winnerMap = roundDataForPoints?.round_stats?.["Winner"];
                            if (winnerMap === teamId1) team1MapWins++;
                            else if (winnerMap === teamId2) team2MapWins++;
                        }

                        let pointsTeam1 = 0, pointsTeam2 = 0;
                        // Sieg Team 1 (2-0 oder 1-0 bei nur einer gewerteten Karte)
                        if (team1MapWins > team2MapWins) { pointsTeam1 = 2; pointsTeam2 = 0; }
                        // Sieg Team 2 (0-2 oder 0-1)
                        else if (team2MapWins > team1MapWins) { pointsTeam1 = 0; pointsTeam2 = 2; }
                        // Unentschieden (1-1 oder 0-0)
                        else { pointsTeam1 = 1; pointsTeam2 = 1; }

                        // Initialisiere Team-Stats inkl. Punkte, falls noch nicht geschehen
                        if (!teamStats[teamId1]) teamStats[teamId1] = { name: "TBD", mapWins: 0, mapLosses: 0, mapsPlayed: 0, points: 0, players: new Set() };
                        if (!teamStats[teamId2]) teamStats[teamId2] = { name: "TBD", mapWins: 0, mapLosses: 0, mapsPlayed: 0, points: 0, players: new Set() };
                        // Addiere Punkte
                        teamStats[teamId1].points = (teamStats[teamId1].points || 0) + pointsTeam1;
                        teamStats[teamId2].points = (teamStats[teamId2].points || 0) + pointsTeam2;
                    } else {
                        console.warn(`[API Uniliga Punkte WARN] Match ${matchId}: Konnte Teams für Punkte nicht identifizieren.`);
                    }
                    // --- Ende Punkteberechnung ---


                    // --- Verarbeitung der einzelnen Karten für Stats ---
                    for (const roundData of rounds) {
                        if (!roundData?.teams || roundData.teams.length === 0) { continue; }
                        const winningTeamIdMap = roundData.round_stats?.["Winner"];
                        const mapRoundsPlayed = parseInt(roundData.round_stats?.["Rounds"], 10);
                        if (isNaN(mapRoundsPlayed) || mapRoundsPlayed <= 0) { continue; }
                        processedMapCount++;

                        for (const team of roundData.teams) {
                            const teamId = team.team_id;
                            const localTeamInfo = teamInfoMap[teamId];
                            let finalTeamName;
                            if (teamStats[teamId] && teamStats[teamId].name !== "TBD") { finalTeamName = teamStats[teamId].name; }
                            else if (localTeamInfo) { finalTeamName = localTeamInfo.name; }
                            else { finalTeamName = `Unbekanntes Team (ID: ${teamId.substring(0, 8)}...)`; }

                            if (!teamStats[teamId]) { teamStats[teamId] = { name: finalTeamName, mapWins: 0, mapLosses: 0, mapsPlayed: 0, points: 0, players: new Set() }; }
                            else { teamStats[teamId].name = finalTeamName; }

                            teamStats[teamId].mapsPlayed += 1 / roundData.teams.length;
                            const isWinnerThisMap = teamId === winningTeamIdMap;
                            if (winningTeamIdMap) { if (isWinnerThisMap) teamStats[teamId].mapWins += 1 / roundData.teams.length; else teamStats[teamId].mapLosses += 1 / roundData.teams.length; }

                            for (const player of team.players) {
                               const playerId = player.player_id; const playerStats = player.player_stats;
                               if (!playerStats || Object.keys(playerStats).length === 0) { continue; }
                               if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' };
                               teamStats[teamId].players.add(playerId);
                               if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];
                               playerMatchStats[playerId].push({
                                    Kills: +(playerStats["Kills"] ?? 0), Deaths: +(playerStats["Deaths"] ?? 0), Assists: +(playerStats["Assists"] ?? 0), Headshots: +(playerStats["Headshots"] ?? 0),
                                    KR_Ratio: +(playerStats["K/R Ratio"] ?? 0), KD_Ratio: +(playerStats["K/D Ratio"] ?? 0), ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0),
                                    Rounds: mapRoundsPlayed, Win: winningTeamIdMap ? (isWinnerThisMap ? 1 : 0) : 0, MatchId: matchId, MapNumber: rounds.indexOf(roundData) + 1
                               });
                            } // Ende Spieler
                        } // Ende Team (pro Karte)
                    } // Ende Runden/Karten-Schleife
                    return true;
                } catch (matchError) { console.error(`[API Uniliga ERROR - Punkte Final] Processing Match ${matchId}: ${matchError.message}`); skippedMatchCount++; return null; }
            }); // Ende batchPromises.map
            await Promise.all(batchPromises);
        } // Ende Batch-Schleife (über Match-IDs)
        console.log(`[API Uniliga - Punkte Final] Finished processing details. Encounters: ${processedMatchCount}, Maps: ${processedMapCount}, Skipped: ${skippedMatchCount}`);

        // c) Spielerstatistiken aggregieren
        console.log("[API Uniliga - Punkte Final] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) { const calculatedStats = calculateAverageStats(playerMatchStats[playerId]); if (calculatedStats && calculatedStats.matchesPlayed > 0) { aggregatedPlayerStats[playerId] = { ...playerDetails[playerId], ...calculatedStats }; } }
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken finalisieren (mit Punkten)
        console.log("[API Uniliga - Punkte Final] Aggregating final team statistics...");
        const aggregatedTeamStats = {};
        for (const teamId in teamStats) {
             const team = teamStats[teamId];
             const mapsPlayedCorrected = Math.round(team.mapsPlayed * 2); const mapWinsCorrected = Math.round(team.mapWins * 2); const mapLossesCorrected = Math.round(team.mapLosses * 2);
             const mapWinRate = mapsPlayedCorrected > 0 ? (mapWinsCorrected / mapsPlayedCorrected) * 100 : 0;
             let avgTeamRating = 0; let playerCount = 0; team.players.forEach(playerId => { if (aggregatedPlayerStats[playerId]?.rating) { avgTeamRating += aggregatedPlayerStats[playerId].rating; playerCount++; } }); avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;

             aggregatedTeamStats[teamId] = {
                  id: teamId, name: team.name,
                  mapsPlayed: mapsPlayedCorrected, mapWins: mapWinsCorrected, mapLosses: mapLossesCorrected, // Karten-Stats
                  mapWinRate: +mapWinRate.toFixed(1),
                  avgRating: +avgTeamRating.toFixed(2),
                  points: team.points || 0 // <<< Punkte
             };
         }
         // Sortiere Teams: Punkte > Karten-WR > AvgRating
         const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => {
             const pointsDiff = (b.points ?? 0) - (a.points ?? 0); if (pointsDiff !== 0) return pointsDiff;
             const wrDiff = (b.mapWinRate ?? 0) - (a.mapWinRate ?? 0); if (wrDiff !== 0) return wrDiff;
             return (b.avgRating ?? 0) - (a.avgRating ?? 0);
          });

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION, lastUpdated: new Date().toISOString(), championshipId: championshipId,
            players: sortedPlayerStats, teams: sortedTeamStats // Enthält jetzt .points bei Teams
        };

        // f) Im Cache speichern
        if (redis && (redis.status === 'ready' || redis.status === 'connecting')) { try { await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS); console.log(`[API Uniliga - Punkte Final] Stored stats in Redis.`); } catch (err) { console.error("[API Uniliga - Punkte Final] Redis SET error:", err); } }

        // g) Erfolgreiche Antwort senden
        console.log("[API Uniliga - Punkte Final] Sending calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga CRITICAL - Punkte Final] Unhandled error in handler:", error);
        return res.status(500).json({ error: "Fehler beim Verarbeiten der Uniliga-Daten.", details: error.message });
    }
}

console.log('[API Uniliga - Punkte Final] Modul Ende erreicht.');