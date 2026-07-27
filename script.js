const thresholds = {
    rating: {
        okay: 0.91,
        good: 1.11,
        great: 1.25,
        max: 1.8,
        precision: 2,
        greatExclusive: true,
        badLabel: "Schlecht"
    },
    dpr: { okay: 0.7, good: 0.63, great: 0.55, max: 0.95, lowerIsBetter: true },
    kast: { okay: 66, good: 75, great: 80, max: 100 },
    impact: {
        okay: 0.91,
        good: 1.11,
        great: 1.25,
        max: 2,
        precision: 2,
        greatExclusive: true,
        badLabel: "Schlecht"
    },
    adr: { okay: 70, good: 85, great: 90, max: 125 },
    kpr: { okay: 0.6, good: 0.8, great: 0.9, max: 1.25 },
    winRate: { okay: 50, good: 60, great: 70 }
};

const clubs = {
    "Royal Madrid": "royal_madrid.png",
    "Bastard München": "bastard_munchen.png",
    PXG: "pxg.png",
    Ubers: "ubers.png",
    Barcha: "barcha.png",
    "Manshine City": "manshine.png"
};

const cacheKeys = {
    players: "saverabi:players:v3"
};
const UNILIGA_API_SCHEMA_VERSION = 19;

const state = {
    players: [],
    sortMode: "elo",
    search: "",
    selectedNickname: null,
    saverAbiLoaded: false,
    saverAbiLoading: false,
    loadedPlayers: 0,
    totalPlayers: 0,
    uniligaData: {
        groups: null,
        playoffs: null
    },
    uniligaPhase: "groups",
    uniligaLoading: new Set(),
    teamIconMap: {},
    leetifyProfiles: new Map(),
    leetifyLoading: new Set(),
    leetifyErrors: new Map()
};

const dom = {};
const number = new Intl.NumberFormat("de-DE");
const compactNumber = new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
});

function cacheDom() {
    dom.views = [...document.querySelectorAll(".view-content")];
    dom.tabs = [...document.querySelectorAll(".nav-tab")];
    dom.playerList = document.getElementById("player-list");
    dom.playerSearch = document.getElementById("player-search");
    dom.playerDetail = document.getElementById("player-detail-card-container");
    dom.playerLoading = document.getElementById("loading-indicator-saverabi");
    dom.playerError = document.getElementById("error-message-saverabi");
    dom.playerProgress = document.getElementById("player-load-progress");
    dom.saverUpdated = document.getElementById("saverabi-updated");
    dom.sortElo = document.getElementById("sort-elo-btn");
    dom.sortWorth = document.getElementById("sort-worth-btn");
    dom.uniligaLoading = document.getElementById("loading-indicator-uniliga");
    dom.uniligaError = document.getElementById("error-message-uniliga");
    dom.uniligaArea = document.getElementById("uniliga-data-area");
    dom.uniligaUpdated = document.getElementById("uniliga-updated");
    dom.uniligaChampionshipTitle = document.getElementById("uniliga-championship-title");
    dom.uniligaHeroCopy = document.getElementById("uniliga-hero-copy");
    dom.uniligaPhaseButtons = [...document.querySelectorAll(".uniliga-phase-button")];
    dom.uniligaPhaseDescription = document.getElementById("uniliga-phase-description");

    dom.summaryPlayerCount = document.getElementById("summary-player-count");
    dom.summaryAverageElo = document.getElementById("summary-average-elo");
    dom.summaryLeader = document.getElementById("summary-leader");
    dom.summaryLeaderElo = document.getElementById("summary-leader-elo");
    dom.summaryEliteCount = document.getElementById("summary-elite-count");

    dom.summaryTeamCount = document.getElementById("summary-team-count");
    dom.summaryUniligaPlayerCount = document.getElementById("summary-uniliga-player-count");
    dom.summaryLeadingTeam = document.getElementById("summary-leading-team");
    dom.summaryLeadingTeamLabel = document.getElementById("summary-leading-team-label");
    dom.summaryLeadingTeamPoints = document.getElementById("summary-leading-team-points");
    dom.summaryTopRating = document.getElementById("summary-top-rating");
    dom.summaryTopPlayer = document.getElementById("summary-top-player");
}

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function safeUrl(value, fallback) {
    try {
        const url = new URL(value, window.location.origin);
        if (url.protocol === "http:" || url.protocol === "https:") {
            return url.href;
        }
    } catch {
        // Fall through to the trusted local fallback.
    }
    return fallback;
}

function safeFixed(value, digits = 2, suffix = "") {
    const parsed = toNumber(value);
    return parsed === null ? "—" : `${parsed.toFixed(digits)}${suffix}`;
}

function formatWorth(value) {
    const parsed = toNumber(value);
    return parsed === null ? "—" : `${compactNumber.format(parsed / 1000)} Mio. $`;
}

function formatSigned(value, digits = 2) {
    const parsed = toNumber(value);
    if (parsed === null) return "—";
    return `${parsed > 0 ? "+" : ""}${parsed.toFixed(digits)}`;
}

function formatDate(value) {
    if (!value) return null;
    const isNumericTimestamp =
        typeof value === "number"
        || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()));
    const numericTimestamp = isNumericTimestamp ? Number(value) : null;
    const normalizedValue = Number.isFinite(numericTimestamp)
        && Math.abs(numericTimestamp) < 1e12
        ? numericTimestamp * 1000
        : value;
    const date = new Date(normalizedValue);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function setStatus(element, text, status = "loading") {
    if (!element) return;
    const icon = element.querySelector(".sync-icon");
    element.classList.toggle("is-ready", status === "ready");
    element.classList.toggle("is-error", status === "error");
    element.replaceChildren(icon, document.createTextNode(text));
}

