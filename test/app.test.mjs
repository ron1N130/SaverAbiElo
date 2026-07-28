import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import leetifyHandler, { createLeetifyHandler } from "../api/leetify-data.js";
import { buildGroupStandings, buildPlayoffBracket } from "../api/uniliga-stats.js";

const playerFixtures = {
    Alpha: {
        nickname: "Alpha",
        steam64Id: "76561198000000001",
        avatar: "/default_avatar.png",
        faceitUrl: "https://www.faceit.com/en/players/Alpha",
        elo: 2600,
        level: 10,
        calculatedRating: 1.28,
        dpr: 0.65,
        kast: 76.4,
        kd: 1.42,
        adr: 88.5,
        kpr: 0.82,
        hsPercent: 48.2,
        impact: 1.62,
        matchesConsidered: 15,
        lastUpdated: "2026-07-27T08:00:00.000Z"
    },
    Bravo: {
        nickname: "Bravo",
        steam64Id: "76561198000000002",
        avatar: "/default_avatar.png",
        faceitUrl: "https://www.faceit.com/en/players/Bravo",
        elo: 2200,
        level: 10,
        calculatedRating: 1.12,
        dpr: 0.7,
        kast: 70,
        kd: 1.1,
        adr: 79,
        kpr: 0.71,
        hsPercent: 42,
        impact: 1.48,
        matchesConsidered: 15,
        lastUpdated: "2026-07-27T08:00:00.000Z"
    },
    Charlie: {
        nickname: "Charlie",
        steam64Id: "76561198000000003",
        avatar: "/default_avatar.png",
        faceitUrl: "https://www.faceit.com/en/players/Charlie",
        elo: 1800,
        level: 9,
        calculatedRating: 1.02,
        dpr: 0.75,
        kast: 64,
        kd: 0.98,
        adr: 70,
        kpr: 0.61,
        hsPercent: 38,
        impact: 1.35,
        matchesConsidered: 15,
        lastUpdated: "2026-07-27T08:00:00.000Z"
    }
};

const leetifyFixture = {
    available: true,
    name: "Alpha",
    steam64Id: "76561198000000001",
    profileUrl: "https://leetify.com/public/profile/76561198000000001",
    totalMatches: 240,
    winRate: 0.61,
    leetifyRating: 2.12,
    aimRating: 84.2,
    positioningRating: 68.4,
    utilityRating: 72.8,
    timeToDamage: 486,
    crosshairPlacement: 7.4,
    counterStrafing: 86.3,
    sprayAccuracy: 41.7
};

const uniligaGroupsFixture = {
    lastUpdated: "2026-07-27T08:00:00.000Z",
    phase: "groups",
    championshipId: "group-stage-id",
    championshipName: "Uniliga Liga 1 Sommerseason 2026",
    teams: [{
        id: "team-1",
        name: "AIX",
        standingPosition: 1,
        matchesPlayed: 3,
        matchWins: 3,
        matchDraws: 0,
        matchLosses: 0,
        matchWinRate: 100,
        avgRating: 1.2,
        points: 9
    }],
    players: [{
        nickname: "Alpha",
        avatar: "/default_avatar.png",
        matchesPlayed: 6,
        rating: 1.5,
        impact: 1.9,
        adr: 102,
        kast: 80,
        winRate: 75
    }],
    bracket: null
};

