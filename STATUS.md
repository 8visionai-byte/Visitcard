# STATUS — Aplikacja do skanowania wizytówek

Cel: zdjęcie wizytówki → automatyczny odczyt danych → zapis (CSV) → 1 klik = kontakt w telefonie (vCard).

## Etapy

| # | Etap | Stan |
|---|------|------|
| 1 | Brainstorm architektury (4 propozycje + 3 sędziów, Workflow) | DONE (7 agentów, 0 błędów; werdykty w BRAINSTORM-WYNIKI.md) |
| 2 | Decyzja: wybór stacku | DONE — hybryda: statyczna PWA + serverless proxy (Vercel), klucz tylko w env |
| 3 | Implementacja aplikacji | DONE — app/ (PWA + api/scan.js), server-dev.js, ikony, testowa wizytówka |
| 4 | Test end-to-end w przeglądarce | DONE — zweryfikowane na żywym serwerze localhost:8388: kompresja zdjęcia (48 KB JPEG), payload do Claude (opus-4-8, json_schema), formularz weryfikacji, zapis IndexedDB, trwałość po reloadzie, wyszukiwarka, vCard 3.0, CSV (BOM+";"), obsługa błędów proxy. Screenshot niemożliwy (awaria narzędzia zrzutów w panelu, nie aplikacji) |
| 5 | Wdrożenie (hosting, URL na telefon) | CZĘŚCIOWO — lokalnie działa; wdrożenie na Vercel wymaga logowania Pawła (README-WDROZENIE.md, wariant A, 7 kroków) |
| 6 | Raport końcowy + instrukcja PL | DONE — README-WDROZENIE.md |

## Runda 2 (2026-07-17): redesign + logowanie

| # | Etap | Stan |
|---|------|------|
| 7 | Panel designu (3 kierunki + design director, Workflow) | DONE — zwycięzca "AKCYDENS" 9.2/10 (szwajcarska typografia drukarska); 10 poprawek sędziego wdrożonych |
| 8 | Redesign (fonty self-hosted Archivo + IBM Plex Mono, nowy HTML/CSS, ikony) | DONE — zweryfikowany zrzutami: bramka, lista, KOREKTA, USTAWIENIA, mobile 375px + desktop |
| 9 | Bramka logowania (imię + e-mail) + /api/register + logi kto skanuje | DONE — rejestracja trafia do logów serwera, opcjonalny REGISTER_WEBHOOK_URL (Make); walidacja e-maila działa |
| 10 | Testy regresji po redesignie | DONE — skan (stub) → KOREKTA → zapis → licznik N° 002, vCard i CSV z polskimi znakami, toast 12px nad belką, zero błędów w konsoli |

## Runda 3 (2026-07-17): logo + GitHub

| # | Etap | Stan |
|---|------|------|
| 11 | Logo (SVG + ikony PWA: 192/512, maskable 192/512, apple-touch 180) | DONE — znak "wizytówka + vermilion paser", zweryfikowany wizualnie; manifest z maskable, favicon SVG |
| 12 | Repo GitHub 8visionai-byte/Visitcard | DONE — main wypchnięty (commity 1ee8675, 98c9062), potwierdzone git ls-remote |
| 13 | Import w Vercelu | PO STRONIE PAWŁA — instrukcja w README (KLUCZOWE: Root Directory = `app`), env: ANTHROPIC_API_KEY, opcjonalnie SCAN_PIN i REGISTER_WEBHOOK_URL |

## Runda 4 (2026-07-17/18): skaner na żywo, bez limitów, produkcja

