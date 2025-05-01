// script.js - Korrigierte Version nach Copy-Paste-Fehlern
// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    // Doppelte Einträge entfernt, letzte Definition beibehalten
    rating: { bad: 0.85, okay: 1.05, good: 1.25, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.6, max: 1 }, // Niedriger ist besser
    kast: { bad: 50, okay: 60, good: 70, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.0 },
    adr: { bad: 65, okay: 70, good: 85, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, max: 1.2 },
    impact: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.5 }, // Letzte Definition beibehalten
    elo: { bad: 1800, okay: 2000, good: 2900, max: 3500 },
    hsp: { bad: 15, okay: 25, good: 35, max: 60 },
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
    if (!playerListContainerEl || !loadingIndicatorSaverAbi || !saverAbiContent || !uniligaContent) {
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
            // Fehler von API zurückgeben, wird in loadSaverAbiView behandelt
            return { nickname, error: p.error, sortElo: -1 };
        }
        // Gültige Daten verarbeiten (nur einmal)
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
        // Fehlerobjekt zurückgeben
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

// Korrekte Funktion zum Anzeigen der Detailkarte
function displayDetailCard(player) {
    if (!detailCardContainer || !mainContentArea) return;

    if (!saverAbiContent.classList.contains('active')) {
        detailCardContainer.style.display = 'none';
        mainContentArea.classList.remove('detail-visible');
        return;
    }

    detailCardContainer.style.display = 'block';
    mainContentArea.classList.add('detail-visible');

    if (!player || player.error) {
        detailCardContainer.innerHTML = `<div class='player-card-hltv error-card'>${player?.nickname || 'Spieler'} – Fehler: ${player?.error || 'Unbekannt'}</div>`;
        return; // Beende hier, wenn Spieler fehlerhaft
    }

    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';
    const lastUpdatedText = player.lastUpdated ? ` | Stand: ${new Date(player.lastUpdated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr` : '';

    detailCardContainer.innerHTML = `
        <div class="player-card-hltv new-layout">
          <div class="card-header">
            <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer"><img src="${player.avatar}" class="avatar" alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" /></a>
            <div>
              <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer" class="player-name">${player.nickname}</a>
              <div class="stats-label">${matchesText}${lastUpdatedText}</div>
            </div>
          </div>
          <div class="stats-grid">
             <div class="stat-item" data-stat="rating"><div class="label">Rating 2.0</div><div class="value">${safe(player.rating, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="dpr"><div class="label">DPR</div><div class="value">${safe(player.dpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="kast"><div class="label">KAST</div><div class="value">${safe(player.kast, 1, '%')}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="impact"><div class="label">IMPACT</div><div class="value">${safe(player.impact, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="adr"><div class="label">ADR</div><div class="value">${safe(player.adr, 1)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             <div class="stat-item" data-stat="kpr"><div class="label">KPR</div><div class="value">${safe(player.kpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
            </div>
         </div>`;
    // Update der Fortschrittsbalken nur, wenn Spieler gültig ist
    updateStatProgressBars(detailCardContainer, player);
}

// Korrekte Funktion zum Updaten der Fortschrittsbalken (Drittel-Stil)
function updateStatProgressBars(card, player) {
    card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
        const stat = item.dataset.stat;
        const val = player[stat];
        const cfg = thresholds[stat];
        const bar = item.querySelector('.stat-progress-bar');
        const lbl = item.querySelector('.stat-indicator-label');

        // Entferne den Indikator, da er im letzten CSS entfernt wurde
        // const indicator = item.querySelector('.stat-progress-indicator');
        // if (!cfg || !bar || !lbl || !indicator) { ... }
        if (!cfg || !bar || !lbl) { // Prüfung ohne Indikator
             if(lbl) lbl.textContent = '---';
             if(bar) { bar.style.left = '0%'; bar.style.width = '0%'; bar.style.backgroundColor = 'transparent'; bar.style.boxShadow = 'none';}
             return;
        }

        let category = 0; let text = 'BAD'; let color = 'var(--bar-bad)'; let barLeft = '0%';
        const barWidth = '33.333%';

        if (val != null && !isNaN(val)) {
            if (stat === 'dpr') {
                if (val <= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '0%'; }
                else if (val <= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '66.666%'; }
            } else {
                if (val >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '66.666%'; }
                else if (val >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '0%'; }
            }
        } else { text = '---'; category = -1; color = 'transparent'; barLeft = '0%'; }

        bar.style.left = barLeft;
        bar.style.width = barWidth;
        bar.style.backgroundColor = color;
        bar.style.boxShadow = (category !== -1) ? `0 0 8px ${color}` : 'none';
        lbl.textContent = text;
        lbl.style.color = (category !== -1) ? color : 'var(--text-secondary)';
    });
}