const uniligaPlayoffsFixture = {
    lastUpdated: "2026-07-27T09:00:00.000Z",
    phase: "playoffs",
    championshipId: "4ee001a9-f6f3-4936-916b-798d3171cca8",
    championshipName: "Uniliga Liga 1 Playoffs",
    teams: [{
        id: "team-1",
        name: "AIX",
        matchesPlayed: 2,
        matchWins: 2,
        matchDraws: 0,
        matchLosses: 0,
        mapWins: 4,
        mapLosses: 1,
        avgRating: 1.3,
        points: 2
    }, {
        id: "team-2",
        name: "MUC",
        matchesPlayed: 2,
        matchWins: 1,
        matchDraws: 0,
        matchLosses: 1,
        mapWins: 3,
        mapLosses: 3,
        avgRating: 1.1,
        points: 1
    }],
    players: [{
        nickname: "Alpha",
        avatar: "/default_avatar.png",
        matchesPlayed: 4,
        rating: 1.52,
        impact: 1.92,
        adr: 103,
        kast: 81,
        winRate: 100
    }],
    bracket: {
        format: "double-elimination",
        champion: {
            id: "team-1",
            name: "AIX",
            score: 2,
            winner: true
        },
        rounds: [{
            round: "1",
            label: "Upper Finale",
            matches: [{
                matchId: "1-upper-final",
                round: 1,
                status: "FINISHED",
                bestOf: 3,
                scheduledAt: "2026-07-20T18:00:00.000Z",
                teams: [
                    { id: "team-1", name: "AIX", score: 2, winner: true },
                    { id: "team-3", name: "OSGG", score: 0, winner: false }
                ],
                winnerId: "team-1"
            }]
        }, {
            round: "1",
            label: "Lower Finale",
            matches: [{
                matchId: "1-lower-final",
                round: 1,
                status: "FINISHED",
                bestOf: 3,
                scheduledAt: "2026-07-23T18:00:00.000Z",
                teams: [
                    { id: "team-2", name: "MUC", score: 2, winner: true },
                    { id: "team-3", name: "OSGG", score: 0, winner: false }
                ],
                winnerId: "team-2"
            }]
        }, {
            round: "1",
            label: "Grand Final",
            matches: [{
                matchId: "1-grand-final",
                round: 1,
                status: "FINISHED",
                bestOf: 3,
                scheduledAt: "2026-07-26T18:00:00.000Z",
                teams: [
                    { id: "team-1", name: "AIX", score: 2, winner: true },
                    { id: "team-2", name: "MUC", score: 1, winner: false }
                ],
                winnerId: "team-1"
            }]
        }],
        stages: [{
            key: "upper",
            label: "Upper Bracket",
            group: "1",
            rounds: [{
                round: "1",
                label: "Upper Finale",
                matches: [{
                    matchId: "1-upper-final",
                    round: 1,
                    status: "FINISHED",
                    bestOf: 3,
                    scheduledAt: "2026-07-20T18:00:00.000Z",
                    teams: [
                        { id: "team-1", name: "AIX", score: 2, winner: true },
                        { id: "team-3", name: "OSGG", score: 0, winner: false }
                    ],
                    winnerId: "team-1"
                }]
            }]
        }, {
            key: "lower",
            label: "Lower Bracket",
            group: "2",
            rounds: [{
                round: "1",
                label: "Lower Finale",
                matches: [{
                    matchId: "1-lower-final",
                    round: 1,
                    status: "FINISHED",
                    bestOf: 3,
                    scheduledAt: "2026-07-23T18:00:00.000Z",
                    teams: [
                        { id: "team-2", name: "MUC", score: 2, winner: true },
                        { id: "team-3", name: "OSGG", score: 0, winner: false }
                    ],
                    winnerId: "team-2"
                }]
            }]
        }, {
            key: "grand-final",
            label: "Grand Final",
            group: "3",
            rounds: [{
                round: "1",
                label: "Grand Final",
                matches: [{
                    matchId: "1-grand-final",
                    round: 1,
                    status: "FINISHED",
                    bestOf: 3,
                    scheduledAt: "2026-07-26T18:00:00.000Z",
                    teams: [
                        { id: "team-1", name: "AIX", score: 2, winner: true },
                        { id: "team-2", name: "MUC", score: 1, winner: false }
                    ],
                    winnerId: "team-1"
                }]
            }]
        }]
    }
};

function jsonResponse(data) {
    return {
        ok: true,
        status: 200,
        json: async () => structuredClone(data)
    };
}

function mockVercelResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return body;
        }
    };
}

async function waitFor(predicate, message) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(message);
}

