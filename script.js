// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    // Bereinigt - letzte Definition aus deinem Code übernommen
    rating: { bad: 0.85, okay: 1.05, good: 1.2, great: 1.3, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.63, great: 0.55, max: 1 }, // Niedriger ist besser
    kast: { bad: 58, okay: 66, good: 75, great: 80, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, great: 1.4, max: 2.0 },
    adr: { bad: 65, okay: 70, good: 85, great: 90, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, great: 0.9, max: 1.2 },
    impact: { bad: 1, okay: 1.3, good: 1.45, great: 1.55, max: 1.8 },
    elo: { bad: 1800, okay: 2000, good: 2600, great: 2900, max: 4000 },
    hsp: { bad: 15, okay: 35, good: 44, great: 55, max: 60 }, // Korrigiert auf 55 für great, falls in %
    winRate: { bad: 40, okay: 50, good: 60, great: 70, max: 100 }
};

let teamIconMap = {}; // Speichert das Mapping von Teamnamen zu Icon-Dateinamen
let allPlayersData = []; // Globale Speicherung der Spielerdaten für SaverAbi
let currentSortMode = 'elo'; // Start-Sortiermodus ('elo' oder 'worth')

// NEU: Variablen für die Vergleichsfunktion
let isComparisonMode = false;
let playersToCompare = []; // Speichert die nicknames der ausgewählten Spieler

function safe(v, digits = 2, suf = "") {
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    return Number.isFinite(num) ? num.toFixed(digits) + suf : "—";
}

function safeWorth(v) {
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    if (!Number.isFinite(num)) return "—";

    // Teile durch 1000, um den Wert in "Tausend" zu erhalten (wie im CSS Kommentar)
    // ACHTUNG: Der CSS Kommentar spricht von "Mio USD", die Berechnung hier scheint auf Tausend zu zielen.
    // Falls Mio USD korrekt ist, müsste die Division durch 1,000,000 erfolgen.
    // Ich behalte die aktuelle Logik (Division durch 1000) bei, da sie im original JS stand,
    // aber der Kommentar im CSS könnte irreführend sein.
    const worthInThousands = num / 1000;

    // Formatiere mit 1 Dezimalstelle und füge ' Tsd USD' hinzu
    // Verwende 'de-DE' Locale, um das Komma als Dezimaltrennzeichen zu nutzen
     // Korrigiere die Einheit im String, um zur Division durch 1000 zu passen
    return worthInThousands.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' Tsd USD';
    // Falls Mio USD gewünscht ist, ändere die Zeile zu:
    // const worthInMillions = num / 1000000;
    // return worthInMillions.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' Mio USD';

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
        const teamsData = await response.json(); // Direkt als JSON parsen
        console.log("[LOG] uniliga_teams.json data:", teamsData);

        teamIconMap = teamsData.reduce((map, team) => {
            if (team.name && team.icon) {
                map[team.name] = team.icon;
            }
            return map;
        }, {});
        console.log("[LOG] Team icon map created:", teamIconMap);

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
    toggleButtons, sortEloButton, sortWorthButton, compareButton, saverAbiListHeader; // NEU: compareButton

function cacheDOMElements() {
    console.log("[LOG] Caching DOM elements...");
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
    compareButton = document.getElementById("compare-button"); // NEU: Cache compare button

    if (!playerListContainerEl || !loadingIndicatorSaverAbi || !saverAbiContent || !uniligaContent || !uniligaDataArea || !sortEloButton || !sortWorthButton || !compareButton || !saverAbiListHeader || !detailCardContainer || !mainContentArea) { // NEU: compareButton hinzugefügt
        console.error("FEHLER: Wichtige DOM-Elemente wurden nicht gefunden!");
         // Optional: Zeige eine generelle Fehlermeldung an
        if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Fehler beim Initialisieren der Seite (UI-Elemente fehlen)."; errorMessageSaverAbi.style.display = 'block'; }
        if(loadingIndicatorSaverAbi) loadingIndicatorSaverAbi.style.display = 'none';
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
                 const errData = await res.json(); // Versuche JSON zu parsen
                 errorMsg = errData.error || errData.message || JSON.stringify(errData) || errorMsg;
            } catch (parseError) {
                 // Wenn JSON nicht parsbar ist, lese den Text
                 const errDataText = await res.text();
                 errorMsg = errDataText || errorMsg;
                 console.error(`[DEBUG] Failed to parse error response for ${nickname}:`, parseError, "Raw text:", errDataText);
            }
            console.error(`[DEBUG] API error for ${nickname}: ${errorMsg}`);
            return { nickname, error: errorMsg, sortElo: -1, worth: null };
        }
        const p = await res.json(); // Direkt als JSON parsen
        console.log(`[DEBUG] /api/faceit-data data for ${nickname}:`, p);

        if (p.error) {
             console.error(`[DEBUG] API returned error for ${nickname}: ${p.error}`);
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
        p.hsp = toNum(p.hsPercent); // Stellen sicher, dass es richtig gelesen wird
        p.impact = toNum(p.impact);


        // Berechne den "Geldwert" (basierend auf der aktuellen Logik)
        if (p.sortElo !== null && typeof p.rating === 'number' && typeof p.impact === 'number') {
            const elo = p.sortElo;
            const rating = p.rating;
            const impact = p.impact;

            const bonusThreshold = thresholds?.elo?.okay ?? 2000;
            const bonusPower = 1.8; // Wie im Original
            const bonusScale = 0.05; // Wie im Original

            const weightedElo = elo + (elo > bonusThreshold ? Math.pow(elo - bonusThreshold, bonusPower) * bonusScale : 0);

            const impactFactor = impact - 0.2; // Wie im Original
            let finalWorth = weightedElo * rating * impactFactor;

            finalWorth = Math.max(0, finalWorth);

            p.worth = finalWorth;

        } else {
             p.worth = null;
        }
        if (p.sortElo === null) p.sortElo = -1; // Sorgt dafür, dass Spieler ohne ELO am Ende sortiert werden

        return p;
    } catch (err) {
        console.error(`getPlayerData error for ${nickname}:`, err);
        return { nickname, error: err.message || "Netzwerk- oder Parsing-Fehler", sortElo: -1, worth: null };
    }
}

