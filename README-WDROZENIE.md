# Skaner Wizytówek — jak uruchomić i wdrożyć

Aplikacja: celujesz aparatem w wizytówkę (ramka skanera) → Claude odczytuje dane → sprawdzasz
je w formularzu → zapis. Potem jednym przyciskiem: kontakt do telefonu (.vcf) albo eksport CSV.
Wszystko darmowe dla użytkowników — bez limitów i płatności (na tym etapie budujemy zasięg).

Design: kierunek "AKCYDENS" (szwajcarska typografia drukarska: papier, czarny tusz, czerwień vermilion),
wybrany panelem 3 kierunków + design director (9.2/10). Fonty Archivo i IBM Plex Mono self-hostowane
w `fonts/` — aplikacja w runtime nie łączy się z żadnym CDN.

## Jak działa dostęp i klucz API

- Użytkownik NIE podaje żadnego klucza. Wszystkie skany idą przez funkcję serwera `/api/scan`,
  która używa **jednego** klucza `ANTHROPIC_API_KEY` z env Vercela (twojego). Ten jeden klucz
  obsługuje też odczyt zdjęć — Claude "widzi" obraz (vision), osobna zmienna nie istnieje.
- Przy pierwszym uruchomieniu użytkownik podaje imię i e-mail (bez tego nie skorzysta),
  a aplikacja od razu prosi o dostęp do aparatu — zgoda zapamiętuje się na stałe.

## Kto korzysta (podgląd użytkowników)

1. **Logi Vercela:** projekt → Deployments → najnowszy → Functions → logi. Wpisy `[rejestracja] {...}`
   (imię, e-mail, data, urządzenie) oraz `[skan] email model` przy każdym skanie.
2. **Webhook Make (opcjonalnie, wygodniejsze):** zmienna `REGISTER_WEBHOOK_URL` w Vercelu;
   każda rejestracja poleci POST-em z JSON `{imie, email, data, userAgent}`.
   W Make: Custom webhook → Google Sheets "Add a row" i masz żywą listę użytkowników w arkuszu.

Wylogowanie: Ustawienia → Wyloguj. Kontakty zostają na urządzeniu.

## Zmienne środowiskowe (Vercel → Settings → Environment Variables)

| Zmienna | Wymagana | Do czego |
|---|---|---|
| `ANTHROPIC_API_KEY` | TAK | Jedyny klucz; odczyt wizytówek (vision). Osobny klucz z limitem wydatków, np. 10 USD/mies. |
| `REGISTER_WEBHOOK_URL` | nie | Webhook Make: rejestracje użytkowników do arkusza |
| `SCAN_MODEL` | nie | Zmiana modelu: `claude-opus-4-8` (domyślny), `claude-sonnet-5`, `claude-haiku-4-5` |
| `ADMIN_CODE` | nie | Rezerwa pod przyszłe limity/płatności (dziś wszystko darmowe, kod nieużywany w UI) |

Po dodaniu/zmianie zmiennych: **Deployments → ⋯ → Redeploy**.

## Wdrożenie: GitHub → Vercel (auto-deploy po każdym pushu)

Kod: **https://github.com/8visionai-byte/Visitcard** (gałąź `main`). Aplikacja leży w katalogu
głównym repo — Vercel działa bez konfiguracji (Root Directory domyślny, Framework: Other).
Projekt jest już podpięty: każdy push na `main` wdraża się sam, pull requesty dostają osobne
adresy testowe. Telefon: otwórz adres → "Dodaj do ekranu głównego" (albo przycisk
"Zainstaluj na telefonie" w aplikacji).

## Test lokalny na komputerze (bez wdrażania)

1. PowerShell w folderze `Aplikacja do Wizytówek`.
2. `$env:ANTHROPIC_API_KEY = "twój-klucz"` (tylko na czas tej sesji, nigdzie się nie zapisuje).
3. `node server-dev.js` → otwórz http://localhost:8388.
4. Zamiast aparatu użyj "Z galerii" i wybierz `test/sample-card.png`.

## Zapis kontaktu do telefonu (szczerze, jak to działa)

Żadna aplikacja webowa (PWA) nie może zapisać kontaktu bezpośrednio do telefonu — Android i iOS
nie dają stronom takiego uprawnienia. Dlatego:

- **Android/iPhone:** przycisk "Do telefonu ↓" otwiera arkusz udostępniania → wybierz Kontakty →
  potwierdź import. Realnie 2-3 tapnięcia — to systemowe minimum.
- **Cała baza naraz:** "Wszystkie .vcf" (import zbiorczy) albo "Eksport CSV" (polski Excel; da się
  zaimportować do Google Contacts).
- **Prawdziwy 1 klik** da dopiero przycisk "Zapisz w Kontaktach Google" (logowanie Google raz,
  potem zapis przez People API bez pytań). Wymaga założenia darmowego OAuth Client ID w Google
  Cloud Console — do zrobienia jako następny etap, opiszę kroki gdy zdecydujesz.

## Koszty

Hosting: 0 zł (Vercel Hobby). Jedyny koszt to API za skan (płacisz ty, użytkownicy nic):
- Claude Opus 4.8 (domyślny, najdokładniejszy): ~8 gr / wizytówka
- Claude Sonnet 5: ~4 gr · Claude Haiku 4.5: ~2 gr (zmiana przez env `SCAN_MODEL`)

1000 wizytówek miesięcznie ≈ 20-80 zł zależnie od modelu. Ustaw limit wydatków na kluczu
w console.anthropic.com — to twój bezpiecznik.

## Ważne ograniczenia (szczerze)

- Baza kontaktów żyje w przeglądarce jednego telefonu (IndexedDB). Wyczyszczenie danych
  przeglądarki = utrata bazy. Ratunek: regularny "Eksport CSV" / "Wszystkie .vcf".
- Ramka skanera kadruje zdjęcie do wizytówki; automatyczne wykrywanie rogów (jak w skanerach
  dokumentów) to możliwy następny etap.
- Wizytówki dwustronne: zeskanuj przód, zapisz, resztę dopisz w "Edytuj" (v1).
- Płatności/limity celowo wyłączone — infrastruktura (licznik skanów, kod admina) czeka
  w kodzie na etap monetyzacji.
