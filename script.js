// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    // Bereinigt - letzte Definition aus deinem Code übernommen
    rating: { bad: 0.85, okay: 1.05, good: 1.2, great: 1.3, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.63, great: 0.55, max: 1 }, // Niedriger ist besser (letzte Definition)
    kast: { bad: 58, okay: 66, good: 75, great: 80, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, great: 1.4, max: 2.0 }, // KD wieder relevant für Anzeige (letzte Definition)
    adr: { bad: 65, okay: 70, good: 85, great: 90, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, great: 0.9, max: 1.2 },
    impact: { bad: 1, okay: 1.3, good: 1.45, great: 1.55, max: 1.8 }, // Bleibt intern für Berechnung (letzte Definition)
    elo: { bad: 1800, okay: 2000, good: 2600, great: 2900, max: 4000 },
    hsp: { bad: 15, okay: 35, good: 44, great: 0.55, max: 60 },
    winRate: { bad: 40, okay: 50, good: 60, great: 70, max: 100 }
};

let teamIconMap = {}; // Speichert das Mapping von Teamnamen zu Icon-Dateinamen
let allPlayersData = []; // Globale Speicherung der Spielerdaten für SaverAbi
let currentSortMode = 'elo'; // Start-Sortiermodus ('elo' oder 'worth')

function safe(v, digits = 2, suf = "") {
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    return Number.isFinite(num) ? num.toFixed(digits) + suf : "—";
}

function safeWorth(v) {
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    // Formatieren als "Währung" ohne Nachkommastellen und mit Tausendertrennzeichen
    return Number.isFinite(num) ? '$' + num.toLocaleString('de-DE', { maximumFractionDigits: 0 }) : "—";
}


function toNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

// -------------------------------------------------------------
// Hilfsfunktionen (oder eigener Abschnitt für Datenladen)
// -------------------------------------------------------------

async function loadTeamIconMap() {
    // Nur laden, wenn die Map noch leer ist
    if (Object.keys(teamIconMap).length > 0) {
        console.log("Team icon map already loaded.");
        return;
    }

    try {
        // *** Pfad zurück zum Root-Verzeichnis ***
        console.log("Fetching /uniliga_teams.json..."); // Pfad im Log korrigiert
        const response = await fetch('/uniliga_teams.json'); // Pfad korrigiert
        console.log("[LOG] /uniliga_teams.json fetch status:", response.status); // Log Pfad korrigiert
        if (!response.ok) {
            throw new Error(`Fehler beim Laden der Team-Icons (${response.status}) from ${response.url}`);
        }
        const teamsData = await response.json();
        console.log("[LOG] uniliga_teams.json raw data:", teamsData); // LOG Rohdaten

        teamIconMap = teamsData.reduce((map, team) => {
            if (team.name && team.icon) {
                map[team.name] = team.icon;
            }
            return map;
        }, {});
        console.log("[LOG] Team icon map created:", teamIconMap); // LOG Ergebnis Map

    } catch (err) {
        console.error("Fehler beim Laden oder Verarbeiten von uniliga_teams.json:", err);
        teamIconMap = {}; // Sicherstellen, dass die Map leer ist bei Fehler
    }
}