function calculateWorth(player) {
    const elo = toNumber(player.sortElo);
    const rating = toNumber(player.rating);
    const impact = toNumber(player.impact);
    if (elo === null || rating === null || impact === null) return null;

    const bonusThreshold = 2000;
    const weightedElo = elo + (
        elo > bonusThreshold
            ? Math.pow(elo - bonusThreshold, 1.8) * 0.05
            : 0
    );
    return Math.max(0, weightedElo * rating * (impact - 0.2));
}

function normalizePlayer(data, fallbackNickname) {
    if (!data || data.error) {
        return {
            nickname: data?.nickname || fallbackNickname,
            error: data?.error || "Spielerdaten nicht verfügbar",
            sortElo: -1,
            worth: null
        };
    }

    const player = {
        ...data,
        nickname: data.nickname || fallbackNickname,
        sortElo: toNumber(data.elo) ?? toNumber(data.sortElo) ?? -1,
        rating: toNumber(data.calculatedRating ?? data.rating),
        dpr: toNumber(data.dpr),
        kast: toNumber(data.kast),
        kd: toNumber(data.kd),
        adr: toNumber(data.adr),
        kpr: toNumber(data.kpr),
        hsp: toNumber(data.hsPercent ?? data.hsp),
        impact: toNumber(data.impact),
        matchesConsidered: toNumber(data.matchesConsidered) ?? 0
    };

    player.worth = calculateWorth(player);
    return player;
}

