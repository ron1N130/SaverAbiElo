// /api/uniliga-stats.js - Schritt 2: Dateiladen testen

// --- Imports ---
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('[API Uniliga Schritt 2] Modul Imports geladen.');

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 9; // Version beibehalten
const CACHE_TTL_SECONDS = 4 * 60 * 60;
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

console.log('[API Uniliga Schritt 2] Konstanten definiert.');

// --- Hilfsfunktionen (delay, fetchFaceitApi - nur Stubs für diesen Test) ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchFaceitApi(endpoint, retries = 3) {
     console.log(`[API Uniliga Schritt 2] Fetching (simuliert): ${endpoint}`);
     return { items: [] };
}

console.log('[API Uniliga Schritt 2] Hilfsfunktionen definiert.');

// --- Redis‑Initialisierung (aktiv, aber noch nicht genutzt) ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 2, showFriendlyErrorStack: true });
        redis.on("error", (err) => { console.error("[Redis Uniliga Schritt 2] Connection error:", err.message); redis = null; });
        console.log("[Redis Uniliga Schritt 2] Client initialized (lazy).");
    } catch (e) { console.error("[Redis Uniliga Schritt 2] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Uniliga Schritt 2] REDIS_URL not set. Caching disabled."); }

// --- JSON Laden / teamInfoMap (JETZT AKTIV) ---
let teamInfoMap = {};
let jsonLoadError = null;
let calculatedJsonPath = "[Nicht berechnet]"; // Für Logging
try {
    // Pfad ermitteln (von /api eine Ebene hoch zum Root)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const jsonPath = path.join(__dirname, '..', "uniliga_teams.json");
    calculatedJsonPath = jsonPath; // Pfad für Log speichern

    console.log(`[API Uniliga Schritt 2] Attempting to load JSON from: ${jsonPath}`);

    if (!fs.existsSync(jsonPath)) {
        throw new Error(`File not found at calculated path: ${jsonPath}. Resolved: ${path.resolve(jsonPath)}`);
    }

    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    console.log(`[API Uniliga Schritt 2] Successfully read file content (length: ${fileContent.length}).`);

    const teamsData = JSON.parse(fileContent);
    console.log(`[API Uniliga Schritt 2] Successfully parsed JSON. Found ${teamsData.length} entries.`);

    teamsData.forEach(team => {
        if (team.team_id && team.name) {
            teamInfoMap[team.team_id] = { name: team.name, icon: team.icon };
        } else {
             console.warn(`[API Uniliga Schritt 2] Entry in JSON missing 'team_id' or 'name':`, team);
        }
    });
    console.log(`[API Uniliga Schritt 2] Created teamInfoMap with ${Object.keys(teamInfoMap).length} teams.`);
} catch (e) {
    console.error(`[API Uniliga Schritt 2 CRITICAL] Failed to load or parse uniliga_teams.json from path '${calculatedJsonPath}':`, e);
    jsonLoadError = e;
    teamInfoMap = {};
}

console.log('[API Uniliga Schritt 2] Vor Handler Definition.');

// --- Haupt‑Handler (Minimal, prüft JSON-Laden) ---
export default async function handler(req, res) {
    console.log(`[API Uniliga Schritt 2] Handler invoked. URL: ${req.url}`);

    let statusMessage = "";
    if (jsonLoadError) {
        statusMessage = `Fehler beim Laden der JSON: ${jsonLoadError.message}`;
         console.error("[API Uniliga Schritt 2] JSON Load Error detected in handler.");
    } else if (Object.keys(teamInfoMap).length > 0) {
        statusMessage = `Schritt 2 erfolgreich: JSON geladen, ${Object.keys(teamInfoMap).length} Teams gemappt.`;
         console.log("[API Uniliga Schritt 2] JSON loaded successfully detected in handler.");
    } else {
        statusMessage = "Schritt 2: JSON konnte nicht geladen werden oder ist leer (siehe Logs oben).";
         console.warn("[API Uniliga Schritt 2] teamInfoMap seems empty in handler.");
    }

    res.status(200).json({
        message: statusMessage,
        version: CACHE_VERSION,
        timestamp: new Date().toISOString()
    });
}

console.log('[API Uniliga Schritt 2] Modul Ende erreicht.');