// -------------------------------------------------------------
// DOM-Elemente Cachen
// -------------------------------------------------------------
let playerListContainerEl, detailCardContainer, mainContentArea,
    loadingIndicatorSaverAbi, errorMessageSaverAbi,
    loadingIndicatorUniliga, errorMessageUniliga, uniligaDataArea,
    saverAbiContent, uniligaContent,
    toggleButtons, sortEloButton, sortWorthButton, saverAbiListHeader; // Neue Elemente hinzugefügt

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
    saverAbiListHeader = document.getElementById("saverabi-list-header"); // Cache header

    // Neue Sortierbuttons
    sortEloButton = document.getElementById("sort-elo-btn");
    sortWorthButton = document.getElementById("sort-worth-btn");


    if (!playerListContainerEl || !loadingIndicatorSaverAbi || !saverAbiContent || !uniligaContent || !uniligaDataArea || !sortEloButton || !sortWorthButton || !saverAbiListHeader) {
        console.error("FEHLER: Wichtige DOM-Elemente wurden nicht gefunden (inkl. Sortierbuttons/Header)!");
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
            throw new Error(errorMsg);
        }
        const p = await res.json();
        if (p.error) {
            // Spieler mit Fehler bekommen -1 Elo und keinen Wert
            return { nickname, error: p.error, sortElo: -1, worth: null };
        }
        // Konvertiere relevante Felder sicher in Zahlen
        p.sortElo = toNum(p.elo);
        p.rating = toNum(p.calculatedRating ?? p.rating); // Nimm berechnetes Rating, wenn vorhanden
        p.dpr = toNum(p.dpr);
        p.kast = toNum(p.kast);
        p.kd = toNum(p.kd);
        p.adr = toNum(p.adr);
        p.kpr = toNum(p.kpr);
        p.hsp = toNum(p.hsPercent); // hsPercent aus API wird zu hsp
        p.impact = toNum(p.impact);

        // *** NEU: Berechne den "Geldwert" ***
        // Nur berechnen, wenn Elo und Rating gültige Zahlen sind
        if (p.sortElo !== null && p.rating !== null) {
             p.worth = p.sortElo * p.rating;
        } else {
             p.worth = null; // Kein Wert, wenn Daten fehlen
        }
        // Spieler ohne Fehler, aber ggf. ohne Elo/Rating bekommen -1 für Sortierung, falls Wert null ist
        if (p.sortElo === null) p.sortElo = -1;


        return p;
    } catch (err) {
        console.error(`getPlayerData error for ${nickname}:`, err.message);
        // Spieler mit Fetch-Fehler bekommen -1 Elo und keinen Wert
        return { nickname, error: err.message || "Netzwerkfehler", sortElo: -1, worth: null };
    }
}

// *** NEU: Sortierfunktionen ***
function sortPlayersByElo(players) {
    return [...players].sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1));
}

function sortPlayersByWorth(players) {
    // Spieler mit gültigem Wert oben, dann nach Wert absteigend
    // Spieler ohne Wert (null) oder mit Fehler kommen ans Ende
    return [...players].sort((a, b) => {
        const worthA = a.worth ?? -Infinity; // Fehler/Null-Werte nach unten
        const worthB = b.worth ?? -Infinity;
        return worthB - worthA;
    });
}


function displayPlayerList(players) {
    console.log(`[displayPlayerList] Aufgerufen mit ${players?.length ?? 0} Spieler-Objekten. Sortierung: ${currentSortMode}`);
    if (!playerListContainerEl) { console.error("FEHLER: playerListContainerEl ist null in displayPlayerList!"); return; }
    if (!saverAbiListHeader) { console.error("FEHLER: saverAbiListHeader ist null!"); return;}

    playerListContainerEl.innerHTML = ''; // Liste leeren

    // Überschrift der Liste anpassen
    saverAbiListHeader.textContent = currentSortMode === 'elo' ? 'Spielerliste (sortiert nach Elo)' : 'Spielerliste (sortiert nach Wert)';

    if (!players || players.length === 0) { console.log("Keine Spielerdaten zum Anzeigen vorhanden."); return; }

    players.forEach((player) => {
        const li = document.createElement('li');
        li.dataset.nickname = player.nickname;

        if (player.error) {
            li.classList.add('error-item');
            li.innerHTML = `<span class='player-info'><img src='default_avatar.png' class='avatar' alt="Standard Avatar"/><span class='player-name'>${player.nickname}</span></span><div class='player-list-right error-text'>Fehler: ${player.error.substring(0, 30)}${player.error.length > 30 ? '...' : ''}</div>`;
        } else {
            // Entscheide, welcher Wert angezeigt wird (Elo oder Worth)
            const displayValue = currentSortMode === 'elo'
                ? `${player.sortElo ?? 'N/A'}` // Elo anzeigen
                : `${safeWorth(player.worth)}`; // Wert anzeigen (formatiert)

            // Elo-Fortschrittsbalken wird *immer* basierend auf Elo angezeigt, unabhängig von der Sortierung
            const eloProgressBarHtml = `<div class='elo-progress-container' data-elo='${player.sortElo ?? 0}'><div class='elo-progress-bar'></div></div>`;

            li.innerHTML = `
                <span class='player-info'>
                    <img src='${player.avatar || 'default_avatar.png'}' class='avatar' alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" />
                    <span class='player-name'>${player.nickname}</span>
                </span>
                <div class='player-list-right'>
                    <span class='player-value'>${displayValue}</span> ${eloProgressBarHtml} </div>`;

            // Update des Elo-Balkens für dieses Listenelement
            const eloBarContainer = li.querySelector('.elo-progress-container');
            if (eloBarContainer) updateEloProgressBarForList(eloBarContainer);
        }
        playerListContainerEl.appendChild(li);
    });
    console.log("[displayPlayerList] Rendering abgeschlossen.");
}