async function getPlayerData(nickname) {
    try {
        const response = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`, {
            headers: { Accept: "application/json" }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
        }
        return normalizePlayer(data, nickname);
    } catch (error) {
        return normalizePlayer({
            nickname,
            error: error.message || "Netzwerkfehler"
        }, nickname);
    }
}

function hashString(value) {
    let hash = 0;
    for (const character of value) {
        hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    }
    return Math.abs(hash);
}

function clubForPlayer(player, rank) {
    if (rank === 1) return ["Royal Madrid", clubs["Royal Madrid"]];
    if (rank <= 4) {
        const names = ["Royal Madrid", "Bastard München"];
        const name = names[hashString(player.nickname) % names.length];
        return [name, clubs[name]];
    }
    if (rank <= 12) {
        const names = ["PXG", "Ubers", "Barcha", "Manshine City"];
        const name = names[hashString(player.nickname) % names.length];
        return [name, clubs[name]];
    }
    return null;
}

function rankedPlayers() {
    const sorted = [...state.players].sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;

        const aValue = state.sortMode === "worth" ? a.worth : a.sortElo;
        const bValue = state.sortMode === "worth" ? b.worth : b.sortElo;
        return (bValue ?? -Infinity) - (aValue ?? -Infinity);
    });

    return sorted.map((player, index) => ({
        player,
        rank: index + 1
    }));
}

function eloProgress(elo) {
    const value = toNumber(elo) ?? 0;
    return clamp(((value - 800) / (3600 - 800)) * 100, 4, 100);
}

function renderSkeletonRows(count = 7) {
    dom.playerList.className = "player-list skeleton-list";
    dom.playerList.innerHTML = Array.from({ length: count }, () => `
        <li class="skeleton-row" aria-hidden="true">
            <span class="skeleton skeleton-rank"></span>
            <span class="skeleton skeleton-avatar"></span>
            <span class="skeleton skeleton-copy"></span>
            <span class="skeleton skeleton-value"></span>
        </li>
    `).join("");
}

function renderPlayerList() {
    const query = state.search.trim().toLocaleLowerCase("de-DE");
    const rows = rankedPlayers().filter(({ player }) => (
        !query || player.nickname.toLocaleLowerCase("de-DE").includes(query)
    ));

    dom.playerList.className = "player-list";

    if (rows.length === 0) {
        dom.playerList.innerHTML = `
            <li class="empty-list">
                ${state.players.length === 0 ? "Noch keine Daten geladen." : "Kein Spieler gefunden."}
            </li>
        `;
        return;
    }

    dom.playerList.innerHTML = rows.map(({ player, rank }) => {
        const nickname = escapeHtml(player.nickname);
        const avatar = escapeHtml(safeUrl(player.avatar, "/default_avatar.png"));
        const isSelected = player.nickname === state.selectedNickname;

        if (player.error) {
            return `
                <li class="player-list-item">
                    <div class="player-row is-error" aria-label="${nickname}: Daten nicht verfügbar">
                        <span class="rank">${rank}</span>
                        <span class="player-identity">
                            <span class="avatar-wrap">
                                <img src="/default_avatar.png" class="avatar" alt="">
                            </span>
                            <span class="player-copy">
                                <span class="player-name">${nickname}</span>
                                <span class="player-subline">Daten nicht verfügbar</span>
                            </span>
                        </span>
                        <span class="error-pill">Fehler</span>
                    </div>
                </li>
            `;
        }

        const club = state.sortMode === "worth" ? clubForPlayer(player, rank) : null;
        const clubIcon = club
            ? `<img src="/icons/${escapeHtml(club[1])}" class="club-icon" alt="${escapeHtml(club[0])}">`
            : "";
        const displayValue = state.sortMode === "worth"
            ? formatWorth(player.worth)
            : number.format(player.sortElo);
        const subline = [
            player.level ? `Level ${escapeHtml(player.level)}` : null,
            player.matchesConsidered ? `${number.format(player.matchesConsidered)} Matches` : null
        ].filter(Boolean).join(" · ") || "Aktuelle FACEIT-Daten";

        return `
            <li class="player-list-item">
                <button
                    class="player-row${isSelected ? " is-selected" : ""}"
                    type="button"
                    data-nickname="${nickname}"
                    aria-current="${isSelected ? "true" : "false"}"
                >
                    <span class="rank${rank <= 3 ? " rank-top" : ""}">${rank}</span>
                    <span class="player-identity">
                        <span class="avatar-wrap">
                            <img src="${avatar}" class="avatar" alt="" loading="lazy" onerror="this.src='/default_avatar.png'">
                            ${clubIcon}
                        </span>
                        <span class="player-copy">
                            <span class="player-name">${nickname}</span>
                            <span class="player-subline">${subline}</span>
                        </span>
                    </span>
                    <span class="player-value-wrap">
                        <span class="player-value">${escapeHtml(displayValue)}</span>
                        <span class="elo-track" aria-hidden="true">
                            <span class="elo-fill" style="width:${eloProgress(player.sortElo)}%"></span>
                        </span>
                    </span>
                </button>
            </li>
        `;
    }).join("");
}

function renderSaverAbiSummary() {
    const validPlayers = state.players.filter((player) => !player.error && player.sortElo >= 0);
    const byElo = [...validPlayers].sort((a, b) => b.sortElo - a.sortElo);
    const leader = byElo[0];
    const averageElo = validPlayers.length
        ? Math.round(validPlayers.reduce((sum, player) => sum + player.sortElo, 0) / validPlayers.length)
        : null;

    dom.summaryPlayerCount.textContent = number.format(validPlayers.length);
    dom.summaryAverageElo.textContent = averageElo === null ? "—" : number.format(averageElo);
    dom.summaryLeader.textContent = leader?.nickname || "—";
    dom.summaryLeaderElo.textContent = leader ? `${number.format(leader.sortElo)} Elo` : "höchstes Elo";
    dom.summaryEliteCount.textContent = number.format(
        validPlayers.filter((player) => player.sortElo >= 2000).length
    );
}

function metricState(stat, value) {
    const config = thresholds[stat];
    if (!config || value === null) {
        return { key: "bad", label: "Keine Daten" };
    }
    const normalizedValue = Number.isInteger(config.precision)
        ? Number(value.toFixed(config.precision))
        : value;

    if (config.lowerIsBetter) {
        if (normalizedValue <= config.great) return { key: "great", label: "Elite" };
        if (normalizedValue <= config.good) return { key: "good", label: "Stark" };
        if (normalizedValue <= config.okay) return { key: "okay", label: "Solide" };
        return { key: "bad", label: config.badLabel || "Schwach" };
    }

    const isGreat = config.greatExclusive
        ? normalizedValue > config.great
        : normalizedValue >= config.great;
    if (isGreat) return { key: "great", label: "Elite" };
    if (normalizedValue >= config.good) return { key: "good", label: "Stark" };
    if (normalizedValue >= config.okay) return { key: "okay", label: "Solide" };
    return { key: "bad", label: config.badLabel || "Schwach" };
}

function metricProgress(stat, value) {
    const config = thresholds[stat];
    if (!config || value === null) return 0;
    if (config.lowerIsBetter) {
        return clamp(((config.max - value) / (config.max - config.great)) * 82 + 18, 8, 100);
    }
    return clamp((value / config.max) * 100, 8, 100);
}

function renderStatCard({ stat, label, value, digits, suffix = "" }) {
    const displayValue = stat === "impact" && value !== null ? value - 0.2 : value;
    const status = metricState(stat, displayValue);
    const progress = metricProgress(stat, displayValue);

    return `
        <article class="stat-card state-${status.key}">
            <div class="stat-topline">
                <span class="stat-label">${label}</span>
            </div>
            <strong class="stat-value">${safeFixed(displayValue, digits, suffix)}</strong>
            <div class="stat-track" aria-hidden="true">
                <span class="stat-fill" style="width:${progress}%"></span>
            </div>
            <div class="stat-footer">
                <span class="stat-state">${status.label}</span>
                <span class="stat-reference">Form</span>
            </div>
        </article>
    `;
}

function renderLeetifyMetric({ label, value, digits = 1, suffix = "", signed = false }) {
    const displayValue = signed
        ? formatSigned(value, digits)
        : safeFixed(value, digits, suffix);

    return `
        <div class="leetify-metric">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(displayValue)}</strong>
        </div>
    `;
}

function renderLeetifySection(player) {
    const steam64Id = player.steam64Id;
    const profile = steam64Id ? state.leetifyProfiles.get(steam64Id) : null;
    const error = steam64Id ? state.leetifyErrors.get(steam64Id) : null;

    let content;
    if (!steam64Id) {
        content = `
            <p class="leetify-message">
                Keine Steam-Verknüpfung verfügbar.
            </p>
        `;
    } else if (error) {
        content = `
            <p class="leetify-message is-error">
                ${escapeHtml(error)}
            </p>
        `;
    } else if (!profile) {
        content = `
            <div class="leetify-loading" role="status">
                <span class="spinner" aria-hidden="true"></span>
                Leetify-Profil wird geladen
            </div>
        `;
    } else if (!profile.available) {
        content = `
            <p class="leetify-message">
                ${escapeHtml(profile.reason || "Kein öffentliches Leetify-Profil verfügbar.")}
            </p>
        `;
    } else {
        const ratings = [
            {
                label: "Leetify Rating",
                value: profile.leetifyRating,
                digits: 2,
                signed: true
            },
            { label: "Aim Rating", value: profile.aimRating },
            { label: "Positioning Rating", value: profile.positioningRating },
            { label: "Utility Rating", value: profile.utilityRating }
        ];
        const mechanics = [
            {
                label: "Time to Damage",
                value: profile.timeToDamage,
                digits: 0,
                suffix: " ms"
            },
            {
                label: "Crosshair Placement",
                value: profile.crosshairPlacement,
                digits: 1,
                suffix: "°"
            },
            {
                label: "Counter-Strafing",
                value: profile.counterStrafing,
                digits: 1,
                suffix: "%"
            },
            {
                label: "Spray Accuracy",
                value: profile.sprayAccuracy,
                digits: 1,
                suffix: "%"
            }
        ];

        content = `
            <div class="leetify-metric-grid">
                ${ratings.map(renderLeetifyMetric).join("")}
            </div>
            <div class="leetify-mechanics">
                ${mechanics.map(renderLeetifyMetric).join("")}
            </div>
        `;
    }

    const profileUrl = profile?.profileUrl
        ? escapeHtml(safeUrl(profile.profileUrl, "https://leetify.com/"))
        : "https://leetify.com/";

    return `
        <section class="leetify-section" aria-label="Leetify Statistiken">
            <header class="leetify-header">
                <a
                    class="leetify-attribution"
                    href="https://leetify.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Data Provided by Leetify"
                >
                    <img src="/leetify-badge.png" alt="Data Provided by Leetify">
                </a>
                ${profile?.available ? `
                    <a
                        class="leetify-profile-link"
                        href="${profileUrl}"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        View on Leetify
                    </a>
                ` : ""}
            </header>
            ${content}
        </section>
    `;
}

async function loadLeetifyProfile(player) {
    const steam64Id = player?.steam64Id;
    if (
        !steam64Id
        || state.leetifyProfiles.has(steam64Id)
        || state.leetifyLoading.has(steam64Id)
        || state.leetifyErrors.has(steam64Id)
    ) {
        return;
    }

    state.leetifyLoading.add(steam64Id);

    try {
        const response = await fetch(
            `/api/leetify-data?steam64_id=${encodeURIComponent(steam64Id)}`,
            { headers: { Accept: "application/json" } }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
        }
        state.leetifyProfiles.set(steam64Id, data);
    } catch (error) {
        state.leetifyErrors.set(
            steam64Id,
            error.message || "Leetify-Daten konnten nicht geladen werden."
        );
    } finally {
        state.leetifyLoading.delete(steam64Id);
        if (state.selectedNickname === player.nickname) {
            renderPlayerDetail(player);
        }
    }
}

function renderPlayerDetail(player) {
    if (!player || player.error) return;

    state.selectedNickname = player.nickname;
    const rank = rankedPlayers().find((entry) => entry.player.nickname === player.nickname)?.rank;
    const avatar = escapeHtml(safeUrl(player.avatar, "/default_avatar.png"));
    const faceitUrl = escapeHtml(safeUrl(
        player.faceitUrl,
        `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`
    ));
    const matches = player.matchesConsidered
        ? `Form aus ${number.format(player.matchesConsidered)} Matches`
        : "Aktuelle FACEIT-Statistiken";
    const stats = [
        { stat: "rating", label: "Rating 2.0", value: player.rating, digits: 2 },
        { stat: "dpr", label: "DPR", value: player.dpr, digits: 2 },
        { stat: "kast", label: "KAST", value: player.kast, digits: 1, suffix: "%" },
        { stat: "impact", label: "Impact", value: player.impact, digits: 2 },
        { stat: "adr", label: "ADR", value: player.adr, digits: 1 },
        { stat: "kpr", label: "KPR", value: player.kpr, digits: 2 }
    ];

    dom.playerDetail.innerHTML = `
        <article class="profile-card">
            <header class="profile-hero">
                <img src="${avatar}" class="profile-avatar" alt="Avatar von ${escapeHtml(player.nickname)}" onerror="this.src='/default_avatar.png'">
                <div class="profile-title">
                    <p class="panel-kicker">#${rank ?? "—"} im Ranking</p>
                    <h2>${escapeHtml(player.nickname)}</h2>
                    <p>${matches}</p>
                </div>
                <a class="faceit-link" href="${faceitUrl}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(player.nickname)} auf FACEIT öffnen">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M14 5h5v5M19 5l-9 9M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>
                    </svg>
                </a>
            </header>
            <div class="profile-meta">
                <div class="profile-meta-item">
                    <span>Elo</span>
                    <strong>${number.format(player.sortElo)}</strong>
                </div>
                <div class="profile-meta-item">
                    <span>Level</span>
                    <strong>${escapeHtml(player.level ?? "—")}</strong>
                </div>
                <div class="profile-meta-item">
                    <span>Marktwert</span>
                    <strong>${escapeHtml(formatWorth(player.worth))}</strong>
                </div>
            </div>
            <div class="stats-grid">
                ${stats.map(renderStatCard).join("")}
            </div>
            ${renderLeetifySection(player)}
        </article>
    `;

    renderPlayerList();
    void loadLeetifyProfile(player);
}

function updatePlayerProgress() {
    if (!state.totalPlayers) {
        dom.playerProgress.textContent = "Wird geladen";
        return;
    }
    dom.playerProgress.textContent = state.loadedPlayers < state.totalPlayers
        ? `${state.loadedPlayers} / ${state.totalPlayers}`
        : `${state.totalPlayers} Spieler`;
}

function readPlayerCache() {
    try {
        const raw = localStorage.getItem(cacheKeys.players);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        const maxAge = 5 * 60 * 1000;
        if (!cached.savedAt || Date.now() - cached.savedAt > maxAge || !Array.isArray(cached.players)) {
            return null;
        }
        return cached;
    } catch {
        return null;
    }
}

function writePlayerCache() {
    try {
        localStorage.setItem(cacheKeys.players, JSON.stringify({
            savedAt: Date.now(),
            players: state.players
        }));
    } catch {
        // A blocked or full browser cache must not break the leaderboard.
    }
}

async function loadSaverAbiView() {
    if (state.saverAbiLoaded || state.saverAbiLoading) return;

    const cached = readPlayerCache();
    if (cached) {
        state.players = cached.players;
        state.totalPlayers = cached.players.length;
        state.loadedPlayers = cached.players.length;
        state.saverAbiLoaded = true;
        renderSaverAbiSummary();
        renderPlayerList();
        updatePlayerProgress();
        const leader = rankedPlayers().find(({ player }) => !player.error)?.player;
        if (leader) renderPlayerDetail(leader);
        dom.playerLoading.hidden = true;
        setStatus(dom.saverUpdated, "Vor wenigen Minuten synchronisiert", "ready");
        return;
    }

    state.saverAbiLoading = true;
    dom.playerError.hidden = true;
    dom.playerLoading.hidden = false;
    renderSkeletonRows();
    setStatus(dom.saverUpdated, "Daten werden synchronisiert", "loading");

    try {
        const namesResponse = await fetch("/players.json", {
            headers: { Accept: "application/json" }
        });
        if (!namesResponse.ok) throw new Error(`Spielerliste: HTTP ${namesResponse.status}`);

        const names = await namesResponse.json();
        if (!Array.isArray(names) || names.length === 0) {
            throw new Error("Die Spielerliste ist leer.");
        }

        state.players = [];
        state.totalPlayers = names.length;
        state.loadedPlayers = 0;
        updatePlayerProgress();

        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < names.length) {
                const index = nextIndex++;
                const player = await getPlayerData(names[index]);
                state.players.push(player);
                state.loadedPlayers += 1;
                updatePlayerProgress();
                renderSaverAbiSummary();
                renderPlayerList();
            }
        };

        const concurrency = Math.min(6, names.length);
        await Promise.all(Array.from({ length: concurrency }, worker));

        state.saverAbiLoaded = true;
        writePlayerCache();

        const leader = rankedPlayers().find(({ player }) => !player.error)?.player;
        if (!state.selectedNickname && leader) renderPlayerDetail(leader);

        const latestUpdate = state.players
            .map((player) => player.lastUpdated)
            .filter(Boolean)
            .sort()
            .at(-1);
        setStatus(
            dom.saverUpdated,
            formatDate(latestUpdate) ? `Stand ${formatDate(latestUpdate)} Uhr` : "Gerade synchronisiert",
            "ready"
        );
    } catch (error) {
        dom.playerError.textContent = `Leaderboard konnte nicht geladen werden: ${error.message}`;
        dom.playerError.hidden = false;
        setStatus(dom.saverUpdated, "Synchronisierung fehlgeschlagen", "error");
        renderPlayerList();
    } finally {
        state.saverAbiLoading = false;
        dom.playerLoading.hidden = true;
        updatePlayerProgress();
    }
}

async function loadTeamIconMap() {
    if (Object.keys(state.teamIconMap).length > 0) return;
    try {
        const response = await fetch("/uniliga_teams.json", {
            headers: { Accept: "application/json" }
        });
        if (!response.ok) return;
        const teams = await response.json();
        if (!Array.isArray(teams)) return;
        state.teamIconMap = Object.fromEntries(
            teams
                .filter((team) => team.name && team.icon)
                .map((team) => [team.name, team.icon])
        );
    } catch {
        state.teamIconMap = {};
    }
}

function winRateClass(value) {
    const winRate = toNumber(value);
    if (winRate === null) return "";
    if (winRate >= thresholds.winRate.great) return "text-great";
    if (winRate >= thresholds.winRate.good) return "text-good";
    if (winRate >= thresholds.winRate.okay) return "text-okay";
    return "text-bad";
}

function setUniligaPhaseControls(phase) {
    dom.uniligaPhaseButtons.forEach((button) => {
        const isActive = button.dataset.phase === phase;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });

    const isPlayoffs = phase === "playoffs";
    dom.uniligaPhaseDescription.textContent = isPlayoffs
        ? "K.-o.-Runden mit realen Match-Ergebnissen direkt von FACEIT."
        : "Offizielle FACEIT-Tabelle · 3 Punkte pro Sieg.";
    dom.uniligaHeroCopy.textContent = isPlayoffs
        ? "Turnierbaum, Match-Ergebnisse und individuelle Performance der Playoffs."
        : "Tabelle, Bilanz und individuelle Performance der Gruppenphase.";
}

function resetUniligaSummary(phase) {
    dom.summaryTeamCount.textContent = "—";
    dom.summaryUniligaPlayerCount.textContent = "—";
    dom.summaryLeadingTeamLabel.textContent = phase === "playoffs" ? "Champion" : "Tabellenführer";
    dom.summaryLeadingTeam.textContent = "—";
    dom.summaryLeadingTeamPoints.textContent = phase === "playoffs" ? "Finale noch offen" : "aktuelle Punkte";
    dom.summaryTopRating.textContent = "—";
    dom.summaryTopPlayer.textContent = "bester Spieler";
}

function playoffBracketStages(data) {
    const stages = data.bracket?.stages;
    if (Array.isArray(stages) && stages.length > 0) {
        return stages.filter((stage) => Array.isArray(stage?.rounds));
    }

    const rounds = data.bracket?.rounds;
    return Array.isArray(rounds) && rounds.length > 0
        ? [{ key: "main", label: null, rounds }]
        : [];
}

function renderUniligaSummary(data, phase) {
    const teams = data.teams || [];
    const players = data.players || [];
    const leader = teams[0];
    const topPlayer = players[0];
    const bracketMatches = playoffBracketStages(data)
        .flatMap((stage) => stage.rounds)
        .flatMap((round) => round.matches || []);
    const finishedMatches = bracketMatches.filter((match) => match.status === "FINISHED").length;
    const champion = data.bracket?.champion;

    dom.summaryTeamCount.textContent = number.format(teams.length);
    dom.summaryUniligaPlayerCount.textContent = number.format(players.length);
    dom.summaryLeadingTeamLabel.textContent = phase === "playoffs" ? "Champion" : "Tabellenführer";
    dom.summaryLeadingTeam.textContent = phase === "playoffs"
        ? champion?.name || "Noch offen"
        : leader?.name || "—";
    dom.summaryLeadingTeamPoints.textContent = phase === "playoffs"
        ? `${number.format(finishedMatches)} von ${number.format(bracketMatches.length)} Spielen beendet`
        : leader
            ? `${number.format(leader.points ?? 0)} Punkte`
            : "aktuelle Punkte";
    dom.summaryTopRating.textContent = topPlayer ? safeFixed(topPlayer.rating, 2) : "—";
    dom.summaryTopPlayer.textContent = topPlayer?.nickname || "bester Spieler";
}

function teamIconUrl(teamName, fallbackAvatar = null) {
    const iconName = state.teamIconMap[teamName];
    if (iconName) return `/uniliga_icons/${encodeURIComponent(iconName)}`;
    return fallbackAvatar
        ? safeUrl(fallbackAvatar, "/default_team_icon.png")
        : "/default_team_icon.png";
}

function renderUniligaTeamTable(data, phase) {
    const isPlayoffs = phase === "playoffs";
    const teams = [...data.teams].sort((teamA, teamB) => {
        if (!isPlayoffs) {
            const positionA = teamA.standingPosition ?? Number.MAX_SAFE_INTEGER;
            const positionB = teamB.standingPosition ?? Number.MAX_SAFE_INTEGER;
            if (positionA !== positionB) return positionA - positionB;
            const points = (teamB.points ?? 0) - (teamA.points ?? 0);
            if (points !== 0) return points;
            const differenceA = (teamA.matchWins ?? 0) - (teamA.matchLosses ?? 0);
            const differenceB = (teamB.matchWins ?? 0) - (teamB.matchLosses ?? 0);
            if (differenceA !== differenceB) return differenceB - differenceA;
        }
        const wins = (teamB.matchWins ?? 0) - (teamA.matchWins ?? 0);
        if (wins !== 0) return wins;
        return (teamB.avgRating ?? 0) - (teamA.avgRating ?? 0);
    });
    const rows = teams.map((team, index) => {
        const teamName = team.name || `Team ${index + 1}`;
        const iconUrl = teamIconUrl(teamName, team.avatar);
        const matchDifference = (team.matchWins ?? 0) - (team.matchLosses ?? 0);
        const phaseCells = isPlayoffs
            ? `
                <td>${number.format(team.matchesPlayed ?? 0)}</td>
                <td><strong>${number.format(team.matchWins ?? 0)}</strong></td>
                <td>${number.format(team.matchLosses ?? 0)}</td>
                <td>${team.mapWins ?? 0}–${team.mapLosses ?? 0}</td>
                <td>${safeFixed(team.avgRating, 2)}</td>
            `
            : `
                <td>${number.format(team.matchesPlayed ?? 0)}</td>
                <td><strong>${number.format(team.matchWins ?? 0)}</strong></td>
                <td>${number.format(team.matchLosses ?? 0)}</td>
                <td class="${matchDifference > 0 ? "text-great" : matchDifference < 0 ? "text-bad" : ""}">
                    ${matchDifference > 0 ? "+" : ""}${number.format(matchDifference)}
                </td>
                <td><strong>${number.format(team.points ?? 0)}</strong></td>
            `;

        return `
            <tr>
                <td class="${index < 3 ? "table-rank-top" : ""}">${team.standingPosition ?? index + 1}</td>
                <td>
                    <span class="table-identity">
                        <img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" onerror="this.src='/default_team_icon.png'">
                        <span>${escapeHtml(teamName)}</span>
                    </span>
                </td>
                ${phaseCells}
            </tr>
        `;
    }).join("");

    return `
        <section class="uniliga-panel">
            <header class="uniliga-panel-header">
                <div>
                    <h2>${isPlayoffs ? "Playoff-Bilanz" : "Team Standings"}</h2>
                    <p>${isPlayoffs ? "Siege, Maps und Teamform" : "Offizielle Platzierung der Gruppenphase"}</p>
                </div>
                <span class="panel-status">${teams.length} Teams</span>
            </header>
            <div class="table-wrap">
                <table class="stats-table">
                    <caption class="sr-only">Uniliga Team Rangliste</caption>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Team</th>
                            ${isPlayoffs
                                ? "<th>Sp.</th><th>S</th><th>N</th><th>Maps</th><th>Rating</th>"
                                : "<th>Sp.</th><th>S</th><th>N</th><th>+/−</th><th>Pkt.</th>"}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderUniligaPlayerTable(data) {
    const players = [...data.players].sort((playerA, playerB) =>
        (playerB.rating ?? 0) - (playerA.rating ?? 0)
    );
    const rows = players.map((player, index) => {
        const avatar = escapeHtml(safeUrl(player.avatar, "/default_avatar.png"));
        return `
            <tr>
                <td class="${index < 3 ? "table-rank-top" : ""}">${index + 1}</td>
                <td>
                    <span class="table-identity">
                        <img src="${avatar}" alt="" loading="lazy" onerror="this.src='/default_avatar.png'">
                        <span>${escapeHtml(player.nickname || "Unbekannt")}</span>
                    </span>
                </td>
                <td>${number.format(player.matchesPlayed ?? 0)}</td>
                <td><strong>${safeFixed(player.rating, 2)}</strong></td>
                <td>${safeFixed(toNumber(player.impact) === null ? null : player.impact - 0.2, 2)}</td>
                <td>${safeFixed(player.adr, 1)}</td>
                <td>${safeFixed(player.kast, 1, "%")}</td>
                <td class="${winRateClass(player.winRate)}">${safeFixed(player.winRate, 1, "%")}</td>
            </tr>
        `;
    }).join("");

    return `
        <section class="uniliga-panel">
            <header class="uniliga-panel-header">
                <div>
                    <h2>Player Performance</h2>
                    <p>Sortiert nach Rating 2.0</p>
                </div>
                <span class="panel-status">${players.length} Spieler</span>
            </header>
            <div class="table-wrap">
                <table class="stats-table">
                    <caption class="sr-only">Uniliga Spieler Rangliste</caption>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Spieler</th>
                            <th>Maps</th>
                            <th>Rating</th>
                            <th>Impact</th>
                            <th>ADR</th>
                            <th>KAST</th>
                            <th>WR</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;
}

function bracketStatus(status) {
    const statuses = {
        FINISHED: { label: "Beendet", className: "is-finished" },
        ONGOING: { label: "Live", className: "is-live" },
        READY: { label: "Bereit", className: "is-upcoming" },
        SCHEDULED: { label: "Geplant", className: "is-upcoming" },
        UPCOMING: { label: "Geplant", className: "is-upcoming" },
        CANCELLED: { label: "Abgesagt", className: "is-cancelled" }
    };
    return statuses[status] || { label: "Offen", className: "is-upcoming" };
}

function renderPlayoffBracket(data) {
    const stages = playoffBracketStages(data);
    const rounds = stages.flatMap((stage) => stage.rounds);
    const totalMatches = rounds.reduce((sum, round) => sum + (round.matches?.length || 0), 0);

    if (rounds.length === 0) {
        return `
            <section class="uniliga-panel uniliga-panel-wide">
                <header class="uniliga-panel-header">
                    <div>
                        <h2>Playoff-Bracket</h2>
                        <p>Der Turnierbaum wird eingeblendet, sobald FACEIT Matches veröffentlicht.</p>
                    </div>
                    <span class="panel-status">Noch offen</span>
                </header>
                <div class="bracket-empty">Noch keine Playoff-Paarungen verfügbar.</div>
            </section>
        `;
    }

    const stageSections = stages.map((stage) => {
        const roundColumns = stage.rounds.map((round) => {
            const matches = (round.matches || []).map((match) => {
                const status = bracketStatus(match.status);
                const date = formatDate(match.scheduledAt || match.finishedAt);
                const matchUrl = `https://www.faceit.com/de/cs2/room/${encodeURIComponent(match.matchId)}`;
                const teams = (match.teams || []).map((team) => {
                    const teamName = team.name || "TBD";
                    const iconUrl = teamIconUrl(teamName, team.avatar);
                    return `
                        <div class="bracket-team ${team.winner ? "is-winner" : ""}">
                            <span class="bracket-team-identity">
                                <img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" onerror="this.src='/default_team_icon.png'">
                                <span>${escapeHtml(teamName)}</span>
                            </span>
                            <strong>${team.score ?? "–"}</strong>
                        </div>
                    `;
                }).join("");

                return `
                    <article class="bracket-match">
                        <div class="bracket-match-meta">
                            <span class="bracket-status ${status.className}">${status.label}</span>
                            <span>${match.bestOf ? `Bo${number.format(match.bestOf)}` : ""}</span>
                        </div>
                        <div class="bracket-teams">${teams}</div>
                        <a class="bracket-match-link" href="${matchUrl}" target="_blank" rel="noreferrer">
                            ${date ? `${escapeHtml(date)} Uhr` : "Match auf FACEIT"}
                        </a>
                    </article>
                `;
            }).join("");

            return `
                <section class="bracket-round" aria-label="${escapeHtml(round.label)}">
                    <header>
                        <span>Runde ${escapeHtml(round.round)}</span>
                        <h4>${escapeHtml(round.label)}</h4>
                    </header>
                    <div class="bracket-round-matches">${matches}</div>
                </section>
            `;
        }).join("");

        const stageHeader = stage.label
            ? `
                <header class="bracket-stage-header">
                    <div>
                        <span>${stage.key === "grand-final" ? "Championship Match" : "Double Elimination"}</span>
                        <h3>${escapeHtml(stage.label)}</h3>
                    </div>
                    <small>${number.format(stage.rounds.length)} ${stage.rounds.length === 1 ? "Runde" : "Runden"}</small>
                </header>
            `
            : "";

        return `
            <section class="bracket-stage ${stage.key === "grand-final" ? "is-grand-final" : ""}">
                ${stageHeader}
                <div class="bracket-scroll">
                    <div class="playoff-bracket">${roundColumns}</div>
                </div>
            </section>
        `;
    }).join("");

    return `
        <section class="uniliga-panel uniliga-panel-wide bracket-panel">
            <header class="uniliga-panel-header">
                <div>
                    <h2>Playoff-Bracket</h2>
                    <p>${data.bracket?.format === "double-elimination"
                        ? "Upper Bracket, Lower Bracket und Grand Final"
                        : "Der echte K.-o.-Turnierbaum der Championship"}</p>
                </div>
                <span class="panel-status">${number.format(totalMatches)} Matches</span>
            </header>
            ${stageSections}
        </section>
    `;
}

