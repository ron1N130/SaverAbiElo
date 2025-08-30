// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    // Bereinigt - letzte Definition aus deinem Code übernommen
    rating: { bad: 0.85, okay: 1.05, good: 1.15, great: 1.3, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.63, great: 0.55, max: 1 }, // Niedriger ist besser (letzte Definition)
    kast: { bad: 58, okay: 66, good: 75, great: 80, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, great: 1.4, max: 2.0 }, // KD wieder relevant für Anzeige (letzte Definition)
    adr: { bad: 65, okay: 70, good: 85, great: 90, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, great: 0.9, max: 1.2 },
    impact: { bad: 1, okay: 1.3, good: 1.45, great: 1.55, max: 1.8 }, // Bleibt intern für Berechnung (letzte Definition)
    elo: { bad: 1800, okay: 2000, good: 2600, great: 2900, max: 4000 },
    hsp: { bad: 15, okay: 35, good: 44, great: 0.55, max: 60 }, // Beachte: great hier 0.55 statt 55? Überprüfen! Falls % gemeint war, eher 55
    winRate: { bad: 40, okay: 50, good: 60, great: 70, max: 100 } // Wird jetzt für Match-Winrate verwendet
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
    if (!Number.isFinite(num)) return "—";

    // Teile durch 1000, um den Wert in "Tausend" zu erhalten
    const worthInThousands = num / 1000;

    // Formatiere mit 1 Dezimalstelle und füge ' Mio USD' hinzu
    // Verwende 'de-DE' Locale, um das Komma als Dezimaltrennzeichen zu nutzen
    return worthInThousands.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' Mio USD';
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
        console.log("[LOG] Team icon map already loaded.");
        return;
    }

    try {
        const response = await fetch('/uniliga_teams.json');
        console.log("[DEBUG] Fetching /uniliga_teams.json. Response status:", response.status); // DEBUG Log
        if (!response.ok) {
            throw new Error(`Fehler beim Laden der Team-Icons (${response.status}) from ${response.url}`);
        }
        const textData = await response.text(); // **NEU:** Lese als Text
        console.log("[DEBUG] /uniliga_teams.json raw text:", textData); // **NEU:** Logge rohen Text
        const teamsData = JSON.parse(textData); // **NEU:** Parse den Text
        console.log("[LOG] uniliga_teams.json raw data:", teamsData); // LOG Rohdaten nach Parse

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
    toggleButtons, sortEloButton, sortWorthButton, saverAbiListHeader;

function cacheDOMElements() {
    console.log("[LOG] Caching DOM elements...");
    // ... (keine Änderungen hier)
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
    saverAbiListHeader = document.getElementById("saverabi-list-header");

    sortEloButton = document.getElementById("sort-elo-btn");
    sortWorthButton = document.getElementById("sort-worth-btn");

    if (!playerListContainerEl || !loadingIndicatorSaverAbi || !saverAbiContent || !uniligaContent || !uniligaDataArea || !sortEloButton || !sortWorthButton || !saverAbiListHeader || !detailCardContainer || !mainContentArea) {
        console.error("FEHLER: Wichtige DOM-Elemente wurden nicht gefunden (inkl. Sortierbuttons/Header/Card Container)!");
    } else {
        console.log("[LOG] DOM elements cached successfully.");
    }
}

// -------------------------------------------------------------
// Funktionen für die SaverAbi-Ansicht
// -------------------------------------------------------------
async function getPlayerData(nickname) {
    try {
        const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
        console.log(`[DEBUG] Fetching /api/faceit-data for ${nickname}. Response status:`, res.status); // DEBUG Log

        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                 const errDataText = await res.text(); // **NEU:** Lese Fehlerantwort als Text
                 console.error(`[DEBUG] /api/faceit-data error raw text for ${nickname}:`, errDataText); // **NEU:** Logge rohen Fehlertext
                 const errData = JSON.parse(errDataText); // **NEU:** Versuche Text zu parsen
                 errorMsg = errData.error || errDataText || errorMsg;
            } catch (parseError) {
                 // Konnte JSON nicht parsen, nutze den rohen Text oder HTTP Status
                 errorMsg = errDataText || errorMsg;
                 console.error(`[DEBUG] Failed to parse error response for ${nickname}:`, parseError);
            }
            throw new Error(errorMsg);
        }
        const textData = await res.text(); // **NEU:** Lese als Text
        console.log(`[DEBUG] /api/faceit-data raw text for ${nickname}:`, textData); // **NEU:** Logge rohen Text
        const p = JSON.parse(textData); // **NEU:** Parse den Text

        if (p.error) {
            return { nickname, error: p.error, sortElo: -1, worth: null };
        }
        // Konvertiere relevante Felder sicher in Zahlen
        p.sortElo = toNum(p.elo);
        p.rating = toNum(p.calculatedRating ?? p.rating);
        p.dpr = toNum(p.dpr);
        p.kast = toNum(p.kast);
        p.kd = toNum(p.kd);
        p.adr = toNum(p.adr);
        p.kpr = toNum(p.kpr);
        p.hsp = toNum(p.hsPercent);
        p.impact = toNum(p.impact);


        // Berechne den "Geldwert"
        // Berechne den "Geldwert"
        if (p.sortElo !== null && typeof p.rating === 'number' && typeof p.impact === 'number') {
            const elo = p.sortElo;
            const rating = p.rating;
            const impact = p.impact;

            const bonusThreshold = thresholds?.elo?.okay ?? 2000;
            const bonusPower = 1.8;
            const bonusScale = 0.05;

            const weightedElo = elo + (elo > bonusThreshold ? Math.pow(elo - bonusThreshold, bonusPower) * bonusScale : 0);

            const impactFactor = impact - 0.2;
            let finalWorth = weightedElo * rating * impactFactor;

            finalWorth = Math.max(0, finalWorth);

            p.worth = finalWorth;

        } else {
             p.worth = null;
        }
        if (p.sortElo === null) p.sortElo = -1;

        return p;
    } catch (err) {
        console.error(`getPlayerData error for ${nickname}:`, err.message);
        return { nickname, error: err.message || "Netzwerkfehler", sortElo: -1, worth: null };
    }
}

