---
project: "InkLingo"
version: 1
status: draft
created: 2026-07-07
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-08-05
  after_hours_only: true
---

## Vision & Problem Statement

Osoba ucząca się języka obcego, natrafiając na nieznane słowo podczas czytania (strony WWW, PDF-y, ale też szerzej w codziennym życiu), chce je natychmiast zapisać, przetłumaczyć i zrozumieć w kontekście zdania — bez opuszczania tego, co właśnie robi. Dziś musi się posiłkować rozdzielonymi narzędziami: osobnym tłumaczem (np. Google Tłumacz) bez możliwości zapisu do własnych zbiorów, oraz aplikacjami do fiszek (np. Anki, Quizlet), które skupiają się na ręcznym tworzeniu fiszek, a nie na wygodnym przechwytywaniu własnych słówek z przeglądanej treści, i nie są zintegrowane z przeglądarką.

Żadne z istniejących narzędzi nie łączy w jednym przepływie: przechwytywania słowa jednym zaznaczeniem/kliknięciem w miejscu czytania, natywnej integracji AI do tłumaczenia i generowania przykładowych zdań w kontekście, zapisu do własnych, tematycznych zbiorów, oraz eksportu do materiałów do nauki (druk). Ta integracja "zero-friction capture + AI-native translation" w jednym miejscu jest tym, czego brakuje na rynku.

## User & Persona

Autor projektu jako uczący się języka obcego, czytający artykuły, strony WWW i PDF-y w przeglądarce. Sięga po produkt w momencie natrafienia na nieznane słowo — chce je zapisać z tłumaczeniem i przykładem zdania bez przerywania czytania. Jest pierwszym użytkownikiem i walidatorem produktu, z docelowym zamiarem wprowadzenia go na szerszy rynek uczących się języków.

## Success Criteria

### Primary
- Działający przepływ end-to-end: wpisanie słowa lub frazy w wtyczce (na zwykłej stronie WWW) → tłumaczenie + kilka przykładowych zdań z wyborem/regeneracją → zapis do wybranego zbioru → wygenerowanie czytelnego, gotowego do druku dokumentu A4.

### Secondary
- Pływające okienko wtyczki i wygenerowany dokument do druku są estetyczne — nie tylko funkcjonalne, ale przyjemne w użyciu od pierwszego dnia.

### Guardrails
- Zero utraty zapisanych słówek/fraz — raz zapisany wpis w zbiorze nigdy nie znika bez jawnej akcji użytkownika.
- Wtyczka nie zakłóca normalnego czytania strony (scroll, zwykłe zaznaczanie tekstu do innych celów).

## User Stories

### US-01: Użytkownik przechwytuje słowo ze strony i zapisuje je do zbioru

- **Given** zalogowany użytkownik z co najmniej jednym zbiorem, czytający zwykłą stronę WWW
- **When** klika ikonę wtyczki, ręcznie wpisuje słowo lub frazę w okienku, wtyczka pokazuje warianty tłumaczenia i kilka przykładowych zdań, użytkownik wybiera jedno zdanie i klika „Zapisz” (domyślnie do ostatnio używanego zbioru, z możliwością wyboru innego)
- **Then** wpis (słowo/fraza + tłumaczenie + wybrane zdanie) pojawia się natychmiast w zawartości wybranego zbioru

#### Acceptance Criteria
- Próba zapisu bez wybrania zbioru pokazuje czytelny komunikat błędu, wpis nie ginie w tle
- Zapisany wpis jest widoczny w panelu głównym bez konieczności ręcznego odświeżania strony
- Puste lub tylko-białoznakowe wejście w okienku wtyczki nie wywołuje zapytania do AI

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

### Wymowa
- FR-015: System pokazuje transkrypcję fonetyczną (IPA) wprowadzonego słowa/frazy obok tłumaczenia. Priority: must-have
  > Socrates: Kontrargument rozważony: "tłumaczenie i przykładowe zdanie już wystarczają do zrozumienia słowa — czy fonetyka to nie zbędny dodatek?". Rozwiązanie: zostaje bez zmian — dla nauki wymowy transkrypcja IPA jest istotną wartością, a koszt krańcowy jest niski (dodatkowe pole w tym samym wywołaniu AI, które już zwraca tłumaczenie i zdania).
- FR-016: Użytkownik może odtworzyć wymowę (audio) wprowadzonego słowa/frazy oraz wybranego przykładowego zdania. Priority: must-have
  > Socrates: Kontrargument rozważony: "to nowa techniczna zależność (silnik TTS) tuż przed trzytygodniowym deadline'em — czy nie za dużo na MVP?". Rozwiązanie: FR zostaje, ale mechanizm generowania audio (przeglądarkowe Web Speech API vs płatne API TTS) pozostaje celowo otwarty — patrz Open Questions, analogicznie do FR-014.

### Zapis
- FR-013: Użytkownik może zapisać słowo/frazę wraz z tłumaczeniem i wybranym zdaniem do zbioru; domyślnie proponowany jest ostatnio używany zbiór, z możliwością rozwinięcia pełnej listy i wyboru innego. Priority: must-have
  > Socrates: Kontrargument rozważony: "wybór zbioru za każdym razem to tarcie". Rozwiązanie: FR doprecyzowana — przycisk „Zapisz” z domyślnie proponowanym (ostatnio używanym) zbiorem + rozwijana strzałka na wybór innego z pełnej listy.