// Diese Funktion bleibt unverändert, sie zeigt immer den Elo-Balken
function updateEloProgressBarForList(containerEl) {
    if (!containerEl) return;
    const val = parseInt(containerEl.dataset.elo, 10) || 0;
    const cfg = thresholds.elo;
    const pct = Math.min(100, (val / cfg.max) * 100);
    const bar = containerEl.querySelector('.elo-progress-bar');
    if (!bar) return;
    bar.style.width = pct + '%';
    let color = 'var(--bar-bad)';
    if (val >= cfg.great) color = 'var(--bar-great)';
    else if (val >= cfg.good) color = 'var(--bar-good)';
    else if (val >= cfg.okay) color = 'var(--bar-okay)';
    bar.style.backgroundColor = color;
}

function displayDetailCard(player) {
    if (!detailCardContainer || !mainContentArea) return;
    const saverAbiContentEl = document.getElementById('saverabi-content');
    // Detailkarte nur anzeigen, wenn die SaverAbi-Ansicht aktiv ist
    if (!saverAbiContentEl || !saverAbiContentEl.classList.contains('active')) {
        detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        return;
    }

    detailCardContainer.style.display = 'block';
    if (mainContentArea) mainContentArea.classList.add('detail-visible');

    if (!player || player.error) {
        detailCardContainer.innerHTML = `<div class='player-card-hltv error-card'>${player?.nickname || 'Spieler'} – Fehler: ${player?.error || 'Unbekannt'}</div>`;
        return;
    }

    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';
    // const lastUpdatedText = player.lastUpdated ? ` | Stand: ${new Date(player.lastUpdated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr` : '';
     // *** NEU: Wertanzeige in der Detailkarte ***
    const worthDisplay = `<div class="stat-item worth-item"><div class="label">Wert</div><div class="value">${safeWorth(player.worth)}</div></div>`;


    detailCardContainer.innerHTML = `
        <div class="player-card-hltv new-layout">
          <div class="card-header">
            <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer"><img src="${player.avatar || 'default_avatar.png'}" class="avatar" alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" /></a>
            <div><a href="${faceitUrl}" target="_blank" rel="noopener noreferrer" class="player-name">${player.nickname}</a><div class="stats-label">${matchesText}</div></div>
          </div>
          <div class="stats-grid">
              <div class="stat-item" data-stat="rating"><div class="label">Rating 2.0</div><div class="value">${safe(player.rating, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="dpr"><div class="label">DPR</div><div class="value">${safe(player.dpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="kast"><div class="label">KAST</div><div class="value">${safe(player.kast, 1, '%')}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="impact"><div class="label">IMPACT</div><div class="value">${safe(player.impact, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="adr"><div class="label">ADR</div><div class="value">${safe(player.adr, 1)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="kpr"><div class="label">KPR</div><div class="value">${safe(player.kpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
             </div>
             <div class="stats-grid single-item-grid"> ${worthDisplay}
             </div>
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
            if (stat === 'dpr') { // Lower DPR is better
                if (val <= cfg.great) { category = 2; text = 'GREAT'; color = 'var(--bar-great)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
                else if (val <= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
                else if (val <= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
            }
            else { // Higher is better for other stats
                if (val >= cfg.great) { category = 2; text = 'GREAT'; color = 'var(--bar-great)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (val >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (val >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
            }
        } else {
            text = '---'; category = -1; color = 'transparent'; barLeft = '0%'; borderRadiusStyle = '0';
        }
        bar.style.left = barLeft; bar.style.width = barWidth; bar.style.backgroundColor = color; bar.style.boxShadow = (category !== -1) ? `0 0 8px ${color}` : 'none'; bar.style.borderRadius = borderRadiusStyle;
        lbl.textContent = text; lbl.style.color = (category !== -1) ? color : 'var(--text-secondary)';
    });
}


async function loadSaverAbiView() {
    console.log("loadSaverAbiView called");
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl || !detailCardContainer || !mainContentArea) { console.error("FEHLER: Benötigte Elemente für SaverAbi View fehlen!"); if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageSaverAbi.style.display = 'block'; } return; }

    loadingIndicatorSaverAbi.style.display = 'block';
    errorMessageSaverAbi.style.display = 'none';
    playerListContainerEl.innerHTML = '';
    detailCardContainer.style.display = 'none';
    if(mainContentArea) mainContentArea.classList.remove('detail-visible');
    allPlayersData = []; // Reset global player data

    try {
        console.log("Fetching players.json...");
        const namesRes = await fetch('/players.json');
        console.log("players.json status:", namesRes.status);
        if (!namesRes.ok) throw new Error(`Fehler Laden Spielerliste (${namesRes.status})`);
        const names = await namesRes.json();
        console.log("Player names loaded:", names);
        if (!Array.isArray(names) || names.length === 0) throw new Error("Spielerliste leer/ungültig.");

        console.log("Fetching player data for all players...");
        const promises = names.map(name => getPlayerData(name)); // getPlayerData berechnet jetzt auch 'worth'
        const results = await Promise.all(promises);
        console.log("Player data fetch results (raw):", results);
        allPlayersData = results; // Speichere die Rohdaten global

        const validPlayerCount = allPlayersData.filter(p => !p.error).length;
        console.log(`Gültige Spielerdaten empfangen: ${validPlayerCount} / ${allPlayersData.length}`);
        if(validPlayerCount === 0 && allPlayersData.length > 0) { console.warn("Keine gültigen Spielerdaten von der API erhalten, nur Fehler."); }

        // *** Initial sortieren basierend auf dem aktuellen Modus (Start: 'elo') ***
        sortAndDisplayPlayers(); // Diese Funktion sortiert und zeigt an

        // Event Listener für Klicks auf die Spielerliste
        if (playerListContainerEl) {
             playerListContainerEl.removeEventListener('click', handlePlayerListClick); // Sicherstellen, dass Listener nicht doppelt hinzugefügt wird
             playerListContainerEl.addEventListener('click', handlePlayerListClick);
             console.log("Click listener added to player list.");
        } else {
             console.warn("Konnte Click listener für Spielerliste nicht hinzufügen.");
        }
    } catch (err) {
        console.error("Schwerwiegender Fehler in loadSaverAbiView:", err);
        if(errorMessageSaverAbi){ errorMessageSaverAbi.textContent = `Fehler: ${err.message}`; errorMessageSaverAbi.style.display = 'block'; }
        if(playerListContainerEl) playerListContainerEl.innerHTML = '';
    }
    finally {
        console.log("loadSaverAbiView finally block reached.");
        if (loadingIndicatorSaverAbi) {
            loadingIndicatorSaverAbi.style.display = 'none';
            console.log("Loading indicator hidden.");
        } else {
            console.warn("loadingIndicatorSaverAbi nicht gefunden im finally block.");
        }
        // Sicherstellen, dass die Sortierbuttons sichtbar sind, wenn Daten geladen wurden (oder Fehler aufgetreten ist)
        const sortButtonContainer = document.getElementById('saverabi-sort-controls');
        if (sortButtonContainer) {
            sortButtonContainer.style.display = 'flex'; // Oder 'block', je nach CSS
        }
    }
}

// *** NEU: Funktion zum Sortieren und Anzeigen ***
function sortAndDisplayPlayers() {
    console.log(`Sorting and displaying players based on: ${currentSortMode}`);
    let sortedPlayers;
    if (currentSortMode === 'elo') {
        sortedPlayers = sortPlayersByElo(allPlayersData);
    } else { // 'worth'
        sortedPlayers = sortPlayersByWorth(allPlayersData);
    }
    console.log("Sorted player data for display:", sortedPlayers);
    displayPlayerList(sortedPlayers); // Anzeige aktualisieren

    // Aktiven Button hervorheben
    if (sortEloButton && sortWorthButton) {
        sortEloButton.classList.toggle('active', currentSortMode === 'elo');
        sortWorthButton.classList.toggle('active', currentSortMode === 'worth');
    }
}

// Event Handler für Klicks auf die Spielerliste (bleibt gleich)
function handlePlayerListClick(e) {
    const li = e.target.closest('li');
    if (!li || !li.dataset.nickname) return;
    const nickname = li.dataset.nickname;
    // Finde den Spieler in den *unsortierten* globalen Daten
    const playerData = allPlayersData.find(p => p.nickname === nickname);
    if (playerData) {
        displayDetailCard(playerData);
    } else {
        console.warn(`Keine Daten gefunden für geklickten Spieler: ${nickname}`);
    }
}

// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht
// -------------------------------------------------------------

let currentUniligaData = null; // Bleibt unverändert

async function loadUniligaView() {
    console.log("[FRONTEND-DEBUG] loadUniligaView WURDE AUFGERUFEN!");
    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaDataArea) {
        console.error("FEHLER: Benötigte Elemente für Uniliga View fehlen!");
        if (errorMessageUniliga) { errorMessageUniliga.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageUniliga.style.display = 'block'; }
        return;
    }
    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    uniligaDataArea.innerHTML = '';

    try {
        const apiUrl = `/api/uniliga-stats?cacheBust=${Date.now()}`;
        console.log(`[FRONTEND-DEBUG] VERSUCHE FETCH (mit Cache Bust): ${apiUrl}...`);
        console.log("Fetching Uniliga stats and Team Icons concurrently...");
        const [apiResponse, iconMapLoaded] = await Promise.all([
            fetch(apiUrl),
            loadTeamIconMap() // Lädt Icons parallel
        ]);
        console.log("[LOG] Uniliga API response status:", apiResponse.status);
        if (!apiResponse.ok) {
            let errorMsg = `Fehler beim Laden der Uniliga-Daten (${apiResponse.status})`;
            try { const errData = await apiResponse.json(); errorMsg = errData.error || errData.message || errorMsg; } catch (parseError) { /* ignore */ }
            throw new Error(errorMsg);
        }
        const data = await apiResponse.json();
         if (data && data.message && data.message.includes('Minimaler Test')) {
             console.warn("[FRONTEND-DEBUG] Minimale Test-Antwort vom Backend erhalten. Echter Code wird nicht ausgeführt.");
             errorMessageUniliga.textContent = "Backend führt Test-Code aus. Bitte Backend korrigieren.";
             errorMessageUniliga.style.display = 'block';
             uniligaDataArea.innerHTML = '<p>Backend-Test aktiv.</p>';
             currentUniligaData = null;
             return;
         }
        console.log("[LOG] Uniliga API data received (teams):", JSON.stringify(data.teams, null, 2));
        console.log("[LOG] Uniliga API data received (players):", JSON.stringify(data.players, null, 2));
        if (!data || !data.teams || !data.players) {
            throw new Error("Ungültiges Datenformat von der API empfangen.");
        }
        currentUniligaData = data;
        console.log("[LOG] Final teamIconMap before display:", teamIconMap);
        displayUniligaData(currentUniligaData);
    } catch (err) {
        console.error("Fehler in loadUniligaView:", err);
        if (errorMessageUniliga) { errorMessageUniliga.textContent = `Fehler: ${err.message}`; errorMessageUniliga.style.display = 'block'; }
        uniligaDataArea.innerHTML = '<p>Daten konnten nicht geladen werden.</p>';
        currentUniligaData = null;
    } finally {
        console.log("loadUniligaView finally block reached.");
        if (loadingIndicatorUniliga) { loadingIndicatorUniliga.style.display = 'none'; console.log("Uniliga loading indicator hidden."); }
        else { console.warn("loadingIndicatorUniliga nicht gefunden im finally block."); }
    }
}

// displayUniligaData bleibt größtenteils unverändert
function displayUniligaData(data) {
    console.log("displayUniligaData called with data:", data);
    if (!uniligaDataArea) { console.error("FEHLER: uniligaDataArea ist null in displayUniligaData!"); return; }
    if (!data || !data.teams || data.teams.length === 0 || !data.players || data.players.length === 0) {
        console.warn("Keine gültigen oder leere Uniliga-Daten zum Anzeigen vorhanden.");
        uniligaDataArea.innerHTML = '<p>Keine vollständigen Daten zum Anzeigen gefunden.</p>';
        return;
    }

    // Team-Tabelle (unverändert)
    let teamTableHtml = `
    <h3>Team Rangliste</h3>
    <div class="table-container">
        <table class="stats-table team-ranking-table">
            <thead><tr><th>#</th><th>Team</th><th>Spiele</th><th>Pkt</th><th>S</th><th>N</th><th>WR %</th><th>Avg. R.</th></tr></thead>
            <tbody>`;
    const sortedTeams = [...data.teams].sort((a, b) => {
        const pointsDiff = (b.points ?? -1) - (a.points ?? -1);
        if (pointsDiff !== 0) return pointsDiff;
        return (b.avgRating ?? 0) - (a.avgRating ?? 0);
    });
    sortedTeams.forEach((team, index) => {
        const teamName = team.name || `Team ID ${team.id.substring(0,8)}...`;
        const iconFilename = teamIconMap[teamName];
        const iconPath = iconFilename ? `/uniliga_icons/${iconFilename}` : 'default_team_icon.png';
        const altText = iconFilename ? `Logo ${teamName}` : 'Standard Team Icon';
        teamTableHtml += `
            <tr data-team-id="${team.id}">
                <td>${index + 1}</td>
                <td class="player-cell team-cell">
                    <img src="${iconPath}" class="table-avatar team-avatar" alt="${altText}" onerror="this.style.display='none'; this.onerror=null;"/>
                    <span>${teamName}</span>
                </td>
                <td>${team.matchesPlayed ?? '0'}</td><td>${team.points ?? '0'}</td><td>${team.wins ?? '0'}</td><td>${team.losses ?? '0'}</td>
                <td class="${getTeamWinrateClass(team.winRate)}">${safe(team.winRate, 1)}</td><td>${safe(team.avgRating, 2)}</td>
            </tr>`;
    });
    teamTableHtml += `</tbody></table></div>`;

    // Spieler-Tabelle (unverändert)
    let playerTableHtml = `
        <h3>Spieler Rangliste (Rating)</h3>
        <div class="table-container">
            <table class="stats-table player-ranking-table">
                <thead><tr><th>#</th><th>Spieler</th><th>Spiele</th><th>Rating</th><th>IMPACT</th><th>ADR</th><th>KAST%</th><th>HS%</th><th>WR%</th></tr></thead>
                <tbody>`;
    data.players.forEach((player, index) => {
        playerTableHtml += `
            <tr>
                <td>${index + 1}</td>
                <td class="player-cell">
                    <img src="${player.avatar || 'default_avatar.png'}" class="table-avatar" alt="Avatar" onerror="this.src='default_avatar.png'"/>
                    <span>${player.nickname || 'Unbekannt'}</span>
                </td>
                <td>${player.matchesPlayed ?? '0'}</td><td>${safe(player.rating, 2)}</td><td>${safe(player.impact, 2)}</td>
                <td>${safe(player.adr, 1)}</td><td>${safe(player.kast, 1)}</td><td>${safe(player.hsp, 1)}</td>
                <td class="${getTeamWinrateClass(player.winRate)}">${safe(player.winRate, 1)}</td>
            </tr>`;
    });
    playerTableHtml += `</tbody></table></div>`;

    const lastUpdatedHtml = data.lastUpdated
        ? `<div class="last-updated">Stand: ${new Date(data.lastUpdated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} Uhr</div>`
        : '';

    uniligaDataArea.innerHTML = teamTableHtml + playerTableHtml + lastUpdatedHtml;
    console.log("Uniliga tables rendered.");
}

// getTeamWinrateClass bleibt unverändert
function getTeamWinrateClass(winRate) {
    const val = parseFloat(winRate);
    if (isNaN(val)) return '';
    const cfg = thresholds.winRate;
    if (val >= cfg.good) return 'text-good';
    if (val >= cfg.okay) return 'text-okay';
    return 'text-bad';
}

// -------------------------------------------------------------
// Umschaltlogik für Ansichten
// -------------------------------------------------------------
function switchView(viewToShow) {
    console.log(`Switching view to: ${viewToShow}`);
    document.querySelectorAll('.view-content').forEach(content => content.classList.remove('active'));
    if (toggleButtons) toggleButtons.forEach(button => button.classList.remove('active'));

    const contentToShow = document.getElementById(`${viewToShow}-content`);
    const buttonToActivate = document.querySelector(`.toggle-button[data-view="${viewToShow}"]`);

    if (contentToShow) contentToShow.classList.add('active');
    if (buttonToActivate) buttonToActivate.classList.add('active');

    // Sortierbuttons nur in der SaverAbi-Ansicht anzeigen
    const sortButtonContainer = document.getElementById('saverabi-sort-controls');
    if (sortButtonContainer) {
        sortButtonContainer.style.display = (viewToShow === 'saverabi') ? 'flex' : 'none'; // Oder 'block' etc. je nach Layout
    }

    if (viewToShow === 'uniliga') {
        if (detailCardContainer) detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        // Uniliga-Daten bei jedem Wechsel laden (wie bisher)
        loadUniligaView();
    } else if (viewToShow === 'saverabi') {
        // Detailkarte initial ausblenden, wenn zur SaverAbi-Ansicht gewechselt wird
        if (detailCardContainer) detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        // Daten nur laden, wenn sie noch nicht da sind (beim ersten Wechsel oder Initialisierung)
        if (allPlayersData.length === 0) {
             loadSaverAbiView();
         } else {
             // Daten sind schon da, nur neu anzeigen (falls z.B. Sortierung geändert wurde und man hin/her wechselt)
             sortAndDisplayPlayers();
         }
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOMContentLoaded event fired.");
    cacheDOMElements(); // Cache all elements first

    // Event Listener für Haupt-Ansicht-Toggle-Buttons
    if (toggleButtons) {
        toggleButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const view = event.currentTarget.dataset.view;
                if (view) switchView(view);
            });
        });
    } else { console.warn("Toggle buttons not found."); }

    // *** NEU: Event Listener für Sortier-Buttons ***
    if (sortEloButton) {
        sortEloButton.addEventListener('click', () => {
            if (currentSortMode !== 'elo') {
                console.log("Switching sort mode to: elo");
                currentSortMode = 'elo';
                sortAndDisplayPlayers(); // Neu sortieren und anzeigen
            }
        });
    } else { console.warn("Sort Elo Button not found."); }

    if (sortWorthButton) {
        sortWorthButton.addEventListener('click', () => {
            if (currentSortMode !== 'worth') {
                console.log("Switching sort mode to: worth");
                currentSortMode = 'worth';
                sortAndDisplayPlayers(); // Neu sortieren und anzeigen
            }
        });
    } else { console.warn("Sort Worth Button not found."); }


    // Startansicht initialisieren und Daten laden
    console.log("Initializing default view: saverabi");
    switchView('saverabi'); // Stellt sicher, dass die SaverAbi-Ansicht aktiv ist und lädt ggf. Daten
                            // loadSaverAbiView() wird innerhalb von switchView aufgerufen, falls nötig
});