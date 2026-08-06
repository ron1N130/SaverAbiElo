export const CURRENT_FACEIT_SEASON = 9;

export const FACEIT_SEASONS = Object.freeze([
    Object.freeze({
        number: 9,
        value: "9",
        label: "Season 9",
        shortLabel: "S9",
        current: true,
        startsAt: "2026-08-05T11:00:00.000Z",
        endsAt: null
    }),
    Object.freeze({
        number: 8,
        value: "8",
        label: "Season 8",
        shortLabel: "S8",
        current: false,
        startsAt: "2026-04-22T11:00:00.000Z",
        endsAt: "2026-08-05T11:00:00.000Z"
    })
]);

export function resolveFaceitSeason(value) {
    const seasonNumber = Number.parseInt(String(value ?? CURRENT_FACEIT_SEASON), 10);
    return FACEIT_SEASONS.find((season) => season.number === seasonNumber)
        || FACEIT_SEASONS[0];
}

export function faceitLevelForElo(value) {
    if (value === null || value === undefined || value === "") return null;
    const elo = Number(value);
    if (!Number.isFinite(elo) || elo < 0) return null;
    if (elo >= 2001) return 10;
    if (elo >= 1751) return 9;
    if (elo >= 1531) return 8;
    if (elo >= 1351) return 7;
    if (elo >= 1201) return 6;
    if (elo >= 1051) return 5;
    if (elo >= 901) return 4;
    if (elo >= 751) return 3;
    if (elo >= 501) return 2;
    return 1;
}

export function profileCalibrationStatus(payload) {
    const cs2 = payload?.payload?.games?.cs2
        || payload?.games?.cs2
        || payload?.payload?.cs2
        || null;
    return typeof cs2?.is_calibrating === "boolean"
        ? cs2.is_calibrating
        : typeof cs2?.isCalibrating === "boolean"
            ? cs2.isCalibrating
            : null;
}

export function placementMatchCount(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.filter((match) => (
        String(match?.competition_type || "").toLowerCase() === "matchmaking"
        && String(match?.status || "finished").toLowerCase() === "finished"
    )).length;
}

function seasonRecords(payload) {
    const candidates = [
        payload?.payload?.cs2?.seasons,
        payload?.payload?.seasons,
        payload?.cs2?.seasons,
        payload?.seasons
    ];
    return candidates.find(Array.isArray) || [];
}

function seasonNumberFromRecord(record) {
    const direct = [record?.number, record?.season_number, record?.seasonNumber]
        .map((value) => Number.parseInt(String(value ?? ""), 10))
        .find(Number.isFinite);
    if (direct) return direct;

    const searchable = [
        record?.name,
        record?.label,
        record?.title,
        record?.slug
    ].filter(Boolean).join(" ");
    const namedMatch = searchable.match(/season[\s_-]*(\d{1,2})(?!\d)/i);
    if (namedMatch) return Number.parseInt(namedMatch[1], 10);

    const id = String(record?.season_id ?? record?.seasonId ?? record?.id ?? "");
    const numericIdMatch = id.match(/^(?:season[\s_-]*)?(\d{1,2})$/i);
    return numericIdMatch ? Number.parseInt(numericIdMatch[1], 10) : null;
}

export function findFaceitSeasonRecord(payload, season) {
    const resolved = typeof season === "object" && season
        ? season
        : resolveFaceitSeason(season);
    const records = seasonRecords(payload);

    const numbered = records.find((record) => seasonNumberFromRecord(record) === resolved.number);
    if (numbered) return numbered;

    const targetStartDate = resolved.startsAt?.slice(0, 10);
    const dateMatched = records.find((record) => {
        const startsAt = record?.starts_at
            ?? record?.startsAt
            ?? record?.start_date
            ?? record?.startDate;
        return targetStartDate && String(startsAt || "").slice(0, 10) === targetStartDate;
    });
    if (dateMatched) return dateMatched;

    if (resolved.current) {
        return records.find((record) => record?.active === true || record?.is_active === true)
            || null;
    }
    const inactiveByStartDate = records
        .filter((record) => record?.active !== true && record?.is_active !== true)
        .map((record) => ({
            record,
            startsAt: Date.parse(
                record?.starts_at
                ?? record?.startsAt
                ?? record?.start_date
                ?? record?.startDate
                ?? ""
            )
        }))
        .filter(({ startsAt }) => Number.isFinite(startsAt))
        .sort((a, b) => b.startsAt - a.startsAt);
    if (resolved.number === 8 && inactiveByStartDate[0]) {
        return inactiveByStartDate[0].record;
    }
    return null;
}

export function faceitSeasonId(record) {
    const value = record?.season_id ?? record?.seasonId ?? record?.id;
    return value === undefined || value === null ? null : String(value);
}

function numericElo(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 100 && parsed <= 10000
        ? Math.round(parsed)
        : null;
}

