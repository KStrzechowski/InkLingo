---
project: "InkLingo"
context_type: greenfield
created: 2026-07-07
updated: 2026-07-07
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-08-05
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "kategoria bólu"
      decision: "brakująca funkcjonalność — brak narzędzia łączącego przechwytywanie słowa + tłumaczenie + kontekst + zapis w notatkach + druk w jednym miejscu; istniejące appki do fiszek (Anki, Quizlet) skupiają się na ręcznym tworzeniu fiszek, nie na przechwytywaniu własnych słówek z przeglądanej treści, i nie są zintegrowane z przeglądarką"
    - topic: "insight / dlaczego nie zbudowano tego wcześniej"
      decision: "istniejące appki do fiszek nie są zintegrowane z przeglądarką i skupiają się na tworzeniu fiszek ręcznie; Google Tłumacz to czysty tłumacz bez zapisu do zbiorów i bez przykładów w zdaniach; przewaga = zero-friction capture (zaznacz/wrzuć słowo w miejscu czytania) + AI-native tłumaczenie i generowanie przykładów, zapisane od razu do własnych zbiorów"
    - topic: "zasięg primary persony"
      decision: "Ty sam jako pierwszy użytkownik (walidacja własnym użyciem); rynek szerszych uczących się języków to cel docelowy, nie zakres MVP"
    - topic: "model dostępu"
      decision: "logowanie (email + hasło / OAuth) od początku — przygotowuje grunt pod przyszłe dzielenie notatek w chmurze; płaski model użytkowników bez ról w MVP"
    - topic: "zakres MVP / cięcia"
      decision: "obsługa PDF-ów otwartych w przeglądarce odłożona na v2 (dodatkowa trudność ponad bazową wtyczkę — inna struktura wewnętrznego widoku PDF niż zwykła strona WWW). Obsługa fraz/wyrażeń wielowyrazowych ORAZ kilka zdań przykładowych z wyborem i regeneracją ZOSTAJĄ w MVP (świadoma decyzja użytkownika mimo dodatkowego kosztu)."
    - topic: "timeline MVP"
      decision: "~3 tygodnie pracy po godzinach, przy zawężonym zakresie (bez PDF w wtyczce)"
    - topic: "docelowa przeglądarka"
      decision: "Firefox zamiast Chrome — MVP celuje wyłącznie w Firefox"
  frs_drafted: 14
  quality_check_status: accepted
---

# Shape Notes

## Seed idea (verbatim, as provided by user)

> 🗺️ PEŁEN PLAN (Wizja Docelowa)
>
> To jest docelowy kształt aplikacji, gdy wdrożysz już wszystkie pomysły i ulepszenia.
>
> - Ekosystem: Oddzielna aplikacja webowa (na komputer) zsynchronizowana z aplikacją mobilną (na telefon).
> - Przechwytywanie słówek (Wtyczka): Wtyczka do przeglądarki z zaawansowanym bocznym panelem (sidebar). Działa na stronach WWW, artykułach oraz plikach PDF otwartych w przeglądarce. Zaznaczasz słowo myszką, a ono automatycznie wpada do systemu.
> - Wprowadzanie ręczne: Pływające, minimalistyczne okienko widgetu, w które możesz szybko wpisać dowolne słowo z klawiatury bez opuszczania czytanej strony.
> - Super-Mózg AI: automatyczne tłumaczenie słowa; generowanie kilku zdań kontekstowych na różnych poziomach zaawansowania (potoczne, biznesowe, literackie); wyjaśnianie niuansów językowych i różnic między synonimami.
> - Zarządzanie wiedzą: nielimitowane, personalizowane zbiory i foldery.
> - System inteligentnych fiszek (SRS): wbudowany algorytm powtórek.
> - Zaawansowane drukowanie: generator PDF z różnorodnymi szablonami do druku na A4.
>
> 🎯 MVP (Wersja 1.0):
> 1. Baza danych i panel główny (web app) — proste foldery.
> 2. Wtyczka z pływającym okienkiem — działa na stronach i PDF-ach w Chrome; ręczne wpisanie słowa LUB zaznaczenie myszką.
> 3. Podstawowa integracja AI — jedno tłumaczenie + jedno zdanie przykładowe, przycisk „Zapisz” do wybranego folderu.
> 4. Prosty eksport do PDF — czarno-biała tabela A4: Słowo | Tłumaczenie | Zdanie.
>
> Odłożone na v2.0+: system fiszek/powtórek w aplikacji, aplikacja mobilna, zaawansowane szablony graficzne PDF, głęboka analiza synonimów przez AI.

