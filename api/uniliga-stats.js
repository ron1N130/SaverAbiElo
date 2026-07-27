import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";
import { calculateAverageStats } from "./utils/stats.js";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const GROUP_STAGE_CHAMPIONSHIP_NAME =
    process.env.UNILIGA_GROUP_STAGE_NAME || "Uniliga Liga 1 Sommerseason 2026";
const GROUP_STAGE_CHAMPIONSHIP_ID =
    process.env.UNILIGA_GROUP_STAGE_ID || "0a49e9c4-808c-4172-bfcb-997c5982770e";
const PLAYOFFS_CHAMPIONSHIP_ID = "4ee001a9-f6f3-4936-916b-798d3171cca8";
const CACHE_VERSION = 16;
const CACHE_TTL_SECONDS = 4 * 60 * 60;
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

const PHASES = Object.freeze({
    groups: {
        label: "Gruppenphase",
        championshipId: GROUP_STAGE_CHAMPIONSHIP_ID,
        matchType: "past"
    },
    playoffs: {
        label: "Playoffs",
        championshipId: PLAYOFFS_CHAMPIONSHIP_ID,
        matchType: "all"
    }
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchFaceitApi(endpoint, retries = 3) {
    if (!FACEIT_API_KEY) {
        throw new Error("FACEIT_API_KEY ist nicht konfiguriert.");
    }

    await delay(API_DELAY);
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${FACEIT_API_KEY}`,
            Accept: "application/json"
        }
    });

    if (response.status === 429 && retries > 0) {
        await delay(API_DELAY * 15);
        return fetchFaceitApi(endpoint, retries - 1);
    }
    if (response.status === 401) {
        throw new Error("FACEIT API-Authentifizierung fehlgeschlagen.");
    }
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        const body = await response.text();
        if (retries > 0 && response.status >= 500) {
            await delay(API_DELAY * (4 - retries));
            return fetchFaceitApi(endpoint, retries - 1);
        }
        throw new Error(`FACEIT API ${response.status}: ${body}`);
    }

    return response.json();
}

let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 10000,
            maxRetriesPerRequest: 2,
            showFriendlyErrorStack: true
        });
        redis.on("error", (error) => {
            console.error("[Redis Uniliga]", error.message);
        });
    } catch (error) {
        console.error("[Redis Uniliga] Initialisierung fehlgeschlagen:", error.message);
        redis = null;
    }
}

function loadTeamInfo() {
    try {
        const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
        const jsonPath = path.join(moduleDirectory, "..", "uniliga_teams.json");
        const teams = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

        return Object.fromEntries(
            teams
                .filter((team) => team.team_id && team.name)
                .map((team) => [team.team_id, { name: team.name, icon: team.icon || null }])
        );
    } catch (error) {
        console.error("[API Uniliga] Teamdatei konnte nicht geladen werden:", error.message);
        return {};
    }
}

const teamInfoMap = loadTeamInfo();

function firstQueryValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function requestedPhase(req) {
    const queryPhase = firstQueryValue(req.query?.phase);
    let urlPhase = null;

    try {
        urlPhase = new URL(req.url || "/", "https://saverabi.local").searchParams.get("phase");
    } catch {
        urlPhase = null;
    }

    const phase = String(queryPhase || urlPhase || "groups").toLowerCase();
    return Object.hasOwn(PHASES, phase) ? phase : null;
}

function bypassesCache(req) {
    if (firstQueryValue(req.query?.noCache) === "true") return true;
    try {
        return new URL(req.url || "/", "https://saverabi.local").searchParams.get("noCache") === "true";
    } catch {
        return false;
    }
}

async function readCache(key) {
    if (!redis) return null;
    try {
        const value = await redis.get(key);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.error("[API Uniliga] Redis GET fehlgeschlagen:", error.message);
        return null;
    }
}

async function writeCache(key, value) {
    if (!redis) return;
    try {
        await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
    } catch (error) {
        console.error("[API Uniliga] Redis SET fehlgeschlagen:", error.message);
    }
}

async function fetchChampionshipMatches(championshipId, type) {
    const matches = [];
    const limit = 100;
    let offset = 0;

    while (matches.length < MAX_MATCHES_TO_FETCH) {
        const response = await fetchFaceitApi(
            `/championships/${championshipId}/matches?type=${type}&offset=${offset}&limit=${limit}`
        );
        const items = Array.isArray(response?.items) ? response.items : [];
        if (items.length === 0) break;

        matches.push(...items);
        offset += items.length;
        if (items.length < limit) break;
    }

    return matches.slice(0, MAX_MATCHES_TO_FETCH);
}

function roundSortValue(round) {
    const numericRound = Number(round);
    if (Number.isFinite(numericRound)) return numericRound;

    const normalized = String(round || "").toLowerCase();
    if (normalized.includes("round of 16") || normalized.includes("achtel")) return 16;
    if (normalized.includes("quarter") || normalized.includes("viertel")) return 32;
    if (normalized.includes("semi") || normalized.includes("halb")) return 64;
    if (normalized.includes("final")) return 128;
    return 0;
}

function playoffRoundLabel(index, totalRounds, rawRound) {
    const distanceFromFinal = totalRounds - index - 1;
    const labels = ["Finale", "Halbfinale", "Viertelfinale", "Achtelfinale"];
    return labels[distanceFromFinal] || `Runde ${rawRound ?? index + 1}`;
}

function stageRoundLabel(stageKey, index, totalRounds, rawRound) {
    const distanceFromFinal = totalRounds - index - 1;
    if (stageKey === "grand-final") return "Grand Final";
    if (stageKey === "upper") {
        const labels = ["Upper Finale", "Upper Halbfinale", "Upper Viertelfinale", "Upper Achtelfinale"];
        return labels[distanceFromFinal] || `Upper Runde ${rawRound ?? index + 1}`;
    }
    if (stageKey === "lower") {
        if (distanceFromFinal === 0) return "Lower Finale";
        if (distanceFromFinal === 1) return "Lower Halbfinale";
        return `Lower Runde ${index + 1}`;
    }
    return playoffRoundLabel(index, totalRounds, rawRound);
}

function normalizeFaceitTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
        const milliseconds = Math.abs(numericValue) < 1e12
            ? numericValue * 1000
            : numericValue;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function matchTeamEntries(match) {
    if (Array.isArray(match?.teams)) {
        return match.teams.map((team, index) => [`faction${index + 1}`, team]);
    }
    if (match?.teams && typeof match.teams === "object") {
        return Object.entries(match.teams);
    }
    return [];
}

function normalizeBracketMatch(match) {
    const entries = matchTeamEntries(match).slice(0, 2);
    while (entries.length < 2) {
        entries.push([`faction${entries.length + 1}`, null]);
    }

    const winnerReference = match?.results?.winner ?? null;
    const score = match?.results?.score;
    const teams = entries.map(([slot, team], index) => {
        const id = team?.faction_id || team?.team_id || team?.id || null;
        const rawScore = Array.isArray(score) ? score[index] : score?.[slot];
        const parsedScore = Number(rawScore);

        return {
            id,
            name: teamInfoMap[id]?.name || team?.name || "TBD",
            avatar: team?.avatar || null,
            score: Number.isFinite(parsedScore) ? parsedScore : null,
            winner: winnerReference === slot || winnerReference === id
        };
    });

    if (!teams.some((team) => team.winner) && String(match?.status).toUpperCase() === "FINISHED") {
        const scoredTeams = teams.filter((team) => team.score !== null);
        if (scoredTeams.length === 2 && scoredTeams[0].score !== scoredTeams[1].score) {
            const winningScore = Math.max(scoredTeams[0].score, scoredTeams[1].score);
            teams.forEach((team) => {
                team.winner = team.score === winningScore;
            });
        }
    }

    return {
        matchId: match?.match_id || match?.id || null,
        round: match?.round ?? null,
        group: match?.group || null,
        status: String(match?.status || "UNKNOWN").toUpperCase(),
        bestOf: Number(match?.best_of) || null,
        scheduledAt: normalizeFaceitTimestamp(match?.scheduled_at),
        finishedAt: normalizeFaceitTimestamp(match?.finished_at),
        teams,
        winnerId: teams.find((team) => team.winner)?.id || null
    };
}

function buildStageRounds(matches, stageKey) {
    const roundMap = new Map();

    for (const match of matches) {
        const key = String(match.round ?? "1");
        if (!roundMap.has(key)) roundMap.set(key, []);
        roundMap.get(key).push(match);
    }

    const groupedRounds = [...roundMap.entries()]
        .sort(([roundA], [roundB]) => roundSortValue(roundA) - roundSortValue(roundB));
    return groupedRounds.map(([rawRound, roundMatches], index) => ({
        round: rawRound,
        label: stageRoundLabel(stageKey, index, groupedRounds.length, rawRound),
        matches: roundMatches.sort((matchA, matchB) =>
            String(matchA.scheduledAt || matchA.finishedAt || "")
                .localeCompare(String(matchB.scheduledAt || matchB.finishedAt || ""))
        )
    }));
}

function stageDefinition(group, hasMultipleGroups) {
    if (!hasMultipleGroups) {
        return { key: "main", label: "Playoff-Bracket" };
    }

    const definitions = {
        "1": { key: "upper", label: "Upper Bracket" },
        "2": { key: "lower", label: "Lower Bracket" },
        "3": { key: "grand-final", label: "Grand Final" }
    };
    return definitions[String(group)] || {
        key: `group-${group}`,
        label: `Bracket ${group}`
    };
}

export function buildPlayoffBracket(matches) {
    const normalizedMatches = (Array.isArray(matches) ? matches : [])
        .map(normalizeBracketMatch)
        .filter((match) => match.matchId);
    const groupMap = new Map();

    for (const match of normalizedMatches) {
        const group = String(match.group ?? "main");
        if (!groupMap.has(group)) groupMap.set(group, []);
        groupMap.get(group).push(match);
    }

    const groupedMatches = [...groupMap.entries()].sort(([groupA], [groupB]) => {
        const numericA = Number(groupA);
        const numericB = Number(groupB);
        if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
        return groupA.localeCompare(groupB);
    });
    const hasMultipleGroups = groupedMatches.length > 1;
    const stages = groupedMatches.map(([group, stageMatches]) => {
        const definition = stageDefinition(group, hasMultipleGroups);
        return {
            ...definition,
            group: group === "main" ? null : group,
            rounds: buildStageRounds(stageMatches, definition.key)
        };
    });
    const finalStage = stages.find((stage) => stage.key === "grand-final") || stages.at(-1);
    const finalMatches = (finalStage?.rounds || [])
        .flatMap((round) => round.matches)
        .filter((match) => match.winnerId)
        .sort((matchA, matchB) =>
            String(matchA.scheduledAt || matchA.finishedAt || "")
                .localeCompare(String(matchB.scheduledAt || matchB.finishedAt || ""))
        );
    const finalMatch = finalMatches.at(-1) || null;
    const champion = finalMatch?.teams.find((team) => team.winner) || null;
    const rounds = stages.flatMap((stage) => stage.rounds);

    return {
        format: hasMultipleGroups ? "double-elimination" : "single-elimination",
        stages,
        rounds,
        champion
    };
}

function newTeamStats(name = "TBD") {
    return {
        name,
        mapWins: 0,
        mapLosses: 0,
        mapsPlayed: 0,
        points: 0,
        matchWins: 0,
        matchLosses: 0,
        matchDraws: 0,
        matchesPlayed: 0,
        players: new Set()
    };
}

function ensureTeam(teamStats, teamId, fallbackName = "TBD") {
    if (!teamStats[teamId]) {
        teamStats[teamId] = newTeamStats(teamInfoMap[teamId]?.name || fallbackName);
    }
    if (teamStats[teamId].name === "TBD") {
        teamStats[teamId].name = teamInfoMap[teamId]?.name || fallbackName;
    }
    return teamStats[teamId];
}

function isFinishedMatch(match) {
    return ["FINISHED", "COMPLETED"].includes(String(match?.status || "").toUpperCase());
}

async function aggregateMatchStats(matches, phase) {
    const playerMatchStats = {};
    const playerDetails = {};
    const teamStats = {};
    const matchTeamNames = {};
    for (const match of matches) {
        for (const [, team] of matchTeamEntries(match)) {
            const teamId = team?.faction_id || team?.team_id || team?.id;
            if (teamId && team?.name) matchTeamNames[teamId] = team.name;
        }
    }
    const matchesForStats = phase === "playoffs"
        ? matches.filter(isFinishedMatch)
        : matches;

    for (let index = 0; index < matchesForStats.length; index += MATCH_DETAIL_BATCH_SIZE) {
        const batch = matchesForStats.slice(index, index + MATCH_DETAIL_BATCH_SIZE);
        await Promise.all(batch.map(async (match) => {
            const matchId = match?.match_id;
            if (!matchId) return;

            try {
                const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                const maps = Array.isArray(stats?.rounds) ? stats.rounds : [];
                if (maps.length === 0 || maps[0]?.teams?.length !== 2) return;

                const teamId1 = maps[0].teams[0]?.team_id;
                const teamId2 = maps[0].teams[1]?.team_id;
                if (!teamId1 || !teamId2) return;

                const team1 = ensureTeam(teamStats, teamId1, matchTeamNames[teamId1]);
                const team2 = ensureTeam(teamStats, teamId2, matchTeamNames[teamId2]);
                let team1MapWins = 0;
                let team2MapWins = 0;

                for (const map of maps) {
                    const winner = map?.round_stats?.Winner;
                    if (winner === teamId1) team1MapWins += 1;
                    if (winner === teamId2) team2MapWins += 1;
                }

                team1.matchesPlayed += 1;
                team2.matchesPlayed += 1;
                if (team1MapWins > team2MapWins) {
                    team1.matchWins += 1;
                    team2.matchLosses += 1;
                    team1.points += phase === "groups" ? 2 : 1;
                } else if (team2MapWins > team1MapWins) {
                    team2.matchWins += 1;
                    team1.matchLosses += 1;
                    team2.points += phase === "groups" ? 2 : 1;
                } else {
                    team1.matchDraws += 1;
                    team2.matchDraws += 1;
                    if (phase === "groups") {
                        team1.points += 1;
                        team2.points += 1;
                    }
                }

                for (const [mapIndex, map] of maps.entries()) {
                    const mapTeams = Array.isArray(map?.teams) ? map.teams : [];
                    const roundsPlayed = Number.parseInt(map?.round_stats?.Rounds, 10);
                    if (mapTeams.length === 0 || !Number.isFinite(roundsPlayed) || roundsPlayed <= 0) {
                        continue;
                    }

                    const winningTeamId = map?.round_stats?.Winner;
                    for (const team of mapTeams) {
                        const teamId = team?.team_id;
                        if (!teamId) continue;

                        const currentTeam = ensureTeam(teamStats, teamId, matchTeamNames[teamId]);
                        currentTeam.mapsPlayed += 1;
                        if (winningTeamId === teamId) currentTeam.mapWins += 1;
                        else if (winningTeamId) currentTeam.mapLosses += 1;

                        for (const player of team.players || []) {
                            const playerId = player?.player_id;
                            const playerStats = player?.player_stats;
                            if (!playerId || !playerStats || Object.keys(playerStats).length === 0) {
                                continue;
                            }

                            playerDetails[playerId] ||= {
                                nickname: player.nickname || "?",
                                avatar: player.avatar || "default_avatar.png"
                            };
                            currentTeam.players.add(playerId);
                            playerMatchStats[playerId] ||= [];
                            playerMatchStats[playerId].push({
                                Kills: Number(playerStats.Kills ?? 0),
                                Deaths: Number(playerStats.Deaths ?? 0),
                                Assists: Number(playerStats.Assists ?? 0),
                                Headshots: Number(playerStats.Headshots ?? 0),
                                KR_Ratio: Number(playerStats["K/R Ratio"] ?? 0),
                                KD_Ratio: Number(playerStats["K/D Ratio"] ?? 0),
                                ADR: Number(playerStats.ADR ?? playerStats["Average Damage per Round"] ?? 0),
                                Rounds: roundsPlayed,
                                Win: winningTeamId ? Number(winningTeamId === teamId) : 0,
                                MatchId: matchId,
                                MapNumber: mapIndex + 1
                            });
                        }
                    }
                }
            } catch (error) {
                console.error(`[API Uniliga] Match ${matchId} übersprungen:`, error.message);
            }
        }));
    }

    const playersById = {};
    for (const [playerId, maps] of Object.entries(playerMatchStats)) {
        const calculated = calculateAverageStats(maps);
        if (calculated?.matchesPlayed > 0) {
            playersById[playerId] = {
                ...playerDetails[playerId],
                ...calculated
            };
        }
    }
    const players = Object.values(playersById)
        .sort((playerA, playerB) => (playerB.rating ?? 0) - (playerA.rating ?? 0));

    const teams = Object.entries(teamStats).map(([teamId, team]) => {
        let ratingTotal = 0;
        let ratedPlayers = 0;
        for (const playerId of team.players) {
            if (Number.isFinite(playersById[playerId]?.rating)) {
                ratingTotal += playersById[playerId].rating;
                ratedPlayers += 1;
            }
        }

        return {
            id: teamId,
            name: team.name,
            mapsPlayed: team.mapsPlayed,
            mapWins: team.mapWins,
            mapLosses: team.mapLosses,
            mapWinRate: team.mapsPlayed > 0
                ? +((team.mapWins / team.mapsPlayed) * 100).toFixed(1)
                : 0,
            matchesPlayed: team.matchesPlayed,
            matchWins: team.matchWins,
            matchLosses: team.matchLosses,
            matchDraws: team.matchDraws,
            matchWinRate: team.matchesPlayed > 0
                ? +((team.matchWins / team.matchesPlayed) * 100).toFixed(1)
                : 0,
            avgRating: ratedPlayers > 0 ? +(ratingTotal / ratedPlayers).toFixed(2) : 0,
            points: team.points
        };
    }).sort((teamA, teamB) => {
        if (phase === "groups") {
            const points = teamB.points - teamA.points;
            if (points !== 0) return points;
        }
        const wins = teamB.matchWins - teamA.matchWins;
        if (wins !== 0) return wins;
        const mapDifference =
            (teamB.mapWins - teamB.mapLosses)
            - (teamA.mapWins - teamA.mapLosses);
        if (mapDifference !== 0) return mapDifference;
        return teamB.avgRating - teamA.avgRating;
    });

    return { players, teams };
}

export default async function handler(req, res) {
    if (req.method && req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Nur GET wird unterstützt." });
    }

    const phase = requestedPhase(req);
    if (!phase) {
        return res.status(400).json({ error: "Ungültige Phase. Erlaubt sind groups und playoffs." });
    }

    const cacheKey = `uniliga_stats:${phase}:v${CACHE_VERSION}`;
    if (!bypassesCache(req)) {
        const cachedData = await readCache(cacheKey);
        if (cachedData) {
            res.setHeader("X-Cache-Status", "HIT");
            res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
            return res.status(200).json(cachedData);
        }
    }
    res.setHeader("X-Cache-Status", bypassesCache(req) ? "SKIPPED" : "MISS");

    try {
        const phaseConfig = PHASES[phase];
        const championshipId = phaseConfig.championshipId;
        const championshipPromise = fetchFaceitApi(`/championships/${championshipId}`)
            .catch(() => null);
        const matches = await fetchChampionshipMatches(championshipId, phaseConfig.matchType);
        const [championship, stats] = await Promise.all([
            championshipPromise,
            aggregateMatchStats(matches, phase)
        ]);
        const championshipName =
            championship?.name
            || matches.find((match) => match?.competition_name)?.competition_name
            || (phase === "groups" ? GROUP_STAGE_CHAMPIONSHIP_NAME : "Uniliga Liga 1 Playoffs");

        const responseData = {
            version: CACHE_VERSION,
            lastUpdated: new Date().toISOString(),
            phase,
            phaseLabel: phaseConfig.label,
            championshipId,
            championshipName,
            teams: stats.teams,
            players: stats.players,
            bracket: phase === "playoffs" ? buildPlayoffBracket(matches) : null
        };

        await writeCache(cacheKey, responseData);
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);
    } catch (error) {
        console.error(`[API Uniliga] ${phase} fehlgeschlagen:`, error);
        return res.status(500).json({
            error: `Uniliga-${PHASES[phase].label} konnte nicht geladen werden.`,
            details: error.message
        });
    }
}