test("Leetify proxy validates and returns a Redis-cacheable no-store profile subset", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            name: "Alpha",
            privacy_mode: "public",
            total_matches: 240,
            winrate: 0.61,
            ranks: { leetify: 2.12 },
            rating: {
                aim: 84.2,
                positioning: 68.4,
                utility: 72.8
            },
            stats: {
                reaction_time_ms: 486,
                preaim: 7.4,
                counter_strafing_good_shots_ratio: 86.3,
                spray_accuracy: 41.7
            }
        })
    });

    try {
        const response = mockVercelResponse();
        await leetifyHandler({
            method: "GET",
            query: { steam64_id: "76561198000000001" }
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(response.headers["x-leetify-cache"], "MISS");
        assert.equal(response.body.aimRating, 84.2);
        assert.equal(response.body.profileUrl, "https://leetify.com/public/profile/76561198000000001");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Leetify Redis cache prevents repeated upstream profile requests", async () => {
    let storedProfile = null;
    let fetchCalls = 0;
    const handler = createLeetifyHandler({
        cacheReader: async () => storedProfile,
        cacheWriter: async (_key, value) => {
            storedProfile = value;
        },
        fetchImpl: async () => {
            fetchCalls += 1;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    name: "Alpha",
                    ranks: { leetify: 2.12 }
                })
            };
        },
        now: () => Date.parse("2026-07-28T08:00:00.000Z")
    });

    const request = {
        method: "GET",
        query: { steam64_id: "76561198000000001" }
    };
    const firstResponse = mockVercelResponse();
    const secondResponse = mockVercelResponse();

    await handler(request, firstResponse);
    await handler(request, secondResponse);

    assert.equal(fetchCalls, 1);
    assert.equal(firstResponse.headers["x-leetify-cache"], "MISS");
    assert.equal(secondResponse.headers["x-leetify-cache"], "HIT");
    assert.equal(secondResponse.body.leetifyRating, 2.12);
});