## Vision & Problem Statement

Osoba ucząca się języka obcego, natrafiając na nieznane słowo podczas czytania (strony WWW, PDF-y, ale też szerzej w codziennym życiu), chce je natychmiast zapisać, przetłumaczyć i zrozumieć w kontekście zdania — bez opuszczania tego, co właśnie robi. Dziś musi się posiłkować rozdzielonymi narzędziami: osobnym tłumaczem (np. Google Tłumacz) bez możliwości zapisu do własnych zbiorów, oraz aplikacjami do fiszek (np. Anki, Quizlet), które skupiają się na ręcznym tworzeniu fiszek, a nie na wygodnym przechwytywaniu własnych słówek z przeglądanej treści, i nie są zintegrowane z przeglądarką.

Żadne z istniejących narzędzi nie łączy w jednym przepływie: przechwytywania słowa jednym zaznaczeniem/kliknięciem w miejscu czytania, natywnej integracji AI do tłumaczenia i generowania przykładowych zdań w kontekście, zapisu do własnych, tematycznych zbiorów, oraz eksportu do materiałów do nauki (druk). Ta integracja "zero-friction capture + AI-native translation" w jednym miejscu jest tym, czego brakuje na rynku.

## User & Persona

Autor projektu jako uczący się języka obcego, czytający artykuły, strony WWW i PDF-y w przeglądarce. Sięga po produkt w momencie natrafienia na nieznane słowo — chce je zapisać z tłumaczeniem i przykładem zdania bez przerywania czytania. Jest pierwszym użytkownikiem i walidatorem produktu, z docelowym zamiarem wprowadzenia go na szerszy rynek uczących się języków.

## Access Control

Logowanie (email + hasło / OAuth) od początku. Płaski model użytkowników — brak ról w MVP; każdy zalogowany użytkownik ma pełny dostęp do własnych zbiorów. Podział na role (np. właściciel zbioru / współdzielony dostęp) jest odłożony do przyszłej funkcji dzielenia notatek z grupami znajomych (poza zakresem MVP).

## Success Criteria

### Primary
- Działający przepływ end-to-end: zaznaczenie/wpisanie słowa lub frazy w wtyczce (na zwykłej stronie WWW) → tłumaczenie + kilka przykładowych zdań z wyborem/regeneracją → zapis do wybranego zbioru → wygenerowanie czarno-białego PDF-a A4 gotowego do druku.

### Secondary
- Pływające okienko wtyczki i wygenerowany PDF są estetyczne — nie tylko funkcjonalne, ale przyjemne w użyciu od pierwszego dnia.

### Guardrails
- Zero utraty zapisanych słówek/fraz — raz zapisany wpis w zbiorze nigdy nie znika bez jawnej akcji użytkownika.
- Wtyczka nie zakłóca normalnego czytania strony (scroll, zwykłe zaznaczanie tekstu do innych celów).

## MVP scope note

Pełen docelowy zakres wtyczki obejmuje też obsługę PDF-ów otwartych w przeglądarce — **odłożone do v2**. Wtyczka celuje w Firefox (nie Chrome). Obsługa fraz wielowyrazowych oraz generowanie kilku zdań przykładowych z wyborem/regeneracją zostają w MVP.

## Functional Requirements

### Uwierzytelnianie
- FR-001: Użytkownik może zarejestrować konto (email + hasło lub OAuth). Priority: must-have
  > Socrates: Kontrargument rozważony: "to MVP dla jednej osoby, pełna rejestracja to zbędny narzut". Rozwiązanie: zostaje bez zmian.
- FR-002: Użytkownik może zalogować się do aplikacji. Priority: must-have
  > Socrates: Kontrargument rozważony: "bez wielu użytkowników logowanie jest zbędne". Rozwiązanie: zostaje bez zmian.
- FR-003: Użytkownik może wylogować się z aplikacji. Priority: must-have
  > Socrates: Kontrargument rozważony: "dla jednoosobowego MVP na własnym urządzeniu wylogowanie nie jest krytyczne". Rozwiązanie: zostaje bez zmian.

### Zbiory
- FR-004: Użytkownik może ręcznie utworzyć nowy zbiór (folder). Priority: must-have
  > Socrates: Kontrargument rozważony: "jeden domyślny zbiór wystarczyłby na start". Rozwiązanie: zostaje bez zmian — użytkownik chce co najmniej osobnych zbiorów per język, więc ręczne tworzenie wielu folderów jest potrzebne od MVP.