function renderUniligaData(data, phase) {
    const updated = formatDate(data.lastUpdated);
    dom.uniligaArea.innerHTML = `
        ${phase === "playoffs" ? renderPlayoffBracket(data) : ""}
        ${renderUniligaTeamTable(data, phase)}
        ${renderUniligaPlayerTable(data)}
        <div class="uniliga-data-timestamp">
            ${updated ? `Stand ${updated} Uhr` : "Aktuelle Championship-Daten"}
        </div>
    `;
}

function showUniligaPhase(data, phase) {
    dom.uniligaChampionshipTitle.textContent =
        typeof data.championshipName === "string" && data.championshipName.trim()
            ? data.championshipName.trim()
            : `Uniliga CS2 · ${phase === "playoffs" ? "Playoffs" : "Gruppenphase"}`;
    renderUniligaSummary(data, phase);
    renderUniligaData(data, phase);
    const updated = formatDate(data.lastUpdated);
    setStatus(
        dom.uniligaUpdated,
        updated ? `Stand ${updated} Uhr` : "Gerade synchronisiert",
        "ready"
    );
}

async function loadUniligaPhase(phase) {
    const cachedData = state.uniligaData[phase];
    if (cachedData) {
        dom.uniligaLoading.hidden = true;
        dom.uniligaError.hidden = true;
        dom.uniligaArea.setAttribute("aria-busy", "false");
        showUniligaPhase(cachedData, phase);
        return;
    }
    if (state.uniligaLoading.has(phase)) return;

    state.uniligaLoading.add(phase);
    dom.uniligaLoading.hidden = false;
    dom.uniligaError.hidden = true;
    dom.uniligaArea.replaceChildren();
    dom.uniligaArea.setAttribute("aria-busy", "true");
    dom.uniligaChampionshipTitle.textContent =
        phase === "playoffs" ? "Uniliga Liga 1 Playoffs" : "Uniliga Liga 1 Gruppenphase";
    resetUniligaSummary(phase);
    setStatus(dom.uniligaUpdated, "Daten werden synchronisiert", "loading");

    try {
        const [response] = await Promise.all([
            fetch(
                `/api/uniliga-stats?phase=${encodeURIComponent(phase)}&v=${UNILIGA_API_SCHEMA_VERSION}`,
                {
                    headers: { Accept: "application/json" }
                }
            ),
            loadTeamIconMap()
        ]);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
        }
        if (!Array.isArray(data?.teams) || !Array.isArray(data?.players)) {
            throw new Error("Ungültiges Datenformat");
        }
        if (
            phase === "playoffs"
            && !Array.isArray(data?.bracket?.rounds)
            && !Array.isArray(data?.bracket?.stages)
        ) {
            throw new Error("Playoff-Bracket fehlt");
        }

        state.uniligaData[phase] = data;
        if (state.uniligaPhase === phase) {
            showUniligaPhase(data, phase);
        }
    } catch (error) {
        if (state.uniligaPhase === phase) {
            dom.uniligaError.textContent = `Uniliga-Daten konnten nicht geladen werden: ${error.message}`;
            dom.uniligaError.hidden = false;
            setStatus(dom.uniligaUpdated, "Synchronisierung fehlgeschlagen", "error");
        }
    } finally {
        state.uniligaLoading.delete(phase);
        if (state.uniligaPhase === phase) {
            dom.uniligaLoading.hidden = true;
            dom.uniligaArea.setAttribute("aria-busy", "false");
        }
    }
}

