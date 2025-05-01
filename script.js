// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    rating: { bad: 0.85, okay: 1.05, good: 1.25, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.6, max: 1 }, // Niedriger ist besser
    kast: { bad: 50, okay: 60, good: 70, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.0 },
    adr: { bad: 65, okay: 70, good: 85, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, max: 1.2 },
    impact: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.5 },
    elo: { bad: 1800, okay: 2000, good: 2900, max: 3500 },
    hsp: { bad: 15, okay: 25, good: 35, max: 60 },
    // Schwellen für Uniliga-Tabellen (optional, hier WinRate)
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
    loadingIndicatorUniliga, errorMessageUniliga, uniligaDataArea, // uniligaDataArea hinzugefügt
    saverAbiContent, uniligaContent,
    toggleButtons, allPlayersData = [];

function cacheDOMElements() {
    playerListContainerEl = document.getElementById("player-list");
    detailCardContainer = document.getElementById("player-detail-card-container");
    mainContentArea = document.getElementById("main-content-area");
    loadingIndicatorSaverAbi = document.getElementById("loading-indicator-saverabi");
    errorMessageSaverAbi = document.getElementById("error-message-saverabi");
    saverAbiContent = document.getElementById("saverabi-content");
    loadingIndicatorUniliga = document.getElementById("loading-indicator-uniliga");
    errorMessageUniliga = document.getElementById("error-message-uniliga");
    uniligaDataArea = document.getElementById("uniliga-data-area"); // Referenz speichern
    uniligaContent = document.getElementById("uniliga-content");
    toggleButtons = document.querySelectorAll(".toggle-button");
}

// -------------------------------------------------------------
// Funktionen für die SaverAbi-Ansicht (unverändert)
// -------------------------------------------------------------
async function getPlayerData(nickname) {
    try {
        const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
        if (!res.ok) { let errorMsg = `HTTP ${res.status}`; try { const errData = await res.json(); errorMsg = errData.error || errorMsg; } catch (parseError) { /* ignore */ } throw new Error(errorMsg); }
        const p = await res.json();
        p.sortElo = toNum(p.elo); p.rating = toNum(p.calculatedRating ?? p.rating); p.dpr = toNum(p.dpr); p.kast = toNum(p.kast); p.kd = toNum(p.kd); p.adr = toNum(p.adr); p.kpr = toNum(p.kpr); p.hsp = toNum(p.hsPercent); p.impact = toNum(p.impact);
        if (p.error) { console.warn(`Data warning for ${nickname}: ${p.error}`); return { nickname, error: p.error, sortElo: -1 }; }
        return p;
    } catch (err) { console.error(`getPlayerData error for ${nickname}:`, err); return { nickname, error: err.message || "Unbekannter Fehler", sortElo: -1 }; }
}
function displayPlayerList(players) { /* ... (unverändert) ... */ }
function updateEloProgressBarForList(containerEl) { /* ... (unverändert) ... */ }
function displayDetailCard(player) { /* ... (unverändert, nutzt updateStatProgressBars) ... */ }
function updateStatProgressBars(card, player) { /* ... (unverändert, Drittel-Stil) ... */ }
async function loadSaverAbiView() { /* ... (unverändert) ... */ }
function handlePlayerListClick(e) { /* ... (unverändert) ... */ }


// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht (ANGEPASST)
// -------------------------------------------------------------
let uniligaDataLoaded = false; // Flag, um mehrfaches Laden zu verhindern
let currentUniligaData = null; // Zum Speichern der geladenen Daten

// Funktion zum Laden und Anzeigen der Uniliga-Daten
async function loadUniligaView() {
    if (uniligaDataLoaded && currentUniligaData) {
        // Wenn Daten schon geladen, nur neu anzeigen (falls nötig, z.B. nach Filterung)
        displayUniligaData(currentUniligaData);
        return;
    }
    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaDataArea) return;

    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    uniligaDataArea.innerHTML = '<p>Lade Uniliga Daten von der API...</p>'; // Ladezustand

    try {
        console.log("Fetching /api/uniliga-stats...");
        const response = await fetch('/api/uniliga-stats');
        console.log("Fetch status:", response.status);

        if (!response.ok) {
            let errorMsg = `API Fehler (${response.status})`;
            try {
                const errData = await response.json();
                errorMsg = errData.error || errData.details || errorMsg;
            } catch (e) { /* ignore parsing error */ }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        console.log("Received Uniliga data:", data);

        if (data.error) {
             throw new Error(data.error);
        }

        if (!data.players || !data.teams) {
            throw new Error("Ungültiges Datenformat von der API empfangen.");
        }

        currentUniligaData = data; // Speichere die geladenen Daten
        displayUniligaData(currentUniligaData); // Zeige die Daten an
        uniligaDataLoaded = true; // Setze Flag

    } catch (err) {
        console.error("Fehler in loadUniligaView:", err);
        errorMessageUniliga.textContent = `Fehler beim Laden der Uniliga-Daten: ${err.message}`;
        errorMessageUniliga.style.display = 'block';
        uniligaDataArea.innerHTML = ''; // Leere den Datenbereich bei Fehler
        uniligaDataLoaded = false; // Erlaube erneuten Ladeversuch
        currentUniligaData = null;
    } finally {
        loadingIndicatorUniliga.style.display = 'none';
    }
}

