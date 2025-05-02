// *** THRESHOLDS BEREINIGT, ZEIGT K/D STATT IMPACT ***
// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    // Bereinigt - letzte Definition aus deinem Code übernommen
    rating: { bad: 0.85, okay: 1.05, good: 1.2, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.6, max: 1 }, // Niedriger ist besser (letzte Definition)
    kast: { bad: 58, okay: 66, good: 75, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.0 }, // KD wieder relevant für Anzeige (letzte Definition)
    adr: { bad: 65, okay: 70, good: 85, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, max: 1.2 },
    impact: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.5 }, // Bleibt intern für Berechnung (letzte Definition)
    elo: { bad: 1800, okay: 2000, good: 2900, max: 4000 },
    hsp: { bad: 15, okay: 35, good: 44, max: 60 },
    winRate: { bad: 40, okay: 50, good: 60, max: 100 }
};

function safe(v, digits = 2, suf = "") {
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    return Number.isFinite(num) ? num.toFixed(digits) + suf : "—";
}

function toNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

// -------------------------------------------------------------
// DOM-Elemente Cachen
// -------------------------------------------------------------
let playerListContainerEl, detailCardContainer, mainContentArea,
    loadingIndicatorSaverAbi, errorMessageSaverAbi,
    loadingIndicatorUniliga, errorMessageUniliga, uniligaDataArea,
    saverAbiContent, uniligaContent,
    toggleButtons, allPlayersData = [];

function cacheDOMElements() {
    console.log("Caching DOM elements...");
    playerListContainerEl = document.getElementById("player-list");
    detailCardContainer = document.getElementById("player-detail-card-container");
    mainContentArea = document.getElementById("main-content-area");
    loadingIndicatorSaverAbi = document.getElementById("loading-indicator-saverabi");
    errorMessageSaverAbi = document.getElementById("error-message-saverabi");
    saverAbiContent = document.getElementById("saverabi-content");
    loadingIndicatorUniliga = document.getElementById("loading-indicator-uniliga");
    errorMessageUniliga = document.getElementById("error-message-uniliga");
    uniligaDataArea = document.getElementById("uniliga-data-area");
    uniligaContent = document.getElementById("uniliga-content");
    toggleButtons = document.querySelectorAll(".toggle-button");
    if (!playerListContainerEl || !loadingIndicatorSaverAbi || !saverAbiContent || !uniligaContent || !uniligaDataArea) {
        console.error("FEHLER: Wichtige DOM-Elemente wurden nicht gefunden!");
    } else {
        console.log("DOM elements cached successfully.");
    }
}

// -------------------------------------------------------------
// Funktionen für die SaverAbi-Ansicht
// -------------------------------------------------------------
async function getPlayerData(nickname) {
    try {
        const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try { const errData = await res.json(); errorMsg = errData.error || errorMsg; } catch (parseError) { /* ignore */ }
            throw new Error(errorMsg); // Fehler werfen
        }
        const p = await res.json();
        if (p.error) {
            return { nickname, error: p.error, sortElo: -1 };
        }
        p.sortElo = toNum(p.elo);
        p.rating = toNum(p.calculatedRating ?? p.rating);
        p.dpr = toNum(p.dpr);
        p.kast = toNum(p.kast);
        p.kd = toNum(p.kd);
        p.adr = toNum(p.adr);
        p.kpr = toNum(p.kpr);
        p.hsp = toNum(p.hsPercent); // hsPercent aus API wird zu hsp
        p.impact = toNum(p.impact);
        return p;
    } catch (err) {
        console.error(`getPlayerData error for ${nickname}:`, err.message);
        return { nickname, error: err.message || "Netzwerkfehler", sortElo: -1 };
    }
}

function displayPlayerList(players) {
    console.log(`[displayPlayerList] Aufgerufen mit ${players?.length ?? 0} Spieler-Objekten.`);
    if (!playerListContainerEl) { console.error("FEHLER: playerListContainerEl ist null in displayPlayerList!"); return; }
    playerListContainerEl.innerHTML = '';
    if (!players || players.length === 0) { console.log("Keine Spielerdaten zum Anzeigen vorhanden."); return; }

    players.forEach((player, index) => {
        const li = document.createElement('li');
        li.dataset.nickname = player.nickname;
        if (player.error) {
            li.classList.add('error-item');
            li.innerHTML = `<span class='player-info'><img src='default_avatar.png' class='avatar' alt="Standard Avatar"/><span class='player-name'>${player.nickname}</span></span><div class='player-list-right error-text'>Fehler: ${player.error.substring(0, 30)}${player.error.length > 30 ? '...' : ''}</div>`;
        } else {
            li.innerHTML = `<span class='player-info'><img src='${player.avatar || 'default_avatar.png'}' class='avatar' alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" /><span class='player-name'>${player.nickname}</span></span><div class='player-list-right'><span class='player-elo'>${player.sortElo ?? 'N/A'}</span><div class='elo-progress-container' data-elo='${player.sortElo || 0}'><div class='elo-progress-bar'></div></div></div>`;
            const eloBarContainer = li.querySelector('.elo-progress-container');
            if (eloBarContainer) updateEloProgressBarForList(eloBarContainer);
        }
        playerListContainerEl.appendChild(li);
    });
    console.log("[displayPlayerList] Rendering abgeschlossen.");
}

