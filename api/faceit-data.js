// Kein KV mehr nötig
// import { kv } from '@vercel/kv';
import fetch from 'node-fetch'; // node-fetch@3 uses ESM import
// Kein fs/path mehr nötig, da players.json nicht mehr vom Cron gelesen wird
// import fs from 'fs';
// import path from 'path';

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
// Keine History-Konstanten mehr
// const HISTORY_LIMIT = 50;
// const MAX_HISTORY_POINTS = 200;

// Cron-Job-Logik komplett entfernt

// Die Hauptfunktion, die jetzt nur noch vom Frontend aufgerufen wird
export default async function handler(req, res) {
    // CORS Header
    res.setHeader('Access-Control-Allow-Origin', '*'); // Anpassen für Produktion!
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { return res.status(200).end(); }

    if (!FACEIT_API_KEY) { console.error("FATAL: FACEIT_API_KEY fehlt!"); return res.status(500).json({ error: 'Server configuration error: API Key missing' }); }
    const headers = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    const nickname = req.query.nickname;
    if (!nickname) { return res.status(400).json({ error: 'Nickname query parameter is required' }); }
    console.log(`[API] Request for nickname: ${nickname}`);

    try {
        // === Schritt 1: Spielerdetails holen ===
        console.log(`[API] Fetching player details for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });
        console.log(`[API] Player Details Status: ${playerDetailsResponse.status}`);
        if (!playerDetailsResponse.ok) {
             if (playerDetailsResponse.status === 404) { return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden.` }); }
             else { throw new Error(`Faceit API error (Details): ${playerDetailsResponse.status}`); }
         }
        const playerData = await playerDetailsResponse.json();
        const playerId = playerData.player_id;
        console.log(`[API] Found Player ID: ${playerId}`);

        // === Schritt 2: Lifetime Stats holen ===
        let simplifiedImpact = 'N/A', lifetimeKD = 'N/A', lifetimeWinRate = 'N/A';
        try {
             console.log(`[API] Fetching stats for: ${playerId} (Game: cs2)`);
             const statsResponse = await fetch(`${API_BASE_URL}/players/${playerId}/stats/cs2`, { headers });
             console.log(`[API] Stats Response Status: ${statsResponse.status}`);
             if (statsResponse.ok) {
                 const statsData = await statsResponse.json();
                 const lifetime = statsData?.lifetime;
                 if (lifetime) {
                     const kills = parseFloat(lifetime['Total Kills with extended stats'] || lifetime['Kills'] || 0);
                     const deaths = parseFloat(lifetime['Deaths'] || 1);
                     const assists = parseFloat(lifetime['Assists'] || 0);
                     const rounds = parseInt(lifetime['Total Rounds with extended stats'] || lifetime['Rounds'] || 1);
                     const winRate = parseFloat(lifetime['Win Rate %'] || 'N/A');
                     const avgKD = parseFloat(lifetime['Average K/D Ratio'] || 'N/A');

                     const KPR = rounds > 0 ? kills / rounds : 0;
                     const APR = rounds > 0 ? assists / rounds : 0;
                     const impactCalc = 2.13 * KPR + 0.42 * APR - 0.41;
                     simplifiedImpact = !isNaN(impactCalc) ? impactCalc.toFixed(2) : 'N/A';
                     lifetimeKD = !isNaN(avgKD) ? avgKD.toFixed(2) : (deaths > 0 && !isNaN(kills/deaths)) ? (kills/deaths).toFixed(2) : 'N/A';
                     lifetimeWinRate = !isNaN(winRate) ? winRate.toFixed(0) : 'N/A';
                     console.log(`[API] Calculated Stats for ${nickname}: Impact=${simplifiedImpact}, K/D=${lifetimeKD}, WR%=${lifetimeWinRate}`);
                 } else { console.warn(`[API] Lifetime stats object missing for ${nickname}`); }
             } else { console.warn(`[API] Could not fetch stats for ${nickname}, Status: ${statsResponse.status}`); }
        } catch(statsError) { console.error(`[API] Error fetching/processing stats for ${nickname}:`, statsError); }

        // === Schritt 3: Daten kombinieren (OHNE HISTORY) ===
        const gameId = 'cs2';
        const gameData = playerData.games && playerData.games[gameId] ? playerData.games[gameId] : null;
        const responseData = {
            nickname: playerData.nickname,
            avatar: playerData.avatar || 'default_avatar.png',
            faceitUrl: playerData.faceit_url ? playerData.faceit_url.replace('{lang}', 'en') : '#',
            elo: gameData?.faceit_elo || 'N/A',
            level: gameData?.skill_level || 'N/A', // Kann drin bleiben, falls doch mal nützlich
            sortElo: parseInt(gameData?.faceit_elo, 10) || 0,
            // Stats für die Liste
            simplifiedImpact: simplifiedImpact,
            lifetimeKD: lifetimeKD,
            lifetimeWinRate: lifetimeWinRate
            // eloTimeHistory wird nicht mehr gesendet
        };

        console.log(`[API] Sending responseData for ${nickname}`);
        res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate'); // 3 Min Cache
        return res.status(200).json(responseData);

    } catch (error) {
        console.error(`[API] CATCH BLOCK Error processing request for ${nickname}:`, error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
}