function selectUniligaPhase(phase) {
    if (!["groups", "playoffs"].includes(phase)) return;
    state.uniligaPhase = phase;
    setUniligaPhaseControls(phase);
    loadUniligaPhase(phase);
}

function loadUniligaView() {
    selectUniligaPhase(state.uniligaPhase);
}

function setSortMode(mode) {
    if (!["elo", "worth"].includes(mode) || state.sortMode === mode) return;
    state.sortMode = mode;
    dom.sortElo.classList.toggle("active", mode === "elo");
    dom.sortWorth.classList.toggle("active", mode === "worth");
    dom.sortElo.setAttribute("aria-pressed", String(mode === "elo"));
    dom.sortWorth.setAttribute("aria-pressed", String(mode === "worth"));
    renderPlayerList();

    const selected = state.players.find((player) => player.nickname === state.selectedNickname);
    if (selected) renderPlayerDetail(selected);
}

function switchView(view, updateUrl = true) {
    const targetView = view === "uniliga" ? "uniliga" : "saverabi";

    dom.views.forEach((element) => {
        const isActive = element.id === `${targetView}-content`;
        element.classList.toggle("active", isActive);
        element.hidden = !isActive;
    });

    dom.tabs.forEach((tab) => {
        const isActive = tab.dataset.view === targetView;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });

    if (updateUrl) {
        history.replaceState(null, "", `#${targetView}`);
    }

    if (targetView === "saverabi") {
        loadSaverAbiView();
    } else {
        loadUniligaView();
    }
}

