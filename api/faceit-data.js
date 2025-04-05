// Lade Umgebungsvariablen aus der .env Datei (nur für lokale Entwicklung relevant)
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2 uses require
const cors = require('cors');

const app = express();
// const port = 3000; // Port wird von Vercel verwaltet, hier nicht nötig

// CORS erlauben (wichtig, falls Frontend und API doch mal auf leicht unterschiedlichen Vercel-Subdomains landen oder für lokale Tests)
app.use(cors());

// Lese den API Key aus den Umgebungsvariablen (lokal aus .env, auf Vercel aus den Vercel Settings)
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';

// Definiere den API Endpunkt
// Vercel leitet Anfragen an /api/faceit-data (oder ähnlich, je nach Dateiname/Struktur) an diese Funktion weiter.
app.get('/api/faceit-data', async (req, res) => {
    const nickname = req.query.nickname;

    if (!nickname) {
        return res.status(400).json({ error: 'Nickname query parameter is required' });
    }

    // Prüfe, ob der API Key auf dem Server verfügbar ist
    if (!FACEIT_API_KEY) {
        console.error("FEHLER: FACEIT_API_KEY nicht als Umgebungsvariable auf dem Server gefunden!");
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }

    const headers = {
        'Authorization': `Bearer ${FACEIT_API_KEY}`
    };

    try {
        // Schritt 1: Spieler-ID holen
        console.log(`[API Function] Fetching player ID for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });

        if (!playerDetailsResponse.ok) {
            if (playerDetailsResponse.status === 404) {
                console.log(`[API Function] Player not found: ${nickname}`);
                return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden.` });
            } else {
                // Logge den Status für Debugging
                console.error(`[API Function] Faceit API error (Player Details): ${playerDetailsResponse.status} for ${nickname}`);
                throw new Error(`Faceit API error (Player Details): ${playerDetailsResponse.status}`);
            }
        }
        const playerData = await playerDetailsResponse.json();
        const playerId = playerData.player_id;
        console.log(`[API Function] Found Player ID: ${playerId} for ${nickname}`);

        // Schritt 2: Stats (Elo) holen (Annahme: CS2)
        console.log(`[API Function] Fetching stats for: ${playerId}`);
        const statsResponse = await fetch(`${API_BASE_URL}/players/${playerId}/stats/cs2`, { headers }); // Anpassen für csgo falls nötig

        let playerStats = {}; // Default leeres Objekt
        if (statsResponse.ok) {
            playerStats = await statsResponse.json();
            console.log(`[API Function] Found stats for: ${playerId}`);
        } else if (statsResponse.status === 404) {
            console.warn(`[API Function] No CS2 stats found for ${nickname} (${playerId}). Returning basic data.`);
        } else {
            console.error(`[API Function] Faceit API error (Player Stats): ${statsResponse.status} for ${playerId}`);
            throw new Error(`Faceit API error (Player Stats): ${statsResponse.status}`);
        }

        // Daten kombinieren und zurücksenden
        const responseData = {
            nickname: playerData.nickname,
            avatar: playerData.avatar || 'default_avatar.png',
            faceitUrl: playerData.faceit_url.replace('{lang}', 'en'),
            elo: playerStats.lifetime?.k5 || 'N/A',
            level: playerStats.lifetime?.k6 || 'N/A',
            levelImageUrl: playerStats.lifetime?.k6 ? `https://cdn-frontend.faceit.com/web/960/src/app/assets/images-compress/skill-level/skill_level_${playerStats.lifetime.k6}_sm.png` : null
        };

        console.log(`[API Function] Sending data for ${nickname}`);
        // Setze Cache-Control Header, um Caching für eine kurze Zeit zu erlauben (z.B. 5 Minuten)
        // Passt die Dauer an, wie aktuell die Daten sein müssen.
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        res.json(responseData);

    } catch (error) {
        console.error(`[API Function] Error processing request for ${nickname}:`, error);
        res.status(500).json({ error: error.message || 'Internal server error fetching Faceit data' });
    }
});

// Starte den Server NICHT mit app.listen() in einer Serverless-Umgebung
// Stattdessen exportiere die Express App, damit Vercel sie verwenden kann
module.exports = app;