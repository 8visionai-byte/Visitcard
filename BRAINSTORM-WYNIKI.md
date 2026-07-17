# Brainstorm architektury — wyniki panelu (2026-07-17)

Workflow: 4 niezależnych architektów + 3 sędziów (perspektywy: UX użytkownika, solo-dev/bezpieczeństwo, jakość ekstrakcji). Pełne wyniki: transkrypt workflow `wf_802be521-ad7`.

## Propozycje i oceny (średnie ważone 0-10)

| Propozycja | Sędzia UX | Sędzia solo-dev/security | Sędzia jakość | Czas do wyniku | Koszt/mies. |
|---|---|---|---|---|---|
| **1. Wizytnik PWA** — statyczna PWA, klucz API w localStorage, Claude vision prosto z przeglądarki | 8.3 | 7.65 | 8.0 | 4-6 h | ~0 zł + kilka zł API |
| **2. SkanKontakt** — frontend + funkcja serverless /api/scan na Vercel, klucz w env | **8.4** | **8.0** | **8.15** | 4-6 h | <20 zł |
| 3. Wizytownik Telegram + Make — bot Telegram → Make → Gemini → Sheets + vCard | 8.3 | 7.75 | 8.1 | 2-4 h | ~0-5 zł |
| 4. WizytkoSkan Mobile — natywna apka Expo/React Native | 6.6 | 6.55 | 6.6 | Android dziś, iPhone 2-4 dni + 99 USD/rok | 0-10 zł |

**Zwycięzca u wszystkich 3 sędziów: propozycja 2 (SkanKontakt).**

## Kluczowe argumenty sędziów

1. **Klucz API nigdy nie istnieje po stronie klienta** (env var na serwerze) — jedyna propozycja spełniająca regułę sekretów nie tylko literalnie, ale w duchu.
2. **Pipeline obrazu bez degradacji** — kompresja po stronie klienta pod pełną kontrolą; wariant Telegram odpada na trudnych wizytówkach, bo Telegram rekompresuje zdjęcia zanim zobaczy je model.
3. **Formularz weryfikacji przed zapisem** — zła cyfra w telefonie to stracony kontakt; edytowalny podgląd to obowiązkowy bezpiecznik.
4. Natywna apka odpada: iPhone wymaga Apple Developer (99 USD) i 2-4 dni, a nie daje realnej przewagi nad vCard.

## Rekomendowana hybryda (2 z 3 sędziów, przyjęta do realizacji)

**Frontend z propozycji 1 + sekrety z propozycji 2:**
- statyczna PWA (vanilla JS, zero build stepu, zero frameworka do utrzymania), IndexedDB, vCard/CSV liczone lokalnie,
- jedna funkcja serverless `api/scan.js` jako proxy do Claude — klucz `ANTHROPIC_API_KEY` wyłącznie w env (Vercel), opcjonalny PIN,
- tryb zapasowy „własny klucz w ustawieniach" (localStorage) do użycia bez wdrożenia — z ostrzeżeniem, tylko do użytku osobistego,
- ekstrakcja: Claude vision + structured outputs (json_schema, gwarantowany poprawny JSON), domyślnie `claude-opus-4-8`, w ustawieniach `claude-sonnet-5` / `claude-haiku-4-5` (taniej).

## Szczery obraz ograniczeń (z propozycji, do zapamiętania)

- „1 klik do kontaktów": na Androidzie realnie 1-2 tapnięcia (pobierz .vcf → otwórz), na iPhone 2-3 tapnięcia przez arkusz udostępniania — ograniczenie Apple, żadna aplikacja webowa tego nie ominie.
- Baza kontaktów żyje w IndexedDB jednego telefonu — brak synchronizacji między urządzeniami; ratunkiem regularny eksport CSV/vCard.
- Wizytówki dwustronne = dwa skany (scalenie ręczne w v1).
- Koszt skanu: opus ~7-8 gr, haiku ~1,5 gr; 100 wizytówek/mies. to od ~1,50 zł (haiku) do ~8 zł (opus).
