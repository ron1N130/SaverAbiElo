// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    // Schwellenwerte bleiben wie zuvor definiert
    rating: { bad: 0.85, okay: 1.05, good: 1.25, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.6, max: 1 }, // DPR wieder relevant
    kast: { bad: 50, okay: 60, good: 70, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.0 }, // KD bleibt für interne Logik, wird aber nicht angezeigt
    adr: { bad: 65, okay: 70, good: 85, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, max: 1.2 },
    impact: { bad: 0.8, okay: 1.0, good: 1.2, max: 1.6 },
    elo: { bad: 1800, okay: 2000, good: 2900, max: 3500 },
};

// Hilfsfunktion zum sicheren Formatieren von Zahlen
function safe(v, digits = 2, suf = "") {
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    return Number.isFinite(num) ? num.toFixed(digits) + suf : "—";
}

// Hilfsfunktion zum Konvertieren in Zahl oder null
function toNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}


// -------------------------------------------------------------
// DOM-Elemente Cachen
// -------------------------------------------------------------
let playerListContainerEl, detailCardContainer, mainContentArea,
    loadingIndicatorSaverAbi, errorMessageSaverAbi,
    loadingIndicatorUniliga, errorMessageUniliga,
    saverAbiContent, uniligaContent,
    toggleButtons, allPlayersData = [];

// Funktion zum Initialisieren der DOM-Elemente
function cacheDOMElements() {
    playerListContainerEl = document.getElementById("player-list");
    detailCardContainer = document.getElementById("player-detail-card-container");
    mainContentArea = document.getElementById("main-content-area");
    loadingIndicatorSaverAbi = document.getElementById("loading-indicator-saverabi");
    errorMessageSaverAbi = document.getElementById("error-message-saverabi");
    saverAbiContent = document.getElementById("saverabi-content");
    loadingIndicatorUniliga = document.getElementById("loading-indicator-uniliga");
    errorMessageUniliga = document.getElementById("error-message-uniliga");
    uniligaContent = document.getElementById("uniliga-content");
    toggleButtons = document.querySelectorAll(".toggle-button");
}

// -------------------------------------------------------------
// Funktionen für die SaverAbi-Ansicht
// -------------------------------------------------------------

// Funktion zum Abrufen der Spielerdaten (unverändert zur letzten Version)
async function getPlayerData(nickname) {
    try {
        const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                errorMsg = errData.error || errorMsg;
            } catch (parseError) { /* ignore */ }
            throw new Error(errorMsg);
        }
        const p = await res.json();
        p.sortElo = toNum(p.elo);
        p.rating = toNum(p.calculatedRating ?? p.rating);
        p.dpr = toNum(p.dpr); // DPR wird wieder benötigt
        p.kast = toNum(p.kast);
        p.kd = toNum(p.kd);
        p.adr = toNum(p.adr);
        p.kpr = toNum(p.kpr);
        p.hsp = toNum(p.hsPercent); // hsPercent aus API wird zu hsp (auch wenn nicht angezeigt)
        p.impact = toNum(p.impact);

        if (p.error) {
            console.warn(`Data fetching warning for ${nickname}: ${p.error}`);
            return { nickname, error: p.error, sortElo: -1 };
        }
        return p;
    } catch (err) {
        console.error(`getPlayerData error for ${nickname}:`, err);
        return { nickname, error: err.message || "Unbekannter Fehler", sortElo: -1 };
    }
}


// Funktion zum Anzeigen der Spielerliste (unverändert)
function displayPlayerList(players) {
    if (!playerListContainerEl) return;
    playerListContainerEl.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        li.dataset.nickname = player.nickname;
        if (player.error) {
            li.classList.add('error-item');
            li.innerHTML = `
                <span class='player-info'>
                    <img src='default_avatar.png' class='avatar' alt="Standard Avatar"/>
                    <span class='player-name'>${player.nickname}</span>
                </span>
                <div class='player-list-right error-text'>
                   Fehler: ${player.error.substring(0, 30)}${player.error.length > 30 ? '...' : ''}
                </div>`;
        } else {
            li.innerHTML = `
                <span class='player-info'>
                  <img src='${player.avatar || 'default_avatar.png'}' class='avatar' alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" />
                  <span class='player-name'>${player.nickname}</span>
                </span>
                <div class='player-list-right'>
                  <span class='player-elo'>${player.sortElo ?? 'N/A'}</span>
                  <div class='elo-progress-container' data-elo='${player.sortElo || 0}'>
                    <div class='elo-progress-bar'></div>
                  </div>
                </div>`;
            updateEloProgressBarForList(li.querySelector('.elo-progress-container'));
        }
        playerListContainerEl.appendChild(li);
    });
}

// Funktion zum Färben der kleinen Elo-Bar in der Liste (unverändert)
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