// Sortierfunktionen (unverändert)
function sortPlayersByElo(players) {
    return [...players].sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1));
}

function sortPlayersByWorth(players) {
    return [...players].sort((a, b) => {
        const worthA = a.worth ?? -Infinity; // Spieler ohne Wert am Ende
        const worthB = b.worth ?? -Infinity;
        return worthB - worthA;
    });
}

function displayPlayerList(players) {
    console.log(`[LOG] displayPlayerList Aufgerufen mit ${players?.length ?? 0} Spieler-Objekten. Sortierung: ${currentSortMode}. Vergleichsmodus: ${isComparisonMode}. Ausgewählt: ${playersToCompare.length}`);
    if (!playerListContainerEl) { console.error("FEHLER: playerListContainerEl ist null in displayPlayerList!"); return; }
    if (!saverAbiListHeader) { console.error("FEHLER: saverAbiListHeader ist null!"); return;}

    playerListContainerEl.innerHTML = ''; // Liste leeren

    saverAbiListHeader.textContent = 'Spielerliste'; // Header bleibt immer gleich

    if (!players || players.length === 0) {
        console.log("[LOG] Keine Spielerdaten zum Anzeigen vorhanden.");
        playerListContainerEl.innerHTML = '<li>Keine Spielerdaten gefunden oder geladen.</li>';
        return;
    }

    players.forEach((player) => {
        const li = document.createElement('li');
        li.dataset.nickname = player.nickname;

        // NEU: Klasse für ausgewählte Spieler hinzufügen
        if (isComparisonMode && playersToCompare.includes(player.nickname)) {
            li.classList.add('selected-for-compare');
        }

        if (player.error) {
            li.classList.add('error-item');
            li.innerHTML = `<span class='player-info'><img src='default_avatar.png' class='avatar' alt="Standard Avatar"/><span class='player-name'>${player.nickname}</span></span><div class='player-list-right error-text'>Fehler</div>`; // Angepasste Fehlermeldung
        } else {
            const displayValue = currentSortMode === 'elo'
                ? `${player.sortElo !== null ? player.sortElo : 'N/A'}` // Zeigt N/A wenn elo null ist
                : `${safeWorth(player.worth)}`;

            const eloProgressBarHtml = `<div class='elo-progress-container' data-elo='${player.sortElo ?? 0}'><div class='elo-progress-bar'></div></div>`;

            // Club Icon nur im Bluelock-Modus anzeigen
            const clubIconHtml = currentSortMode === 'worth' && player.assignedClubIcon
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


// Club Zuweisung für Bluelock Ranking (unverändert)
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
     // Sortiere die Spieler temporär nach Worth für die Zuweisung
    const sortedByWorth = [...players].sort((a, b) => (b.worth ?? -Infinity) - (a.worth ?? -Infinity));

    sortedByWorth.forEach((player, index) => {
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
        // Finde den ursprünglichen Spieler im allPlayersData Array, um das Icon zuzuweisen
        const originalPlayer = players.find(p => p.nickname === player.nickname);
        if(originalPlayer) {
             originalPlayer.assignedClubIcon = assignedClubName ? clubIconMap[assignedClubName] : null;
        } else {
             console.warn(`[LOG] Original Spieler "${player.nickname}" nicht in allPlayersData gefunden.`);
        }
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

// NEU: Funktion zum Anzeigen der einzelnen Spieler-Detailkarte
function displaySinglePlayerCard(player) {
    console.log("[LOG] displaySinglePlayerCard called for player:", player?.nickname || 'N/A');
    if (!detailCardContainer || !mainContentArea) { console.error("FEHLER: Detail Card Container oder Main Content Area nicht gefunden."); return; }

    // Sicherstellen, dass die SaverAbi-Ansicht aktiv ist
    const saverAbiContentEl = document.getElementById('saverabi-content');
    if (!saverAbiContentEl || !saverAbiContentEl.classList.contains('active')) {
        console.log("[LOG] SaverAbi view is not active, hiding detail card.");
        detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        return;
    }

    // Detailkarte anzeigen
    detailCardContainer.style.display = 'block';
    if (mainContentArea) mainContentArea.classList.add('detail-visible');

    if (!player || player.error) {
        console.warn("[LOG] Displaying error card for player:", player?.nickname || 'N/A', "Error:", player?.error);
        detailCardContainer.innerHTML = `<div class='player-card-base error-card'>${player?.nickname || 'Spieler'} – Fehler: ${player?.error || 'Unbekannt'}</div>`; // Nutzt player-card-base
        detailCardContainer.querySelector('.player-card-base')?.classList.add('player-card-detail'); // Fügt Detail-Klasse hinzu
        return;
    }

    console.log("[LOG] Rendering detail card for", player.nickname);
    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';

    detailCardContainer.innerHTML = `
        <div class="player-card-base player-card-detail"> <div class="card-header">
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
    updateStatProgressBars(detailCardContainer.querySelector('.player-card-detail'), player); // Wählt die Detail-Karte aus
    console.log("[LOG] Detail card rendered.");
}


// updateStatProgressBars (unverändert)
function updateStatProgressBars(card, player) {
    // Sucht innerhalb des übergebenen Karten-Elements
     card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
        const stat = item.dataset.stat; const val = player[stat]; const cfg = thresholds[stat];
        const bar = item.querySelector('.stat-progress-container .stat-progress-bar'); // Präziserer Selektor
        const lbl = item.querySelector('.stat-indicator-label');
        if (!cfg || !bar || !lbl) {
            console.warn(`[LOG] Konnte Elemente oder Konfiguration für Stat "${stat}" nicht finden.`);
            if(lbl) lbl.textContent = '---'; if(bar) { bar.style.left = '0%'; bar.style.width = '0%'; bar.style.backgroundColor = 'transparent'; bar.style.boxShadow = 'none'; bar.style.borderRadius = '0';} return;
        }
        let category = 0; let text = 'BAD'; let color = 'var(--bar-bad)'; let barLeft = '0%'; const barWidth = '33.333%'; let borderRadiusStyle = '0';
        let numericalVal = toNum(val); // Sicher in Zahl umwandeln

        if (numericalVal != null) { // Prüfen, ob der Wert eine gültige Zahl ist
             if (stat === 'dpr') { // Niedriger DPR ist besser
                if (numericalVal <= cfg.great) { category = 2; text = 'GREAT'; color = 'var(--bar-great)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
                else if (numericalVal <= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
                else if (numericalVal <= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
            } else if (stat === 'hsp') { // HSP ist in %
                let compareVal = numericalVal;
                 // Annahme: HSP kommt als Zahl zwischen 0 und 100 oder 0 und 1.
                 // Schwellenwerte sind in 0-100. Normalisieren bei Bedarf.
                 if (compareVal <= 1 && cfg.max > 1) { // Sieht nach 0-1 aus, Schwellen nach 0-100
                      compareVal = compareVal * 100;
                      console.log(`[LOG] HSP value ${val} adjusted to ${compareVal}% for threshold comparison.`);
                 } else if (compareVal > 1 && cfg.max <= 1) { // Sieht nach 0-100 aus, Schwellen nach 0-1
                       compareVal = compareVal / 100;
                       console.log(`[LOG] HSP value ${val} adjusted to ${compareVal} for threshold comparison.`);
                 }
                 // Jetzt mit den angepassten Schwellenwerten vergleichen
                 if (compareVal >= cfg.great) { category = 2; text = 'GREAT'; color = 'var(--bar-great)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (compareVal >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (compareVal >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }

            }
            else { // Höher ist besser für andere Stats
                if (numericalVal >= cfg.great) { category = 2; text = 'GREAT'; color = 'var(--bar-great)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (numericalVal >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; barLeft = '66.666%'; borderRadiusStyle = '0 4px 4px 0'; }
                else if (numericalVal >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; barLeft = '33.333%'; borderRadiusStyle = '0'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; barLeft = '0%'; borderRadiusStyle = '4px 0 0 4px'; }
            }
        } else {
            text = '---'; category = -1; color = 'transparent'; barLeft = '0%'; borderRadiusStyle = '0';
             console.warn(`[LOG] Ungültiger numerischer Wert für Stat "${stat}":`, val);
        }
        bar.style.left = barLeft; bar.style.width = barWidth; bar.style.backgroundColor = color; bar.style.boxShadow = (category !== -1) ? `0 0 8px ${color}` : 'none'; bar.style.borderRadius = borderRadiusStyle;
        lbl.textContent = text; lbl.style.color = (category !== -1) ? color : 'var(--text-secondary)';
    });
}

// NEU: Helper Funktion für Vergleichsindikatoren
function getComparisonIndicator(statName, value1, value2) {
    const numVal1 = toNum(value1);
    const numVal2 = toNum(value2);

    if (numVal1 === null || numVal2 === null || numVal1 === numVal2) {
        return ''; // Kein Indikator, wenn Werte fehlen oder gleich sind
    }

    let isValue1Better;

    // Spezielle Logik für DPR (niedriger ist besser)
    if (statName === 'dpr') {
        isValue1Better = numVal1 < numVal2;
    } else {
         // Logik für alle anderen Stats (höher ist besser)
        isValue1Better = numVal1 > numVal2;
    }

    if (isValue1Better) {
        return { p1: '<span class="compare-indicator compare-indicator-better">˰</span>', p2: '<span class="compare-indicator compare-indicator-worse">˯</span>' };
    } else {
        return { p1: '<span class="compare-indicator compare-indicator-worse">˯</span>', p2: '<span class="compare-indicator compare-indicator-better">˰</span>' };
    }
}


// NEU: Funktion zum Anzeigen der Vergleichskarte
function displayComparisonCard(player1, player2) {
     console.log("[LOG] displayComparisonCard called for players:", player1?.nickname, player2?.nickname);
     if (!detailCardContainer || !mainContentArea) { console.error("FEHLER: Detail Card Container oder Main Content Area nicht gefunden."); return; }

     // Sicherstellen, dass die SaverAbi-Ansicht aktiv ist
     const saverAbiContentEl = document.getElementById('saverabi-content');
    if (!saverAbiContentEl || !saverAbiContentEl.classList.contains('active')) {
        console.log("[LOG] SaverAbi view is not active, hiding comparison card.");
        detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        return;
    }


     detailCardContainer.style.display = 'block';
     if (mainContentArea) mainContentArea.classList.add('detail-visible');

     if (!player1 || !player2 || player1.error || player2.error) {
         console.warn("[LOG] Displaying error in comparison card. Player1:", player1?.nickname, "Error:", player1?.error, "Player2:", player2?.nickname, "Error:", player2?.error);
         let errorText = "Fehler beim Laden der Spielerdaten für Vergleich.";
         if(player1?.error && player2?.error) errorText = `${player1.nickname} & ${player2.nickname}: Fehler beim Laden.`;
         else if (player1?.error) errorText = `${player1.nickname}: ${player1.error}`;
         else if (player2?.error) errorText = `${player2.nickname}: ${player2.error}`;
         else errorText = "Mindestens ein Spieler konnte nicht gefunden werden."; // Fall, falls Datenobjekte fehlen
         detailCardContainer.innerHTML = `<div class='player-card-base error-card'>${errorText}</div>`;
         detailCardContainer.querySelector('.player-card-base')?.classList.add('player-card-compare'); // Fügt Compare-Klasse hinzu
         return;
     }

    // Datenpunkte, die im Vergleich angezeigt werden sollen
    const statsToCompare = [
         { name: 'rating', label: 'Rating 2.0', format: v => safe(v, 2) },
         { name: 'dpr', label: 'DPR', format: v => safe(v, 2) },
         { name: 'kast', label: 'KAST', format: v => safe(v, 1, '%') },
         { name: 'impact', label: 'IMPACT', format: v => safe(v - 0.2, 2) }, // Anpassung für Impact Anzeige
         { name: 'adr', label: 'ADR', format: v => safe(v, 1) },
         { name: 'kpr', label: 'KPR', format: v => safe(v, 2) },
         { name: 'kd', label: 'K/D', format: v => safe(v, 2) }, // K/D wieder hinzufügen für Vergleich? Oder weglassen wie vorher? Füge es hinzu.
         { name: 'hsp', label: 'HS %', format: v => safe(v, 1, '%') }, // HSP Format anpassen
    ];

     let player1StatsHtml = '';
     let player2StatsHtml = '';

     statsToCompare.forEach(stat => {
         const val1 = player1[stat.name];
         const val2 = player2[stat.name];
         const indicators = getComparisonIndicator(stat.name, val1, val2);

         player1StatsHtml += `
             <li>
                 <span class="label">${stat.label}</span>
                 <span class="value-container">
                     <span class="value">${stat.format(val1)}</span>
                     ${indicators.p1 || ''}
                 </span>
             </li>`;
        player2StatsHtml += `
             <li>
                 <span class="label">${stat.label}</span>
                 <span class="value-container">
                     <span class="value">${stat.format(val2)}</span>
                     ${indicators.p2 || ''}
                 </span>
             </li>`;
     });

     const faceitUrl1 = player1.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player1.nickname)}`;
     const faceitUrl2 = player2.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player2.nickname)}`;


     detailCardContainer.innerHTML = `
         <div class="player-card-base player-card-compare"> <div class="player-compare-player-section">
                 <div class="card-header">
                    <a href="${faceitUrl1}" target="_blank" rel="noopener noreferrer"><img src="${player1.avatar || 'default_avatar.png'}" class="avatar" alt="Avatar von ${player1.nickname}" onerror="this.src='default_avatar.png'"/></a>
                    <a href="${faceitUrl1}" target="_blank" rel="noopener noreferrer" class="player-name">${player1.nickname}</a>
                    <div class="stats-label">${player1.matchesConsidered ? `(${player1.matchesConsidered} Matches)` : ''}</div>
                 </div>
                 <ul class="player-compare-stats-list">
                     ${player1StatsHtml}
                 </ul>
             </div>
             <div class="player-compare-player-section">
                 <div class="card-header">
                    <a href="${faceitUrl2}" target="_blank" rel="noopener noreferrer"><img src="${player2.avatar || 'default_avatar.png'}" class="avatar" alt="Avatar von ${player2.nickname}" onerror="this.src='default_avatar.png'"/></a>
                    <a href="${faceitUrl2}" target="_blank" rel="noopener noreferrer" class="player-name">${player2.nickname}</a>
                     <div class="stats-label">${player2.matchesConsidered ? `(${player2.matchesConsidered} Matches)` : ''}</div>
                 </div>
                 <ul class="player-compare-stats-list">
                     ${player2StatsHtml}
                 </ul>
             </div>
         </div>`;
     console.log("[LOG] Comparison card rendered.");
}


// loadSaverAbiView (modifiziert, um sortAndDisplayPlayers aufzurufen)
async function loadSaverAbiView() {
    console.log("[LOG] loadSaverAbiView called");
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl || !detailCardContainer || !mainContentArea || !saverAbiContent || !sortEloButton || !sortWorthButton || !compareButton || !saverAbiListHeader) {
        console.error("FEHLER: Benötigte Elemente für SaverAbi View fehlen!");
        if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageSaverAbi.style.display = 'block'; }
        return;
    }

    // NEU: Exit comparison mode beim Laden der SaverAbi View
    exitComparisonMode(); // Stellt sicher, dass wir nicht im Vergleichsmodus starten

    loadingIndicatorSaverAbi.style.display = 'block';
    errorMessageSaverAbi.style.display = 'none';
    playerListContainerEl.innerHTML = '';
    detailCardContainer.style.display = 'none';
    if(mainContentArea) mainContentArea.classList.remove('detail-visible');
    allPlayersData = []; // Daten zurücksetzen

    try {
        console.log("[LOG] Fetching /players.json...");
        const namesRes = await fetch('/players.json');
        console.log("[DEBUG] /players.json status:", namesRes.status); // DEBUG Log
        if (!namesRes.ok) throw new Error(`Fehler Laden Spielerliste (${namesRes.status})`);
        const names = await namesRes.json(); // Direkt als JSON parsen

        console.log("[LOG] Player names loaded:", names);
        if (!Array.isArray(names) || names.length === 0) {
             const msg = "Spielerliste leer/ungültig in players.json";
             console.warn(`[LOG] ${msg}`);
             if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = msg; errorMessageSaverAbi.style.display = 'block'; }
             if(playerListContainerEl) playerListContainerEl.innerHTML = '<li>Keine Spieler in der Liste gefunden.</li>';
             return; // Beende Funktion, da keine Spieler geladen werden können
        }

        console.log("[LOG] Fetching player data for all players...");
        const promises = names.map(name => getPlayerData(name));
        const results = await Promise.all(promises);
        console.log("[LOG] Player data fetch results (raw):", results);
        allPlayersData = results;

        const validPlayerCount = allPlayersData.filter(p => !p.error).length;
        console.log(`[LOG] Gültige Spielerdaten empfangen: ${validPlayerCount} / ${allPlayersData.length}`);
        if(validPlayerCount === 0 && allPlayersData.length > 0) {
            console.warn("[LOG] Keine gültigen Spielerdaten von der API erhalten, nur Fehler.");
             if(errorMessageSaverAbi) { errorMessageSaverAbi.textContent = "Keine gültigen Spielerdaten von der API erhalten."; errorMessageSaverAbi.style.display = 'block'; }
        }

        // Sortieren und anzeigen der Spieler nach dem Standard-Sortiermodus
        sortAndDisplayPlayers();

        // Click Listener nur einmal hinzufügen beim Initialisieren der View
        if (playerListContainerEl) {
             // Entferne vorherige Listener, um Duplikate zu vermeiden (wichtig beim Wechsel der Views)
             playerListContainerEl.removeEventListener('click', handlePlayerListClick);
             playerListContainerEl.addEventListener('click', handlePlayerListClick);
             console.log("[LOG] Click listener added to player list.");
        } else {
             console.warn("[LOG] Konnte Click listener für Spielerliste nicht hinzufügen.");
        }

         // Sortier-Controls anzeigen, wenn Daten geladen wurden
        const sortButtonContainer = document.getElementById('saverabi-sort-controls');
        if (sortButtonContainer) {
            sortButtonContainer.style.display = 'flex';
            console.log("[LOG] Sort controls displayed.");
        }


    } catch (err) {
        console.error("Schwerwiegender Fehler in loadSaverAbiView:", err);
        if(errorMessageSaverAbi){ errorMessageSaverAbi.textContent = `Fehler: ${err.message}`; errorMessageSaverAbi.style.display = 'block'; }
        if(playerListContainerEl) playerListContainerEl.innerHTML = '<li>Fehler beim Laden der Spielerliste oder Daten.</li>';
    }
    finally {
        console.log("[LOG] loadSaverAbiView finally block reached.");
        if (loadingIndicatorSaverAbi) {
            loadingIndicatorSaverAbi.style.display = 'none';
            console.log("[LOG] Loading indicator hidden.");
        }
    }
}

// sortAndDisplayPlayers (modifiziert, um Club-Icon Zuweisung basierend auf aktuellem allPlayersData zu machen)
function sortAndDisplayPlayers() {
    console.log(`[LOG] Sorting and displaying players based on: ${currentSortMode}. Comparison Mode: ${isComparisonMode}`);

    // Vor dem Sortieren die Club-Icons zuweisen, falls im Worth-Modus
    if (currentSortMode === 'worth') {
        assignClubsToPlayers(allPlayersData); // Zuweisung basierend auf aktuellen Daten
    } else {
         // Icons entfernen/zurücksetzen, wenn im Elo-Modus
        allPlayersData.forEach(player => player.assignedClubIcon = null);
    }


    let sortedPlayers;
    if (currentSortMode === 'elo') {
        sortedPlayers = sortPlayersByElo(allPlayersData);
    } else { // 'worth' (Bluelock Ranking)
        sortedPlayers = sortPlayersByWorth(allPlayersData);
    }
    console.log("[LOG] Sorted player data for display:", sortedPlayers.map(p => ({ nickname: p.nickname, sortValue: currentSortMode === 'elo' ? p.sortElo : p.worth, error: p.error }))); // Log relevante Infos

    displayPlayerList(sortedPlayers); // Diese Funktion kümmert sich um das Rendering

    // NEU: Button-Zustände aktualisieren
    if (sortEloButton && sortWorthButton && compareButton) {
        sortEloButton.classList.toggle('active', currentSortMode === 'elo' && !isComparisonMode);
        sortWorthButton.classList.toggle('active', currentSortMode === 'worth' && !isComparisonMode);
        compareButton.classList.toggle('active', isComparisonMode); // Compare Button ist aktiv, wenn im Vergleichsmodus
    } else {
         console.warn("[LOG] Sortier- oder Vergleichsbuttons nicht gefunden.");
    }

    // NEU: Detail-/Vergleichskarte verstecken, wenn Sortierung geändert wird (außer im Vergleichsmodus, wo 2 ausgewählt sind)
    if (!isComparisonMode || playersToCompare.length < 2) {
        detailCardContainer.style.display = 'none';
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
         console.log("[LOG] Detail/Compare card hidden after sorting.");
    } else if (isComparisonMode && playersToCompare.length === 2) {
        // Wenn im Vergleichsmodus und 2 Spieler ausgewählt sind, die Vergleichsansicht neu rendern
        const player1 = allPlayersData.find(p => p.nickname === playersToCompare[0]);
        const player2 = allPlayersData.find(p => p.nickname === playersToCompare[1]);
         if(player1 && player2) displayComparisonCard(player1, player2);
         else console.warn("[LOG] Konnte Spielerdaten für Neu-Rendering der Vergleichskarte nicht finden.");
    }
}

// handlePlayerListClick (modifiziert für Vergleichsmodus)
function handlePlayerListClick(e) {
    const li = e.target.closest('li');
    if (!li || !li.dataset.nickname) return; // Nur auf gültige Listenelemente reagieren

    const nickname = li.dataset.nickname;
    const playerData = allPlayersData.find(p => p.nickname === nickname);

    if (!playerData) {
        console.warn(`[LOG] Keine Daten gefunden für geklickten Spieler: ${nickname}`);
        // Optional: Fehlerkarte anzeigen, wenn keine Daten verfügbar sind
        displaySinglePlayerCard({ nickname: nickname, error: "Daten nicht verfügbar" });
        return;
    }

    if (playerData.error) {
         console.warn(`[LOG] Geklickter Spieler "${nickname}" hat einen Fehler. Zeige Fehlerkarte.`);
         displaySinglePlayerCard(playerData); // Zeige Fehlerkarte für diesen Spieler
         return;
    }


    if (isComparisonMode) {
        console.log(`[LOG] Comparison Mode active. Player clicked: ${nickname}`);
        const index = playersToCompare.indexOf(nickname);

        if (index > -1) {
            // Spieler ist bereits ausgewählt -> Abwählen
            playersToCompare.splice(index, 1);
            li.classList.remove('selected-for-compare');
            console.log(`[LOG] Player "${nickname}" deselected. Players to compare:`, playersToCompare);
        } else {
            // Spieler ist noch nicht ausgewählt
            if (playersToCompare.length < 2) {
                // Weniger als 2 Spieler ausgewählt -> Hinzufügen
                playersToCompare.push(nickname);
                li.classList.add('selected-for-compare');
                console.log(`[LOG] Player "${nickname}" selected. Players to compare:`, playersToCompare);
            } else {
                // Bereits 2 Spieler ausgewählt -> Ersten ersetzen
                const oldNickname = playersToCompare.shift(); // Entferne den ersten Spieler
                playersToCompare.push(nickname); // Füge den neuen Spieler hinzu

                // Entferne die Klasse vom vorherigen ersten Spieler in der Liste
                const oldLi = playerListContainerEl.querySelector(`li[data-nickname="${oldNickname}"]`);
                if (oldLi) oldLi.classList.remove('selected-for-compare');

                li.classList.add('selected-for-compare');
                console.log(`[LOG] Player "${nickname}" selected, replacing "${oldNickname}". Players to compare:`, playersToCompare);
            }
        }

        // Aktualisiere die Anzeige basierend auf der Anzahl der ausgewählten Spieler
        if (playersToCompare.length === 2) {
            const p1 = allPlayersData.find(p => p.nickname === playersToCompare[0]);
            const p2 = allPlayersData.find(p => p.nickname === playersToCompare[1]);
            if (p1 && p2) {
                 displayComparisonCard(p1, p2);
            } else {
                 console.error("[LOG] Konnte Daten für ausgewählte Spieler im Vergleichsmodus nicht finden.");
                 // Optional: Fehlermeldung anzeigen
                 detailCardContainer.innerHTML = `<div class='player-card-base error-card'>Fehler beim Laden der Daten für Vergleich.</div>`;
                 detailCardContainer.style.display = 'block';
                 if(mainContentArea) mainContentArea.classList.add('detail-visible');
            }

        } else {
            // Wenn weniger als 2 Spieler ausgewählt sind, Detail/Vergleichskarte ausblenden
            detailCardContainer.style.display = 'none';
            if (mainContentArea) mainContentArea.classList.remove('detail-visible');
             console.log("[LOG] Less than 2 players selected, hiding detail/compare card.");
        }

    } else {
        // Nicht im Vergleichsmodus -> Einzelne Detailkarte anzeigen
        console.log(`[LOG] Not in Comparison Mode. Displaying detail card for: ${nickname}`);
        displaySinglePlayerCard(playerData);
    }
}


// NEU: Funktionen zum Umschalten des Vergleichsmodus
function toggleComparisonMode() {
     console.log("[LOG] toggleComparisonMode called. Current mode:", isComparisonMode);
    if (isComparisonMode) {
        // Vergleichsmodus verlassen
        exitComparisonMode();
    } else {
        // Vergleichsmodus aktivieren
        enterComparisonMode();
    }
}

function enterComparisonMode() {
    console.log("[LOG] Entering Comparison Mode");
    isComparisonMode = true;
    playersToCompare = []; // Auswahl zurücksetzen
    detailCardContainer.style.display = 'none'; // Detail-/Vergleichskarte ausblenden
    if(mainContentArea) mainContentArea.classList.remove('detail-visible');

    // Button-Zustände aktualisieren
    if (sortEloButton) sortEloButton.classList.remove('active');
    if (sortWorthButton) sortWorthButton.classList.remove('active');
    if (compareButton) compareButton.classList.add('active');

    // Visuelle Hervorhebung in der Liste entfernen (falls vorhanden)
    document.querySelectorAll('#player-list li.selected-for-compare').forEach(li => {
        li.classList.remove('selected-for-compare');
    });

    // Optionale Nachricht anzeigen: "Wählen Sie zwei Spieler zum Vergleichen aus"
    // (Dies könnte in der Spielerliste selbst oder an anderer Stelle platziert werden)
    // Beispiel: saverAbiListHeader.textContent = 'Spieler auswählen (2)';
    console.log("[LOG] Comparison Mode active. Select two players.");
}

function exitComparisonMode() {
    console.log("[LOG] Exiting Comparison Mode");
    isComparisonMode = false;
    playersToCompare = []; // Auswahl zurücksetzen
    detailCardContainer.style.display = 'none'; // Detail-/Vergleichskarte ausblenden
     if(mainContentArea) mainContentArea.classList.remove('detail-visible');

    // Button-Zustände aktualisieren (zurück zum aktuellen Sortiermodus)
    if (sortEloButton) sortEloButton.classList.toggle('active', currentSortMode === 'elo');
    if (sortWorthButton) sortWorthButton.classList.toggle('active', currentSortMode === 'worth');
    if (compareButton) compareButton.classList.remove('active');

     // Visuelle Hervorhebung in der Liste entfernen
     document.querySelectorAll('#player-list li.selected-for-compare').forEach(li => {
         li.classList.remove('selected-for-compare');
     });

    // Spielerliste neu anzeigen (falls nötig, z.B. wenn Header geändert wurde)
    // Wenn der Header immer "Spielerliste" bleibt, ist ein Neu-Rendering der Liste nicht zwingend nötig,
    // aber wir rufen sortAndDisplayPlayers auf, um sicherzustellen, dass der Listen-Zustand korrekt ist.
    sortAndDisplayPlayers(); // Neu sortieren/anzeigen basierend auf dem aktuellen Sortiermodus
    console.log("[LOG] Comparison Mode inactive.");
}


// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht (leicht modifiziert für exitComparisonMode)
// -------------------------------------------------------------

let currentUniligaData = null;

async function loadUniligaView() {
    console.log("[LOG] loadUniligaView WURDE AUFGERUFEN!");
    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaDataArea) {
        console.error("FEHLER: Benötigte Elemente für Uniliga View fehlen!");
        if (errorMessageUniliga) { errorMessageUniliga.textContent = "Fehler: UI-Elemente nicht initialisiert."; errorMessageUniliga.style.display = 'block'; }
        return;
    }

     // NEU: Exit comparison mode beim Wechsel zur Uniliga View
     exitComparisonMode(); // Stellt sicher, dass der Vergleichsmodus deaktiviert wird

    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    uniligaDataArea.innerHTML = ''; // Inhalt leeren

    try {
        const apiUrl = `/api/uniliga-stats?cacheBust=${Date.now()}`; // Cache Bust beibehalten
        console.log(`[LOG] VERSUCHE FETCH (mit Cache Bust): ${apiUrl}...`);

        // Laden der Team-Icon Map parallel zum API-Aufruf
        const [apiResponse] = await Promise.all([
            fetch(apiUrl),
            loadTeamIconMap() // Stellt sicher, dass die Team-Icon Map geladen ist
        ]);

        console.log("[DEBUG] Uniliga API response status:", apiResponse.status); // DEBUG Log
        if (!apiResponse.ok) {
            let errorMsg = `Fehler beim Laden der Uniliga-Daten (${apiResponse.status})`;
             try {
                 const errData = await apiResponse.json();
                 errorMsg = errData.error || errData.message || JSON.stringify(errData) || errorMsg;
            } catch (parseError) {
                 const errDataText = await apiResponse.text();
                 errorMsg = errDataText || errorMsg;
                 console.error(`[DEBUG] Failed to parse error response for Uniliga:`, parseError, "Raw text:", errDataText);
            }
            console.error("[DEBUG] Uniliga API error:", errorMsg);
            throw new Error(errorMsg);
        }
        const data = await apiResponse.json(); // Direkt als JSON parsen
        console.log("[LOG] Uniliga API data received:", data);

         if (data && (data.message?.includes('Minimaler Test') || (!data.teams && !data.players))) {
             console.warn("[LOG] Minimale Test-Antwort oder leere Daten vom Backend erhalten.");
             errorMessageUniliga.textContent = data.message || "Keine vollständigen Uniliga-Daten verfügbar.";
             errorMessageUniliga.style.display = 'block';
             uniligaDataArea.innerHTML = data.message ? `<p>${data.message}</p>` : '<p>Keine vollständigen Daten zum Anzeigen gefunden.</p>';
             currentUniligaData = null;
             return;
         }
        console.log("[LOG] Uniliga API data received (teams):", data.teams ? `${data.teams.length} teams` : 'no teams');
        console.log("[LOG] Uniliga API data received (players):", data.players ? `${data.players.length} players` : 'no players');

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

    // Clear previous content except loading/error if they are shown
    uniligaDataArea.innerHTML = '';


    if (!data || (!data.teams || data.teams.length === 0) && (!data.players || data.players.length === 0)) {
        console.warn("[LOG] Keine gültigen oder leere Uniliga-Daten zum Anzeigen vorhanden.");
        uniligaDataArea.innerHTML = '<p>Keine vollständigen Daten zum Anzeigen gefunden.</p>';
        return;
    }

    // Team Table
    if(data.teams && data.teams.length > 0) {
         let teamTableHtml = `
            <h3>Team Rangliste</h3>
            <div class="table-container">
                <table class="stats-table team-ranking-table">
                    <thead><tr><th>#</th><th>Team</th><th>Spiele</th><th>Pkt</th><th>S</th><th>N</th><th>WR %</th><th>Avg. R.</th></tr></thead>
                    <tbody>`;
        const sortedTeams = [...data.teams].sort((a, b) => {
            const pointsDiff = (b.points ?? -Infinity) - (a.points ?? -Infinity); // Sort by points desc
            if (pointsDiff !== 0) return pointsDiff;
             // Then sort by avgRating desc if points are equal
            return (b.avgRating ?? -Infinity) - (a.avgRating ?? -Infinity);
        });
        sortedTeams.forEach((team, index) => {
            const teamName = team.name || `Team ID ${team.id?.substring(0,8) || 'N/A'}...`;
            const iconFilename = teamIconMap[team.name]; // Nutzt team.name für den Lookup
            const iconPath = iconFilename ? `/uniliga_icons/${iconFilename}` : 'default_team_icon.png';
            const altText = iconFilename ? `Logo ${teamName}` : 'Standard Team Icon';
             const winRateVal = toNum(team.winRate);

            teamTableHtml += `
                <tr data-team-id="${team.id || ''}">
                    <td>${index + 1}</td>
                    <td class="player-cell team-cell">
                        <img src="${iconPath}" class="table-avatar team-avatar" alt="${altText}" onerror="this.style.display='none'; this.onerror=null;"/>
                        <span>${teamName}</span>
                    </td>
                    <td>${team.matchesPlayed ?? '—'}</td><td>${team.points ?? '—'}</td><td>${team.wins ?? '—'}</td><td>${team.losses ?? '—'}</td>
                    <td class="${getTeamWinrateClass(winRateVal)}">${safe(winRateVal, 1)}</td><td>${safe(team.avgRating, 2)}</td>
                </tr>`;
        });
        teamTableHtml += `</tbody></table></div>`;
        uniligaDataArea.innerHTML += teamTableHtml;
         console.log("[LOG] Uniliga team table rendered.");
    } else {
         console.log("[LOG] No team data available for Uniliga.");
         uniligaDataArea.innerHTML += '<p>Keine Teamdaten verfügbar.</p>';
    }


    // Player Table
    if(data.players && data.players.length > 0) {
        let playerTableHtml = `
            <h3>Spieler Rangliste (Rating)</h3>
            <div class="table-container">
                <table class="stats-table player-ranking-table">
                    <thead><tr><th>#</th><th>Spieler</th><th>Spiele</th><th>Rating</th><th>IMPACT</th><th>ADR</th><th>KAST%</th><th>HS%</th><th>WR%</th></tr></thead>
                    <tbody>`;
         // Sortiere Spieler nach Rating absteigend für die Rangliste
        const sortedPlayers = [...data.players].sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));

        sortedPlayers.forEach((player, index) => {
             const winRateVal = toNum(player.winRate);
             const impactAdjusted = toNum(player.impact) !== null ? toNum(player.impact) - 0.2 : null; // Impact Wert anpassen
             const hspVal = toNum(player.hsp);

            playerTableHtml += `
                <tr>
                    <td>${index + 1}</td>
                    <td class="player-cell">
                        <img src="${player.avatar || 'default_avatar.png'}" class="table-avatar" alt="Avatar" onerror="this.src='default_avatar.png'"/>
                        <span>${player.nickname || 'Unbekannt'}</span>
                    </td>
                    <td>${player.matchesPlayed ?? '—'}</td><td>${safe(player.rating, 2)}</td><td>${safe(impactAdjusted, 2)}</td>
                    <td>${safe(player.adr, 1)}</td><td>${safe(player.kast, 1)}</td><td>${safe(hspVal, 1)}</td>
                    <td class="${getTeamWinrateClass(winRateVal)}">${safe(winRateVal, 1)}</td>
                </tr>`;
        });
        playerTableHtml += `</tbody></table></div>`;
        uniligaDataArea.innerHTML += playerTableHtml;
         console.log("[LOG] Uniliga player table rendered.");
    } else {
        console.log("[LOG] No player data available for Uniliga.");
        uniligaDataArea.innerHTML += '<p>Keine Spielerdaten verfügbar.</p>';
    }


    const lastUpdatedHtml = data.lastUpdated
        ? `<div class="last-updated">Stand: ${new Date(data.lastUpdated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} Uhr</div>`
        : '';
     uniligaDataArea.innerHTML += lastUpdatedHtml; // Füge das Last Updated Datum hinzu


    console.log("[LOG] Uniliga data rendering complete.");
}

function getTeamWinrateClass(winRate) {
    const val = parseFloat(winRate);
    if (isNaN(val)) return '';
    const cfg = thresholds.winRate;
    // Winrate ist höher besser
    if (val >= cfg.great) return 'text-good'; // Verwende good für great > good
    if (val >= cfg.good) return 'text-good';
    if (val >= cfg.okay) return 'text-okay';
    return 'text-bad';
}

// -------------------------------------------------------------
// Umschaltlogik für Ansichten (modifiziert für exitComparisonMode)
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
     // Zeige Sortier-Controls nur in der SaverAbi View an
    if (sortButtonContainer) {
        sortButtonContainer.style.display = (viewToShow === 'saverabi') ? 'flex' : 'none';
    }

    if (viewToShow === 'uniliga') {
         exitComparisonMode(); // Vergleichsmodus verlassen beim Wechsel zur Uniliga View
        if (detailCardContainer) detailCardContainer.style.display = 'none'; // Detail-/Vergleichskarte ausblenden
        if (mainContentArea) mainContentArea.classList.remove('detail-visible');
        loadUniligaView();
    } else if (viewToShow === 'saverabi') {
         // Beim Wechsel zurück zur SaverAbi View, sicherstellen, dass Vergleichsmodus deaktiviert ist
         exitComparisonMode(); // Dies lädt auch die Spielerliste neu und setzt die Anzeige zurück

         // Die loadSaverAbiView() wird bereits von exitComparisonMode() aufgerufen,
         // wenn allPlayersData leer ist. Wenn Daten da sind, sortiert und zeigt
         // exitComparisonMode() die Liste neu an. Daher hier kein zusätzlicher Aufruf nötig,
         // außer wenn loadSaverAbiView selbst einen Fehler hatte und allPlayersData leer blieb.
         // Im aktuellen Design deckt exitComparisonMode das korrekt ab.
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    console.log("[LOG] DOMContentLoaded event fired.");
    cacheDOMElements(); // Erst Elemente cachen

    // Event Listener für View Toggle Buttons
    if (toggleButtons) {
        toggleButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const view = event.currentTarget.dataset.view;
                if (view) switchView(view);
            });
        });
         console.log("[LOG] View toggle button listeners added.");
    } else { console.warn("[LOG] View toggle buttons not found. Cannot add listeners."); }

    // Event Listener für Sortier-Buttons
    if (sortEloButton) {
        sortEloButton.addEventListener('click', () => {
            if (currentSortMode !== 'elo' || isComparisonMode) { // Wenn Modus anders ODER im Vergleichsmodus
                console.log("[LOG] Switching sort mode to: elo (from button click)");
                 exitComparisonMode(); // Vergleichsmodus beenden, dies setzt auch die Buttons zurück und sortiert neu
                currentSortMode = 'elo'; // Setze den Modus NACH exitComparisonMode
                sortAndDisplayPlayers(); // Erneutes Sortieren und Anzeigen nach Elo
            } else {
                 console.log("[LOG] Already in Elo sort mode and not in comparison mode.");
            }
        });
         console.log("[LOG] Elo sort button listener added.");
    } else { console.warn("[LOG] Sort Elo Button not found. Cannot add listener."); }

    if (sortWorthButton) {
        sortWorthButton.addEventListener('click', () => {
            if (currentSortMode !== 'worth' || isComparisonMode) { // Wenn Modus anders ODER im Vergleichsmodus
                console.log("[LOG] Switching sort mode to: worth (from button click)");
                 exitComparisonMode(); // Vergleichsmodus beenden
                currentSortMode = 'worth'; // Setze den Modus NACH exitComparisonMode
                sortAndDisplayPlayers(); // Erneutes Sortieren und Anzeigen nach Worth
            } else {
                 console.log("[LOG] Already in Worth sort mode and not in comparison mode.");
            }
        });
         console.log("[LOG] Worth sort button listener added.");
    } else { console.warn("[LOG] Sort Worth Button not found. Cannot add listener."); }

     // NEU: Event Listener für Vergleichsbutton
    if (compareButton) {
        compareButton.addEventListener('click', toggleComparisonMode);
         console.log("[LOG] Compare button listener added.");
    } else { console.warn("[LOG] Compare Button not found. Cannot add listener."); }


    console.log("[LOG] Initializing default view: saverabi");
    // Initialisiere die SaverAbi View beim Laden
    // switchView('saverabi'); // Dieser Aufruf ist nicht nötig, da exitComparisonMode() aufgerufen wird,
                               // was wiederum loadSaverAbiView() oder sortAndDisplayPlayers() aufruft.
    exitComparisonMode(); // Startet im Standard-Sortiermodus und lädt Daten/Liste.
});