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
    hsp: { bad: 15, okay: 35, good: 44, great: 0.55, max: 60 }, // Beachte: great hier 0.55 statt 55? Überprüfen! Falls % gemeint war, eher 55
    winRate: { bad: 40, okay: 50, good: 60, great: 70, max: 100 }
};

let teamIconMap = {}; // Speichert das Mapping von Teamnamen zu Icon-Dateinamen
let allPlayersData = []; // Globale Speicherung der Spielerdaten für SaverAbi
let currentSortMode = 'elo'; // Start-Sortiermodus ('elo' oder 'worth')

// Variablen für den Vergleichsmodus
let isComparing = false;
let playersToCompare = []; // Array, das die 1 oder 2 Spieler für den Vergleich speichert


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
    toggleButtons, sortEloButton, sortWorthButton, compareButton, saverAbiListHeader; // *** compareButton hinzugefügt ***

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
    compareButton = document.getElementById("compare-btn"); // *** compareButton cachen ***


    if (!playerListContainerEl || !loadingIndicatorSaverAbi || !saverAbiContent || !uniligaContent || !uniligaDataArea || !sortEloButton || !sortWorthButton || !compareButton || !saverAbiListHeader || !detailCardContainer || !mainContentArea) { // *** compareButton hinzugefügt ***
        console.error("FEHLER: Wichtige DOM-Elemente wurden nicht gefunden (inkl. Sortier/Compare Buttons/Header/Card Container)!");
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
        p.matchesConsidered = p.matchesConsidered; // Matches Considered als String lassen oder auch zu Zahl?
        p.winRate = toNum(p.winRate); // Auch Win Rate als Zahl konvertieren


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

    // Header-Text wird nun von toggleComparisonMode gesetzt
    // saverAbiListHeader.textContent = 'Spielerliste';

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

            // Markiere Spieler, die bereits für den Vergleich ausgewählt sind
             if (playersToCompare.some(p => p.nickname === player.nickname)) {
                 li.classList.add('selected-for-compare');
             }
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

    // Sicherstellen, dass keine Vergleichskarte angezeigt wird
    detailCardContainer.innerHTML = '';

    detailCardContainer.style.display = 'block';
    if (mainContentArea) mainContentArea.classList.add('detail-visible');

    if (!player || player.error) {
        console.warn("[LOG] Displaying error card for player:", player?.nickname || 'N/A', "Error:", player?.error);
        detailCardContainer.innerHTML = `<div class='player-card-base error-card'>${player?.nickname || 'Spieler'} – Fehler: ${player?.error || 'Unbekannt'}</div>`;
        return;
    }

    console.log("[LOG] Rendering detail card for", player.nickname);
    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';

    detailCardContainer.innerHTML = `
        <div class="player-card-base player-card-detail">
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
                if (stat === 'hsp' && val <= 1 && cfg.great > 1) { // Annahme: cfg.great > 1 bedeutet, dass Schwellenwert als % erwartet wird
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

// displayComparisonCard (Code aus früheren Schritten, ggf. mit Anpassungen)
function displayComparisonCard(player1, player2) {
     console.log("[LOG] displayComparisonCard called for", player1?.nickname, "vs", player2?.nickname);
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

     if (!player1 || !player2 || player1.error || player2.error) {
         console.warn("[LOG] Cannot display comparison card due to missing or erroneous player data.");
         detailCardContainer.innerHTML = `<div class='player-card-base error-card'>Vergleich nicht möglich. Bitte wähle zwei gültige Spieler.</div>`;
         return;
     }

     // Ensure stats for comparison are numbers
     const numericStats1 = convertStatsToNumbers(player1);
     const numericStats2 = convertStatsToNumbers(player2);

     detailCardContainer.innerHTML = `
         <div class="player-card-base player-card-compare">
             <div class="player-compare-player-section">
                 <div class="card-header">
                      <a href="${numericStats1.faceitUrl || '#'}" target="_blank" rel="noopener noreferrer"><img src="${numericStats1.avatar || 'default_avatar.png'}" class="avatar" alt="Avatar von ${numericStats1.nickname}" onerror="this.src='default_avatar.png'"/></a>
                     <a href="${numericStats1.faceitUrl || '#'}" target="_blank" rel="noopener noreferrer" class="player-name">${numericStats1.nickname || 'Spieler 1'}</a>
                      <div class="stats-label">${numericStats1.matchesConsidered ? `(${numericStats1.matchesConsidered} Matches)` : '(Stats)'}</div>
                 </div>
                 <ul class="player-compare-stats-list">
                     ${generateComparisonStatsList(numericStats1, numericStats2, true)}
                 </ul>
             </div>
             <div class="player-compare-player-section">
                 <div class="card-header">
                     <a href="${numericStats2.faceitUrl || '#'}" target="_blank" rel="noopener noreferrer"><img src="${numericStats2.avatar || 'default_avatar.png'}" class="avatar" alt="Avatar von ${numericStats2.nickname}" onerror="this.src='default_avatar.png'"/></a>
                     <a href="${numericStats2.faceitUrl || '#'}" target="_blank" rel="noopener noreferrer" class="player-name">${numericStats2.nickname || 'Spieler 2'}</a>
                      <div class="stats-label">${numericStats2.matchesConsidered ? `(${numericStats2.matchesConsidered} Matches)` : '(Stats)'}</div>
                 </div>
                 <ul class="player-compare-stats-list">
                     ${generateComparisonStatsList(numericStats2, numericStats1, false)}
                 </ul>
             </div>
         </div>
     `;
     console.log("[LOG] Comparison card rendered.");
}


// generateComparisonStatsList (Code aus früheren Schritten, ggf. mit Anpassungen)
function generateComparisonStatsList(player, opponent, isPlayer1) {
    const stats = [
         { key: 'elo', label: 'ELO', format: (v) => v !== null ? safe(v, 0) : '—' },
         { key: 'worth', label: 'Worth', format: safeWorth },
         { key: 'rating', label: 'Rating 2.0', format: (v) => safe(v, 2) },
         { key: 'dpr', label: 'DPR', format: (v) => safe(v, 2), lowerIsBetter: true },
         { key: 'kast', label: 'KAST %', format: (v) => safe(v, 1), isPercentage: true },
         { key: 'impact', label: 'IMPACT', format: (v) => safe(v - 0.2, 2) }, // Anpassung
         { key: 'adr', label: 'ADR', format: (v) => safe(v, 1) },
         { key: 'kpr', label: 'KPR', format: (v) => safe(v, 2) },
         { key: 'hsp', label: 'HS %', format: (v) => safe(v, 1), isPercentage: true }, // HS%
         { key: 'winRate', label: 'Win %', format: (v) => safe(v, 1), isPercentage: true }, // Win Rate
         { key: 'matchesPlayed', label: 'Matches', format: (v) => v !== null ? v.toString() : '—'} // Matches Played
     ];

    let html = '';
    stats.forEach(stat => {
        const playerVal = player[stat.key];
        const opponentVal = opponent[stat.key];
        const playerValNum = typeof playerVal === 'number' ? playerVal : parseFloat(playerVal); // Sicherstellen, dass es eine Zahl ist
        const opponentValNum = typeof opponentVal === 'number' ? opponentVal : parseFloat(opponentVal); // Sicherstellen, dass es eine Zahl ist


        let indicator = '';
        let indicatorClass = '';

        if (playerValNum !== null && !isNaN(playerValNum) && opponentValNum !== null && !isNaN(opponentValNum)) {
            let comparisonResult;
            // Besonderheit für Worth: Kleine Unterschiede ignorieren (optional, anpassen bei Bedarf)
            // const worthTolerance = 1000; // 1 Tausend USD Toleranz
            // if (stat.key === 'worth' && Math.abs(playerValNum - opponentValNum) < worthTolerance) {
            //      indicator = '=';
            //      indicatorClass = 'compare-indicator-equal';
            // } else {
                 if (stat.lowerIsBetter) {
                     comparisonResult = opponentValNum - playerValNum; // Positive if player is better (lower)
                 } else {
                     comparisonResult = playerValNum - opponentValNum; // Positive if player is better (higher)
                 }

                 const significanceThreshold = (stat.isPercentage || stat.key === 'rating' || stat.key === 'impact' || stat.key === 'dpr' || stat.key === 'kpr' || stat.key === 'adr') ? 0.005 : (stat.key === 'elo' ? 5 : 0.5); // Kleine Schwellenwerte für genaue Werte, 5 für Elo

                 if (comparisonResult > significanceThreshold) {
                     indicator = stat.lowerIsBetter ? '↓' : '↑'; // Runterpfeil wenn besser und lowerIsBetter=true, Hochpfeil sonst
                     indicatorClass = 'compare-indicator-better';
                 } else if (comparisonResult < -significanceThreshold) {
                      indicator = stat.lowerIsBetter ? '↑' : '↓'; // Hochpfeil wenn schlechter und lowerIsBetter=true, Runterpfeil sonst
                      indicatorClass = 'compare-indicator-worse';
                 } else {
                      indicator = '='; // Werte sind sehr ähnlich
                      indicatorClass = 'compare-indicator-equal'; // Optionaler Stil für Gleichheit
                 }
            // } // Ende Worth Toleranz

             // Wenn es die Spalte des zweiten Spielers ist, die Pfeile umkehren, da sie aus dessen Sicht angezeigt werden
            if (!isPlayer1 && indicator !== '=' && indicator !== '—') {
                indicator = (indicator === '↑' ? '↓' : '↑'); // Pfeil umkehren
                indicatorClass = (indicatorClass === 'compare-indicator-better' ? 'compare-indicator-worse' : 'compare-indicator-better'); // Farbe umkehren
            }

        } else if (playerValNum !== null && !isNaN(playerValNum) && (opponentValNum === null || isNaN(opponentValNum))) {
             // Spieler 1 hat Daten, Spieler 2 nicht -> Spieler 1 ist "besser" weil Daten vorhanden sind
             indicator = '↑';
             indicatorClass = 'compare-indicator-better';
        } else if ((playerValNum === null || isNaN(playerValNum)) && opponentValNum !== null && !isNaN(opponentValNum)) {
             // Spieler 2 hat Daten, Spieler 1 nicht -> Spieler 1 ist "schlechter" weil Daten fehlen
             indicator = '↓';
             indicatorClass = 'compare-indicator-worse';
        } else {
             indicator = '—'; // Beide haben keine Daten
             indicatorClass = '';
        }


        html += `
            <li>
                <span class="label">${stat.label}</span>
                <span class="value-container">
                    <span class="value">${stat.format(playerVal)}</span>
                    <span class="compare-indicator ${indicatorClass}">${indicator}</span>
                </span>
            </li>`;
    });
    return html;
}

// convertStatsToNumbers (Code aus früheren Schritten, ggf. mit Anpassungen)
function convertStatsToNumbers(player) {
     const numericPlayer = { ...player };
     const statsToConvert = ['elo', 'rating', 'dpr', 'kast', 'kd', 'adr', 'kpr', 'hsp', 'impact', 'worth', 'winRate', 'matchesPlayed']; // Add other stats as needed

     statsToConvert.forEach(statKey => {
         if (numericPlayer[statKey] !== undefined && numericPlayer[statKey] !== null) {
             const num = parseFloat(numericPlayer[statKey]);
             numericPlayer[statKey] = Number.isFinite(num) ? num : null;
         } else {
             numericPlayer[statKey] = null; // Ensure it's explicitly null if undefined/null
         }
     });

     // Handle impact calculation specifically if needed here, or ensure it's done upstream
     // Überprüfen Sie, ob die Impact-Berechnung hier oder im getPlayerData erfolgt
     // Wenn es im getPlayerData korrekt gemacht wird, brauchen Sie es hier nicht mehr
     // Lassen Sie es hier zur Sicherheit, falls der Rohwert kommt
     // if (numericPlayer.impact !== null) {
     //      numericPlayer.impact = numericPlayer.impact - 0.2; // Passe den Wert hier an, falls nötig
     // }

     return numericPlayer;
}

// Funktion zum Umschalten des Vergleichsmodus
function toggleComparisonMode(activate) {
    console.log(`[LOG] Toggling comparison mode. Requested state: ${activate}, Current state: ${isComparing}`);
    if (isComparing === activate && activate === true) {
         console.log("[LOG] Comparison mode is already active. Doing nothing.");
         return; // Verhindern, dass der Modus erneut aktiviert wird, wenn er schon an ist
    }
     if (isComparing === activate && activate === false) {
         console.log("[LOG] Comparison mode is already inactive. Doing nothing.");
         // Nur Reset, wenn der Modus tatsächlich deaktiviert wurde (z.B. durch Sortieren)
         // resetComparisonSelection(); // Diese Logik ist jetzt in der aufrufenden Funktion
         return; // Verhindern, dass der Modus erneut deaktiviert wird, wenn er schon aus ist
    }


    isComparing = activate;
    console.log(`[LOG] Comparison mode isComparing set to: ${isComparing}`);

    if (compareButton) {
        compareButton.classList.toggle('active', isComparing);
         console.log(`[LOG] Compare button active class toggled: ${isComparing}`);
    } else {
        console.warn("[LOG] compareButton is null in toggleComparisonMode!");
    }

    // Sortier-Buttons deaktivieren, wenn im Vergleichsmodus
    if (sortEloButton) sortEloButton.disabled = isComparing;
    if (sortWorthButton) sortWorthButton.disabled = isComparing;


    if (isComparing) {
        console.log("[LOG] Comparison mode activated. Select two players.");
        resetComparisonSelection(); // Vorherige Auswahl löschen
        hidePlayerCard(); // Aktuelle Detail-/Vergleichskarte ausblenden BEFORE selecting players
        if(saverAbiListHeader) saverAbiListHeader.textContent = 'Wähle 2 Spieler zum Vergleich';
    } else {
        console.log("[LOG] Comparison mode deactivated.");
        if(saverAbiListHeader) saverAbiListHeader.textContent = 'Spielerliste'; // Headertext zurücksetzen
        // hidePlayerCard(); // <-- DIESE ZEILE BLEIBT ENTFERNT
        resetComparisonSelection(); // Auswahl und Hervorhebung löschen (behält aber die angezeigte Karte, falls 2 Spieler ausgewählt wurden)
    }
}

// Funktion zum Zurücksetzen der Vergleichsauswahl
function resetComparisonSelection() {
    playersToCompare = [];
    // Hervorhebung von allen Listenelementen entfernen
    if (playerListContainerEl) {
        playerListContainerEl.querySelectorAll('li').forEach(li => {
            li.classList.remove('selected-for-compare');
        });
    }
}

// Funktion zum Ausblenden der Detail-/Vergleichskarte
function hidePlayerCard() {
    console.log("[LOG] Hiding player card.");
     if (detailCardContainer) detailCardContainer.style.display = 'none';
     if (mainContentArea) mainContentArea.classList.remove('detail-visible');
     detailCardContainer.innerHTML = ''; // Inhalt leeren
}


// handlePlayerListClick (ANGEPASST für Vergleichsmodus und Detailkarte schließen)
function handlePlayerListClick(e) {
    console.log("[LOG] Player list item clicked."); // Add log at the start
    const li = e.target.closest('li');
    if (!li) {
        console.log("[LOG] Click was not on a list item.");
        return;
    }
    const nickname = li.dataset.nickname;
    console.log(`[LOG] Clicked player with nickname: ${nickname}`);
    if (!nickname) {
        console.warn("[LOG] Clicked list item has no nickname dataset.");
        return;
    }

    const playerData = allPlayersData.find(p => p.nickname === nickname);

    if (!playerData) {
        console.warn(`[LOG] No player data found for nickname: ${nickname}`);
        // Optional: Display an error or do nothing if data is missing
        return;
    }

    // Problem 3 & 4: Detailkarte öffnen und schließen bei erneutem Klick
    const detailCardIsVisible = detailCardContainer.style.display !== 'none';
    // Versuche, den Nickname aus der aktuell angezeigten Karte zu bekommen
    const currentDetailPlayerNicknameEl = detailCardContainer.querySelector('.player-name');
    const currentDetailPlayerNickname = currentDetailPlayerNicknameEl ? currentDetailPlayerNicknameEl.textContent : null;


    if (!isComparing && detailCardIsVisible && currentDetailPlayerNickname === nickname) {
        console.log(`[LOG] Clicking on already displayed player ${nickname}. Closing detail card.`);
        hidePlayerCard(); // Karte ausblenden
        return; // Verarbeitung stoppen
    }


    if (isComparing) {
        // Vergleichsmodus Logik
        const isAlreadySelected = playersToCompare.some(p => p.nickname === nickname);
         console.log(`[LOG] In comparison mode. Player ${nickname} already selected? ${isAlreadySelected}. Players selected so far: ${playersToCompare.length}`); // Log Vergleichsstatus

        if (isAlreadySelected) {
             // Wenn der bereits ausgewählte Spieler erneut geklickt wird, Auswahl aufheben
             playersToCompare = playersToCompare.filter(p => p.nickname !== nickname);
             li.classList.remove('selected-for-compare'); // Hervorhebung entfernen
             console.log(`[LOG] Player ${nickname} deselected. Remaining players: ${playersToCompare.length}`);

             if (playersToCompare.length === 1) {
                 if(saverAbiListHeader) saverAbiListHeader.textContent = `Wähle 2. Spieler zum Vergleich (${playersToCompare[0].nickname} ausgewählt)`;
                 hidePlayerCard(); // Karte ausblenden, wenn nur noch ein Spieler übrig ist
             } else { // playersToCompare.length === 0
                 if(saverAbiListHeader) saverAbiListHeader.textContent = 'Wähle 2 Spieler zum Vergleich';
                 hidePlayerCard(); // Karte ausblenden, wenn keine Spieler ausgewählt sind
             }

        } else if (playersToCompare.length < 2) {
            // Spieler zur Vergleichsliste hinzufügen (maximal 2)
            playersToCompare.push(playerData);
            li.classList.add('selected-for-compare'); // Spieler visuell hervorheben
             console.log(`[LOG] Player ${nickname} selected. Players selected: ${playersToCompare.length}`);

            if (playersToCompare.length === 2) {
                console.log(`[LOG] Zwei Spieler für Vergleich ausgewählt: ${playersToCompare[0].nickname} vs ${playersToCompare[1].nickname}`);
                displayComparisonCard(playersToCompare[0], playersToCompare[1]);
                // Vergleich abgeschlossen, Modus verlassen
                toggleComparisonMode(false); // Deaktiviert den Vergleichsmodus und setzt die Auswahl zurück (OHNE die Karte auszublenden)
            } else { // playersToCompare.length === 1
                console.log(`[LOG] Erster Spieler ausgewählt: ${playerData.nickname}. Warte auf den zweiten.`);
                if(saverAbiListHeader) saverAbiListHeader.textContent = `Wähle 2. Spieler zum Vergleich (${playerData.nickname} ausgewählt)`;
                 // Keine Notwendigkeit, die Karte hier auszublenden, hidePlayerCard() wird aufgerufen, wenn der Modus aktiviert wird.
            }
        } else {
             // Dieser Fall sollte idealerweise nicht erreichbar sein, wenn toggleComparisonMode(false) nach Auswahl von 2 Spielern korrekt funktioniert.
             console.warn("[LOG] Angeklickter Spieler, obwohl 2 Spieler bereits ausgewählt sind und der Modus irgendwie noch aktiv ist.");
             // Optionale Fehlerbehandlung oder einfach Ignorieren
        }

    } else {
        // Normaler Detailkarten-Modus
        console.log(`[LOG] Nicht im Vergleichsmodus. Zeige Detailkarte für: ${nickname}`);
        resetComparisonSelection(); // Sicherstellen, dass keine alten Vergleiche hängen
        displayDetailCard(playerData);
    }
}


// loadSaverAbiView (unverändert bis auf Error Handling/Logging)
async function loadSaverAbiView() {
    console.log("[LOG] loadSaverAbiView called");
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl || !detailCardContainer || !mainContentArea || !saverAbiContent || !sortEloButton || !sortWorthButton || !compareButton || !saverAbiListHeader) { // *** compareButton hinzugefügt ***
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
    resetComparisonSelection(); // Auswahl beim Neuladen zurücksetzen
    toggleComparisonMode(false); // Vergleichsmodus beim Neuladen deaktivieren


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

        // Add click listener to player list container ONCE in DOMContentLoaded instead
        // Add click listener to sort buttons ONCE in DOMContentLoaded instead
        // Add click listener to compare button ONCE in DOMContentLoaded instead

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
        // compareButton sollte hier nicht aktiv sein, es sei denn, er wurde geklickt
         if (compareButton) compareButton.classList.remove('active'); // Sicherstellen, dass Compare Button deaktiviert ist
    }
}


// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht
// -------------------------------------------------------------

let currentUniligaData = null;

async function loadUniligaView() {
    console.log("[LOG] loadUniligaView WURDE AUFGERUFEN!");
     // Sicherstellen, dass der Vergleichsmodus beendet wird, wenn die Ansicht gewechselt wird
    toggleComparisonMode(false);
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
        console.log("[LOG] loadUniligaView finally block reached.");
        if (loadingIndicatorUniliga) { loadingIndicatorUniliga.style.display = 'none'; console.log("[LOG] Uniliga loading indicator hidden."); }
    }
}

function displayUniligaData(data) {
    // ... (keine Änderungen hier)
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