| # | Etap | Stan |
|---|------|------|
| 14 | Fix 404 na Vercelu (aplikacja przeniesiona do roota repo, zero-config) | DONE — commit 5fd6d6c; produkcja serwuje aplikację |
| 15 | Skaner: aparat na żywo z ramką ISO + kadrowanie, zgoda na aparat raz po rejestracji, fallback galeria | DONE — geometria nakładki zweryfikowana (proporcje 1.585, przyciemnienie, vermilion narożniki); kamera per se do potwierdzenia na fizycznym telefonie |
| 16 | Bez limitów i płatności (decyzja Pawła: budowanie zasięgu); plumbing limitów/admina czeka w api/scan.js | DONE — skan przechodzi przy dowolnym liczniku; ekran cen NIE zbudowany celowo |
| 17 | Uproszczone ustawienia (zero kluczy od użytkowników), instalacja PWA (beforeinstallprompt + instrukcja iOS), stopka "Powered by SimpleFast.AI" → simplefast.ai, vCard przez share także na Androidzie | DONE — commit 8d80d17 |
| 18 | PRAWDZIWY E2E NA PRODUKCJI | DONE — 2026-07-18: /api/scan 200 w 5,0 s, Opus 4.8 odczytał testową wizytówkę bezbłędnie (wszystkie pola, null tam gdzie brak danych), 1798+184 tokenów ≈ 5 gr; klucz z env Vercela działa |

## Runda 5 (2026-07-18): naprawa wyszukiwarki

| # | Etap | Stan |
|---|------|------|
| 19 | BUG: wyszukiwarka pomijała notatki (a także NIP, adres, kod pocztowy, kraj, WWW) | DONE — nowy `searchIndex()` obejmuje WSZYSTKIE pola kontaktu; procedura naczyń połączonych: grep potwierdził 6 pozostałych konsumentów pola `notatki` (vCard, CSV, formularz, zapis, schema+prompt w api/scan.js, pole w index.html) — wszystkie działały, wyszukiwarka była jedyną nietkniętą warstwą |
| 20 | Wyszukiwanie bez ogonków i po numerach | DONE — normalizacja NFD + `ł→l` ("wisniewska" znajduje "Wiśniewską"), osobny indeks cyfr ("601234567" znajduje "+48 601 234 567", NIP bez myślników) |
| 21 | Notatka widoczna w wierszu listy (bez tego wynik szukania po notatce jest niezrozumiały) | DONE — `.row-note` z vermilion kreską, przycięta do 3 linii |
| 22 | Testy: 16 przypadków wyszukiwania + regresja | DONE — wszystkie trafienia poprawne; wykryty i naprawiony fałszywy wynik ("lak" łapało "dla kosmetyków" przez sklejkę bez separatorów → sklejanie zawężone do cyfr); vCard, CSV, edycja i licznik bez regresji |
| 23 | Wdrożenie i test NA PRODUKCJI | DONE — commit 7142310 wdrożony; na visitcard-lemon.vercel.app potwierdzone w przeglądarce: szukanie po notatkach ("targach", "automatyzacji", "podwykonawcy", "wrzesniu" bez ogonka), po NIP-ie i telefonie bez separatorów, nazwisko bez ogonków, brak fałszywych trafień, notatki widoczne w wierszach |

## NIEZWERYFIKOWANE
- Aparat na żywo i instalacja PWA na fizycznym telefonie (panel przeglądarki blokuje kamerę; do sprawdzenia przez Pawła na komórce).

## Notatki
- Sesja: 2026-07-16, start zadania.
- Klucz API tylko w env Vercela (użytkownicy nie podają niczego); zero sekretów w repo.
- Następne możliwe etapy: "Zapisz w Kontaktach Google" (1 klik, wymaga OAuth Client ID Pawła), auto-wykrywanie rogów wizytówki, monetyzacja (plumbing gotowy: ADMIN_CODE + licznik skanów).
- Zamknięcie 2026-07-18: repo zsynchronizowane (HEAD 8d80d17 = origin/main), produkcja visitcard-lemon.vercel.app serwuje aktualną wersję (kontrola 200 + bramka rejestracji), prawdziwy skan E2E potwierdzony (etap 18).

AUTO-RESUME: DONE
