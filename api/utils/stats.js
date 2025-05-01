// api/utils/stats.js
// -------------------------------------------------
// Zentrale Utility-Funktionen für Statistik-Berechnungen
// -------------------------------------------------

/**
 * Berechnet einen neuen "Proxy" Impact Score basierend auf KPR, ADR und KAST.
 * Versucht, Spieler zu belohnen, die überdurchschnittlich in Kills und Schaden sind,
 * angepasst durch ihre Rundenkonstanz (KAST).
 *
 * @param {number} kpr_avg - Durchschnittliche Kills pro Runde
 * @param {number} adr_avg - Durchschnittlicher Schaden pro Runde (einfacher Durchschnitt pro Match)
 * @param {number} kast_avg - KAST Rate in Prozent (Durchschnitt pro Match)
 * @returns {number} Der berechnete Impact Score
 */

function calculateAverageStats(matches) {
    const totalMatches = matches.length;
    if (totalMatches === 0) return null;

    // Konstanten
    const DMG_PER_KILL = 105;
    const TRADE_PERCENT = 0.2; // Für KAST-Annäherung
    const KAST_FACTOR = 0.45;  // Für KAST-Annäherung

    // Summen initialisieren
    let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalHeadshots = 0;
    let totalRounds = 0, simpleTotalAdrSum = 0, totalKastPercentSum = 0;
    let totalWins = 0;

    // Daten extrahieren und Summen bilden
    matches.forEach(m => {
        const kills = +m.Kills || 0;
        const deaths = +m.Deaths || 0;
        const rounds = Math.max(1, +m.Rounds || 1);
        const kpr_match = kills / rounds;
        const adr_match = +m.ADR || (kpr_match * DMG_PER_KILL);
        const headshots = +m.Headshots || 0;
        const assists = +m.Assists || 0;
        const win = +m.Win || 0;

        totalKills += kills;
        totalDeaths += deaths;
        totalAssists += assists;
        totalHeadshots += headshots;
        totalRounds += rounds;
        simpleTotalAdrSum += adr_match;
        totalWins += win;

        // KAST % für dieses Match berechnen
        const survived = rounds - deaths;
        const traded = TRADE_PERCENT * rounds;
        const kastRaw = (kills + assists + survived + traded) * KAST_FACTOR;
        const kast_match_percent = rounds > 0 ? Math.min((kastRaw / rounds) * 100, 100) : 0;
        totalKastPercentSum += kast_match_percent;
    });

    // --- Berechne durchschnittliche Statistiken ---
    const kpr_avg = totalRounds > 0 ? totalKills / totalRounds : 0;
    const dpr_avg = totalRounds > 0 ? totalDeaths / totalRounds : 0;
    const apr_avg = totalRounds > 0 ? totalAssists / totalRounds : 0; // Assists pro Runde
    const adr_avg_simple = simpleTotalAdrSum / totalMatches; // ADR (Avg pro Match)
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths; // Gesamt K/D
    const hsp = totalKills === 0 ? 0 : (totalHeadshots / totalKills) * 100; // Gesamt HS%
    const kast_avg = totalKastPercentSum / totalMatches; // KAST % (Avg pro Match)
    const winRate = (totalWins / totalMatches) * 100; // Spieler-Winrate

    // *** ORIGINAL IMPACT BERECHNUNG (HLTV 1.0 Stil) ***
    const impact_original = Math.max(0, 2.13 * kpr_avg + 0.42 * apr_avg - 0.41);

    // *** Rating Berechnung (mit original Impact und leicht erhöhter Basis) ***
    const ratingRaw = Math.max(
        0,
        0.0073 * kast_avg +
        0.3591 * kpr_avg +
        -0.5329 * dpr_avg +
        0.2372 * impact_original + // <<<< Original Impact hier verwendet
        0.0032 * adr_avg_simple +
        0.2287 // Basis V5 (leicht erhöht)
    );
    const rating_final = Math.max(0, ratingRaw);

    // Gib umfassendes Objekt mit berechneten Stats zurück
    return {
        matchesPlayed: totalMatches,
        rating: +rating_final.toFixed(2),
        impact: +impact_original.toFixed(2), // Original Impact
        kpr: +kpr_avg.toFixed(2),
        adr: +adr_avg_simple.toFixed(1),
        kast: +kast_avg.toFixed(1),
        dpr: +dpr_avg.toFixed(2),
        kd: +kd.toFixed(2), // KD wird zurückgegeben
        hsp: +hsp.toFixed(1), // Wichtig für Cache/API-Konsistenz
        winRate: +winRate.toFixed(1),
        apr: +apr_avg.toFixed(2), // APR hinzugefügt (wird für Impact gebraucht)
        // Rohwerte optional hinzufügen
        totalKills, totalDeaths, totalRounds, totalAssists, totalHeadshots, totalWins
    };
}

// Exportiere nur noch calculateAverageStats
export { calculateAverageStats };