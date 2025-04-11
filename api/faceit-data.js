import Redis from 'ioredis';
import fetch from 'node-fetch'; // node-fetch@3 ESM

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
const REDIS_URL = process.env.REDIS_URL; // Get Redis URL from env

// Input validation for REDIS_URL
if (!REDIS_URL) {
    console.error("FATAL: REDIS_URL environment variable is not set!");
    // Optionally throw an error or exit if Redis is absolutely required
    // throw new Error("REDIS_URL environment variable is not set!");
}

// Initialize Redis client only if REDIS_URL is available
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            // Optional: Configure timeouts and retry strategies
            connectTimeout: 10000, // 10 seconds
            maxRetriesPerRequest: 3,
            // Add TLS options if your Redis provider requires it (like Vercel Redis)
            // tls: { rejectUnauthorized: false } // Be careful with this in production
        });

        redis.on('error', (err) => {
            console.error('[Redis Client Error]', err);
            // Implement logic to handle Redis connection errors, e.g., fallback or logging
        });

        redis.on('connect', () => {
            console.log('[Redis Client] Connected successfully.');
        });

    } catch (error) {
        console.error('[Redis Client] Failed to initialize:', error);
        redis = null; // Ensure redis is null if initialization fails
    }
} else {
    console.warn('[Redis Client] Skipping initialization because REDIS_URL is not set.');
}


export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!FACEIT_API_KEY) {
        console.error("FATAL: FACEIT_API_KEY fehlt!");
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }
    const faceitHeaders = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: 'Nickname query parameter is required' });
    }
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
            if (playerDetailsResponse.status === 404) {
                return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden (Faceit API).` });
            }
            else {
                throw new Error(`Faceit API error (Details): ${playerDetailsResponse.status}`);
            }
        }

        // === Schritt 2: Berechnete Stats aus Redis holen ===
        // Only attempt Redis operations if the client initialized successfully
        if (playerId && redis) {
            try {
                const redisKey = `player_stats:${playerId}`; // Use same key structure
                console.log(`[API FRONTEND] Attempting to get data from Redis for key: ${redisKey}`);
                const storedStatsString = await redis.get(redisKey);
                console.log(`[API FRONTEND] Redis GET result for ${nickname}: ${storedStatsString ? 'Found data' : 'No data found'}`);

                if (storedStatsString) {
                    const storedStats = JSON.parse(storedStatsString);
                    console.log(`[API FRONTEND] Found stored stats in Redis for ${nickname}:`, storedStats);
                    // Überschreibe/Füge berechnete Werte hinzu
                    responseData.calculatedRating = storedStats.calculatedRating ?? 'N/A';
                    responseData.kd = storedStats.kd ?? 'N/A';
                    responseData.adr = storedStats.adr ?? 'N/A';
                    responseData.winRate = storedStats.winRate ?? 'N/A';
                    responseData.hsPercent = storedStats.hsPercent ?? 'N/A';
                    responseData.matchesConsidered = storedStats.matchesConsidered ?? 0;
                    responseData.lastUpdated = storedStats.lastUpdated ?? null;
                } else {
                    console.log(`[API FRONTEND] No stored stats found in Redis for ${nickname} (Key: ${redisKey})`);
                    // Setze Stats auf 'Pending' oder 'N/A', wenn noch nichts da ist
                    responseData.calculatedRating = 'Pending';
                    responseData.kd = 'Pending';
                    responseData.adr = 'Pending';
                    responseData.winRate = 'Pending';
                    responseData.hsPercent = 'Pending';
                    responseData.matchesConsidered = 0;
                    // lastUpdated bleibt null
                }
            } catch (redisError) {
                console.error(`[API FRONTEND] Error fetching from Redis for ${nickname}:`, redisError);
                // Set stats to error state or N/A if Redis fails
                responseData.calculatedRating = 'Error';
                responseData.kd = 'Error';
                responseData.adr = 'Error';
                responseData.winRate = 'Error';
                responseData.hsPercent = 'Error';
                responseData.matchesConsidered = 0;
                responseData.lastUpdated = null; // Indicate data is potentially stale/unavailable
            }
        } else if (playerId && !redis) {
            console.warn(`[API FRONTEND] Redis client not available, cannot fetch stats for ${nickname}`);
            // Set stats to indicate Redis is unavailable
            responseData.calculatedRating = 'N/A (DB)';
            responseData.kd = 'N/A (DB)';
            responseData.adr = 'N/A (DB)';
            responseData.winRate = 'N/A (DB)';
            responseData.hsPercent = 'N/A (DB)';
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
