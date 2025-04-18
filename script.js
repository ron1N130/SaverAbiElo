// -------------------------------------------------------------
// 1) Hilfsfunktionen am Anfang
// -------------------------------------------------------------
function toNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}
const safe = (v, digits = 2, suf = "") => (v === null ? "—" : v.toFixed(digits) + suf);

// -------------------------------------------------------------
// 2) Hauptscript
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const playerListContainerEl = document.getElementById("player-list");
    const detailCardContainer   = document.getElementById("player-detail-card-container");
    const mainContentArea       = document.getElementById("main-content-area");
    const loadingIndicator      = document.getElementById("loading-indicator");
    const errorMessageElement   = document.getElementById("error-message");

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    const thresholds = {
        calculatedRating: { bad: 0.85, okay: 1.05, good: 1.25, max: 1.8 },
        kd:               { bad: 0.8,  okay: 1.0,  good: 1.2,  max: 2.0 },
        adr:              { bad: 65,   okay: 80,   good: 95,   max: 120 },
        winRate:          { bad: 40,   okay: 50,   good: 60,   max: 100 },
        hsPercent:        { bad: 30,   okay: 40,   good: 50,   max: 70 },
        elo:              { bad: 1100, okay: 1700, good: 2200, max: 3500 },
    };

    // Elo‐Progress‐Bar in Liste
    function updateEloProgressBarForList(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar) return;
        const config = thresholds.elo;
        let percentage = 0;
        let barColor = 'var(--bar-color-bad)';
        if (!isNaN(elo) && elo > 0) {
            percentage = Math.min(100, Math.max(0, (elo / config.max) * 100));
            if (elo >= config.good)      barColor = 'var(--bar-color-good)';
            else if (elo >= config.okay) barColor = 'var(--bar-color-okay)';
        } else {
            barColor = 'var(--bar-background)';
        }
        bar.style.width = `${percentage}%`;
        bar.style.backgroundColor = barColor;
    }

    // API‐Call und Normalisierung
    async function getPlayerData(nickname) {
        try {
            const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const p = await res.json();
            p.sortElo          = toNum(p.elo);
            p.level            = toNum(p.level);
            p.calculatedRating = toNum(p.calculatedRating);
            p.kd               = toNum(p.kd);
            p.adr              = toNum(p.adr);
            p.winRate          = toNum(p.winRate);
            p.hsPercent        = toNum(p.hsPercent);
            return p;
        } catch (err) {
            console.error("getPlayerData error:", err);
            return { nickname, error: err.message, sortElo: -1 };
        }
    }

    // Liste rendern
    function displayPlayerList(players) {
        playerListContainerEl.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            li.dataset.nickname = player.nickname;
            if (player.error) {
                li.classList.add('error-item');
                li.innerHTML = `<span class="player-info">${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                li.innerHTML = `
          <span class="player-info">
            <img src="${player.avatar || 'default_avatar.png'}" class="avatar" onerror="this.src='default_avatar.png'" />
            <span class="player-name">${player.nickname}</span>
          </span>
          <div class="player-list-right">
            <span class="player-elo">${player.sortElo ?? 'N/A'}</span>
            <div class="elo-progress-container" data-elo="${player.sortElo}"><div class="elo-progress-bar"></div></div>
          </div>`;
                const pc = li.querySelector('.elo-progress-container');
                updateEloProgressBarForList(pc);
            }
            playerListContainerEl.appendChild(li);
        });
    }

    // Detail‐Card Bars färben
    function updateStatProgressBars(card, player) {
        card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
            const stat = item.dataset.stat;
            const val = stat === 'elo' ? player.sortElo : player[stat];
            const cfg = thresholds[stat];
            const bar = item.querySelector('.stat-progress-bar');
            const lbl = item.querySelector('.stat-indicator-label');
            let pct = 0;
            let col = 'var(--bar-color-bad)';
            let txt = '---';

            if (val !== null && !isNaN(val)) {
                pct = Math.min(100, (val / cfg.max) * 100);
                if (val >= cfg.good) {
                    col = 'var(--bar-color-good)';
                    txt = 'GOOD';
                } else if (val >= cfg.okay) {
                    col = 'var(--bar-color-okay)';
                    txt = 'OKAY';
                } else {
                    col = 'var(--bar-color-bad)';
                    txt = 'BAD';
                }
            }

            bar.style.width = `${pct}%`;
            bar.style.backgroundColor = col;
            lbl.textContent = txt;
        });
    }


// Detail‐Card rendern
function displayDetailCard(player) {
    if (!player || player.error) {
        detailCardContainer.innerHTML = `<div class="error-card">${player.nickname} - ${player.error}</div>`;
        return;
    }
    const html = `
      <div class="card-header">
        <div class="player-info">
          <img src="${player.avatar}" class="avatar" onerror="this.src='default_avatar.png'"/>
          <span class="player-name">${player.nickname}</span>
        </div>
        <div class="stats-label">Letzte ${player.matchesConsidered} Matches</div>
      </div>
      <div class="stats-grid">
        <div class="stat-item" data-stat="calculatedRating"><div class="value">${safe(player.calculatedRating,2)}</div><div class="stat-progress-bar"></div><span class="stat-indicator-label"></span></div>
        <div class="stat-item" data-stat="kd"><div class="value">${safe(player.kd,2)}</div><div class="stat-progress-bar"></div><span class="stat-indicator-label"></span></div>
        <div class="stat-item" data-stat="adr"><div class="value">${safe(player.adr,1)}</div><div class="stat-progress-bar"></div><span class="stat-indicator-label"></span></div>
        <div class="stat-item" data-stat="winRate"><div class="value">${safe(player.winRate,0,'%')}</div><div class="stat-progress-bar"></div><span class="stat-indicator-label"></span></div>
        <div class="stat-item" data-stat="hsPercent"><div class="value">${safe(player.hsPercent,0,'%')}</div><div class="stat-progress-bar"></div><span class="stat-indicator-label"></span></div>
        <div class="stat-item" data-stat="elo"><div class="value">${player.sortElo}</div><div class="stat-progress-bar"></div><span class="stat-indicator-label"></span></div>
      </div>`;
    detailCardContainer.innerHTML = html;
    updateStatProgressBars(detailCardContainer, player);
}

// Hide Detail
function hideDetailCard() {
    detailCardContainer.innerHTML = '';
}

// Daten laden
async function loadAllPlayers() {
    loadingIndicator.style.display = 'block';
    errorMessageElement.style.display = 'none';
    hideDetailCard();
    allPlayersData = [];
    try {
        const res = await fetch('/players.json');
        if (!res.ok) throw new Error(res.statusText);
        const names = await res.json();
        const settled = await Promise.allSettled(names.map(getPlayerData));
        allPlayersData = settled.map(r => r.status === 'fulfilled' ? r.value : {nickname:'?', error:r.reason});
        allPlayersData.sort((a,b)=> (b.sortElo||0)-(a.sortElo||0));
        displayPlayerList(allPlayersData);
    } catch(err) {
        errorMessageElement.textContent = err.message;
        errorMessageElement.style.display = 'block';
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

// Klicks
playerListContainerEl.addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li) return;
    const name = li.dataset.nickname;
    const pd = allPlayersData.find(p=>p.nickname===name);
    if (pd) displayDetailCard(pd);
});

// Start
loadAllPlayers();
});