import { kv } from '@vercel/kv';
import fetch from 'node-fetch'; // node-fetch@3 ESM

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { return res.status(200).end(); }

    if (!FACEIT_API_KEY) { console.error("FATAL: FACEIT_API_KEY fehlt!"); return res.status(500).json({ error: 'Server configuration error: API Key missing' }); }
    const faceitHeaders = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    const nickname = req.query.nickname;
    if (!nickname) { return res.status(400).json({ error: 'Nickname query parameter is required' }); }
    console.log(`[API FRONTEND] Request for nickname: ${nickname}`);

    let responseData = { // Standard-Antwortstruktur
        nickname: nickname, // Fallback
        avatar: 'default_avatar.png',
        faceitUrl: '#',
        elo: 'N/A',
        level: 'N/A',
        sortElo: 0,
        // Berechnete Stats initialisieren
        calculatedRating: 'N/A',
        kd: 'N/A',
        adr: 'N/A',
        winRate: 'N/A',
        hsPercent: 'N/A',
        matchesConsidered: 0,
        lastUpdated: null
    };

    try {
        // === Schritt 1: Aktuelle Spielerdetails von Faceit API holen ===
        console.log(`[API FRONTEND] Fetching player details for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers: faceitHeaders });
        console.log(`[API FRONTEND] Player Details Status: ${playerDetailsResponse.status}`);

        let playerId = null;
        if (playerDetailsResponse.ok) {
            const playerData = await playerDetailsResponse.json();
            playerId = playerData.player_id;
            const gameData = playerData.games?.cs2;

            // Fülle Antwort mit aktuellen Daten
            responseData.nickname = playerData.nickname;
            responseData.avatar = playerData.avatar || 'default_avatar.png';
            responseData.faceitUrl = playerData.faceit_url ? playerData.faceit_url.replace('{lang}', 'en') : '#';
            responseData.elo = gameData?.faceit_elo || 'N/A';
            responseData.level = gameData?.skill_level || 'N/A';
            responseData.sortElo = parseInt(gameData?.faceit_elo, 10) || 0;
            console.log(`[API FRONTEND] Found Player ID: ${playerId}, Current Elo: ${responseData.elo}`);

        } else {
            // Spieler nicht gefunden oder anderer API Fehler -> Sende nur Fehler zurück
            if (playerDetailsResponse.status === 404) { return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden (Faceit API).` }); }
            else { throw new Error(`Faceit API error (Details): ${playerDetailsResponse.status}`); }
        }

        // === Schritt 2: Berechnete Stats aus Vercel KV holen ===
        if (playerId) { // Nur wenn wir eine ID haben
            try {
                const kvKey = `player_stats:${playerId}`;
                const storedStatsString = await kv.get(kvKey);
                if (storedStatsString) {
                    const storedStats = JSON.parse(storedStatsString);
                    console.log(`[API FRONTEND] Found stored stats in KV for ${nickname}:`, storedStats);
                    // Überschreibe/Füge berechnete Werte hinzu
                    responseData.calculatedRating = storedStats.calculatedRating ?? 'N/A';
                    responseData.kd = storedStats.kd ?? 'N/A';
                    responseData.adr = storedStats.adr ?? 'N/A';
                    responseData.winRate = storedStats.winRate ?? 'N/A';
                    responseData.hsPercent = storedStats.hsPercent ?? 'N/A';
                    responseData.matchesConsidered = storedStats.matchesConsidered ?? 0;
                    responseData.lastUpdated = storedStats.lastUpdated ?? null;
                } else {
                    console.log(`[API FRONTEND] No stored stats found in KV for ${nickname} (Key: ${kvKey})`);
                    // Setze Stats auf 'Pending' oder 'N/A', wenn noch nichts da ist
                    responseData.calculatedRating = 'Pending';
                    responseData.kd = 'Pending';
                    // ... etc
                }
            } catch (kvError) {
                console.error(`[API FRONTEND] Error fetching from KV for ${nickname}:`, kvError);
                // Fahre fort, aber ohne gespeicherte Stats
            }
        }

        // === Schritt 3: Kombinierte Daten senden ===
        console.log(`[API FRONTEND] Sending final responseData for ${nickname}`);
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate'); // Kurzer Cache
        return res.status(200).json(responseData);

    } catch (error) {
        console.error(`[API FRONTEND] CATCH BLOCK Error processing request for ${nickname}:`, error);
        // Sende zumindest die Basisdaten mit Fehler, falls vorhanden
        responseData.error = error.message || 'Internal server error';
        return res.status(500).json(responseData);
    }
}