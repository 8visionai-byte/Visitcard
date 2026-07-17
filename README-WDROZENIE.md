# Skaner Wizytówek — jak uruchomić i wdrożyć

Aplikacja: robisz telefonem zdjęcie wizytówki → Claude odczytuje dane → sprawdzasz je w formularzu → zapis.
Potem jednym przyciskiem: plik .vcf (kontakt do telefonu) albo eksport wszystkiego do CSV.

Design: kierunek "AKCYDENS" (szwajcarska typografia drukarska: papier, czarny tusz, czerwień vermilion),
wybrany panelem 3 kierunków + design director (9.2/10). Fonty Archivo i IBM Plex Mono self-hostowane
w `app/fonts/` — aplikacja w runtime nie łączy się z żadnym CDN.

## Logowanie użytkowników

Przy pierwszym uruchomieniu aplikacja wymaga podania imienia i adresu e-mail — bez tego nie da się
skanować. Kto się zarejestrował i kto skanuje, widzisz w dwóch miejscach:

1. **Logi Vercela:** projekt → Deployments → najnowszy → Functions → logi. Wpisy `[rejestracja] {...}`
   (imię, e-mail, data, urządzenie) oraz `[skan] email model` przy każdym skanie.
2. **Webhook Make (opcjonalnie, wygodniejsze):** dodaj w Vercelu zmienną `REGISTER_WEBHOOK_URL`
   z adresem webhooka Make; każda rejestracja poleci POST-em z JSON `{imie, email, data, userAgent}`.
   W Make: Custom webhook → Google Sheets "Add a row" i masz żywą listę użytkowników w arkuszu.

Wylogowanie: Ustawienia → Wyloguj. Kontakty zostają na urządzeniu.

## Co gdzie leży

| Plik / folder | Do czego |
|---|---|
| `app/` | Cała aplikacja (to wdrażasz na hosting) |
| `app/api/scan.js` | Funkcja serverless, jedyne miejsce dotykające klucza API |
| `server-dev.js` | Lokalny serwer do testów na komputerze |
| `test/sample-card.png` | Testowa wizytówka do prób |
| `BRAINSTORM-WYNIKI.md` | Wyniki panelu architektów i uzasadnienie wyboru |

## Wariant A — wdrożenie na Vercel (ZALECANY, klucz bezpieczny na serwerze)

Wszystko robisz na swoim komputerze (PowerShell) i w przeglądarce:

1. Otwórz PowerShell w folderze `Aplikacja do Wizytówek\app`.
2. Wpisz: `npx vercel login` i zaloguj się (mail albo GitHub).
3. Wpisz: `npx vercel --prod` i potwierdzaj Enterem (nazwa projektu np. `skaner-wizytowek`).
4. Wejdź na vercel.com → projekt → **Settings → Environment Variables** i dodaj:
   - `ANTHROPIC_API_KEY` = twój klucz z console.anthropic.com (załóż OSOBNY klucz z limitem wydatków, np. 10 USD/mies.),
   - opcjonalnie `SCAN_PIN` = dowolny kod (np. 4 cyfry); wtedy aplikacja zapyta o PIN w Ustawieniach i nikt obcy nie użyje twojego klucza, nawet znając adres.
5. Wpisz jeszcze raz `npx vercel --prod` (żeby nowe zmienne weszły w życie).
6. Otwórz adres z Vercela **na telefonie**, w menu przeglądarki wybierz **"Dodaj do ekranu głównego"** i gotowe: masz apkę z ikoną.
7. W aplikacji: Ustawienia → tryb "Serwer aplikacji" (domyślny), wpisz PIN jeśli ustawiłeś → **Testuj połączenie** → ma pokazać "✓".

## Wariant B — test lokalny na komputerze (bez wdrażania)

1. PowerShell w folderze `Aplikacja do Wizytówek`.
2. `$env:ANTHROPIC_API_KEY = "twój-klucz"` (tylko na czas tej sesji, nigdzie się nie zapisuje).
3. `node server-dev.js` → otwórz http://localhost:8388.
4. Zamiast aparatu wybierz plik `test/sample-card.png` przez przycisk "Skanuj wizytówkę".

## Wariant C — dowolny hosting statyczny + własny klucz w przeglądarce

Jeśli wrzucisz folder `app/` na hosting bez funkcji serverless (np. GitHub Pages), przełącz w aplikacji
Ustawienia → tryb "Własny klucz API" i wklej klucz. Klucz siedzi wtedy w localStorage TWOJEJ przeglądarki.
To OK do użytku osobistego, ale: tylko osobny klucz z limitem wydatków i nie podawaj nikomu adresu.

## Zapis kontaktu do telefonu (jak to działa)

- **Android:** przycisk "Do telefonu (.vcf)" → plik się pobiera → tapnij powiadomienie → system pyta o dodanie do Kontaktów. Realnie 1-2 tapnięcia.
- **iPhone:** ten sam przycisk otwiera arkusz udostępniania → wybierz Kontakty → "Utwórz nowy kontakt". 2-3 tapnięcia; tyle pozwala Apple każdej aplikacji webowej.
- **Cała baza naraz:** "Wszystkie .vcf" (import zbiorczy) albo "Eksport CSV" (polski Excel: średniki + BOM; da się też zaimportować do Google Contacts).

## Koszty

Hosting: 0 zł (Vercel Hobby). Jedyny koszt to API za skan:
- Claude Opus 4.8 (domyślny, najdokładniejszy): ~8 gr / wizytówka
- Claude Sonnet 5: ~4 gr
- Claude Haiku 4.5: ~2 gr
100 wizytówek miesięcznie = od ~2 zł (Haiku) do ~8 zł (Opus). Model zmieniasz w Ustawieniach.

## Ważne ograniczenia (szczerze)

- Baza kontaktów żyje w przeglądarce jednego telefonu (IndexedDB). Wyczyszczenie danych przeglądarki = utrata bazy.
  Rób co jakiś czas "Eksport CSV" albo "Wszystkie .vcf" jako kopię.
- Wizytówki dwustronne: zeskanuj przód, zapisz, potem dodaj resztę ręcznie w "Edytuj" (v1).
- Prompt i schema danych są w DWÓCH plikach: `app/api/scan.js` i `app/app.js` — przy zmianach edytuj oba.
