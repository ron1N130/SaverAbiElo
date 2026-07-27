import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import leetifyHandler from "../api/leetify-data.js";
import { buildPlayoffBracket } from "../api/uniliga-stats.js";

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
        matchesPlayed: 3,
        matchWins: 3,
        matchDraws: 0,
        matchLosses: 0,
        matchWinRate: 100,
        avgRating: 1.2,
        points: 6
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
        format: "single-elimination",
        champion: {
            id: "team-1",
            name: "AIX",
            score: 2,
            winner: true
        },
        rounds: [{
            round: "1",
            label: "Halbfinale",
            matches: [{
                matchId: "1-semi-final",
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
            round: "2",
            label: "Finale",
            matches: [{
                matchId: "1-grand-final",
                round: 2,
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

test("Leetify proxy validates and returns a no-store profile subset", async () => {
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
        assert.equal(response.body.aimRating, 84.2);
        assert.equal(response.body.profileUrl, "https://leetify.com/public/profile/76561198000000001");
    } finally {
        globalThis.fetch = originalFetch;
    }
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

test("builds the playoff bracket from FACEIT rounds and results", () => {
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
    assert.equal(
        document.getElementById("uniliga-championship-title").textContent,
        "Uniliga Liga 1 Sommerseason 2026"
    );
    assert.equal(document.getElementById("uniliga-content").hidden, false);
    assert.equal(document.getElementById("saverabi-content").hidden, true);

    document.getElementById("uniliga-phase-playoffs").click();
    await waitFor(
        () => document.querySelectorAll("#uniliga-data-area .bracket-round").length === 2,
        "Playoff bracket did not render"
    );
    assert.equal(
        document.getElementById("uniliga-championship-title").textContent,
        "Uniliga Liga 1 Playoffs"
    );
    assert.equal(document.getElementById("summary-leading-team-label").textContent, "Champion");
    assert.equal(document.getElementById("summary-leading-team").textContent, "AIX");
    assert.equal(document.querySelectorAll(".bracket-match").length, 2);
    assert.deepEqual(
        [...document.querySelectorAll(".bracket-round h3")].map((heading) => heading.textContent),
        ["Halbfinale", "Finale"]
    );

    dom.window.close();
});