// Korrekte Funktion zum Laden der SaverAbi-Ansicht
async function loadSaverAbiView() {
    console.log("loadSaverAbiView called");
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl || !detailCardContainer || !mainContentArea) { console.error("FEHLER: Benötigte Elemente für SaverAbi View fehlen!"); if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageSaverAbi.style.display = 'block'; } return; }

    loadingIndicatorSaverAbi.style.display = 'block';
    errorMessageSaverAbi.style.display = 'none';
    playerListContainerEl.innerHTML = '';
    detailCardContainer.style.display = 'none';
    mainContentArea.classList.remove('detail-visible');
    allPlayersData = [];

    try {
        console.log("Fetching players.json...");
        const namesRes = await fetch('/players.json');
        console.log("players.json status:", namesRes.status);
        if (!namesRes.ok) throw new Error(`Fehler Laden Spielerliste (${namesRes.status})`);
        const names = await namesRes.json();
        console.log("Player names loaded:", names);
        if (!Array.isArray(names) || names.length === 0) throw new Error("Spielerliste leer/ungültig.");

        console.log("Fetching player data for all players...");
        const promises = names.map(name => getPlayerData(name));
        const results = await Promise.all(promises);
        console.log("Player data fetch results (raw):", results);

        allPlayersData = results; // Beinhaltet jetzt Objekte mit Daten oder Fehler

        const validPlayerCount = allPlayersData.filter(p => !p.error).length;
        console.log(`Gültige Spielerdaten empfangen: ${validPlayerCount} / ${allPlayersData.length}`);
        if(validPlayerCount === 0 && allPlayersData.length > 0) {
             console.warn("Keine gültigen Spielerdaten von der API erhalten, nur Fehler.");
        }

        allPlayersData.sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1));
        console.log("Sorted player data:", allPlayersData);

        displayPlayerList(allPlayersData); // Zeigt Liste an (inkl. Fehler)

        if (playerListContainerEl) {
            playerListContainerEl.removeEventListener('click', handlePlayerListClick);
            playerListContainerEl.addEventListener('click', handlePlayerListClick);
            console.log("Click listener added.");
        } else { console.warn("Konnte Click listener nicht hinzufügen."); }

    } catch (err) {
        console.error("Schwerwiegender Fehler in loadSaverAbiView:", err);
        if(errorMessageSaverAbi){ errorMessageSaverAbi.textContent = `Fehler: ${err.message}`; errorMessageSaverAbi.style.display = 'block'; }
        if(playerListContainerEl) playerListContainerEl.innerHTML = '';
    } finally {
        console.log("loadSaverAbiView finally block reached.");
        if (loadingIndicatorSaverAbi) { loadingIndicatorSaverAbi.style.display = 'none'; console.log("Loading indicator hidden."); }
        else { console.warn("loadingIndicatorSaverAbi nicht gefunden im finally block."); }
    }
}

// Korrekter Event-Handler für Klicks auf die Spielerliste
function handlePlayerListClick(e) {
    const li = e.target.closest('li');
    if (!li || !li.dataset.nickname) return;
    const nickname = li.dataset.nickname;
    const playerData = allPlayersData.find(p => p.nickname === nickname);
    if (playerData) {
        displayDetailCard(playerData); // Ruft korrigierte Funktion auf
    } else {
        console.warn(`Keine Daten gefunden für geklickten Spieler: ${nickname}`);
    }
}

// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht
// -------------------------------------------------------------
let uniligaDataLoaded = false;
let currentUniligaData = null;

