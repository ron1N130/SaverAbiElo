// script.js - Überarbeitet für View-Toggle
// -------------------------------------------------------------
// Globale Variablen und Hilfsfunktionen
// -------------------------------------------------------------
const thresholds = {
    rating: { bad: 0.85, okay: 1.05, good: 1.25, max: 1.8 },
    dpr: { bad: 0.75, okay: 0.7, good: 0.6, max: 1 },
    kast: { bad: 50, okay: 60, good: 70, max: 100 },
    kd: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.0 },
    adr: { bad: 65, okay: 70, good: 85, max: 120 },
    kpr: { bad: 0.5, okay: 0.6, good: 0.8, max: 1.2 },
    impact: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.5 }, // Schwellen für Impact (aus vorherigen Schritten)
    elo: { bad: 1800, okay: 2000, good: 2900, max: 3500 }
};

// Hilfsfunktion zum sicheren Formatieren von Zahlen
function safe(v, digits = 2, suf = "") {
    // Prüft ob v null oder undefined ist
    if (v === null || typeof v === 'undefined') return "—";
    const num = parseFloat(v);
    // Prüft ob num eine gültige Zahl ist
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
    toggleButtons, allPlayersData = []; // Globale Variable für SaverAbi-Daten

// Funktion zum Initialisieren der DOM-Elemente
function cacheDOMElements() {
    // SaverAbi View Elemente
    playerListContainerEl = document.getElementById("player-list");
    detailCardContainer = document.getElementById("player-detail-card-container");
    mainContentArea = document.getElementById("main-content-area"); // Container für Liste & Karte
    loadingIndicatorSaverAbi = document.getElementById("loading-indicator-saverabi");
    errorMessageSaverAbi = document.getElementById("error-message-saverabi");
    saverAbiContent = document.getElementById("saverabi-content");

    // Uniliga View Elemente
    loadingIndicatorUniliga = document.getElementById("loading-indicator-uniliga");
    errorMessageUniliga = document.getElementById("error-message-uniliga");
    uniligaContent = document.getElementById("uniliga-content");

    // Toggle Buttons
    toggleButtons = document.querySelectorAll(".toggle-button");
}

// -------------------------------------------------------------
// Funktionen für die SaverAbi-Ansicht
// -------------------------------------------------------------

// Funktion zum Abrufen der Spielerdaten (wie bisher)
async function getPlayerData(nickname) {
    try {
        const res = await fetch(`/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);
        if (!res.ok) {
            // Versuche, Fehlerdetails aus der Antwort zu lesen
            let errorMsg = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                errorMsg = errData.error || errorMsg; // Nutze Fehlermeldung aus API, falls vorhanden
            } catch (parseError) { /* Ignoriere Parse-Fehler, nutze HTTP-Status */ }
            throw new Error(errorMsg);
        }
        const p = await res.json();
        // Verarbeite die empfangenen Daten
        p.sortElo = toNum(p.elo);
        // Nutze calculatedRating als Fallback für rating, falls rating null ist
        p.rating = toNum(p.calculatedRating ?? p.rating); // Verwende calculatedRating, wenn rating fehlt
        p.dpr = toNum(p.dpr);
        p.kast = toNum(p.kast);
        p.kd = toNum(p.kd);
        p.adr = toNum(p.adr);
        p.kpr = toNum(p.kpr);
        // Stelle sicher, dass hsPercent vorhanden ist (Name aus API/Cache)
        p.hsp = toNum(p.hsPercent); // hsPercent aus API wird zu hsp
        p.impact = toNum(p.impact);

        // Überprüfe, ob ein Fehler in den Daten zurückgegeben wurde (z.B. Spieler nicht gefunden)
        if (p.error) {
            console.warn(`Data fetching warning for ${nickname}: ${p.error}`);
            // Behandle dies als Fehler für die Anzeige
            return { nickname, error: p.error, sortElo: -1 };
        }

        return p;
    } catch (err) {
        console.error(`getPlayerData error for ${nickname}:`, err);
        // Gib ein Fehlerobjekt zurück
        return { nickname, error: err.message || "Unbekannter Fehler", sortElo: -1 };
    }
}


// Funktion zum Anzeigen der Spielerliste (wie bisher, kleine Anpassungen)
function displayPlayerList(players) {
    if (!playerListContainerEl) return; // Sicherstellen, dass Element existiert
    playerListContainerEl.innerHTML = ''; // Leere die Liste
    players.forEach(player => {
        const li = document.createElement('li');
        li.dataset.nickname = player.nickname; // Wichtig für Klick-Event

        if (player.error) {
            li.classList.add('error-item');
            // Zeige Fehler direkt in der Liste an
            li.innerHTML = `
                <span class='player-info'>
                    <img src='default_avatar.png' class='avatar' />
                    <span class='player-name'>${player.nickname}</span>
                </span>
                <div class='player-list-right error-text'>
                   Fehler: ${player.error.substring(0, 30)}${player.error.length > 30 ? '...' : ''}
                </div>`;
        } else {
            // Normaler Listeneintrag
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
            // Update Elo-Bar für diesen Spieler
            updateEloProgressBarForList(li.querySelector('.elo-progress-container'));
        }
        playerListContainerEl.appendChild(li);
    });
}

// Funktion zum Färben der kleinen Elo-Bar in der Liste (wie bisher)
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

// Funktion zum Anzeigen der Detailkarte (wie bisher, nutzt safe() und hsp)
function displayDetailCard(player) {
    if (!detailCardContainer || !mainContentArea) return;

    // Detailkarte nur anzeigen, wenn SaverAbi-Ansicht aktiv ist
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

    detailCardContainer.innerHTML = `
        <div class="player-card-hltv">
          <div class="card-header">
            <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer">
              <img src="${player.avatar}" class="avatar" alt="Avatar von ${player.nickname}" onerror="this.src='default_avatar.png'" />
            </a>
            <div>
              <a href="${faceitUrl}" target="_blank" rel="noopener noreferrer" class="player-name">${player.nickname}</a>
              <div class="stats-label">${matchesText}${lastUpdatedText}</div>
            </div>
          </div>
          <div class="stats-grid">
             <div class="stat-item" data-stat="rating">
               <div class="label">Rating 2.0</div>
               <div class="value">${safe(player.rating, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="impact"> <div class="label">Impact</div>
               <div class="value">${safe(player.impact, 2)}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
             <div class="stat-item" data-stat="kast">
               <div class="label">KAST %</div>
               <div class="value">${safe(player.kast, 1, '%')}</div>
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
             <div class="stat-item" data-stat="hsp"> <div class="label">HS %</div>
               <div class="value">${safe(player.hsp, 1, '%')}</div>
               <div class="stat-progress-container"><div class="stat-progress-bar"></div></div>
               <span class="stat-indicator-label"></span>
             </div>
            </div>
         </div>`;
    // Update der Fortschrittsbalken für die angezeigten Stats
    updateStatProgressBars(detailCardContainer, player);
}

// Funktion zum Updaten der Fortschrittsbalken in der Detailkarte (wie bisher)
function updateStatProgressBars(card, player) {
    card.querySelectorAll('.stat-item[data-stat]').forEach(item => {
        const stat = item.dataset.stat;
        // Behandle Elo separat, falls es hinzugefügt wird
        const val = stat === 'elo' ? player.sortElo : player[stat];
        const cfg = thresholds[stat];
        const bar = item.querySelector('.stat-progress-bar');
        const lbl = item.querySelector('.stat-indicator-label');

        if (!cfg || !bar || !lbl) {
            // console.warn(`Missing config, bar or label for stat: ${stat}`);
            return; // Überspringe, wenn Konfig oder Elemente fehlen
        }

        let category = 0; // 0 = BAD
        let text = 'BAD';
        let color = 'var(--bar-bad)';

        if (val != null && !isNaN(val)) {
            // Spezielle Behandlung für DPR (niedriger ist besser)
            if (stat === 'dpr') {
                if (val <= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; }
                else if (val <= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; }
            }
            // Standardbehandlung (höher ist besser)
            else {
                if (val >= cfg.good) { category = 2; text = 'GOOD'; color = 'var(--bar-good)'; }
                else if (val >= cfg.okay) { category = 1; text = 'OKAY'; color = 'var(--bar-okay)'; }
            }
        } else {
            text = '---'; // Kein Wert vorhanden
            category = 0; // Standard auf "Bad" setzen oder neutral?
            color = 'var(--bar-bg)'; // Graue Bar ohne Wert
        }

        const third = 100 / 3;
        bar.style.left = `${third * category}%`;
        bar.style.width = `${third}%`;
        bar.style.backgroundColor = color;
        // Nur Glow hinzufügen, wenn ein gültiger Wert vorhanden ist
        bar.style.boxShadow = (val != null && !isNaN(val)) ? `0 0 8px ${color}` : 'none';

        lbl.textContent = text;
    });
}

// Funktion zum Laden der SaverAbi-Ansicht
async function loadSaverAbiView() {
    if (!loadingIndicatorSaverAbi || !errorMessageSaverAbi || !playerListContainerEl) return;

    loadingIndicatorSaverAbi.style.display = 'block';
    errorMessageSaverAbi.style.display = 'none';
    playerListContainerEl.innerHTML = ''; // Liste leeren
    detailCardContainer.style.display = 'none'; // Detailkarte ausblenden
    mainContentArea.classList.remove('detail-visible');

    try {
        // Lade Spielernamen aus players.json
        const namesRes = await fetch('/players.json');
        if (!namesRes.ok) throw new Error(`Fehler beim Laden der Spielerliste (${namesRes.status})`);
        const names = await namesRes.json();

        // Hole Daten für alle Spieler parallel
        const settled = await Promise.allSettled(names.map(getPlayerData));

        // Verarbeite Ergebnisse
        allPlayersData = settled.map(r => {
            if (r.status === 'fulfilled') {
                return r.value;
            } else {
                // Versuche, den Nickname aus dem Grund des Fehlers zu extrahieren (nicht zuverlässig)
                // Besser: Wir wissen nicht, welcher Nickname fehlgeschlagen ist, wenn Promise.allSettled verwendet wird
                // Wir geben einfach ein generisches Fehlerobjekt zurück oder loggen den Fehler
                console.error("Ein Spieler konnte nicht geladen werden:", r.reason);
                // Hier könnten wir versuchen, den Nickname zu erraten, aber das ist unsicher.
                // Stattdessen filtern wir fehlerhafte Einträge später oder zeigen sie als Fehler an.
                // Fürs Erste geben wir null zurück, um sie später zu filtern
                return null; // Markiere als fehlerhaft
            }
        }).filter(p => p !== null); // Entferne null-Einträge (fehlerhafte Promises)

        // Sortiere Spieler nach Elo (höchste zuerst)
        allPlayersData.sort((a, b) => (b.sortElo ?? -1) - (a.sortElo ?? -1));

        // Zeige die Spielerliste an
        displayPlayerList(allPlayersData);

        // Füge Klick-Listener zur Liste hinzu (nur einmal nach dem Laden)
        // Entferne alte Listener, falls vorhanden, um Duplikate zu vermeiden
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

// Event-Handler für Klicks auf die Spielerliste
function handlePlayerListClick(e) {
    const li = e.target.closest('li');
    if (!li || !li.dataset.nickname) return; // Kein gültiges Listenelement geklickt
    const nickname = li.dataset.nickname;
    const playerData = allPlayersData.find(p => p.nickname === nickname);
    if (playerData) {
        displayDetailCard(playerData); // Zeige Detailkarte für den geklickten Spieler
    }
}


// -------------------------------------------------------------
// Funktionen für die Uniliga-Ansicht
// -------------------------------------------------------------
let uniligaDataLoaded = false; // Flag, um zu verhindern, dass Daten mehrmals geladen werden

// Funktion zum Laden der Uniliga-Daten (Platzhalter)
async function loadUniligaView() {
    if (uniligaDataLoaded) return; // Nicht erneut laden, wenn schon geladen

    if (!loadingIndicatorUniliga || !errorMessageUniliga || !uniligaContent) return;
    const dataArea = document.getElementById('uniliga-data-area');
    if (!dataArea) return;

    loadingIndicatorUniliga.style.display = 'block';
    errorMessageUniliga.style.display = 'none';
    dataArea.innerHTML = '<p>Lade Uniliga Daten...</p>'; // Zeige Ladezustand an

    try {
        // --- HIER KOMMT DER API CALL ---
        // const response = await fetch('/api/uniliga-stats'); // Ziel-API-Endpunkt
        // if (!response.ok) {
        //     throw new Error(`Fehler beim Abrufen der Uniliga-Daten (${response.status})`);
        // }
        // const data = await response.json();

        // --- HIER DATEN VERARBEITEN UND ANZEIGEN ---
        // z.B. Tabellen für Spieler und Teams erstellen
        // dataArea.innerHTML = `
        //     <h3>Spieler Stats</h3>
        //     <table id="uniliga-player-table">...</table>
        //     <h3>Team Stats</h3>
        //     <table id="uniliga-team-table">...</table>
        // `;
        // // Tabellen befüllen...

        // --- VORERST NUR PLATZHALTER ---
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simuliere Laden
         dataArea.innerHTML = `
             <p>Uniliga Statistiken sind hier bald verfügbar.</p>
             <p>Die Daten werden vom Faceit Turnier mit der ID <code>c1fcd6a9-34ef-4e18-8e92-b57af0667a40</code> abgerufen.</p>
             <p><i>(Implementierung des API-Calls und der Datenanzeige steht noch aus.)</i></p>
         `;

        uniligaDataLoaded = true; // Setze Flag nach erfolgreichem Laden

    } catch (err) {
        console.error("Fehler in loadUniligaView:", err);
        errorMessageUniliga.textContent = `Fehler beim Laden der Uniliga-Daten: ${err.message}`;
        errorMessageUniliga.style.display = 'block';
        dataArea.innerHTML = ''; // Leere den Datenbereich bei Fehler
    } finally {
        loadingIndicatorUniliga.style.display = 'none';
    }
}


// -------------------------------------------------------------
// Umschaltlogik für Ansichten
// -------------------------------------------------------------
function switchView(viewToShow) {
    // Alle Content-Bereiche ausblenden
    document.querySelectorAll('.view-content').forEach(content => {
        content.classList.remove('active');
    });
    // Alle Buttons deaktivieren
    toggleButtons.forEach(button => {
        button.classList.remove('active');
    });

    // Gewünschten Content-Bereich anzeigen
    const contentToShow = document.getElementById(`${viewToShow}-content`);
    if (contentToShow) {
        contentToShow.classList.add('active');
    }

    // Passenden Button aktivieren
    const buttonToActivate = document.querySelector(`.toggle-button[data-view="${viewToShow}"]`);
    if (buttonToActivate) {
        buttonToActivate.classList.add('active');
    }

    // Detailkarte ausblenden, wenn Uniliga-Ansicht aktiv ist
    if (viewToShow === 'uniliga' && detailCardContainer) {
         detailCardContainer.style.display = 'none';
         mainContentArea.classList.remove('detail-visible');
    }

    // Lade Daten für die Ansicht, falls noch nicht geschehen
    if (viewToShow === 'saverabi') {
        // SaverAbi-Daten werden initial geladen, hier evtl. nur bei Bedarf neu laden?
        // Fürs Erste: Keine Aktion hier, da initial geladen.
    } else if (viewToShow === 'uniliga') {
        loadUniligaView(); // Lade Uniliga-Daten (nur wenn nötig, prüft intern Flag)
    }
}

// -------------------------------------------------------------
// Initialisierung beim Laden der Seite
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    cacheDOMElements(); // DOM Elemente einmalig holen

    // Event Listener für Toggle Buttons hinzufügen
    toggleButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const view = event.target.dataset.view;
            if (view) {
                switchView(view);
            }
        });
    });

    // Initial die SaverAbi-Ansicht laden und anzeigen
    switchView('saverabi'); // Setzt SaverAbi als aktiv
    loadSaverAbiView();     // Lädt die Daten dafür
});