function updateEloProgressBarForList(containerEl) {
    if (!containerEl) return;
    const val = parseInt(containerEl.dataset.elo, 10) || 0;
    const cfg = thresholds.elo;
    const pct = Math.min(100, (val / cfg.max) * 100);
    const bar = containerEl.querySelector('.elo-progress-bar');
    if (!bar) return;
    bar.style.width = pct + '%';
    let color = 'var(--bar-bad)';
    if (val >= cfg.good) color = 'var(--bar-good)';
    else if (val >= cfg.okay) color = 'var(--bar-okay)';
    bar.style.backgroundColor = color;
}

function displayDetailCard(player) {
    if (!detailCardContainer || !mainContentArea) return;
    const saverAbiContent = document.getElementById('saverabi-content'); // Stelle sicher, dass das Element existiert
    if (!saverAbiContent || !saverAbiContent.classList.contains('active')) {
        detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        return;
    }
    detailCardContainer.style.display = 'block';
    if (mainContentArea) mainContentArea.classList.add('detail-visible');
    if (!player || player.error) { detailCardContainer.innerHTML = `<div class='player-card-hltv error-card'>${player?.nickname || 'Spieler'} – Fehler: ${player?.error || 'Unbekannt'}</div>`; return; }
    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';
    const lastUpdatedText = player.lastUpdated ? ` | Stand: ${new Date(player.lastUpdated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr` : '';
    detailCardContainer.innerHTML = `
        <div class="player-card-hltv new-layout">
          <div class="card-header">
            <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer"><img src="${player.avatar}" class="avatar" alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" /></a>
            <div><a href="${faceitUrl}" target="_blank" rel="noopener noreferrer" class="player-name">${player.nickname}</a><div class="stats-label">${matchesText}${lastUpdatedText}</div></div>
          </div>
          <div class="stats-grid">
             <div class="stat-item" data-stat="rating"><div class="label">Rating 2.0</div><div class="value">${safe(player.rating, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="dpr"><div class="label">DPR</div><div class="value">${safe(player.dpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="kast"><div class="label">KAST</div><div class="value">${safe(player.kast, 1, '%')}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="kd"><div class="label">K/D</div><div class="value">${safe(player.kd, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="adr"><div class="label">ADR</div><div class="value">${safe(player.adr, 1)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="kpr"><div class="label">KPR</div><div class="value">${safe(player.kpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
            </div>
         </div>`;
    updateStatProgressBars(detailCardContainer, player);
}

function updateStatProgressBars(card, player) {
    card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
        const stat = item.dataset.stat; const val = player[stat]; const cfg = thresholds[stat];
        const bar = item.querySelector('.stat-progress-bar'); const lbl = item.querySelector('.stat-indicator-label');
        if (!cfg || !bar || !lbl) { if(lbl) lbl.textContent = '---'; if(bar) { bar.style.left = '0%'; bar.style.width = '0%'; bar.style.backgroundColor = 'transparent'; bar.style.boxShadow = 'none'; bar.style.borderRadius = '0';} return; }
        let category = 0; let text = 'BAD'; let color = 'var(--bar-bad)'; let barLeft = '0%'; const barWidth = '33.333%'; let borderRadiusStyle = '0';
        if (val != null && !isNaN(val)) {
            if (stat === 'dpr') { if (val <= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; } else if (val <= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; } else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; } }
            else { if (val >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; } else if (val >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; } else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; } }
        } else { text = '---'; category = -1; color = 'transparent'; barLeft = '0%'; borderRadiusStyle = '0';}
        bar.style.left = barLeft; bar.style.width = barWidth; bar.style.backgroundColor = color; bar.style.boxShadow = (category !== -1) ? `0 0 8px ${color}` : 'none'; bar.style.borderRadius = borderRadiusStyle;
        lbl.textContent = text; lbl.style.color = (category !== -1) ? color : 'var(--text-secondary)';
    });
}

