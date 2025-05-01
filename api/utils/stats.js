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
function calculateNewImpact(kpr_avg, adr_avg, kast_avg) {
    // Baselines für die Normalisierung (ggf. anpassen)
    const baseline_kpr = 0.70;
    const baseline_adr = 75.0;
    const baseline_kast = 68.0;

    // Normalisierte Werte berechnen (Division durch Null verhindern)
    const norm_kpr = baseline_kpr !== 0 ? kpr_avg / baseline_kpr : kpr_avg;
    const norm_adr = baseline_adr !== 0 ? adr_avg / baseline_adr : adr_avg;

    // Konsistenz-Modifikator basierend auf KAST berechnen und begrenzen
    const consistency_modifier = 1.0 + (kast_avg - baseline_kast) * 0.01;
    const clamped_modifier = Math.max(0.7, Math.min(1.3, consistency_modifier));

    // Kern-Impact berechnen (gewichteter Durchschnitt von KPR und ADR)
    const core_impact = (norm_kpr * 0.6) + (norm_adr * 0.4);

    // Finalen Impact mit Konsistenz-Modifikator berechnen und auf >= 0 begrenzen
    const final_impact = core_impact * clamped_modifier;
    return Math.max(0, final_impact);
}

/**
 * Berechnet umfassende Durchschnittsstatistiken für einen Spieler aus einer Liste seiner Matches.
 * Verwendet Rating-Formel V5 (leicht erhöhte Basis).
 * Berechnet ADR und KAST als einfachen Durchschnitt pro Match.
 *
 * @param {Array<object>} matches - Array von Match-Objekten. Jedes Objekt sollte mind.
 * Kills, Deaths, Assists, Headshots, Rounds, ADR, Win enthalten.
 * @returns {object|null} - Objekt mit berechneten Statistiken oder null bei keinen Matches.
 */
function calculateAverageStats(matches) {
    const totalMatches = matches.length;
    if (totalMatches === 0) return null; // Kein Ergebnis, wenn keine Matches

    // Konstanten für Berechnungen
    const DMG_PER_KILL = 105;
    const TRADE_PERCENT = 0.2;
    const KAST_FACTOR = 0.45;

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
        // ADR für dieses Match (aus Daten oder Fallback)
        const adr_match = +m.ADR || (kpr_match * DMG_PER_KILL);
        const headshots = +m.Headshots || 0;
        const assists = +m.Assists || 0;
        const win = +m.Win || 0; // Sieg-Info für Spieler-Winrate

        totalKills += kills;
        totalDeaths += deaths;
        totalAssists += assists;
        totalHeadshots += headshots;
        totalRounds += rounds;
        simpleTotalAdrSum += adr_match; // Addiere Match-ADR
        totalWins += win;

        // KAST % für dieses Match berechnen
        const survived = rounds - deaths;
        const traded = TRADE_PERCENT * rounds;
        const kastRaw = (kills + assists + survived + traded) * KAST_FACTOR;
        const kast_match_percent = rounds > 0 ? Math.min((kastRaw / rounds) * 100, 100) : 0;
        totalKastPercentSum += kast_match_percent;
    });

    // --- Berechne durchschnittliche Statistiken ---
    // Durchschnitt pro Runde
    const kpr_avg = totalRounds > 0 ? totalKills / totalRounds : 0;
    const dpr_avg = totalRounds > 0 ? totalDeaths / totalRounds : 0;
    const apr_avg = totalRounds > 0 ? totalAssists / totalRounds : 0;

    // ADR als einfacher Durchschnitt pro Match
    const adr_avg_simple = simpleTotalAdrSum / totalMatches;

    // Gesamt oder Durchschnitt pro Match
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths; // Gesamt K/D
    const hsp = totalKills === 0 ? 0 : (totalHeadshots / totalKills) * 100; // Gesamt HS%
    const kast_avg = totalKastPercentSum / totalMatches; // KAST % (Avg pro Match)
    const winRate = (totalWins / totalMatches) * 100; // Spieler-Winrate

    // Impact berechnen (verwendet einfachen ADR-Avg)
    const impact_new = calculateNewImpact(kpr_avg, adr_avg_simple, kast_avg);

    // Rating berechnen (V5 Basis)
    const ratingRaw = Math.max(
        0,
        0.0073 * kast_avg +       // KAST Avg (pro Match)
        0.3591 * kpr_avg +      // KPR Avg (pro Runde)
        -0.5329 * dpr_avg +       // DPR Avg (pro Runde)
        0.2372 * impact_new +     // NEUER Impact Wert
        0.0032 * adr_avg_simple + // Einfacher ADR Avg Wert
        0.2287                    // Basis V5
    );
    const rating_final = Math.max(0, ratingRaw);

    // Gib umfassendes Objekt mit berechneten Stats zurück
    return {
        matchesPlayed: totalMatches,
        rating: +rating_final.toFixed(2),
        impact: +impact_new.toFixed(2),
        kpr: +kpr_avg.toFixed(2),
        adr: +adr_avg_simple.toFixed(1),
        kast: +kast_avg.toFixed(1),
        dpr: +dpr_avg.toFixed(2),
        kd: +kd.toFixed(2),
        hsp: +hsp.toFixed(1),
        winRate: +winRate.toFixed(1),
        // Rohwerte optional hinzufügen
        totalKills,
        totalDeaths,
        totalRounds,
        totalAssists,
        totalHeadshots,
        totalWins
    };
}

// Exportiere die Funktionen für die Verwendung in anderen Modulen
export { calculateNewImpact, calculateAverageStats };