// Funktion zum Erstellen und Anzeigen der Uniliga-Tabellen
function displayUniligaData(data) {
    if (!uniligaDataArea || !data) return;

    const { players, teams, lastUpdated, championshipId } = data;

    // --- Spieler-Tabelle ---
    let playerTableHTML = `
        <h3>Spieler Ranking (Top 50 nach Rating)</h3>
        <p>Basierend auf Matches in Championship: ${championshipId}</p>
        <div class="table-container">
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Spieler</th>
                        <th>Rating</th>
                        <th>Impact</th>
                        <th>KPR</th>
                        <th>ADR</th>
                        <th>KAST</th>
                        <th>DPR</th>
                        <th>KD</th>
                        <th>HS%</th>
                        <th>Win%</th>
                        <th>Spiele</th>
                    </tr>
                </thead>
                <tbody>
    `;
    // Zeige nur Top 50 Spieler (oder weniger, falls vorhanden)
    players.slice(0, 50).forEach((player, index) => {
        playerTableHTML += `
            <tr>
                <td>${index + 1}</td>
                <td class="player-cell">
                    <img src="${player.avatar || 'default_avatar.png'}" class="table-avatar" alt="Avatar ${player.nickname}" onerror="this.src='default_avatar.png'"/>
                    <span>${player.nickname || 'Unbekannt'}</span>
                </td>
                <td>${safe(player.rating, 2)}</td>
                <td>${safe(player.impact, 2)}</td>
                <td>${safe(player.kpr, 2)}</td>
                <td>${safe(player.adr, 1)}</td>
                <td>${safe(player.kast, 1, '%')}</td>
                <td>${safe(player.dpr, 2)}</td>
                <td>${safe(player.kd, 2)}</td>
                <td>${safe(player.hsp, 1, '%')}</td>
                <td>${safe(player.winRate, 1, '%')}</td>
                <td>${player.matchesPlayed || 'N/A'}</td>
            </tr>
        `;
    });
    playerTableHTML += `
                </tbody>
            </table>
        </div>
    `;

    // --- Team-Tabelle ---
    let teamTableHTML = `
        <h3 style="margin-top: 2rem;">Team Ranking (nach Winrate)</h3>
         <div class="table-container">
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Team</th>
                        <th>Winrate</th>
                        <th>Avg. Rating</th>
                        <th>Spiele</th>
                        <th>Siege</th>
                        <th>Niederl.</th>
                    </tr>
                </thead>
                <tbody>
    `;
    teams.forEach((team, index) => {
        teamTableHTML += `
            <tr>
                <td>${index + 1}</td>
                <td>${team.name || 'Unbekanntes Team'}</td>
                <td class="${getTeamWinrateClass(team.winRate)}">${safe(team.winRate, 1, '%')}</td>
                <td>${safe(team.avgRating, 2)}</td>
                <td>${team.matchesPlayed || 0}</td>
                <td>${team.wins || 0}</td>
                <td>${team.losses || 0}</td>
            </tr>
        `;
    });
    teamTableHTML += `
                </tbody>
            </table>
        </div>
        <p class="last-updated">Datenstand: ${lastUpdated ? new Date(lastUpdated).toLocaleString('de-DE') : 'Unbekannt'}</p>
    `;

    // Füge beide Tabellen in den Container ein
    uniligaDataArea.innerHTML = playerTableHTML + teamTableHTML;
}

// Hilfsfunktion für Team-Winrate-Farbe (optional)
function getTeamWinrateClass(winRate) {
    const cfg = thresholds.winRate;
    if (winRate == null) return '';
    if (winRate >= cfg.good) return 'text-good';
    if (winRate >= cfg.okay) return 'text-okay';
    return 'text-bad';
}


// -------------------------------------------------------------
// Umschaltlogik für Ansichten (unverändert)
// -------------------------------------------------------------
function switchView(viewToShow) {
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
    // Lade Daten für die Ansicht, falls nötig
    if (viewToShow === 'uniliga') {
        loadUniligaView(); // Ruft die Funktion auf, die den API Call macht
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite (unverändert)
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    cacheDOMElements();
    if (toggleButtons) {
        toggleButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const view = event.target.dataset.view;
                if (view) switchView(view);
            });
        });
    }
    switchView('saverabi');
    loadSaverAbiView();
});