// api/uniliga-stats.js - Refactored
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 6
// -------------------------------------------------

import Redis from "ioredis";
// *** NEU: Importiere Berechnungsfunktionen ***
import { calculateAverageStats } from './utils/stats.js';

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 7; // <<<< Cache-Version erhöht auf 6
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

// --- Hilfsfunktionen ---
/** simple async sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch Faceit API (unverändert zur letzten Version dieser Datei) */
async function fetchFaceitApi(endpoint, retries = 3) {
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
        if (retries > 0) { await delay(API_DELAY * 5); return fetchFaceitApi(endpoint, retries - 1); }
        else throw error;
    }
}

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,          // Beibehalten!
            connectTimeout: 15000,      // Evtl. leicht reduzieren (z.B. 15s)?
            maxRetriesPerRequest: 2,    // 3 ist ok, 2 reicht vielleicht auch
            showFriendlyErrorStack: true // Hilfreich für Debugging
        });
        redis.on("error", (err) => {
            console.error("[Redis Update] Connection error:", err.message);
            // Wichtig: Bei Fehler hier null setzen, damit nicht versucht wird, redis zu nutzen
            redis = null;
        });
        // redis.connect().catch(err => { console.error("[Redis Update] Initial connection failed:", err.message); redis = null; }); // <-- DIESE ZEILE ENTFERNEN ODER AUSKOMMENTIEREN
        console.log("[Redis Update] Client initialized (lazy)."); // Angepasste Log-Nachricht
    } catch (e) {
        console.error("[Redis Update] Initialization failed:", e);
        redis = null;
    }
} else {
    console.warn("[Redis Update] REDIS_URL not set. Caching disabled.");
}

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga] Received request at ${new Date().toISOString()}`);
    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}`;

    // 1. Cache prüfen
    if (redis) {
        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                if (parsedData.version === CACHE_VERSION) { // Prüft auf v6
                    console.log(`[API Uniliga] Cache HIT (v${CACHE_VERSION}). Returning cached data.`);
                    res.setHeader("X-Cache-Status", "HIT");
                    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
                    return res.status(200).json(parsedData);
                } else { console.log(`[API Uniliga] Cache STALE (v${parsedData.version}, expected v${CACHE_VERSION}).`); res.setHeader("X-Cache-Status", "STALE"); }
            } else { console.log("[API Uniliga] Cache MISS."); res.setHeader("X-Cache-Status", "MISS"); }
        } catch (err) { console.error("[API Uniliga] Redis GET error:", err); res.setHeader("X-Cache-Status", "ERROR"); }
    } else { res.setHeader("X-Cache-Status", "DISABLED"); }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga] Fetching matches for championship: ${championshipId}`);
        let allMatches = [];
        let offset = 0;
        const limit = 100;
        while (allMatches.length < MAX_MATCHES_TO_FETCH) {
            const matchResponse = await fetchFaceitApi(`/championships/${championshipId}/matches?type=past&offset=${offset}&limit=${limit}`);
            if (!matchResponse?.items?.length) break;
            allMatches.push(...matchResponse.items);
            offset += limit;
        }
        console.log(`[API Uniliga] Total matches found: ${allMatches.length}`);

        // b) Match-Details holen und Daten sammeln
        const playerMatchStats = {};
        const teamStats = {};
        const playerDetails = {};

        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            // console.log(`[API Uniliga] Processing batch ${Math.floor(i / MATCH_DETAIL_BATCH_SIZE) + 1}...`);
            const batchPromises = batchMatchIds.map(async (matchId) => {
                const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                if (!stats?.rounds?.[0]?.teams) return null;
                const roundData = stats.rounds[0];
                const winningTeamId = roundData.round_stats?.["Winner"];
                const matchRounds = parseInt(roundData.round_stats?.["Rounds"], 10) || 1;
                for (const team of roundData.teams) {
                    const teamId = team.team_id;
                    const teamName = team.nickname;
                    if (!teamStats[teamId]) teamStats[teamId] = { name: teamName, wins: 0, losses: 0, matchesPlayed: 0, players: new Set() };
                    teamStats[teamId].name = teamName;
                    teamStats[teamId].matchesPlayed += 1 / team.players.length;
                    const isWinner = teamId === winningTeamId;
                    if (winningTeamId) { if (isWinner) teamStats[teamId].wins += 1 / team.players.length; else teamStats[teamId].losses += 1 / team.players.length; }
                    for (const player of team.players) {
                        const playerId = player.player_id;
                        const playerStats = player.player_stats;
                        if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' };
                        teamStats[teamId].players.add(playerId);
                        if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];
                        playerMatchStats[playerId].push({
                            Kills: playerStats["Kills"], Deaths: playerStats["Deaths"], Assists: playerStats["Assists"],
                            Headshots: playerStats["Headshots"], "K/R Ratio": playerStats["K/R Ratio"],
                            ADR: playerStats["ADR"] ?? playerStats["Average Damage per Round"],
                            Rounds: matchRounds, Win: isWinner ? 1 : 0, MatchId: matchId
                        });
                    }
                } return true;
            });
            await Promise.all(batchPromises);
        }

        // c) Spielerstatistiken aggregieren (nutzt importierte Funktion)
        console.log("[API Uniliga] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) {
            // *** NEU: Rufe importierte Funktion auf ***
            const calculatedStats = calculateAverageStats(playerMatchStats[playerId]);
            if (calculatedStats) {
                 aggregatedPlayerStats[playerId] = { ...playerDetails[playerId], ...calculatedStats };
            }
        }
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken aggregieren (unverändert)
        console.log("[API Uniliga] Aggregating team statistics...");
        const aggregatedTeamStats = {};
         for (const teamId in teamStats) {
             const team = teamStats[teamId];
             const matchesPlayedCorrected = Math.round(team.matchesPlayed);
             const winsCorrected = Math.round(team.wins);
             const lossesCorrected = Math.round(team.losses);
             const winRate = matchesPlayedCorrected > 0 ? (winsCorrected / matchesPlayedCorrected) * 100 : 0;
             let avgTeamRating = 0; let playerCount = 0;
             team.players.forEach(playerId => {
                 if (aggregatedPlayerStats[playerId]?.rating) { avgTeamRating += aggregatedPlayerStats[playerId].rating; playerCount++; }
             });
             avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;
             aggregatedTeamStats[teamId] = {
                 id: teamId, name: team.name, matchesPlayed: matchesPlayedCorrected,
                 wins: winsCorrected, losses: lossesCorrected, winRate: +winRate.toFixed(1),
                 avgRating: +avgTeamRating.toFixed(2),
             };
         }
        const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION, lastUpdated: new Date().toISOString(),
            championshipId: championshipId, players: sortedPlayerStats, teams: sortedTeamStats
        };

        // f) Im Cache speichern
        if (redis) {
            try { await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS); console.log(`[API Uniliga] Stored aggregated stats in Redis.`); }
            catch (err) { console.error("[API Uniliga] Redis SET error:", err); }
        }

        // g) Senden
        console.log("[API Uniliga] Sending freshly calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga] Unhandled error:", error);
        return res.status(500).json({ error: "Fehler beim Verarbeiten der Uniliga-Daten.", details: error.message });
    }
}