// *** NEU: Angepasste Funktion zum Anzeigen der Detailkarte ***
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
        return;
    }

    const faceitUrl = player.faceitUrl || `https://faceit.com/en/players/${encodeURIComponent(player.nickname)}`;
    const matchesText = player.matchesConsidered ? `Letzte ${player.matchesConsidered} Matches` : 'Aktuelle Stats';
    const lastUpdatedText = player.lastUpdated ? ` | Stand: ${new Date(player.lastUpdated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr` : '';

    // HTML Struktur angepasst an das neue Layout (Rating, DPR, KAST | Impact, ADR, KPR)
    detailCardContainer.innerHTML = `
        <div class="player-card-hltv new-layout"> <div class="card-header">
            <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer">
              <img src="${player.avatar}" class="avatar" alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" />
            </a>
            <div>
              <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer" class="player-name">${player.nickname}</a>
            </div>
            </div>
          <div class="stats-grid">
             <div class="stat-item" data-stat="rating">
               <div class="label">RATING 2.0</div> <div class="value">${safe(player.rating, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div><div class="stat-progress-indicator"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="dpr"> <div class="label">DPR</div>
               <div class="value">${safe(player.dpr, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div><div class="stat-progress-indicator"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="kast">
               <div class="label">KAST</div> <div class="value">${safe(player.kast, 1, '%')}</div> <div class="stat-progress-container"><div class="stat-progress-bar"></div><div class="stat-progress-indicator"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="impact">
               <div class="label">IMPACT</div> <div class="value">${safe(player.impact, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div><div class="stat-progress-indicator"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="adr">
               <div class="label">ADR</div>
               <div class="value">${safe(player.adr, 1)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div><div class="stat-progress-indicator"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
              <div class="stat-item" data-stat="kpr">
               <div class="label">KPR</div>
               <div class="value">${safe(player.kpr, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div><div class="stat-progress-indicator"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
            </div>
         </div>`;
    // Update der Fortschrittsbalken für die angezeigten Stats
    updateStatProgressBars(detailCardContainer, player);
}

// *** NEU: Angepasste Funktion zum Updaten der Fortschrittsbalken ***
function updateStatProgressBars(card, player) {
    card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
        const stat = item.dataset.stat;
        const val = player[stat]; // Wert direkt holen
        const cfg = thresholds[stat];
        const bar = item.querySelector('.stat-progress-bar');
        const indicator = item.querySelector('.stat-progress-indicator'); // Neuer Indikator-Strich
        const lbl = item.querySelector('.stat-indicator-label');

        if (!cfg || !bar || !lbl || !indicator) {
             // console.warn(`Missing elements for stat: ${stat}`);
             if(lbl) lbl.textContent = '---'; // Label leeren wenn Elemente fehlen
             return;
        }

        let category = 0; // 0 = BAD
        let text = 'BAD';
        let color = 'var(--bar-bad)';
        let barWidthPercent = 0; // Breite der farbigen Bar

        if (val != null && !isNaN(val)) {
            // Berechne Position relativ zum Maximum (oder einem sinnvollen oberen Grenzwert)
            const maxValue = cfg.max || 1.5 * cfg.good; // Fallback falls max fehlt
            barWidthPercent = Math.min(100, (val / maxValue) * 100);

             // Kategorie bestimmen (für Label und Indikator-Position)
            if (stat === 'dpr') { // Niedriger ist besser
                if (val <= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; }
                else if (val <= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; }
                else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; } // Default BAD
            } else { // Höher ist besser
                if (val >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; }
                else if (val >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; }
                 else { category = 0; text = 'BAD'; color = 'var(--bar-bad)'; } // Default BAD
            }
        } else {
            text = '---'; // Kein Wert vorhanden
            category = -1; // Keine Kategorie
            color = 'var(--bar-bg)'; // Graue Bar
            barWidthPercent = 0;
        }

        // Style für die farbige Bar (Breite basiert auf Wert)
        bar.style.width = `${barWidthPercent}%`;
        bar.style.backgroundColor = color;
        bar.style.boxShadow = (category !== -1) ? `0 0 6px ${color}` : 'none'; // Glow nur bei gültigem Wert

        // Style für den Indikator-Strich (Position basiert auf Kategorie)
        if (category === 1) { // OKAY
             indicator.style.left = '50%'; // Mittig
             indicator.style.backgroundColor = 'var(--bar-okay)';
             indicator.style.display = 'block';
        } else if (category === 2 && stat === 'dpr') { // GOOD bei DPR (links)
             indicator.style.left = '16.66%'; // Mitte des linken Drittels
             indicator.style.backgroundColor = 'var(--bar-good)';
             indicator.style.display = 'block';
        } else if (category === 2) { // GOOD bei anderen Stats (rechts)
             indicator.style.left = '83.33%'; // Mitte des rechten Drittels
             indicator.style.backgroundColor = 'var(--bar-good)';
             indicator.style.display = 'block';
        } else if (category === 0 && stat === 'dpr') { // BAD bei DPR (rechts)
             indicator.style.left = '83.33%'; // Mitte des rechten Drittels
             indicator.style.backgroundColor = 'var(--bar-bad)';
             indicator.style.display = 'block';
        } else if (category === 0) { // BAD bei anderen Stats (links)
             indicator.style.left = '16.66%'; // Mitte des linken Drittels
             indicator.style.backgroundColor = 'var(--bar-bad)';
             indicator.style.display = 'block';
        }
        else { // Kein Wert oder undefinierte Kategorie
            indicator.style.display = 'none';
        }

        // Label Text setzen
        lbl.textContent = text;
        lbl.style.color = color; // Färbe auch das Label
    });
}