// Sortierfunktionen (unverändert)
function sortPlayersByElo(players) {
    return [...players].sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1));
}

function sortPlayersByWorth(players) {
    return [...players].sort((a, b) => {
        const worthA = a.worth ?? -Infinity;
        const worthB = b.worth ?? -Infinity;
        return worthB - worthA;
    });
}

function displayPlayerList(players) {
    console.log(`[LOG] displayPlayerList Aufgerufen mit ${players?.length ?? 0} Spieler-Objekten. Sortierung: ${currentSortMode}`);
    if (!playerListContainerEl) { console.error("FEHLER: playerListContainerEl ist null in displayPlayerList!"); return; }
    if (!saverAbiListHeader) { console.error("FEHLER: saverAbiListHeader ist null!"); return;}

    playerListContainerEl.innerHTML = '';

    saverAbiListHeader.textContent = 'Spielerliste'; // Header bleibt immer gleich

    if (!players || players.length === 0) { console.log("[LOG] Keine Spielerdaten zum Anzeigen vorhanden."); return; }

    players.forEach((player) => {
        const li = document.createElement('li');
        li.dataset.nickname = player.nickname;

        if (player.error) {
            li.classList.add('error-item');
            li.innerHTML = `<span class='player-info'><img src='default_avatar.png' class='avatar' alt="Standard Avatar"/><span class='player-name'>${player.nickname}</span></span><div class='player-list-right error-text'>Fehler</div>`; // Angepasste Fehlermeldung
        } else {
            const displayValue = currentSortMode === 'elo'
                ? `${player.sortElo ?? 'N/A'}`
                : `${safeWorth(player.worth)}`;

            const eloProgressBarHtml = `<div class='elo-progress-container' data-elo='${player.sortElo ?? 0}'><div class='elo-progress-bar'></div></div>`;

            const clubIconHtml = currentSortMode !== 'elo' && player.assignedClubIcon // Icon nur im Bluelock-Modus
                ? `<img src='/icons/${player.assignedClubIcon}' class='club-icon' alt="Club Icon" onerror="this.style.display='none';"/>`
                : '';

            li.innerHTML = `
                <span class='player-info'>
                    <img src='${player.avatar || 'default_avatar.png'}' class='avatar' alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" />
                    <span class='player-name'>${player.nickname}</span>
                    ${clubIconHtml}
                </span>
                <div class='player-list-right'>
                    <span class='player-value'>${displayValue}</span>
                    ${eloProgressBarHtml}
                </div>`;

            const eloBarContainer = li.querySelector('.elo-progress-container');
            if (eloBarContainer) updateEloProgressBarForList(eloBarContainer);
        }
        playerListContainerEl.appendChild(li);
    });
    console.log("[LOG] displayPlayerList Rendering abgeschlossen.");
}


