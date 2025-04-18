// api/update-stats.js – vollständig überarbeitet
// -------------------------------------------------
// ◼ Entfernt: node-fetch‑Import (fetch ist global ab Node 18/Vercel)
// ◼ Neu: delay‑Helper
// ◼ Fixes: ADR‑Mapping, Winner‑Ermittlung, teamWon‑Logik
// -------------------------------------------------

import Redis from "ioredis";
import fs from "fs";
import path from "path";

// --- Helpers -------------------------------------------------------------
/** simple async sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// HLTV‑Berechnung … (unchanged ausser ADR‑Fallback) -----------------------
function calculateAverageStats(matches) {
    const DMG_PER_KILL = 105;
    const weight = matches.length;
    if (weight === 0) {
        return {
            kills: 0,
            deaths: 0,
            hs: 0,
            wins: 0,
            kd: 0,
            dpr: 0,
            kpr: 0,
            avgk: 0,
            adr: 0,
            hsp: 0,
            winRate: 0,
            apr: 0,
            kast: 0,
            impact: 0,
            rating: 0,
            weight,
        };
    }
    const matchStats = matches.map((m) => {
        const kills = Number(m["Kills"]) || 0;
        const deaths = Number(m["Deaths"]) || 0;
        const rounds = Number(m["Rounds"]) || 1;
        const kpr = Number(m["K/R Ratio"]) || 0;
        const adr = Number(m["ADR"]) || DMG_PER_KILL * kpr;
        const hs = Number(m["Headshots"]) || 0;
        const assists = Number(m["Assists"]) || 0;
        const win = Number(m["Win"]) || 0;
        return { kills, deaths, rounds, kpr, adr, hs, assists, win };
    });
    // … (Berechnungen wie gehabt)
    const totalKills = matchStats.reduce((s, a) => s + a.kills, 0);
    const totalDeaths = matchStats.reduce((s, a) => s + a.deaths, 0);
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths;
    const adr_avg = matchStats.reduce((s, a) => s + a.adr, 0) / weight;
    const kpr_avg = matchStats.reduce((s, a) => s + a.kpr, 0) / weight;
    const dpr = matchStats.reduce((s, a) => s + a.deaths / a.rounds, 0) / weight;
    const hsp = (matchStats.reduce((s, a) => s + a.hs, 0) / totalKills) * 100 || 0;
    const winRate = (matchStats.reduce((s, a) => s + a.win, 0) / weight) * 100;
    const apr = matchStats.reduce((s, a) => s + a.assists / a.rounds, 0) / weight;
    const kast = 100 * (0.0073 + (0.3591 * kpr_avg) + (-0.5329 * dpr)); // simplified example
    const impact = 2.13 * kpr_avg + 0.42 * (totalKills / weight) - 0.41;
    const rating = Math.max(
        0,
        0.0073 * kast + 0.3591 * kpr_avg - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr_avg + 0.1587
    );
    return {
        kd: +kd.toFixed(2),
        adr: +adr_avg.toFixed(1),
        winRate: +winRate.toFixed(1),
        hsp: +hsp.toFixed(1),
        kast: +kast.toFixed(1),
        impact: +impact.toFixed(2),
        rating: +rating.toFixed(2),
        weight,
    };
}

function calculateCurrentFormStats(matches) {
    // Berechne immer auf Basis der **letzten 10 Matches** (unabhängig vom Datum)
    // 1) Nach Start‑Zeit (CreatedAt) absteigend sortieren
    const sorted = [...matches].sort((a, b) => b.CreatedAt - a.CreatedAt);
    // 2) Die 10 jüngsten auswählen
    const recent = sorted.slice(0, 10);
    return {
        stats: calculateAverageStats(recent),
        matchesCount: recent.length, // sollte 10 sein – falls weniger Spiele vorhanden
    };
}

// --- Konfiguration ------------------------------------------------------
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const MATCH_COUNT = 20;
const API_DELAY = 600;

// --- Redis‑Initialisierung mit Fehlertoleranz ---------------------------
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, {
        lazyConnect: true,        // verbindet erst bei erstem Kommando
        connectTimeout: 20000,    // 20 Sek. Timeout
        maxRetriesPerRequest: 3,
    });
    // „error“-Event abfangen, damit es nicht als Unhandled auftaucht
    redis.on("error", (err) => {
        console.error("[Redis] connection error → continue without Redis", err.message);
        redis = null; // deaktiviert Redis für den weiteren Request‑Flow
    });
    try {
        await redis.connect();
    } catch (err) {
        console.error("[Redis] initial connect failed", err.message);
        redis = null;
    }
}

// „error“‑Event konsumieren, damit es nicht als Unhandled auftaucht
redis.on("error", (err) => {
    console.error("[Redis] connection error → continue without Redis", err.message);
    redis = null; // deaktiviert Redis für den weiteren Request‑Flow
});
try {
    await redis.connect();
} catch (err) {
    console.error("[Redis] initial connect failed", err.message);
    redis = null;
}

// --- Hilfs‑Fetch mit Rate‑Limit‑Pause -----------------------------------
async function fetchFaceitApi(endpoint) {
    await delay(API_DELAY);
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${FACEIT_API_KEY}` },
    });
    if (res.status === 429) {
        console.warn("[API] Rate‑Limit – extra sleep");
        await delay(API_DELAY * 10);
        return fetchFaceitApi(endpoint);
    }
    if (!res.ok) throw new Error(`[API] ${endpoint} → ${res.status}`);
    return res.json();
}

// ------------------------------------------------------------------------
export default async function handler(req, res) {
    const jsonPath = path.resolve(process.cwd(), "players.json");
    const playerList = JSON.parse(fs.readFileSync(jsonPath));
    let success = 0,
        failed = 0;

    for (const nickname of playerList) {
        try {
            // 1) Spieler‑Details
            const details = await fetchFaceitApi(`/players?nickname=${nickname}`);
            const playerId = details.player_id;

            // 2) Match‑History
            const history = await fetchFaceitApi(
                `/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`
            );
            if (!history.items?.length) throw new Error("No history");

            const matchesForCalc = [];
            for (const h of history.items) {
                const stats = await fetchFaceitApi(`/matches/${h.match_id}/stats`);
                if (!stats.rounds?.length) continue;

                const winningTeamId = stats.rounds[0].round_stats["Winner"];
                const matchRounds = parseInt(stats.rounds[0].round_stats["Rounds"], 10) || 1;

                for (const team of stats.rounds[0].teams) {
                    const pl = team.players.find((p) => p.player_id === playerId);
                    if (!pl) continue;
                    matchesForCalc.push({
                        Kills: pl.player_stats["Kills"],
                        Deaths: pl.player_stats["Deaths"],
                        Assists: pl.player_stats["Assists"],
                        Headshots: pl.player_stats["Headshots"],
                        "K/R Ratio": pl.player_stats["K/R Ratio"],
                        ADR:
                            pl.player_stats["ADR"] ?? pl.player_stats["Average Damage per Round"],
                        Rounds: matchRounds,
                        Win: team.team_id === winningTeamId ? 1 : 0,
                        CreatedAt: h.started_at,
                    });
                }
            }

            const { stats, matchesCount } = calculateCurrentFormStats(matchesForCalc);
            const dataToStore = {
                calculatedRating: stats.rating,
                kd: stats.kd,
                adr: stats.adr,
                winRate: stats.winRate,
                hsPercent: stats.hsp,
                kast: stats.kast,
                impact: stats.impact,
                matchesConsidered: matchesCount,
                lastUpdated: new Date().toISOString(),
            };
            await redis.set(`player_stats:${playerId}`, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60);
            success++;
        } catch (e) {
            console.error(`[CRON] ${nickname} failed →`, e.message);
            failed++;
        }
    }
    res.status(200).json({ success, failed });
}