// Korrekte Funktion zum Laden der Uniliga-Daten
async function loadUniligaView() {
    if (uniligaDataLoaded && currentUniligaData) {
        displayUniligaData(currentUniligaData);
        return;
    }
    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaDataArea) return;

    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    uniligaDataArea.innerHTML = '<p>Lade Uniliga Daten von der API...</p>';

    try {
        console.log("Fetching /api/uniliga-stats...");
        const response = await fetch('/api/uniliga-stats');
        console.log("Fetch status:", response.status);
        if (!response.ok) {
            let errorMsg = `API Fehler (${response.status})`; try { const errData = await response.json(); errorMsg = errData.error || errData.details || errorMsg; } catch (e) { /* ignore */ }
            throw new Error(errorMsg);
        }
        const data = await response.json();
        console.log("Received Uniliga data:", data);
        if (data.error) { throw new Error(data.error); }
        if (!data.players || !data.teams) { throw new Error("Ungültiges Datenformat von der API empfangen."); }
        currentUniligaData = data;
        displayUniligaData(currentUniligaData);
        uniligaDataLoaded = true;
    } catch (err) {
        console.error("Fehler in loadUniligaView:", err);
        errorMessageUniliga.textContent = `Fehler beim Laden der Uniliga-Daten: ${err.message}`;
        errorMessageUniliga.style.display = 'block';
        uniligaDataArea.innerHTML = '';
        uniligaDataLoaded = false;
        currentUniligaData = null;
    } finally {
        loadingIndicatorUniliga.style.display = 'none';
    }
}

// Korrekte Funktion zum Erstellen und Anzeigen der Uniliga-Tabellen
function displayUniligaData(data) {
    if (!uniligaDataArea || !data) return;
    const { players, teams, lastUpdated, championshipId } = data;
    let playerTableHTML = `<h3>Spieler Ranking (Top 50 nach Rating)</h3><p>Basierend auf Matches in Championship: ${championshipId}</p><div class="table-container"><table class="stats-table"><thead><tr><th>#</th><th>Spieler</th><th>Rating</th><th>Impact</th><th>KPR</th><th>ADR</th><th>KAST</th><th>DPR</th><th>KD</th><th>HS%</th><th>Win%</th><th>Spiele</th></tr></thead><tbody>`;
    players.slice(0, 50).forEach((player, index) => { playerTableHTML += `<tr><td>${index + 1}</td><td class="player-cell"><img src="${player.avatar || 'default_avatar.png'}" class="table-avatar" alt="Avatar ${player.nickname}" onerror="this.src='default_avatar.png'"/><span>${player.nickname || 'Unbekannt'}</span></td><td>${safe(player.rating, 2)}</td><td>${safe(player.impact, 2)}</td><td>${safe(player.kpr, 2)}</td><td>${safe(player.adr, 1)}</td><td>${safe(player.kast, 1, '%')}</td><td>${safe(player.dpr, 2)}</td><td>${safe(player.kd, 2)}</td><td>${safe(player.hsp, 1, '%')}</td><td>${safe(player.winRate, 1, '%')}</td><td>${player.matchesPlayed || 'N/A'}</td></tr>`; });
    playerTableHTML += `</tbody></table></div>`;
    let teamTableHTML = `<h3 style="margin-top: 2rem;">Team Ranking (nach Winrate)</h3><div class="table-container"><table class="stats-table"><thead><tr><th>#</th><th>Team</th><th>Winrate</th><th>Avg. Rating</th><th>Spiele</th><th>Siege</th><th>Niederl.</th></tr></thead><tbody>`;
    teams.forEach((team, index) => { teamTableHTML += `<tr><td>${index + 1}</td><td>${team.name || 'Unbekanntes Team'}</td><td class="${getTeamWinrateClass(team.winRate)}">${safe(team.winRate, 1, '%')}</td><td>${safe(team.avgRating, 2)}</td><td>${team.matchesPlayed || 0}</td><td>${team.wins || 0}</td><td>${team.losses || 0}</td></tr>`; });
    teamTableHTML += `</tbody></table></div><p class="last-updated">Datenstand: ${lastUpdated ? new Date(lastUpdated).toLocaleString('de-DE') : 'Unbekannt'}</p>`;
    uniligaDataArea.innerHTML = playerTableHTML + teamTableHTML;
}

// Korrekte Hilfsfunktion für Team-Winrate-Farbe
function getTeamWinrateClass(winRate) {
    const cfg = thresholds.winRate;
    if (winRate == null) return '';
    if (winRate >= cfg.good) return 'text-good';
    if (winRate >= cfg.okay) return 'text-okay';
    return 'text-bad';
}

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