### Eksport do druku
- FR-014: Użytkownik może wygenerować czytelny, gotowy do druku dokument A4 (czarno-biały) dla wybranego zbioru z tabelą Słowo/Fraza | Tłumaczenie | Zdanie. Priority: must-have
  > Socrates: Kontrargument rozważony: "zamiast własnego generatora PDF, widok tabeli + druk z przeglądarki (Ctrl+P) mógłby wystarczyć". Rozwiązanie: FR przeformułowana na wynik (czytelny wydruk A4), bez przesądzania mechanizmu — dedykowany plik PDF vs. widok do druku z przeglądarki to decyzja downstream (patrz Open Questions), użytkownik nie jest pewien i akceptuje dowolne podejście, o ile wydruk jest dobrej jakości.

## Non-Functional Requirements

- Tłumaczenie i przykładowe zdania pojawiają się w okienku wtyczki wystarczająco szybko, by nie przerywać czytania (odpowiedź w poniżej kilku sekund od wpisania słowa).
- Wtyczka działa na najnowszej wersji Firefoksa; inne przeglądarki poza zakresem MVP.
- Odtworzenie wymowy (FR-016) startuje bez zauważalnego opóźnienia po kliknięciu przycisku odtwarzania (subiektywnie natychmiastowe).

## Business Logic

Na podstawie wprowadzonego słowa lub frazy aplikacja automatycznie dobiera najtrafniejsze warianty tłumaczenia oraz generuje przykładowe zdania odzwierciedlające rzeczywiste użycie, tak by użytkownik nie musiał sam formułować zapytania ani oceniać poprawności.

Regułę zasilają: słowo lub fraza wpisana ręcznie w oknie wtyczki (język źródłowy i docelowy nauki). Wynikiem jest: kilka wariantów tłumaczenia (dla przypadków wieloznaczności), transkrypcja fonetyczna (IPA) oraz kilka przykładowych zdań kontekstowych, z możliwością poproszenia o kolejne, jeśli żadne nie pasuje. Użytkownik spotyka tę regułę natychmiast po wpisaniu słowa w pływającym okienku wtyczki — jeszcze przed zapisaniem do zbioru widzi propozycje i wybiera tę, która najlepiej oddaje kontekst, w jakim napotkał słowo.

## Access Control

Logowanie (email + hasło / OAuth) od początku. Płaski model użytkowników — brak ról w MVP; każdy zalogowany użytkownik ma pełny dostęp do własnych zbiorów. Podział na role (np. właściciel zbioru / współdzielony dostęp) jest odłożony do przyszłej funkcji dzielenia notatek z grupami znajomych (poza zakresem MVP).

## Non-Goals

- **Brak systemu fiszek/powtórek (SRS)** — algorytm powtórek (spaced repetition) to zapowiedziana funkcja v2+; MVP kończy się na eksporcie do druku.
- **Brak aplikacji mobilnej** — tylko web app + wtyczka do przeglądarki w MVP; synchronizacja z aplikacją mobilną to przyszłość.
- **Brak zaawansowanych szablonów graficznych do druku** — jeden prosty, czarno-biały układ tabeli; metoda Cornella, kolorowe szablony do wycięcia itd. to v2+.
- **Brak dzielonych/publicznych notatek dla grup znajomych** — funkcja społecznościowa (współdzielenie zbiorów) to pomysł na przyszłość, nie MVP.
- **Brak obsługi PDF-ów otwartych w przeglądarce w wtyczce** — MVP działa tylko na zwykłych stronach WWW; PDF to v2.
- **Brak automatycznego przechwytywania przez zaznaczenie myszką** — MVP działa wyłącznie przez ręczne wpisanie słowa/frazy w okienku wtyczki (FR-007); auto-capture przez zaznaczenie (FR-008) to v2.
- **Brak wyboru głosu/akcentu w odtwarzanej wymowie** — jeden domyślny głos/akcent w MVP (FR-016); wybór spośród wielu głosów/akcentów to v2+.

## Open Questions

1. **Mechanizm generowania wydruku (FR-014)** — dedykowany plik generowany po stronie serwera, czy widok tabeli w przeglądarce + druk (Ctrl+P)? Owner: użytkownik / downstream tech-stack-selection. Nierozstrzygnięte świadomie — użytkownik akceptuje dowolne podejście, o ile efekt na kartce jest czytelny i dobrej jakości.
2. **Mechanizm generowania audio wymowy (FR-016)** — przeglądarkowe Web Speech API (darmowe, ale jakość/dostępność głosów zależy od systemu użytkownika) czy płatne API TTS (np. ElevenLabs, Amazon Polly, Google Cloud TTS — wyższa i spójniejsza jakość, ale koszt oraz nowa integracja backendu)? Owner: użytkownik / downstream tech-stack-selection lub `/10x-plan` dla `pronunciation-playback`. Nierozstrzygnięte świadomie — analogicznie do pytania 1.
