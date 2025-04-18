// -------------------------------------------------------------
// 1) Hilfsfunktionen ganz nach oben (sie sind dann überall nutzbar)
// -------------------------------------------------------------
function toNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

const safe = (v, digits = 2, suf = "") => (v === null ? "—" : v.toFixed(digits) + suf);

// -------------------------------------------------------------
// 2) Haupt‑Script
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const playerListContainerEl = document.getElementById("player-list");
    const detailCardContainer = document.getElementById("player-detail-card-container");
    const mainContentArea = document.getElementById("main-content-area");
    const loadingIndicator = document.getElementById("loading-indicator");
    const errorMessageElement = document.getElementById("error-message");

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    const thresholds = {
        calculatedRating: {bad: 0.85, okay: 1.05, good: 1.25, max: 1.8},
        kd: {bad: 0.8, okay: 1.0, good: 1.2, max: 2.0},
        adr: {bad: 65, okay: 80, good: 95, max: 120},
        winRate: {bad: 40, okay: 50, good: 60, max: 100},
        hsPercent: {bad: 30, okay: 40, good: 50, max: 70},
        elo: {bad: 1100, okay: 1700, good: 2200, max: 3500},
    };

    // -----------------------------------------------------------
    // Helper: Elo‑Progressbar (unverändert)
    // -----------------------------------------------------------
    function updateEloProgressBarForList(container) { /* … wie gehabt … */
    }

    // -----------------------------------------------------------
    // API‑Call + Normalisierung – **hier werden jetzt toNum() benutzt**
    // -----------------------------------------------------------
    async function getPlayerData(nickname) {
        try {
            const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const p = await res.json();

            // numerische Felder sicher wandeln
            p.sortElo = toNum(p.elo);
            p.level = toNum(p.level);
            p.calculatedRating = toNum(p.calculatedRating);
            p.kd = toNum(p.kd);
            p.adr = toNum(p.adr);
            p.winRate = toNum(p.winRate);
            p.hsPercent = toNum(p.hsPercent);

            return p;
        } catch (err) {
            console.error("getPlayerData", err);
            return {nickname, error: err.message, sortElo: -1};
        }
    }

    // -----------------------------------------------------------
    // Anzeige‑Funktionen (gekürzt) – hier safe() nutzen
    // -----------------------------------------------------------
    function displayDetailCard(player) {
        if (!player || player.error) { /* … */
            return;
        }
        const html = `
      <div class="stats-grid">
        <div class="stat-item" data-stat="calculatedRating">
          <div class="value">${safe(player.calculatedRating, 2)}</div>
        </div>
        <div class="stat-item" data-stat="kd">
          <div class="value">${safe(player.kd, 2)}</div>
        </div>
        <div class="stat-item" data-stat="adr">
          <div class="value">${safe(player.adr, 1)}</div>
        </div>
        <div class="stat-item" data-stat="winRate">
          <div class="value">${safe(player.winRate, 0, "%")}</div>
        </div>
        <div class="stat-item" data-stat="hsPercent">
          <div class="value">${safe(player.hsPercent, 0, "%")}</div>
        </div>
        <div class="stat-item" data-stat="elo">
          <div class="value">${player.sortElo ?? "N/A"}</div>
        </div>
      </div>`;
        detailCardContainer.innerHTML = html;
        // danach updateStatProgressBars(…)
    }

    // -----------------------------------------------------------
    // Initial Load & Events (unverändert)
    // -----------------------------------------------------------
    async function loadAllPlayers() { /* … */
    }

    playerListContainerEl.addEventListener("click", /* … */);
    loadAllPlayers();
});