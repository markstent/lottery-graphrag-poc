"""Sentence templates for the synthetic document corpus (data only).

One pool per language. Each pool has openers, generic detail sentences,
detail sentences per subject kind and closers. Every sentence ends with a
full stop and contains no full stop followed by a space, so sentence
splitting and chunking stay stable. Placeholders are filled by
``app.datasets.documents`` with entities related to the document subject.
"""

from __future__ import annotations

TEMPLATES: dict[str, dict[str, tuple[str, ...]]] = {
    "en": {
        "open": (
            "This document covers {subject}.",
            "The following notes concern {subject}.",
            "Scope of this document: {subject}.",
        ),
        "generic": (
            "The product team reviewed performance against the agreed quarterly plan.",
            "Customer contacts were monitored through the usual support channels.",
            "Responsible gaming obligations were checked with the compliance lead.",
            "Retail and digital sales were compared week by week across the period.",
            "Open actions are tracked in the shared operations log.",
            "Figures in this document are taken from the central reporting warehouse.",
            "Feedback from retailers was collected during the regular field visits.",
            "The market team in {market} confirmed the timeline with the central team.",
            "Risks were reviewed with the finance and legal stakeholders.",
            "Stakeholders agreed to revisit {subject} at the next monthly review.",
        ),
        "game": (
            "The game belongs to the {family} product family.",
            "The core game mechanic is: {mechanic}.",
            "Sales of {game} developed in line with seasonal expectations.",
            "The game was affected by {incident} during the period.",
            "The campaign {campaign} promoted the game during the period.",
        ),
        "incident": (
            "The incident was classified as {incident_type}.",
            "Affected games included {game}.",
            "The affected game belongs to the {family} product family.",
            "App release {app_version} was in use when the incident started.",
            "The fault was traced to platform version {platform_version}.",
            "Root cause analysis was completed together with the platform team.",
        ),
        "campaign": (
            "The campaign promoted {game} to active and lapsed players.",
            "Creative assets highlighted the {family} product family.",
            "The campaign ran across digital channels and retail outlets.",
            "Campaign spend stayed within the approved budget.",
        ),
        "release": (
            "Release {subject} was rolled out to all supported devices.",
            "The release fixes defects linked to {incident}.",
            "Store listings were updated for the new version.",
            "Crash rates after the release stayed within the agreed threshold.",
        ),
        "experiment": (
            "The experiment targeted the {segment} player segment.",
            "Variant and control groups were drawn from the {segment} segment.",
            "The experiment ran in {market} only.",
            "Results were reviewed by the analytics team before sign-off.",
        ),
        "close": (
            "The next review is scheduled with the market operations team.",
            "Ownership of follow-up items sits with the product owner.",
            "No further action is required for this reporting period.",
        ),
    },
    "el": {
        "open": (
            "Αντικείμενο του παρόντος εγγράφου: {subject}.",
            "Σημειώσεις εργασίας με θέμα: {subject}.",
        ),
        "generic": (
            "Η ομάδα προϊόντος εξέτασε την πορεία σε σχέση με το τριμηνιαίο πλάνο.",
            "Οι επαφές των πελατών παρακολουθήθηκαν μέσω των συνήθων καναλιών εξυπηρέτησης.",
            "Οι υποχρεώσεις υπεύθυνου παιχνιδιού ελέγχθηκαν με τον υπεύθυνο συμμόρφωσης.",
            "Οι πωλήσεις στα πρακτορεία και στα ψηφιακά κανάλια συγκρίθηκαν ανά εβδομάδα.",
            "Οι ανοιχτές ενέργειες καταγράφονται στο κοινό ημερολόγιο λειτουργιών.",
            "Τα στοιχεία του εγγράφου προέρχονται από το κεντρικό σύστημα αναφορών.",
            "Τα σχόλια των πρακτόρων συγκεντρώθηκαν κατά τις τακτικές επισκέψεις πεδίου.",
            "Η ομάδα της αγοράς {market} επιβεβαίωσε το χρονοδιάγραμμα με την κεντρική ομάδα.",
            "Οι κίνδυνοι εξετάστηκαν με το οικονομικό και το νομικό τμήμα.",
            "Το θέμα {subject} θα επανεξεταστεί στην επόμενη μηνιαία σύσκεψη.",
        ),
        "game": (
            "Το παιχνίδι ανήκει στην οικογένεια προϊόντων {family}.",
            "Ο βασικός μηχανισμός του παιχνιδιού είναι: {mechanic}.",
            "Οι πωλήσεις του παιχνιδιού {game} κινήθηκαν σύμφωνα με τις εποχικές προσδοκίες.",
            "Το παιχνίδι επηρεάστηκε από το περιστατικό {incident} μέσα στην περίοδο.",
            "Η καμπάνια {campaign} προώθησε το παιχνίδι μέσα στην περίοδο.",
        ),
        "incident": (
            "Το περιστατικό καταγράφηκε στην κατηγορία {incident_type}.",
            "Μεταξύ των παιχνιδιών που επηρεάστηκαν ήταν το {game}.",
            "Το επηρεασμένο παιχνίδι ανήκει στην οικογένεια προϊόντων {family}.",
            "Κατά την έναρξη του περιστατικού ήταν σε χρήση η έκδοση εφαρμογής {app_version}.",
            "Το πρόβλημα εντοπίστηκε στην έκδοση πλατφόρμας {platform_version}.",
            "Η ανάλυση αιτίων ολοκληρώθηκε από κοινού με την ομάδα πλατφόρμας.",
        ),
        "campaign": (
            "Η καμπάνια προώθησε το παιχνίδι {game} σε ενεργούς και ανενεργούς παίκτες.",
            "Το δημιουργικό υλικό ανέδειξε την οικογένεια προϊόντων {family}.",
            "Η καμπάνια προβλήθηκε σε ψηφιακά κανάλια και στα πρακτορεία.",
            "Ο προϋπολογισμός της καμπάνιας κινήθηκε εντός του εγκεκριμένου ορίου.",
        ),
        "release": (
            "Η έκδοση {subject} διατέθηκε σε όλες τις υποστηριζόμενες συσκευές.",
            "Η έκδοση διορθώνει σφάλματα που συνδέονται με το περιστατικό {incident}.",
            "Οι σελίδες στα καταστήματα εφαρμογών ενημερώθηκαν για τη νέα έκδοση.",
            "Τα ποσοστά σφαλμάτων μετά την κυκλοφορία έμειναν εντός του αποδεκτού ορίου.",
        ),
        "experiment": (
            "Το πείραμα στόχευσε το τμήμα παικτών {segment}.",
            "Οι ομάδες ελέγχου και παραλλαγής προήλθαν από το τμήμα παικτών {segment}.",
            "Τα αποτελέσματα του πειράματος εξετάστηκαν από την ομάδα αναλύσεων.",
        ),
        "close": (
            "Η επόμενη αξιολόγηση προγραμματίζεται με την τοπική ομάδα λειτουργιών.",
            "Την ευθύνη για τις εκκρεμότητες έχει ο υπεύθυνος προϊόντος.",
            "Δεν απαιτείται περαιτέρω ενέργεια για την περίοδο αυτή.",
        ),
    },
    "de": {
        "open": (
            "Gegenstand dieses Dokuments: {subject}.",
            "Arbeitsnotizen zum Thema: {subject}.",
        ),
        "generic": (
            "Das Produktteam hat die Entwicklung gegen den Quartalsplan geprüft.",
            "Kundenkontakte wurden über die üblichen Servicekanäle beobachtet.",
            "Die Pflichten zum verantwortungsvollen Spiel wurden mit der Compliance abgestimmt.",
            "Umsätze in Annahmestellen und digitalen Kanälen wurden wochenweise verglichen.",
            "Offene Maßnahmen werden im gemeinsamen Betriebsprotokoll verfolgt.",
            "Die Zahlen in diesem Dokument stammen aus dem zentralen Berichtswesen.",
            "Rückmeldungen der Annahmestellen wurden bei den regelmäßigen Besuchen gesammelt.",
            "Das Marktteam für {market} hat den Zeitplan mit der Zentrale bestätigt.",
            "Risiken wurden mit der Finanz- und der Rechtsabteilung besprochen.",
            "Das Thema {subject} wird in der nächsten Monatsrunde erneut behandelt.",
        ),
        "game": (
            "Das Spiel gehört zur Produktfamilie {family}.",
            "Die zentrale Spielmechanik lautet: {mechanic}.",
            "Die Umsätze von {game} entsprachen den saisonalen Erwartungen.",
            "Das Spiel war im Zeitraum vom Vorfall {incident} betroffen.",
            "Die Kampagne {campaign} hat das Spiel im Zeitraum beworben.",
        ),
        "incident": (
            "Der Vorfall wurde der Kategorie {incident_type} zugeordnet.",
            "Zu den betroffenen Spielen gehörte {game}.",
            "Das betroffene Spiel gehört zur Produktfamilie {family}.",
            "Bei Beginn des Vorfalls war die App-Version {app_version} im Einsatz.",
            "Die Ursache wurde in der Plattformversion {platform_version} gefunden.",
            "Die Ursachenanalyse wurde gemeinsam mit dem Plattformteam abgeschlossen.",
        ),
        "campaign": (
            "Die Kampagne hat das Spiel {game} bei aktiven und ehemaligen Spielern beworben.",
            "Die Werbemittel stellten die Produktfamilie {family} in den Mittelpunkt.",
            "Die Kampagne lief in digitalen Kanälen und in den Annahmestellen.",
            "Das Budget der Kampagne blieb innerhalb des genehmigten Rahmens.",
        ),
        "release": (
            "Die Version {subject} wurde auf allen unterstützten Geräten ausgerollt.",
            "Die Version behebt Fehler im Zusammenhang mit dem Vorfall {incident}.",
            "Die Einträge in den App-Stores wurden für die neue Version aktualisiert.",
            "Die Absturzrate blieb nach der Veröffentlichung im vereinbarten Rahmen.",
        ),
        "experiment": (
            "Das Experiment richtete sich an das Spielersegment {segment}.",
            "Test- und Kontrollgruppe wurden aus dem Segment {segment} gezogen.",
            "Die Ergebnisse des Experiments wurden vom Analyseteam geprüft.",
        ),
        "close": (
            "Die nächste Überprüfung ist mit dem Marktteam geplant.",
            "Die Verantwortung für offene Punkte liegt bei der Produktverantwortung.",
            "Für diesen Zeitraum sind keine weiteren Maßnahmen erforderlich.",
        ),
    },
    "cs": {
        "open": (
            "Předmět dokumentu: {subject}.",
            "Pracovní poznámky k tématu: {subject}.",
        ),
        "generic": (
            "Produktový tým posoudil vývoj oproti čtvrtletnímu plánu.",
            "Kontakty zákazníků byly sledovány běžnými kanály podpory.",
            "Povinnosti v oblasti odpovědného hraní byly ověřeny s útvarem compliance.",
            "Prodeje na prodejních místech a v digitálních kanálech byly porovnány po týdnech.",
            "Otevřené úkoly jsou evidovány ve společném provozním deníku.",
            "Údaje v tomto dokumentu pocházejí z centrálního reportingu.",
            "Zpětná vazba od prodejců byla sebrána při pravidelných návštěvách v terénu.",
            "Tržní tým pro trh {market} potvrdil harmonogram s centrálou.",
            "Rizika byla projednána s finančním a právním oddělením.",
            "Téma {subject} bude znovu projednáno na příští měsíční poradě.",
        ),
        "game": (
            "Hra patří do produktové rodiny {family}.",
            "Základní herní mechanika zní: {mechanic}.",
            "Prodeje hry {game} odpovídaly sezónním očekáváním.",
            "Hru v daném období zasáhl incident {incident}.",
            "Kampaň {campaign} hru v daném období propagovala.",
        ),
        "incident": (
            "Incident byl zařazen do kategorie {incident_type}.",
            "Mezi zasažené hry patřila hra {game}.",
            "Zasažená hra patří do produktové rodiny {family}.",
            "Na začátku incidentu byla v provozu verze aplikace {app_version}.",
            "Příčina byla nalezena ve verzi platformy {platform_version}.",
            "Analýza příčin byla dokončena společně s týmem platformy.",
        ),
        "campaign": (
            "Kampaň propagovala hru {game} mezi aktivními i bývalými hráči.",
            "Reklamní materiály zdůraznily produktovou rodinu {family}.",
            "Kampaň běžela v digitálních kanálech i na prodejních místech.",
            "Rozpočet kampaně zůstal v rámci schváleného limitu.",
        ),
        "release": (
            "Verze {subject} byla nasazena na všechna podporovaná zařízení.",
            "Verze opravuje chyby související s incidentem {incident}.",
            "Záznamy v obchodech s aplikacemi byly pro novou verzi aktualizovány.",
            "Míra pádů aplikace zůstala po vydání v dohodnutých mezích.",
        ),
        "experiment": (
            "Experiment cílil na hráčský segment {segment}.",
            "Testovací a kontrolní skupina byly vybrány ze segmentu {segment}.",
            "Výsledky experimentu posoudil analytický tým.",
        ),
        "close": (
            "Další revize je naplánována s tržním týmem.",
            "Za otevřené body odpovídá vlastník produktu.",
            "Pro toto období nejsou potřeba žádná další opatření.",
        ),
    },
}

# Subject wording for documents that cover a reporting period, not an entity.
REPORTING_PERIOD: dict[str, str] = {
    "en": "the reporting period",
    "el": "η περίοδος αναφοράς",
    "de": "der Berichtszeitraum",
    "cs": "sledované období",
}

# Market names as written in each document language.
MARKET_NAMES: dict[str, dict[str, str]] = {
    "en": {
        "MKT_UK": "United Kingdom",
        "MKT_GR": "Greece",
        "MKT_AT": "Austria",
        "MKT_CZ": "Czech Republic",
    },
    "el": {
        "MKT_UK": "Ηνωμένο Βασίλειο",
        "MKT_GR": "Ελλάδα",
        "MKT_AT": "Αυστρία",
        "MKT_CZ": "Τσεχία",
    },
    "de": {
        "MKT_UK": "Vereinigtes Königreich",
        "MKT_GR": "Griechenland",
        "MKT_AT": "Österreich",
        "MKT_CZ": "Tschechien",
    },
    "cs": {
        "MKT_UK": "Spojené království",
        "MKT_GR": "Řecko",
        "MKT_AT": "Rakousko",
        "MKT_CZ": "Česko",
    },
}
