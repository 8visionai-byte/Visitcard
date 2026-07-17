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

## NIEZWERYFIKOWANE
- Żywe wywołanie Claude API (ekstrakcja z prawdziwym kluczem) — brak klucza w środowisku pracy; przetestowane z zaślepką odpowiedzi, format żądania zgodny ze skillem claude-api. Do potwierdzenia przyciskiem "Testuj połączenie" po wpisaniu klucza.
- Deploy na Vercel i instalacja PWA na telefonie — wymaga konta/logowania Pawła.

## Notatki
- Sesja: 2026-07-16, start zadania.
- Ograniczenia: zero sekretów w repo/plikach (klucz API wpisuje user w UI aplikacji), maszyna Windows, deliverable = plik + wdrożenie.