async function loadSaverAbiView() {
    console.log("loadSaverAbiView called");
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl || !detailCardContainer || !mainContentArea) { console.error("FEHLER: Benötigte Elemente für SaverAbi View fehlen!"); if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageSaverAbi.style.display = 'block'; } return; }
    loadingIndicatorSaverAbi.style.display = 'block'; errorMessageSaverAbi.style.display = 'none'; playerListContainerEl.innerHTML = ''; detailCardContainer.style.display = 'none'; if(mainContentArea) mainContentArea.classList.remove('detail-visible'); allPlayersData = [];
    try {
        console.log("Fetching players.json..."); const namesRes = await fetch('/players.json'); console.log("players.json status:", namesRes.status); if (!namesRes.ok) throw new Error(`Fehler Laden Spielerliste (${namesRes.status})`); const names = await namesRes.json(); console.log("Player names loaded:", names); if (!Array.isArray(names) || names.length === 0) throw new Error("Spielerliste leer/ungültig.");
        console.log("Fetching player data for all players..."); const promises = names.map(name => getPlayerData(name)); const results = await Promise.all(promises); console.log("Player data fetch results (raw):", results); allPlayersData = results;
        const validPlayerCount = allPlayersData.filter(p => !p.error).length; console.log(`Gültige Spielerdaten empfangen: ${validPlayerCount} / ${allPlayersData.length}`); if(validPlayerCount === 0 && allPlayersData.length > 0) { console.warn("Keine gültigen Spielerdaten von der API erhalten, nur Fehler."); }
        allPlayersData.sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1)); console.log("Sorted player data:", allPlayersData);
        displayPlayerList(allPlayersData);
        if (playerListContainerEl) { playerListContainerEl.removeEventListener('click', handlePlayerListClick); playerListContainerEl.addEventListener('click', handlePlayerListClick); console.log("Click listener added."); } else { console.warn("Konnte Click listener nicht hinzufügen."); }
    } catch (err) { console.error("Schwerwiegender Fehler in loadSaverAbiView:", err); if(errorMessageSaverAbi){ errorMessageSaverAbi.textContent = `Fehler: ${err.message}`; errorMessageSaverAbi.style.display = 'block'; } if(playerListContainerEl) playerListContainerEl.innerHTML = ''; }
    finally { console.log("loadSaverAbiView finally block reached."); if (loadingIndicatorSaverAbi) { loadingIndicatorSaverAbi.style.display = 'none'; console.log("Loading indicator hidden."); } else { console.warn("loadingIndicatorSaverAbi nicht gefunden im finally block."); } }
}

function handlePlayerListClick(e) {
    const li = e.target.closest('li'); if (!li || !li.dataset.nickname) return; const nickname = li.dataset.nickname; const playerData = allPlayersData.find(p => p.nickname === nickname); if (playerData) { displayDetailCard(playerData); } else { console.warn(`Keine Daten gefunden für geklickten Spieler: ${nickname}`); }
}

// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht
// -------------------------------------------------------------
let uniligaDataLoaded = false;
let currentUniligaData = null;
async function loadUniligaView() { /* ... (unverändert) ... */ }
function displayUniligaData(data) { /* ... (unverändert) ... */ }
function getTeamWinrateClass(winRate) { /* ... (unverändert) ... */ }

// -------------------------------------------------------------
// Umschaltlogik für Ansichten
// -------------------------------------------------------------
function switchView(viewToShow) {
    // Korrekte Version ohne Duplikate
    document.querySelectorAll('.view-content').forEach(content => content.classList.remove('active'));
    if (toggleButtons) toggleButtons.forEach(button => button.classList.remove('active'));
    const contentToShow = document.getElementById(`${viewToShow}-content`);
    if (contentToShow) contentToShow.classList.add('active');
    const buttonToActivate = document.querySelector(`.toggle-button[data-view="${viewToShow}"]`);
    if (buttonToActivate) buttonToActivate.classList.add('active');
    if (viewToShow === 'uniliga' && detailCardContainer) {
         detailCardContainer.style.display = 'none';
        if(mainContentArea) mainContentArea.classList.remove('detail-visible');
    }
    if (viewToShow === 'uniliga') {
        loadUniligaView(); // Nur einmal aufrufen
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOMContentLoaded event fired.");
    cacheDOMElements();
    if (toggleButtons) {
        // Korrekte Version ohne Duplikate
        toggleButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const view = event.target.dataset.view;
                if (view) switchView(view);
            });
        });
    } else { console.warn("Toggle buttons not found."); }
    console.log("Initializing default view: saverabi");
    switchView('saverabi');
    loadSaverAbiView();
});