- FR-005: Użytkownik może przeglądać listę swoich zbiorów i zawartość każdego z nich. Priority: must-have
  > Socrates: Kontrargument rozważony: "wystarczyłby jeden aktywny zbiór naraz, bez pełnej listy". Rozwiązanie: zostaje bez zmian.

### Wtyczka — przechwytywanie
- FR-006: Użytkownik może kliknąć ikonę wtyczki na stronie WWW, aby otworzyć pływające okienko. Priority: must-have
  > Socrates: Kontrargument rozważony: "skrót klawiszowy byłby szybszy niż kliknięcie ikony". Rozwiązanie: zostaje bez zmian.
- FR-007: Użytkownik może ręcznie wpisać słowo lub frazę w okienku wtyczki. Priority: must-have
  > Socrates: Kontrargument rozważony: "zaznaczanie myszką (FR-008) wystarczyłoby, ręczne wpisywanie mogłoby poczekać". Rozwiązanie: zostaje bez zmian — i tak zyskuje na znaczeniu, bo FR-008 zostaje odłożone na v2 (patrz niżej), więc ręczne wpisywanie jest jedyną ścieżką wprowadzania w MVP.
- FR-008: Użytkownik może zaznaczyć słowo lub frazę myszką na stronie WWW, co automatycznie wypełnia okienko wtyczki. Priority: nice-to-have (v2)
  > Socrates: Kontrargument rozważony: "to najbardziej złożona technicznie część wtyczki (content script + Selection API w wewnętrznej strukturze strony)". Rozwiązanie: **odłożone na v2** — MVP działa wyłącznie przez ręczne wpisanie słowa/frazy w okienku (FR-007).

### AI
- FR-009: System zwraca kilka wariantów tłumaczenia wprowadzonego słowa/frazy (dla słów wieloznacznych). Priority: must-have
  > Socrates: Kontrargument rozważony: "pojedyncze tłumaczenie może nie wystarczyć dla słów wieloznacznych". Rozwiązanie: FR zmieniona — system zwraca kilka wariantów tłumaczenia zamiast jednego.
- FR-010: System zwraca kilka przykładowych zdań kontekstowych dla wprowadzonego słowa/frazy. Priority: must-have
  > Socrates: Kontrargument rozważony: "więcej zdań = więcej kosztów/opóźnienia wywołań AI". Rozwiązanie: zostaje bez zmian.
- FR-011: Użytkownik może wybrać jedno z zaproponowanych zdań. Priority: must-have
  > Socrates: Kontrargument rozważony: "system mógłby wybrać zdanie automatycznie, bez angażowania użytkownika". Rozwiązanie: zostaje bez zmian.
- FR-012: Użytkownik może poprosić o wygenerowanie innych przykładowych zdań (regeneracja). Priority: must-have
  > Socrates: Kontrargument rozważony: "regeneracja to dodatkowy koszt AI na żądanie". Rozwiązanie: zostaje bez zmian.

### Zapis
- FR-013: Użytkownik może zapisać słowo/frazę wraz z tłumaczeniem i wybranym zdaniem do zbioru; domyślnie proponowany jest ostatnio używany zbiór, z możliwością rozwinięcia pełnej listy i wyboru innego. Priority: must-have
  > Socrates: Kontrargument rozważony: "wybór zbioru za każdym razem to tarcie". Rozwiązanie: FR doprecyzowana — przycisk „Zapisz” z domyślnie proponowanym (ostatnio używanym) zbiorem + rozwijana strzałka na wybór innego z pełnej listy.

### Eksport do druku
- FR-014: Użytkownik może wygenerować czytelny, gotowy do druku dokument A4 (czarno-biały) dla wybranego zbioru z tabelą Słowo/Fraza | Tłumaczenie | Zdanie. Priority: must-have
  > Socrates: Kontrargument rozważony: "zamiast własnego generatora PDF, widok tabeli + druk z przeglądarki (Ctrl+P) mógłby wystarczyć". Rozwiązanie: FR przeformułowana na wynik (czytelny wydruk A4), bez przesądzania mechanizmu — dedykowany plik PDF vs. widok do druku z przeglądarki to decyzja downstream (patrz Open Questions), użytkownik nie jest pewien i akceptuje dowolne podejście, o ile wydruk jest dobrej jakości.

## User Stories

### US-01: Użytkownik przechwytuje słowo ze strony i zapisuje je do zbioru