// Club Zuweisung für Bluelock Ranking (unverändert, aber stelle sicher, dass die Map korrekt geladen wird)
const clubIconMap = {
    "Royal Madrid": "royal_madrid.png",
    "Bastard Munchen": "bastard_munchen.png",
    "PXG": "pxg.png",
    "Ubers": "ubers.png",
    "Barcha": "barcha.png",
    "Manshine City": "manshine.png",
};
const otherClubs = Object.keys(clubIconMap).filter(clubName =>
    clubName !== "Royal Madrid" && clubName !== "Bastard Munchen"
);

function assignClubsToPlayers(players) {
    console.log("[LOG] Beginne Club Zuweisung...");
    if (!players || players.length === 0) {
        console.log("[LOG] Keine Spieler für Club Zuweisung vorhanden.");
        return;
    }
    players.forEach((player, index) => {
        const rank = index + 1;
        let assignedClubName = null;
        if (rank === 1) {
            assignedClubName = "Royal Madrid";
        } else if (rank >= 2 && rank <= 4) {
            const potentialClubs = ["Royal Madrid", "Bastard Munchen"];
            assignedClubName = potentialClubs[Math.floor(Math.random() * potentialClubs.length)];
        } else if (rank >= 5 && rank <= 12) {
            if (otherClubs.length > 0) {
                assignedClubName = otherClubs[Math.floor(Math.random() * otherClubs.length)];
            } else {
                console.warn(`[LOG] Keine "otherClubs" definiert für Rang ${rank}. Spieler ${player.nickname} erhält kein Icon.`);
                assignedClubName = null;
            }
        } else {
            assignedClubName = null;
        }
        player.assignedClubIcon = assignedClubName ? clubIconMap[assignedClubName] : null;
    });
     console.log("[LOG] Club Zuweisung abgeschlossen.");
}

// updateEloProgressBarForList (unverändert)
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

