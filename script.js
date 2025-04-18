// script.js
// -------------------------------------------------------------
// 1) Hilfsfunktionen am Anfang
// -------------------------------------------------------------
function toNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

const safe = (v, digits = 2, suf = "") => (v == null ? "—" : v.toFixed(digits) + suf);

// -------------------------------------------------------------
// 2) Hauptscript
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const playerListContainerEl = document.getElementById("player-list");
    const detailCardContainer = document.getElementById("player-detail-card-container");
    const mainContentArea = document.getElementById("main-content-area");
    const loadingIndicator = document.getElementById("loading-indicator");
    const errorMessageElement = document.getElementById("error-message");

    let allPlayersData = [];

    const thresholds = {
        rating: {bad: 0.85, okay: 1.05, good: 1.25, max: 1.8},
        dpr: {bad: 0.75, okay: 0.7, good: 0.6, max: 1},
        kast: {bad: 50, okay: 60, good: 70, max: 100},
        kd: {bad: 0.8, okay: 1.0, good: 1.2, max: 2.0},
        adr: {bad: 65, okay: 70, good: 85, max: 120},
        kpr: {bad: 0.5, okay: 0.6, good: 0.8, max: 1.2},
        elo: {bad: 1800, okay: 2000, good: 2900, max: 3500}
    };
    // ============================================================
// Funktion zum Auffüllen und Färben des kleinen Elo‑Bars in der Liste
// ============================================================
    function updateEloProgressBarForList(containerEl) {
        // Wert aus dem data-Attribut holen
        const val = parseInt(containerEl.dataset.elo, 10) || 0;
        const cfg = thresholds.elo;

        // Prozent (max 100%)
        const pct = Math.min(100, (val / cfg.max) * 100);

        // Bar‑Element auswählen
        const bar = containerEl.querySelector('.elo-progress-bar');
        bar.style.width = pct + '%';

        // Farbe je nach Schwellenwert
        let color = 'var(--bar-bad)';
        if (val >= cfg.good) color = 'var(--bar-good)';
        else if (val >= cfg.okay) color = 'var(--bar-okay)';
        bar.style.backgroundColor = color;
    }

    // -------------------------------------------------------------
    // EINZIGE updateStatProgressBars‑Funktion
    // -------------------------------------------------------------
    function updateStatProgressBars(card, player) {
        card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
            const stat = item.dataset.stat;
            const val  = stat === 'elo' ? player.sortElo : player[stat];
            const cfg  = thresholds[stat];
            const bar  = item.querySelector('.stat-progress-bar');
            const lbl  = item.querySelector('.stat-indicator-label');

            let pct   = 0;
            let color = 'var(--bar-bad)';
            let text  = '---';

            if (val != null && !isNaN(val)) {
                if (stat === 'dpr') {
                    // je niedriger, desto besser → invertiere
                    pct = Math.min(100, ((cfg.max - val) / cfg.max) * 100);
                    if (val <= cfg.good)      { text = 'GOOD'; color = 'var(--bar-good)'; }
                    else if (val <= cfg.okay) { text = 'OKAY'; color = 'var(--bar-okay)'; }
                    else                       { text = 'BAD';  color = 'var(--bar-bad)'; }
                } else {
                    // Standard: je höher, desto besser
                    pct = Math.min(100, (val / cfg.max) * 100);
                    if (val >= cfg.good)      { text = 'GOOD'; color = 'var(--bar-good)'; }
                    else if (val >= cfg.okay) { text = 'OKAY'; color = 'var(--bar-okay)'; }
                    else                      { text = 'BAD';  color = 'var(--bar-bad)'; }
                }
            }

            bar.style.width = pct + '%';
            bar.style.backgroundColor = color;
            lbl.textContent = text;
        });
    }



    async function getPlayerData(nickname) {
        try {
            const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const p = await res.json();
            p.sortElo = toNum(p.elo);
            p.rating = toNum(p.rating ?? p.calculatedRating);
            p.dpr = toNum(p.dpr);
            p.kast = toNum(p.kast);
            p.kd = toNum(p.kd);
            p.adr = toNum(p.adr);
            p.kpr = toNum(p.kpr);
            return p;
        } catch (err) {
            console.error("getPlayerData error:", err);
            return {nickname, error: err.message, sortElo: -1};
        }
    }

    function displayPlayerList(players) {
        playerListContainerEl.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            li.dataset.nickname = player.nickname;
            if (player.error) {
                li.classList.add('error-item');
                li.innerHTML = `<span class='player-info'>${player.nickname} – Fehler: ${player.error}</span>`;
            } else {
                li.innerHTML = `
            <span class='player-info'>
              <img src='${player.avatar || 'default_avatar.png'}' class='avatar' onerror="this.src='default_avatar.png'" />
              <span class='player-name'>${player.nickname}</span>
            </span>
            <div class='player-list-right'>
              <span class='player-elo'>${player.sortElo}</span>
              <div class='elo-progress-container' data-elo='${player.sortElo}'>
                <div class='elo-progress-bar'></div>
              </div>
            </div>`;
                updateEloProgressBarForList(li.querySelector('.elo-progress-container'));
            }
            playerListContainerEl.appendChild(li);
        });
    }

    function displayDetailCard(player) {
        detailCardContainer.style.display = 'block';
        mainContentArea.classList.add('detail-visible');
        if (!player || player.error) {
            detailCardContainer.innerHTML = `<div class='player-card-hltv error-card'>${player.nickname} – ${player.error}</div>`;
            return;
        }
        const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${player.nickname}`;
        const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';
        detailCardContainer.innerHTML = `
        <div class="player-card-hltv">
          <div class="card-header">
            <a href="${faceitUrl}" target="_blank">
              <img src="${player.avatar}" class="avatar" onerror="this.src='default_avatar.png'" />
            </a>
            <div>
              <a href="${faceitUrl}" target="_blank" class="player-name">${player.nickname}</a>
              <div class="stats-label">${matchesText}</div>
            </div>
          </div>
          <div class="stats-grid">
          <div class="stat-item" data-stat="rating">
               <div class="label">Rating 2.0</div>
               <div class="value">${safe(player.rating, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="dpr">
               <div class="label">DPR</div>
               <div class="value">${safe(player.dpr, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="kast">
               <div class="label">KAST %</div>
               <div class="value">${safe(player.kast, 1, '%')}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="kd">
               <div class="label">K/D</div>
               <div class="value">${safe(player.kd, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="adr">
               <div class="label">ADR</div>
               <div class="value">${safe(player.adr, 1)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="kpr">
               <div class="label">KPR</div>
               <div class="value">${safe(player.kpr, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
            </div>
         </div>`;
        updateStatProgressBars(detailCardContainer, player);
    }

    playerListContainerEl.addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li) return;
        const pd = allPlayersData.find(p => p.nickname === li.dataset.nickname);
        if (pd) displayDetailCard(pd);
    });

    (async () => {
        loadingIndicator.style.display = 'block';
        try {
            const names = await (await fetch('/players.json')).json();
            const settled = await Promise.allSettled(names.map(getPlayerData));
            allPlayersData = settled.map(r => r.status === 'fulfilled' ? r.value : {nickname: '?', error: r.reason});
            allPlayersData.sort((a, b) => (b.sortElo || 0) - (a.sortElo || 0));
            displayPlayerList(allPlayersData);
        } catch (err) {
            errorMessageElement.textContent = err.message;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    })();
});