test("Leetify serves stale Redis data when the upstream rate limit is reached", async () => {
    const staleProfile = {
        version: 1,
        freshUntil: Date.parse("2026-07-27T08:00:00.000Z"),
        data: {
            available: true,
            steam64Id: "76561198000000001",
            leetifyRating: 1.42
        }
    };
    const handler = createLeetifyHandler({
        cacheReader: async () => staleProfile,
        cacheWriter: async () => {},
        fetchImpl: async () => ({
            ok: false,
            status: 429,
            json: async () => ({})
        }),
        now: () => Date.parse("2026-07-28T08:00:00.000Z")
    });
    const response = mockVercelResponse();

    await handler({
        method: "GET",
        query: { steam64_id: "76561198000000001" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-leetify-cache"], "STALE");
    assert.equal(response.body.leetifyRating, 1.42);
});

test("uses the requested Uniliga championship and SaverAbi roster", async () => {
    const [uniligaSource, playersSource] = await Promise.all([
        readFile(new URL("../api/uniliga-stats.js", import.meta.url), "utf8"),
        readFile(new URL("../players.json", import.meta.url), "utf8")
    ]);
    const players = JSON.parse(playersSource);

    assert.match(uniligaSource, /0a49e9c4-808c-4172-bfcb-997c5982770e/);
    assert.match(uniligaSource, /4ee001a9-f6f3-4936-916b-798d3171cca8/);
    assert.match(uniligaSource, /Uniliga Liga 1 Sommerseason 2026/);
    assert.equal(players.includes("s3sh"), true);
    assert.equal(players.includes("2911-"), true);
    assert.equal(players.includes("a5u"), false);
});

test("builds a single-elimination bracket from FACEIT rounds and results", () => {
    const bracket = buildPlayoffBracket([{
        match_id: "1-semi-a",
        round: 1,
        status: "FINISHED",
        best_of: 3,
        scheduled_at: "2026-07-20T18:00:00.000Z",
        teams: {
            faction1: { faction_id: "team-a", name: "AIX" },
            faction2: { faction_id: "team-b", name: "MUC" }
        },
        results: {
            winner: "faction1",
            score: { faction1: 2, faction2: 0 }
        }
    }, {
        match_id: "1-final",
        round: 2,
        status: "FINISHED",
        best_of: 3,
        scheduled_at: "2026-07-26T18:00:00.000Z",
        teams: {
            faction1: { faction_id: "team-a", name: "AIX" },
            faction2: { faction_id: "team-c", name: "OSGG" }
        },
        results: {
            winner: "faction1",
            score: { faction1: 2, faction2: 1 }
        }
    }]);

    assert.deepEqual(bracket.rounds.map((round) => round.label), ["Halbfinale", "Finale"]);
    assert.equal(bracket.rounds[0].matches[0].teams[0].winner, true);
    assert.equal(bracket.champion.name, "AIX");
});

test("separates FACEIT upper, lower, and grand-final groups", () => {
    const createMatch = ({
        id,
        group,
        round,
        faction1,
        faction2,
        score1,
        score2,
        finishedAt
    }) => ({
        match_id: id,
        group,
        round,
        status: "FINISHED",
        best_of: group === 3 ? 5 : 3,
        finished_at: finishedAt,
        teams: {
            faction1: { faction_id: faction1.toLowerCase(), name: faction1 },
            faction2: { faction_id: faction2.toLowerCase(), name: faction2 }
        },
        results: {
            winner: score1 > score2 ? "faction1" : "faction2",
            score: { faction1: score1, faction2: score2 }
        }
    });
    const bracket = buildPlayoffBracket([
        createMatch({
            id: "1-upper-final",
            group: 1,
            round: 3,
            faction1: "AIX",
            faction2: "ECO",
            score1: 2,
            score2: 0,
            finishedAt: 1783017924
        }),
        createMatch({
            id: "1-lower-final",
            group: 2,
            round: 4,
            faction1: "RUB",
            faction2: "ECO",
            score1: 1,
            score2: 2,
            finishedAt: 1784233008
        }),
        createMatch({
            id: "1-grand-final",
            group: 3,
            round: 1,
            faction1: "ECO",
            faction2: "AIX",
            score1: 1,
            score2: 3,
            finishedAt: 1784836583
        })
    ]);

    assert.equal(bracket.format, "double-elimination");
    assert.deepEqual(
        bracket.stages.map((stage) => stage.label),
        ["Upper Bracket", "Lower Bracket", "Grand Final"]
    );
    assert.deepEqual(
        bracket.stages.map((stage) => stage.rounds[0].label),
        ["Upper Finale", "Lower Finale", "Grand Final"]
    );
    assert.equal(bracket.champion.name, "AIX");
    assert.match(bracket.stages[2].rounds[0].matches[0].finishedAt, /^2026-/);
});

test("orders the double-elimination bracket by its real match paths", () => {
    const createMatch = ({
        id,
        group,
        round,
        firstId,
        firstName,
        secondId,
        secondName,
        firstScore,
        secondScore,
        bestOf = 3,
        finishedAt
    }) => ({
        match_id: id,
        group,
        round,
        status: "FINISHED",
        best_of: bestOf,
        finished_at: finishedAt,
        teams: {
            faction1: { faction_id: firstId, name: firstName },
            faction2: { faction_id: secondId, name: secondName }
        },
        results: {
            winner: firstScore > secondScore ? "faction1" : "faction2",
            score: { faction1: firstScore, faction2: secondScore }
        }
    });
    const data = [
        createMatch({
            id: "ub-2",
            group: 1,
            round: 1,
            firstId: "dg",
            firstName: "DG One",
            secondId: "ued",
            secondName: "UED Wolves",
            firstScore: 2,
            secondScore: 0,
            finishedAt: 20
        }),
        createMatch({
            id: "ub-4",
            group: 1,
            round: 1,
            firstId: "muc",
            firstName: "MUC University",
            secondId: "rub",
            secondName: "RUB Serpents S",
            firstScore: 2,
            secondScore: 0,
            finishedAt: 21
        }),
        createMatch({
            id: "ub-3",
            group: 1,
            round: 1,
            firstId: "bye",
            firstName: "Bye",
            secondId: "aix",
            secondName: "AIX",
            firstScore: 0,
            secondScore: 1,
            finishedAt: 19
        }),
        createMatch({
            id: "ub-1",
            group: 1,
            round: 1,
            firstId: "bye",
            firstName: "Bye",
            secondId: "eco",
            secondName: "eSports Cologne",
            firstScore: 0,
            secondScore: 1,
            finishedAt: 18
        }),
        createMatch({
            id: "ub-5",
            group: 1,
            round: 2,
            firstId: "dg",
            firstName: "DG One",
            secondId: "eco",
            secondName: "eSports Cologne",
            firstScore: 0,
            secondScore: 2,
            finishedAt: 30
        }),
        createMatch({
            id: "ub-6",
            group: 1,
            round: 2,
            firstId: "aix",
            firstName: "AIX",
            secondId: "muc",
            secondName: "MUC University",
            firstScore: 2,
            secondScore: 0,
            finishedAt: 31
        }),
        createMatch({
            id: "ub-7",
            group: 1,
            round: 3,
            firstId: "eco",
            firstName: "eSports Cologne",
            secondId: "aix",
            secondName: "AIX",
            firstScore: 0,
            secondScore: 2,
            finishedAt: 40
        }),
        createMatch({
            id: "lb-1",
            group: 2,
            round: 1,
            firstId: "ued",
            firstName: "UED Wolves",
            secondId: "bye",
            secondName: "Bye",
            firstScore: 1,
            secondScore: 0,
            finishedAt: 22
        }),
        createMatch({
            id: "lb-2",
            group: 2,
            round: 1,
            firstId: "rub",
            firstName: "RUB Serpents S",
            secondId: "bye",
            secondName: "Bye",
            firstScore: 1,
            secondScore: 0,
            finishedAt: 23
        }),
        createMatch({
            id: "lb-3",
            group: 2,
            round: 2,
            firstId: "ued",
            firstName: "UED Wolves",
            secondId: "muc",
            secondName: "MUC University",
            firstScore: 2,
            secondScore: 1,
            finishedAt: 32
        }),
        createMatch({
            id: "lb-4",
            group: 2,
            round: 2,
            firstId: "dg",
            firstName: "DG One",
            secondId: "rub",
            secondName: "RUB Serpents S",
            firstScore: 0,
            secondScore: 2,
            finishedAt: 33
        }),
        createMatch({
            id: "lb-5",
            group: 2,
            round: 3,
            firstId: "rub",
            firstName: "RUB Serpents S",
            secondId: "ued",
            secondName: "UED Wolves",
            firstScore: 2,
            secondScore: 0,
            finishedAt: 41
        }),
        createMatch({
            id: "lb-6",
            group: 2,
            round: 4,
            firstId: "rub",
            firstName: "RUB Serpents S",
            secondId: "eco",
            secondName: "eSports Cologne",
            firstScore: 1,
            secondScore: 2,
            finishedAt: 50
        }),
        createMatch({
            id: "final-1",
            group: 3,
            round: 1,
            firstId: "aix",
            firstName: "AIX",
            secondId: "eco",
            secondName: "eSports Cologne",
            firstScore: 3,
            secondScore: 1,
            bestOf: 5,
            finishedAt: 60
        })
    ];
    const bracket = buildPlayoffBracket(data);
    const [upper, lower, grandFinal] = bracket.stages;
    const teamNames = (match) => match.teams.map((team) => team.name);

    assert.deepEqual(
        upper.rounds[0].matches.map(teamNames),
        [
            ["eSports Cologne", "Bye"],
            ["DG One", "UED Wolves"],
            ["AIX", "Bye"],
            ["MUC University", "RUB Serpents S"]
        ]
    );
    assert.deepEqual(
        upper.rounds[1].matches.map(teamNames),
        [
            ["eSports Cologne", "DG One"],
            ["AIX", "MUC University"]
        ]
    );
    assert.deepEqual(
        lower.rounds.map((round) => round.matches.map(teamNames)),
        [
            [["Bye", "UED Wolves"], ["Bye", "RUB Serpents S"]],
            [["MUC University", "UED Wolves"], ["DG One", "RUB Serpents S"]],
            [["UED Wolves", "RUB Serpents S"]],
            [["eSports Cologne", "RUB Serpents S"]]
        ]
    );
    assert.equal(grandFinal.rounds[0].matches[0].bestOf, 5);
    assert.deepEqual(teamNames(grandFinal.rounds[0].matches[0]), ["AIX", "eSports Cologne"]);
});

test("uses official FACEIT group positions and three points per win", () => {
    const matches = [{
        match_id: "group-1",
        status: "FINISHED",
        teams: {
            faction1: { faction_id: "eco", name: "eSports Cologne" },
            faction2: { faction_id: "muc", name: "MUC University" }
        },
        results: {
            winner: "faction1",
            score: { faction1: 1, faction2: 0 }
        }
    }];
    const ranking = {
        items: [{
            position: 1,
            played: 9,
            won: 8,
            lost: 1,
            draw: 0,
            points: 24,
            win_rate: 88.9,
            team: { team_id: "eco", name: "eSports Cologne" }
        }, {
            position: 2,
            played: 9,
            won: 7,
            lost: 2,
            draw: 0,
            points: 21,
            win_rate: 77.8,
            team: { team_id: "muc", name: "MUC University" }
        }]
    };
    const standings = buildGroupStandings(matches, ranking);

    assert.deepEqual(
        standings.map((team) => ({
            position: team.standingPosition,
            name: team.name,
            played: team.matchesPlayed,
            won: team.matchWins,
            lost: team.matchLosses,
            points: team.points
        })),
        [{
            position: 1,
            name: "eSports Cologne",
            played: 9,
            won: 8,
            lost: 1,
            points: 24
        }, {
            position: 2,
            name: "MUC University",
            played: 9,
            won: 7,
            lost: 2,
            points: 21
        }]
    );

    const fallback = buildGroupStandings(matches);
    assert.equal(fallback[0].points, 3);
});

test("keeps FACEIT's published order for teams with identical records", () => {
    const bielefeldId = "6cc2b819-9873-4c01-899e-f0c15c5369f2";
    const dgId = "a1714e75-33cb-4b9f-8ee8-d4ecb12d1d0d";
    const rubId = "21db7105-6917-4659-841c-1346457ecae7";
    const match = (id, winnerId, loserId, winnerName, loserName) => ({
        match_id: id,
        status: "FINISHED",
        teams: {
            faction1: { faction_id: winnerId, name: winnerName },
            faction2: { faction_id: loserId, name: loserName }
        },
        results: {
            winner: "faction1",
            score: { faction1: 1, faction2: 0 }
        }
    });
    const matches = [
        match("tie-1", bielefeldId, dgId, "Bielefeld Alliance", "DG One"),
        match("tie-2", bielefeldId, rubId, "Bielefeld Alliance", "RUB Serpents S"),
        match("tie-3", rubId, dgId, "RUB Serpents S", "DG One")
    ];
    const ranking = {
        items: [
            { team: { team_id: bielefeldId }, played: 9, won: 4, lost: 5, points: 12 },
            { team: { team_id: dgId }, played: 9, won: 4, lost: 5, points: 12 },
            { team: { team_id: rubId }, played: 9, won: 4, lost: 5, points: 12 }
        ]
    };

    assert.deepEqual(
        buildGroupStandings(matches, ranking).map((team) => team.name),
        ["Bielefeld Alliance", "DG One", "RUB Serpents S"]
    );
});

test("renders the leaderboard, filters players, and switches to Uniliga", async () => {
    const [html, script] = await Promise.all([
        readFile(new URL("../index.html", import.meta.url), "utf8"),
        readFile(new URL("../script.js", import.meta.url), "utf8")
    ]);
    const documentSource = html.replace(
        '<script src="/script.js" defer></script>',
        () => `<script>${script.replaceAll("</script>", "<\\/script>")}</script>`
    );

    const dom = new JSDOM(documentSource, {
        url: "https://saverabi.test/#saverabi",
        runScripts: "dangerously",
        pretendToBeVisual: true,
        beforeParse(window) {
            window.fetch = async (input) => {
                const url = new URL(String(input), "https://saverabi.test/");
                if (url.pathname === "/players.json") {
                    return jsonResponse(Object.keys(playerFixtures));
                }
                if (url.pathname === "/api/faceit-data") {
                    return jsonResponse(playerFixtures[url.searchParams.get("nickname")]);
                }
                if (url.pathname === "/api/leetify-data") {
                    return jsonResponse(leetifyFixture);
                }
                if (url.pathname === "/uniliga_teams.json") {
                    return jsonResponse([
                        { name: "AIX", icon: "aix.png" },
                        { name: "MUC", icon: "muc.png" },
                        { name: "OSGG", icon: "osgg.png" }
                    ]);
                }
                if (url.pathname === "/api/uniliga-stats") {
                    return jsonResponse(
                        url.searchParams.get("phase") === "playoffs"
                            ? uniligaPlayoffsFixture
                            : uniligaGroupsFixture
                    );
                }
                return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
            };
        }
    });

    const { document } = dom.window;
    await waitFor(
        () => document.querySelectorAll(".player-row[data-nickname]").length === 3,
        "Leaderboard rows did not render"
    );

    assert.equal(document.getElementById("summary-player-count").textContent, "3");
    assert.equal(document.getElementById("summary-leader").textContent, "Alpha");
    assert.match(document.querySelector(".profile-title h2").textContent, /Alpha/);
    await waitFor(
        () => document.querySelectorAll(".leetify-metric").length === 8,
        "Leetify metrics did not render"
    );
    assert.match(
        document.querySelector(".leetify-profile-link").getAttribute("href"),
        /leetify\.com/
    );

    const tierCases = [
        [0.9, "bad", "Schlecht"],
        [0.91, "okay", "Solide"],
        [1.1, "okay", "Solide"],
        [1.11, "good", "Stark"],
        [1.25, "good", "Stark"],
        [1.26, "great", "Elite"]
    ];
    for (const stat of ["rating", "impact"]) {
        for (const [value, key, label] of tierCases) {
            const metric = dom.window.metricState(stat, value);
            assert.equal(metric.key, key, `${stat} ${value} should be ${key}`);
            assert.equal(metric.label, label, `${stat} ${value} should be ${label}`);
        }
    }

    const search = document.getElementById("player-search");
    search.value = "Bravo";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(document.querySelectorAll(".player-row[data-nickname]").length, 1);
    assert.equal(document.querySelector(".player-name").textContent, "Bravo");

    document.getElementById("btn-toggle-uniliga").click();
    await waitFor(
        () => document.querySelectorAll("#uniliga-data-area .stats-table").length === 2,
        "Uniliga tables did not render"
    );

    assert.equal(document.getElementById("summary-team-count").textContent, "1");
    assert.equal(document.getElementById("summary-leading-team").textContent, "AIX");
    assert.equal(document.getElementById("summary-leading-team-points").textContent, "9 Punkte");
    assert.match(document.getElementById("uniliga-phase-description").textContent, /3 Punkte/);
    assert.equal(
        document.getElementById("uniliga-championship-title").textContent,
        "Uniliga Liga 1 Sommerseason 2026"
    );
    assert.equal(document.getElementById("uniliga-content").hidden, false);
    assert.equal(document.getElementById("saverabi-content").hidden, true);

    document.getElementById("uniliga-phase-playoffs").click();
    await waitFor(
        () => document.querySelectorAll("#uniliga-data-area .bracket-round").length === 3,
        "Playoff bracket did not render"
    );
    assert.equal(
        document.getElementById("uniliga-championship-title").textContent,
        "Uniliga Liga 1 Playoffs"
    );
    assert.equal(document.getElementById("summary-leading-team-label").textContent, "Champion");
    assert.equal(document.getElementById("summary-leading-team").textContent, "AIX");
    assert.equal(document.querySelectorAll(".bracket-match").length, 3);
    assert.deepEqual(
        [...document.querySelectorAll(".bracket-stage-header h3")].map((heading) => heading.textContent),
        ["Upper Bracket", "Lower Bracket", "Grand Final"]
    );
    assert.deepEqual(
        [...document.querySelectorAll(".bracket-round h4")].map((heading) => heading.textContent),
        ["Upper Finale", "Lower Finale", "Grand Final"]
    );

    dom.window.close();
});
