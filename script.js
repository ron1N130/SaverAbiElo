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
    const detailCardContainer   = document.getElementById("player-detail-card-container");
    const mainContentArea       = document.getElementById("main-content-area");
    const loadingIndicator      = document.getElementById("loading-indicator");
    const errorMessageElement   = document.getElementById("error-message");

    let allPlayersData = [];

    const thresholds = {
        calculatedRating: { bad: 0.85,  okay: 1.05, good: 1.25, max: 1.8 },
        dpr:              { bad: 0.5,   okay: 0.65, good: 0.85, max: 1.0 },
        kast:             { bad: 50,    okay: 60,   good: 70,  max: 100 },
        kd:               { bad: 0.8,   okay: 1.0,  good: 1.2, max: 2.0 },
        adr:              { bad: 65,    okay: 80,   good: 95,  max: 120 },
        kpr:              { bad: 0.5,   okay: 0.6,  good: 0.8, max: 1.2 },
        elo:              { bad: 1100,  okay: 1700,good: 2200,max: 3500 }
    };

    // Progress‑Bar in Liste aktualisieren
    function updateEloProgressBarForList(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar) return;
        const cfg = thresholds.elo;
        let pct = 0, col = 'var(--bar-color-bad)';
        if (!isNaN(elo) && elo > 0) {
            pct = Math.min(100, (elo / cfg.max) * 100);
            if (elo >= cfg.good)      col = 'var(--bar-color-good)';
            else if (elo >= cfg.okay) col = 'var(--bar-color-okay)';
        } else {
            col = 'var(--bar-background)';
        }
        bar.style.width = `${pct}%`;
        bar.style.backgroundColor = col;
    }

    // Bars in Detail‑Card aktualisieren
    function updateStatProgressBars(card, player) {
        card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
            const stat = item.dataset.stat;
            const val  = stat === 'elo' ? player.sortElo : player[stat];
            const cfg  = thresholds[stat] || { max: 1 };
            const bar  = item.querySelector('.stat-progress-bar');
            const lbl  = item.querySelector('.stat-indicator-label');
            let pct = 0, col = 'var(--bar-color-bad)', txt = '---';
            if (val != null && !isNaN(val)) {
                pct = Math.min(100, (val / cfg.max) * 100);
                if      (val >= cfg.good)  { col = 'var(--bar-color-good)';  txt = 'GOOD'; }
                else if (val >= cfg.okay)  { col = 'var(--bar-color-okay)'; txt = 'OKAY'; }
                else                       { col = 'var(--bar-color-bad)';  txt = 'BAD'; }
            }
            bar.style.width = `${pct}%`;
            bar.style.backgroundColor = col;
            lbl.textContent = txt;
        });
    }

    // Spieler‑Daten von API holen
    async function getPlayerData(nickname) {
        try {
            const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const p = await res.json();
            // in Numbers konvertieren
            p.sortElo          = toNum(p.elo);
            p.calculatedRating = toNum(p.calculatedRating);
            p.dpr              = toNum(p.dpr);
            p.kast             = toNum(p.kast);
            p.kd               = toNum(p.kd);
            p.adr              = toNum(p.adr);
            p.kpr              = toNum(p.kpr);
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
                li.innerHTML = `<span class='player-info'>${player.nickname} – Fehler: ${player.error}</span>`;
            } else {
                li.innerHTML = `
          <span class='player-info'>
            <img src='${player.avatar || 'default_avatar.png'}' class='avatar' onerror="this.src='default_avatar.png'" />
            <span class='player-name'>${player.nickname}</span>
          </span>
          <div class='player-list-right'>
            <span class='player-elo'>${player.sortElo ?? 'N/A'}</span>
            <div class='elo-progress-container' data-elo='${player.sortElo}'><div class='elo-progress-bar'></div></div>
          </div>`;
                updateEloProgressBarForList(li.querySelector('.elo-progress-container'));
            }
            playerListContainerEl.appendChild(li);
        });
    }

    // Detail‑Card rendern (3×2 Layout)
    function displayDetailCard(player) {
        // erst Detail-Container sichtbar machen und Layout anpassen
        detailCardContainer.style.display = 'block';
        mainContentArea.classList.add('detail-visible');

        if (!player || player.error) {
            detailCardContainer.innerHTML = `<div class='player-card-hltv error-card'>${player.nickname} – ${player.error}</div>`;
            return;
        }

        const faceitUrl   = player.faceitUrl || `https://www.faceit.com/en/players/${player.nickname}`;
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
          <div class="stat-item" data-stat="calculatedRating">
            <div class="label">Rating 2.0</div>
            <div class="value">${safe(player.calculatedRating, 2)}</div>
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
      </div>
    `;

        // jetzt die Progress‑Bars animieren
        updateStatProgressBars(detailCardContainer, player);
    }

    // Klick‑Handler
    playerListContainerEl.addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li) return;
        const pd = allPlayersData.find(p => p.nickname === li.dataset.nickname);
        if (pd) displayDetailCard(pd);
    });

    // Initial Load
    (async () => {
        loadingIndicator.style.display = 'block';
        try {
            const names    = await (await fetch('/players.json')).json();
            const settled  = await Promise.allSettled(names.map(getPlayerData));
            allPlayersData = settled.map(r => r.status === 'fulfilled' ? r.value : { nickname:'?', error:r.reason });
            allPlayersData.sort((a,b)=> (b.sortElo||0)-(a.sortElo||0));
            displayPlayerList(allPlayersData);
        } catch (err) {
            errorMessageElement.textContent    = err.message;
            errorMessageElement.style.display  = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    })();
});