// Funktion zum Laden der SaverAbi-Ansicht (unverändert)
async function loadSaverAbiView() {
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl) return;
    loadingIndicatorSaverAbi.style.display = 'block';
    errorMessageSaverAbi.style.display = 'none';
    playerListContainerEl.innerHTML = '';
    detailCardContainer.style.display = 'none';
    mainContentArea.classList.remove('detail-visible');
    try {
        const namesRes = await fetch('/players.json');
        if (!namesRes.ok) throw new Error(`Fehler beim Laden der Spielerliste (${namesRes.status})`);
        const names = await namesRes.json();
        const settled = await Promise.allSettled(names.map(getPlayerData));
        allPlayersData = settled.map(r => {
            if (r.status === 'fulfilled') {
                return r.value;
            } else {
                console.error("Ein Spieler konnte nicht geladen werden:", r.reason);
                return null;
            }
        }).filter(p => p !== null);
        allPlayersData.sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1));
        displayPlayerList(allPlayersData);
        playerListContainerEl.removeEventListener('click', handlePlayerListClick);
        playerListContainerEl.addEventListener('click', handlePlayerListClick);
    } catch (err) {
        console.error("Fehler in loadSaverAbiView:", err);
        errorMessageSaverAbi.textContent = `Fehler beim Laden der SaverAbi-Daten: ${err.message}`;
        errorMessageSaverAbi.style.display = 'block';
    } finally {
        loadingIndicatorSaverAbi.style.display = 'none';
    }
}

// Event-Handler für Klicks auf die Spielerliste (unverändert)
function handlePlayerListClick(e) {
    const li = e.target.closest('li');
    if (!li || !li.dataset.nickname) return;
    const nickname = li.dataset.nickname;
    const playerData = allPlayersData.find(p => p.nickname === nickname);
    if (playerData) {
        displayDetailCard(playerData);
    }
}


// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht (unverändert)
// -------------------------------------------------------------
let uniligaDataLoaded = false;
async function loadUniligaView() {
    if (uniligaDataLoaded) return;
    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaContent) return;
    const dataArea = document.getElementById('uniliga-data-area');
    if (!dataArea) return;
    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    dataArea.innerHTML = '<p>Lade Uniliga Daten...</p>';
    try {
        // --- API Call Platzhalter ---
        await new Promise(resolve => setTimeout(resolve, 1000));
         dataArea.innerHTML = `
             <p>Uniliga Statistiken sind hier bald verfügbar.</p>
             <p>Die Daten werden vom Faceit Turnier mit der ID <code>c1fcd6a9-34ef-4e18-8e92-b57af0667a40</code> abgerufen.</p>
             <p><i>(Implementierung des API-Calls und der Datenanzeige steht noch aus.)</i></p>
         `;
        uniligaDataLoaded = true;
    } catch (err) {
        console.error("Fehler in loadUniligaView:", err);
        errorMessageUniliga.textContent = `Fehler beim Laden der Uniliga-Daten: ${err.message}`;
        errorMessageUniliga.style.display = 'block';
        dataArea.innerHTML = '';
    } finally {
        loadingIndicatorUniliga.style.display = 'none';
    }
}


// -------------------------------------------------------------
// Umschaltlogik für Ansichten (unverändert)
// -------------------------------------------------------------
function switchView(viewToShow) {
    document.querySelectorAll('.view-content').forEach(content => {
        content.classList.remove('active');
    });
    toggleButtons.forEach(button => {
        button.classList.remove('active');
    });
    const contentToShow = document.getElementById(`${viewToShow}-content`);
    if (contentToShow) {
        contentToShow.classList.add('active');
    }
    const buttonToActivate = document.querySelector(`.toggle-button[data-view="${viewToShow}"]`);
    if (buttonToActivate) {
        buttonToActivate.classList.add('active');
    }
    if (viewToShow === 'uniliga' && detailCardContainer) {
         detailCardContainer.style.display = 'none';
         mainContentArea.classList.remove('detail-visible');
    }
    if (viewToShow === 'uniliga') {
        loadUniligaView();
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite (unverändert)
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    cacheDOMElements();
    toggleButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const view = event.target.dataset.view;
            if (view) {
                switchView(view);
            }
        });
    });
    switchView('saverabi');
    loadSaverAbiView();
});