export function extractSeasonElo(payload) {
    const preferredKeys = [
        "end_elo",
        "endElo",
        "final_elo",
        "finalElo",
        "season_elo",
        "seasonElo",
        "current_elo",
        "currentElo",
        "faceit_elo",
        "faceitElo"
    ];
    const blockedPathParts = /(highest|lowest|average|avg|max|min|start|before|delta|change|team|opponent|peak)/i;
    const candidates = [];
    const queue = [{ value: payload, path: "" }];
    const visited = new Set();

    while (queue.length > 0) {
        const { value, path } = queue.shift();
        if (!value || typeof value !== "object" || visited.has(value)) continue;
        visited.add(value);

        for (const [key, child] of Object.entries(value)) {
            const childPath = path ? `${path}.${key}` : key;
            const elo = numericElo(child);
            if (elo !== null && !blockedPathParts.test(childPath)) {
                const preferredIndex = preferredKeys.indexOf(key);
                if (preferredIndex >= 0) {
                    candidates.push({ elo, score: 100 - preferredIndex, path: childPath });
                } else if (/^elo$/i.test(key)) {
                    candidates.push({ elo, score: 60, path: childPath });
                }
            }
            if (child && typeof child === "object") {
                queue.push({ value: child, path: childPath });
            }
        }
    }

    candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return candidates[0]?.elo ?? null;
}

export function matchRoundsFromPayload(payload) {
    const candidates = [
        payload?.payload?.cs2?.match_rounds,
        payload?.payload?.cs2?.matchRounds,
        payload?.payload?.match_rounds,
        payload?.payload?.matchRounds,
        payload?.match_rounds,
        payload?.matchRounds,
        payload
    ];
    return candidates.find(Array.isArray) || [];
}

export function historicalEloFromMatchRounds(payload, season) {
    const resolved = typeof season === "object" && season
        ? season
        : resolveFaceitSeason(season);
    const startsAt = Date.parse(resolved.startsAt);
    const endsAt = Date.parse(resolved.endsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null;

    const rounds = matchRoundsFromPayload(payload)
        .filter((round) => {
            const timestamp = Date.parse(round?.end_time ?? round?.endTime ?? round?.start_time ?? round?.startTime);
            const matchType = String(round?.match_type ?? round?.matchType ?? "matchmaking");
            return Number.isFinite(timestamp)
                && timestamp >= startsAt
                && timestamp < endsAt
                && matchType === "matchmaking";
        })
        .sort((a, b) => {
            const aTime = Date.parse(a?.end_time ?? a?.endTime ?? a?.start_time ?? a?.startTime);
            const bTime = Date.parse(b?.end_time ?? b?.endTime ?? b?.start_time ?? b?.startTime);
            return bTime - aTime;
        });

    for (const round of rounds) {
        const before = Number(round?.elo_before ?? round?.eloBefore);
        const delta = Number(round?.elo_delta ?? round?.eloDelta ?? 0);
        if (Number.isFinite(before) && before > 0 && Number.isFinite(delta)) {
            return Math.round(before + delta);
        }
    }
    return null;
}

export function historicalEloFromPlayerStats(payload, season) {
    const resolved = typeof season === "object" && season
        ? season
        : resolveFaceitSeason(season);
    const startsAt = Date.parse(resolved.startsAt);
    const endsAt = Date.parse(resolved.endsAt);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null;

    const candidates = items.map((item) => {
        const stats = item?.stats || item || {};
        const timestamp = Number(
            stats["Match Finished At"]
            ?? stats["Match Finished"]
            ?? stats.match_finished_at
            ?? stats.finished_at
        );
        const normalizedTimestamp = Number.isFinite(timestamp)
            ? timestamp < 1e12 ? timestamp * 1000 : timestamp
            : Date.parse(
                stats["Match Finished At"]
                ?? stats["Match Finished"]
                ?? stats.match_finished_at
                ?? stats.finished_at
                ?? ""
            );
        const before = Number(
            stats["Elo Before"]
            ?? stats["ELO Before"]
            ?? stats.elo_before
            ?? stats.eloBefore
        );
        const delta = Number(
            stats["Elo Change"]
            ?? stats["ELO Change"]
            ?? stats.elo_delta
            ?? stats.eloDelta
        );
        const calculatedElo = Number.isFinite(before) && before > 0 && Number.isFinite(delta)
            ? Math.round(before + delta)
            : null;
        return {
            timestamp: normalizedTimestamp,
            elo: extractSeasonElo(stats) ?? calculatedElo
        };
    }).filter(({ timestamp, elo }) => (
        Number.isFinite(timestamp)
        && timestamp >= startsAt
        && timestamp < endsAt
        && elo !== null
    )).sort((a, b) => b.timestamp - a.timestamp);

    return candidates[0]?.elo ?? null;
}