// displayDetailCard (unverändert - Layout-Fixes kommen via CSS)
function displayDetailCard(player) {
    console.log("[LOG] displayDetailCard called for player:", player?.nickname || 'N/A');
    if (!detailCardContainer || !mainContentArea) { console.error("FEHLER: Detail Card Container oder Main Content Area nicht gefunden."); return; }
    const saverAbiContentEl = document.getElementById('saverabi-content');
    if (!saverAbiContentEl || !saverAbiContentEl.classList.contains('active')) {
        console.log("[LOG] SaverAbi view is not active, hiding detail card.");
        detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        return;
    }

    detailCardContainer.style.display = 'block';
    if (mainContentArea) mainContentArea.classList.add('detail-visible');

    if (!player || player.error) {
        console.warn("[LOG] Displaying error card for player:", player?.nickname || 'N/A', "Error:", player?.error);
        detailCardContainer.innerHTML = `<div class='player-card-hltv error-card'>${player?.nickname || 'Spieler'} – Fehler: ${player?.error || 'Unbekannt'}</div>`;
        return;
    }

    console.log("[LOG] Rendering detail card for", player.nickname);
    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';

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
              <div class="stat-item" data-stat="impact"><div class="label">IMPACT</div><div class="value">${safe(player.impact -0.2, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="adr"><div class="label">ADR</div><div class="value">${safe(player.adr, 1)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
              <div class="stat-item" data-stat="kpr"><div class="label">KPR</div><div class="value">${safe(player.kpr, 2)}</div><div class="stat-progress-container"><div class="stat-progress-bar"></div></div><span class="stat-indicator-label"></span></div>
           </div>
           </div>
        </div>`;
    updateStatProgressBars(detailCardContainer, player);
    console.log("[LOG] Detail card rendered.");
}

// updateStatProgressBars (unverändert)
function updateStatProgressBars(card, player) {
    // ... (keine Änderungen hier)
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
                let compareVal = val;
                if (stat === 'hsp' && val <= 1) {
                     compareVal = val * 100;
                     console.log(`[LOG] HSP value ${val} adjusted to ${compareVal} for threshold comparison.`);
                }

                if (compareVal >= cfg.great) { category = 2; text = 'GREAT'; color = 'var(--bar-great)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (compareVal >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (compareVal >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
            }
        } else {
            text = '---'; category = -1; color = 'transparent'; barLeft = '0%'; borderRadiusStyle = '0';
        }
        bar.style.left = barLeft; bar.style.width = barWidth; bar.style.backgroundColor = color; bar.style.boxShadow = (category !== -1) ? `0 0 8px ${color}` : 'none'; bar.style.borderRadius = borderRadiusStyle;
        lbl.textContent = text; lbl.style.color = (category !== -1) ? color : 'var(--text-secondary)';
    });
}


// loadSaverAbiView (unverändert bis auf Error Handling/Logging)
async function loadSaverAbiView() {
    console.log("[LOG] loadSaverAbiView called");
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl || !detailCardContainer || !mainContentArea || !saverAbiContent || !sortEloButton || !sortWorthButton || !saverAbiListHeader) {
        console.error("FEHLER: Benötigte Elemente für SaverAbi View fehlen!");
        if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageSaverAbi.style.display = 'block'; }
        return;
    }

    loadingIndicatorSaverAbi.style.display = 'block';
    errorMessageSaverAbi.style.display = 'none';
    playerListContainerEl.innerHTML = '';
    detailCardContainer.style.display = 'none';
    if(mainContentArea) mainContentArea.classList.remove('detail-visible');
    allPlayersData = [];

    try {
        console.log("[LOG] Fetching /players.json...");
        const namesRes = await fetch('/players.json');
        console.log("[DEBUG] /players.json status:", namesRes.status); // DEBUG Log
        if (!namesRes.ok) throw new Error(`Fehler Laden Spielerliste (${namesRes.status})`);
        const namesText = await namesRes.text(); // **NEU:** Lese als Text
        console.log("[DEBUG] /players.json raw text:", namesText); // **NEU:** Logge rohen Text
        const names = JSON.parse(namesText); // **NEU:** Parse den Text

        console.log("[LOG] Player names loaded:", names);
        if (!Array.isArray(names) || names.length === 0) throw new Error("Spielerliste leer/ungültig.");

        console.log("[LOG] Fetching player data for all players...");
        const promises = names.map(name => getPlayerData(name));
        const results = await Promise.all(promises);
        console.log("[LOG] Player data fetch results (raw):", results);
        allPlayersData = results;

        const validPlayerCount = allPlayersData.filter(p => !p.error).length;
        console.log(`[LOG] Gültige Spielerdaten empfangen: ${validPlayerCount} / ${allPlayersData.length}`);
        if(validPlayerCount === 0 && allPlayersData.length > 0) { console.warn("[LOG] Keine gültigen Spielerdaten von der API erhalten, nur Fehler."); }

        sortAndDisplayPlayers();

        if (playerListContainerEl) {
             playerListContainerEl.removeEventListener('click', handlePlayerListClick);
             playerListContainerEl.addEventListener('click', handlePlayerListClick);
             console.log("[LOG] Click listener added to player list.");
        } else {
             console.warn("[LOG] Konnte Click listener für Spielerliste nicht hinzufügen.");
        }
    } catch (err) {
        console.error("Schwerwiegender Fehler in loadSaverAbiView:", err);
        if(errorMessageSaverAbi){ errorMessageSaverAbi.textContent = `Fehler: ${err.message}`; errorMessageSaverAbi.style.display = 'block'; }
        if(playerListContainerEl) playerListContainerEl.innerHTML = '';
    }
    finally {
        console.log("[LOG] loadSaverAbiView finally block reached.");
        if (loadingIndicatorSaverAbi) {
            loadingIndicatorSaverAbi.style.display = 'none';
            console.log("[LOG] Loading indicator hidden.");
        }
        const sortButtonContainer = document.getElementById('saverabi-sort-controls');
        if (sortButtonContainer) {
            sortButtonContainer.style.display = 'flex';
        }
    }
}

// sortAndDisplayPlayers (Club-Icon Zuweisung hinzugefügt)
function sortAndDisplayPlayers() {
    console.log(`[LOG] Sorting and displaying players based on: ${currentSortMode}`);
    let sortedPlayers;
    if (currentSortMode === 'elo') {
        sortedPlayers = sortPlayersByElo(allPlayersData);
         // Icons entfernen, wenn im Elo-Modus
        sortedPlayers.forEach(player => player.assignedClubIcon = null);
    } else { // 'worth' (Bluelock Ranking)
        sortedPlayers = sortPlayersByWorth(allPlayersData);
        // Icons zuweisen, wenn im Bluelock-Modus
        assignClubsToPlayers(sortedPlayers);
    }
    console.log("[LOG] Sorted player data for display:", sortedPlayers);
    displayPlayerList(sortedPlayers); // Diese Funktion kümmert sich um das Rendering basierend auf assignedClubIcon

    if (sortEloButton && sortWorthButton) {
        sortEloButton.classList.toggle('active', currentSortMode === 'elo');
        sortWorthButton.classList.toggle('active', currentSortMode === 'worth');
    }
}

// handlePlayerListClick (unverändert)
function handlePlayerListClick(e) {
    // ... (keine Änderungen hier)
    const li = e.target.closest('li');
    if (!li || !li.dataset.nickname) return;
    const nickname = li.dataset.nickname;
    const playerData = allPlayersData.find(p => p.nickname === nickname);
    if (playerData) {
        displayDetailCard(playerData);
    } else {
        console.warn(`[LOG] Keine Daten gefunden für geklickten Spieler: ${nickname}`);
    }
}

// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht
// -------------------------------------------------------------

let currentUniligaData = null;

async function loadUniligaView() {
    console.log("[LOG] loadUniligaView WURDE AUFGERUFEN!");
    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaDataArea) {
        console.error("FEHLER: Benötigte Elemente für Uniliga View fehlen!");
        if (errorMessageUniliga) { errorMessageUniliga.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageUniliga.style.display = 'block'; }
        return;
    }
    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    uniligaDataArea.innerHTML = '';

    try {
        // Using a cache busting parameter to ensure fresh data during development/testing
        const apiUrl = `/api/uniliga-stats?cacheBust=${Date.now()}`;
        console.log(`[LOG] VERSUCHE FETCH (mit Cache Bust): ${apiUrl}...`);

        const [apiResponse, iconMapLoaded] = await Promise.all([
            fetch(apiUrl),
            loadTeamIconMap() // Stellt sicher, dass die Team-Icon Map geladen ist
        ]);
        console.log("[DEBUG] Uniliga API response status:", apiResponse.status); // DEBUG Log
        if (!apiResponse.ok) {
            let errorMsg = `Fehler beim Laden der Uniliga-Daten (${apiResponse.status})`;
             try {
                 const errDataText = await apiResponse.text(); // **NEU:** Lese Fehlerantwort als Text
                 console.error(`[DEBUG] Uniliga API error raw text:`, errDataText); // **NEU:** Logge rohen Fehlertext
                 const errData = JSON.parse(errDataText); // **NEU:** Versuche Text zu parsen
                 errorMsg = errData.error || errData.message || errDataText || errorMsg;
            } catch (parseError) {
                 errorMsg = errDataText || errorMsg;
                 console.error(`[DEBUG] Failed to parse error response for Uniliga:`, parseError);
            }
            throw new Error(errorMsg);
        }
        const textData = await apiResponse.text(); // **NEU:** Lese als Text
        console.log("[DEBUG] Uniliga API raw text:", textData); // **NEU:** Logge rohen Text
        const data = JSON.parse(textData); // **NEU:** Parse den Text

         if (data && data.message && data.message.includes('Minimaler Test')) {
             console.warn("[LOG] Minimale Test-Antwort vom Backend erhalten. Echter Code wird nicht ausgeführt.");
             errorMessageUniliga.textContent = "Backend führt Test-Code aus. Bitte Backend korrigieren.";
             errorMessageUniliga.style.display = 'block';
             uniligaDataArea.innerHTML = '<p>Backend-Test aktiv.</p>';
             currentUniligaData = null;
             return;
         }
        console.log("[LOG] Uniliga API data received (teams):", JSON.stringify(data.teams, null, 2));
        console.log("[LOG] Uniliga API data received (players):", JSON.stringify(data.players, null, 2));
        if (!data || !data.teams || data.teams.length === 0 || !data.players || data.players.length === 0) {
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
        console.log("[LOG] loadUniligaView finally block reached.");
        if (loadingIndicatorUniliga) { loadingIndicatorUniliga.style.display = 'none'; console.log("[LOG] Uniliga loading indicator hidden."); }
    }
}

function displayUniligaData(data) {
    console.log("[LOG] displayUniligaData called with data:", data);
    if (!uniligaDataArea) { console.error("FEHLER: uniligaDataArea ist null in displayUniligaData!"); return; }
    if (!data || !data.teams || data.teams.length === 0 || !data.players || data.players.length === 0) {
        console.warn("[LOG] Keine gültigen oder leere Uniliga-Daten zum Anzeigen vorhanden.");
        uniligaDataArea.innerHTML = '<p>Keine vollständigen Daten zum Anzeigen gefunden.</p>';
        return;
    }

    let teamTableHtml = `
    <h3>Team Rangliste</h3>
    <div class="table-container">
        <table class="stats-table team-ranking-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Spiele</th>
                    <th>Pkt</th>
                    <th>S</th>
                    <th>U</th> <th>N</th>
                    <th>WR %</th>
                    <th>Avg. R.</th>
                </tr>
            </thead>
            <tbody>`;
    const sortedTeams = [...data.teams].sort((a, b) => {
        // Sorting logic now uses match stats as implemented in backend
        const pointsDiff = (b.points ?? 0) - (a.points ?? 0);
        if (pointsDiff !== 0) return pointsDiff;
        const winsDiff = (b.matchWins ?? 0) - (a.matchWins ?? 0);
        if (winsDiff !== 0) return winsDiff;
        const drawsDiff = (b.matchDraws ?? 0) - (a.matchDraws ?? 0);
        if (drawsDiff !== 0) return drawsDiff;
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
                <td>${team.matchesPlayed ?? '0'}</td>
                <td>${team.points ?? '0'}</td>
                <td>${team.matchWins ?? '0'}</td> <td>${team.matchDraws ?? '0'}</td> <td>${team.matchLosses ?? '0'}</td> <td class="${getTeamWinrateClass(team.matchWinRate)}">${safe(team.matchWinRate, 1)}</td> <td>${safe(team.avgRating, 2)}</td>
            </tr>`;
    });
    teamTableHtml += `</tbody></table></div>`;

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
                <td>${player.matchesPlayed ?? '0'}</td><td>${safe(player.rating, 2)}</td><td>${safe(player.impact - 0.2, 2)}</td>
                <td>${safe(player.adr, 1)}</td><td>${safe(player.kast, 1)}</td><td>${safe(player.hsp, 1)}</td>
                <td class="${getTeamWinrateClass(player.winRate)}">${safe(player.winRate, 1)}</td>
            </tr>`;
    });
    playerTableHtml += `</tbody></table></div>`;

    const lastUpdatedHtml = data.lastUpdated
        ? `<div class="last-updated">Stand: ${new Date(data.lastUpdated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} Uhr</div>`
        : '';

    uniligaDataArea.innerHTML = teamTableHtml + playerTableHtml + lastUpdatedHtml;
    console.log("[LOG] Uniliga tables rendered.");
}

function getTeamWinrateClass(winRate) {
    const val = parseFloat(winRate);
    if (isNaN(val)) return '';
    const cfg = thresholds.winRate;
    // Assuming thresholds.winRate is for percentage (0-100)
    if (val >= cfg.great) return 'text-great'; // Use great threshold for highest win rate class
    if (val >= cfg.good) return 'text-good';
    if (val >= cfg.okay) return 'text-okay';
    return 'text-bad';
}

// -------------------------------------------------------------
// Umschaltlogik für Ansichten (unverändert)
// -------------------------------------------------------------
function switchView(viewToShow) {
    console.log(`[LOG] Switching view to: ${viewToShow}`);
    document.querySelectorAll('.view-content').forEach(content => content.classList.remove('active'));
    if (toggleButtons) toggleButtons.forEach(button => button.classList.remove('active'));

    const contentToShow = document.getElementById(`${viewToShow}-content`);
    const buttonToActivate = document.querySelector(`.toggle-button[data-view="${viewToShow}"]`);

    if (contentToShow) contentToShow.classList.add('active');
    if (buttonToActivate) buttonToActivate.classList.add('active');

    const sortButtonContainer = document.getElementById('saverabi-sort-controls');
    if (sortButtonContainer) {
        sortButtonContainer.style.display = (viewToShow === 'saverabi') ? 'flex' : 'none';
    }

    if (viewToShow === 'uniliga') {
        if (detailCardContainer) detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        loadUniligaView();
    } else if (viewToShow === 'saverabi') {
        if (detailCardContainer) detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        if (allPlayersData.length === 0) {
             loadSaverAbiView();
         } else {
             sortAndDisplayPlayers(); // Beim Wechsel zurück, einfach neu sortieren/anzeigen
         }
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite (unverändert)
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    console.log("[LOG] DOMContentLoaded event fired.");
    cacheDOMElements();

    if (toggleButtons) {
        toggleButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const view = event.currentTarget.dataset.view;
                if (view) switchView(view);
            });
        });
    } else { console.warn("[LOG] Toggle buttons not found."); }

    if (sortEloButton) {
        sortEloButton.addEventListener('click', () => {
            if (currentSortMode !== 'elo') {
                console.log("[LOG] Switching sort mode to: elo");
                currentSortMode = 'elo';
                sortAndDisplayPlayers();
            }
        });
    } else { console.warn("[LOG] Sort Elo Button not found."); }

    if (sortWorthButton) {
        sortWorthButton.addEventListener('click', () => {
            if (currentSortMode !== 'worth') {
                console.log("[LOG] Switching sort mode to: worth");
                currentSortMode = 'worth';
                sortAndDisplayPlayers();
            }
        });
    } else { console.warn("[LOG] Sort Worth Button not found."); }


    console.log("[LOG] Initializing default view: saverabi");
    switchView('saverabi');
});