function bindEvents() {
    dom.tabs.forEach((tab) => {
        tab.addEventListener("click", () => switchView(tab.dataset.view));
        tab.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const target = tab.dataset.view === "saverabi" ? "uniliga" : "saverabi";
            switchView(target);
            document.querySelector(`.nav-tab[data-view="${target}"]`)?.focus();
        });
    });

    dom.sortElo.addEventListener("click", () => setSortMode("elo"));
    dom.sortWorth.addEventListener("click", () => setSortMode("worth"));

    dom.uniligaPhaseButtons.forEach((button, index) => {
        button.addEventListener("click", () => selectUniligaPhase(button.dataset.phase));
        button.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const nextIndex = (index + direction + dom.uniligaPhaseButtons.length)
                % dom.uniligaPhaseButtons.length;
            const nextButton = dom.uniligaPhaseButtons[nextIndex];
            selectUniligaPhase(nextButton.dataset.phase);
            nextButton.focus();
        });
    });

    dom.playerSearch.addEventListener("input", (event) => {
        state.search = event.currentTarget.value;
        renderPlayerList();
    });

    dom.playerList.addEventListener("click", (event) => {
        const row = event.target.closest(".player-row[data-nickname]");
        if (!row) return;
        const player = state.players.find((entry) => entry.nickname === row.dataset.nickname);
        if (!player) return;

        renderPlayerDetail(player);
        const narrowViewport = window.matchMedia?.("(max-width: 1080px)");
        if (
            narrowViewport?.matches
            && typeof dom.playerDetail.scrollIntoView === "function"
        ) {
            dom.playerDetail.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "start"
            });
        }
    });

    window.addEventListener("hashchange", () => {
        switchView(window.location.hash.slice(1), false);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    bindEvents();
    const initialView = window.location.hash.slice(1) === "uniliga" ? "uniliga" : "saverabi";
    switchView(initialView, false);
});