- **Given** zalogowany użytkownik z co najmniej jednym zbiorem, czytający zwykłą stronę WWW
- **When** klika ikonę wtyczki, ręcznie wpisuje słowo lub frazę w okienku, wtyczka pokazuje warianty tłumaczenia i kilka przykładowych zdań, użytkownik wybiera jedno zdanie i klika „Zapisz” (domyślnie do ostatnio używanego zbioru, z możliwością wyboru innego)
- **Then** wpis (słowo/fraza + tłumaczenie + wybrane zdanie) pojawia się natychmiast w zawartości wybranego zbioru

#### Acceptance Criteria
- Próba zapisu bez wybrania zbioru pokazuje czytelny komunikat błędu, wpis nie ginie w tle
- Zapisany wpis jest widoczny w panelu głównym bez konieczności ręcznego odświeżania strony
- Puste lub tylko-białoznakowe wejście w okienku wtyczki nie wywołuje zapytania do AI

## Business Logic

Na podstawie wprowadzonego słowa lub frazy aplikacja automatycznie dobiera najtrafniejsze warianty tłumaczenia oraz generuje przykładowe zdania odzwierciedlające rzeczywiste użycie, tak by użytkownik nie musiał sam formułować zapytania ani oceniać poprawności.

Regułę zasilają: słowo lub fraza wpisana ręcznie w oknie wtyczki (język źródłowy i docelowy nauki). Wynikiem jest: kilka wariantów tłumaczenia (dla przypadków wieloznaczności) oraz kilka przykładowych zdań kontekstowych, z możliwością poproszenia o kolejne, jeśli żadne nie pasuje. Użytkownik spotyka tę regułę natychmiast po wpisaniu słowa w pływającym okienku wtyczki — jeszcze przed zapisaniem do zbioru widzi propozycje i wybiera tę, która najlepiej oddaje kontekst, w jakim napotkał słowo.

## Non-Functional Requirements

- Tłumaczenie i przykładowe zdania pojawiają się w okienku wtyczki wystarczająco szybko, by nie przerywać czytania (odpowiedź w poniżej kilku sekund od wpisania słowa).
- Wtyczka działa na najnowszej wersji Firefoksa; inne przeglądarki poza zakresem MVP.

## Non-Goals

- **Brak systemu fiszek/powtórek (SRS)** — algorytm powtórek (spaced repetition) to zapowiedziana funkcja v2+; MVP kończy się na eksporcie do druku.
- **Brak aplikacji mobilnej** — tylko web app + wtyczka do przeglądarki w MVP; synchronizacja z aplikacją mobilną to przyszłość.
- **Brak zaawansowanych szablonów graficznych PDF** — jeden prosty, czarno-biały układ tabeli; metoda Cornella, kolorowe szablony do wycięcia itd. to v2+.
- **Brak dzielonych/publicznych notatek dla grup znajomych** — funkcja społecznościowa (chmura, współdzielenie zbiorów) to pomysł na przyszłość, nie MVP.
- **Brak obsługi PDF-ów otwartych w przeglądarce w wtyczce** — MVP działa tylko na zwykłych stronach WWW; PDF to v2 (patrz FR-008 dot. zaznaczania myszką — jest z tym powiązane).
- **Brak automatycznego przechwytywania przez zaznaczenie myszką (FR-008)** — MVP działa wyłącznie przez ręczne wpisanie słowa/frazy w okienku wtyczki; auto-capture przez zaznaczenie to v2.

## Open Questions

1. **Mechanizm generowania wydruku (FR-014)** — dedykowany plik PDF generowany po stronie serwera, czy widok tabeli w przeglądarce + druk (Ctrl+P)? Owner: użytkownik/downstream tech-stack-selection. Nierozstrzygnięte świadomie — użytkownik akceptuje dowolne podejście, o ile efekt na kartce jest czytelny i dobrej jakości.

## Forward: tech-stack

- Backend/API i baza danych muszą być wdrożone w chmurze (nie lokalnie) — logowanie, zapis zbiorów i wywołania AI wymagają zawsze dostępnego serwera. Platforma/region/tier wdrożenia to decyzja downstream (tech-stack-selection), nie PRD.
- Wtyczka przeglądarkowa w MVP może być instalowana lokalnie (side-loaded) w Firefoksie, bez publikacji w Firefox Add-ons — oszczędza czas na start, nie jest wymaganiem produktowym.

## Forward: technical-roadmap

(none captured yet)
