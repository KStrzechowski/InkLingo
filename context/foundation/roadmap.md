---
project: "InkLingo"
version: 1
status: draft
created: 2026-07-19
updated: 2026-07-21
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: InkLingo

> Wygenerowano z `context/foundation/prd.md` (v1) + auto-zbadanego stanu bazowego kodu.
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji.
> Slice'y poniżej są w kolejności zależności. Tabela "W skrócie" to indeks.

## Vision recap

Osoba ucząca się języka obcego, natrafiając na nieznane słowo podczas czytania stron WWW, chce je natychmiast zapisać, przetłumaczyć i zrozumieć w kontekście zdania — bez opuszczania tego, co właśnie czyta. Żadne istniejące narzędzie (osobny tłumacz, aplikacja do fiszek) nie łączy przechwytywania słowa jednym kliknięciem, natywnej integracji AI do tłumaczenia i przykładów, zapisu do własnych zbiorów oraz eksportu do materiałów drukowanych w jednym miejscu — to jest luka, którą InkLingo wypełnia.

## North star

**S-03: Użytkownik przechwytuje słowo w wtyczce, dostaje tłumaczenie i zdania od AI, i zapisuje wpis do zbioru** — to dosłownie PRD Success Criteria (Primary): najmniejszy kompletny przepływ, który dowodzi, że "zero-friction capture + AI-native translation" faktycznie działa dla prawdziwego użytkownika.

> "Gwiazda przewodnia" (north star) to najmniejszy kompletny wycinek funkcjonalności, którego udane dostarczenie dowodzi głównej hipotezy produktu — umieszczony tak wcześnie, jak pozwalają na to jego zależności, bo cała reszta roadmapy ma sens tylko wtedy, gdy ten wycinek działa.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | minimal-database | (foundation) minimalny schemat Postgres (users, collections, entries) + narzędzie migracji | — | Access Control, FR-004, FR-005, FR-013 | done |
| S-01 | account-auth | user can zarejestrować konto, zalogować się i wylogować się | — | FR-001, FR-002, FR-003, Access Control | ready |
| S-02 | word-collections | user can ręcznie utworzyć zbiór i przeglądać listę zbiorów wraz z ich zawartością | S-01, F-01 | FR-004, FR-005 | proposed |
| S-03 | capture-translate-save | user can przechwycić słowo/frazę w wtyczce, otrzymać warianty tłumaczenia, transkrypcję fonetyczną i przykładowe zdania od AI (z regeneracją) i zapisać wpis do zbioru | S-01, S-02, F-01 | US-01, FR-006, FR-007, FR-009, FR-010, FR-011, FR-012, FR-013, FR-015, NFR (czas odpowiedzi), NFR (tylko Firefox) | proposed |
| S-04 | printable-export | user can wygenerować czytelny, gotowy do druku dokument A4 dla wybranego zbioru | S-03 | FR-014 | proposed |
| S-05 | pronunciation-playback | user can odtworzyć wymowę (audio) wprowadzanego słowa/frazy oraz wybranego przykładowego zdania | S-03 | FR-016, NFR (odtwarzanie bez zauważalnego opóźnienia) | proposed |

## Streams

Nawigacyjna pomoc — grupuje elementy dzielące ten sam łańcuch zależności. Kanoniczna kolejność nadal wynika z grafu zależności poniżej; ta tabela to proponowana kolejność czytania po równoległych ścieżkach.

| Stream | Theme | Chain | Note |
| --- | --- | --- | --- |
| A | Tożsamość | `S-01` | Samodzielny — nie zależy od żadnego fundamentu; może ruszyć równolegle z F-01. |
| B | Zbiory i dane | `F-01` → `S-02` | Dołącza do Stream A przy `S-02` (potrzebuje i S-01, i F-01). |
| C | Rdzeń przechwytywania | `S-03` → `S-04` | Dołącza do Stream B przy `S-03` — to jest gwiazda przewodnia i jej konsument (eksport). |
| D | Wymowa | `S-03` → `S-05` | Dołącza do Stream C przy `S-03`; równoległa z `S-04` (obie są niezależnymi konsumentami gwiazdy przewodniej). |

## Baseline

Stan bazowy kodu na dzień `2026-07-19` (auto-zbadany + potwierdzony przez użytkownika: "base app z prawie zerem funkcji, ale usługi działają").
Fundamenty poniżej zakładają, że to jest już na miejscu i NIE odtwarzają tego od zera.

- **Frontend:** partial — szkielet Vite+React+TS, logowanie/wylogowanie Cognito już podpięte (`frontend/src/auth/cognito.ts`), ale brak routingu, stron, UI zbiorów i UI przechwytywania poza jednym `App.tsx`.
- **Backend / API:** partial — aplikacja Fastify startuje, autoloaduje pluginy/route'y, klient Neon Postgres podpięty; brak realnych route'ów funkcjonalnych (tylko health/ping).
- **Data:** partial — sterownik Neon serverless zainstalowany i połączony, brak ORM, brak plików schematu/migracji, brak tabel dla users/collections/entries.
- **Auth:** partial — Cognito podpięty tylko po stronie frontendu (redirect login/logout); backend nie weryfikuje żadnych tokenów, brak middleware/guardów auth.
- **Deploy / infra:** present — AWS CDK (4 stacki: Frontend/Auth/Api/GithubOidc), pipeline GitHub Actions z OIDC deployujący do Lambda (backend) + S3/CloudFront (frontend). Brak Dockerfile — architektura serverless, nie kontenerowa.
- **Observability:** absent — tylko domyślny logger Fastify/pino, brak error trackingu/metryk/dashboardów.

## Foundations

### F-01: Minimalny schemat danych (users, collections, entries)

- **Outcome:** (foundation) w bazie Postgres istnieje minimalny schemat i narzędzie migracji dla użytkowników, zbiorów i zapisanych wpisów (słowo/fraza + tłumaczenie + zdanie); żadna logika biznesowa jeszcze go nie używa.
- **Change ID:** minimal-database
- **PRD refs:** Access Control, FR-004, FR-005, FR-013
- **Unlocks:** S-02 (zbiory potrzebują trwałego zapisu), S-03 (wpisy potrzebują tabeli entries), S-04 (eksport czyta z entries)
- **Prerequisites:** — (baseline: sterownik Neon już połączony, brak schematu)
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez tego żadna funkcja nie może trwale zapisać danych — sekwencjonowany najwcześniej, równolegle z S-01, żeby nie blokować startu prac nad kontem.
- **Status:** done

## Slices

### S-01: Konto — rejestracja, logowanie, wylogowanie

- **Outcome:** user can zarejestrować konto (email+hasło lub OAuth), zalogować się i wylogować się z aplikacji.
- **Change ID:** account-auth
- **PRD refs:** FR-001, FR-002, FR-003, Access Control
- **Prerequisites:** — (baseline: Cognito hosted UI już podpięty po stronie frontendu; brakuje weryfikacji tokenu po stronie backendu)
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Prawie każda kolejna funkcja (zbiory, zapis, eksport) wymaga zalogowanego użytkownika — sekwencjonowany jako pierwszy user-facing krok, równolegle z fundamentem danych, żeby nie tworzyć sztucznego opóźnienia.
- **Status:** ready

### S-02: Zbiory — tworzenie i przeglądanie

- **Outcome:** user can ręcznie utworzyć nowy zbiór (folder) oraz przeglądać listę swoich zbiorów i zawartość każdego z nich.
- **Change ID:** word-collections
- **PRD refs:** FR-004, FR-005
- **Prerequisites:** S-01, F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Gwiazda przewodnia (S-03) zapisuje wpisy do zbioru, więc przynajmniej jeden zbiór musi dać się utworzyć i zobaczyć zanim przechwytywanie ma sens — stąd bezpośrednio przed S-03.
- **Status:** proposed (Prerequisites S-01/F-01 jeszcze nie ukończone; brak blokujących niewiadomych)

### S-03: Przechwytywanie + tłumaczenie AI + zapis (gwiazda przewodnia)

- **Outcome:** user can kliknąć ikonę wtyczki, ręcznie wpisać słowo/frazę w pływającym okienku, zobaczyć kilka wariantów tłumaczenia i kilka przykładowych zdań (z możliwością regeneracji), wybrać jedno zdanie i zapisać wpis do wybranego zbioru (domyślnie ostatnio używanego).
- **Change ID:** capture-translate-save
- **PRD refs:** US-01, FR-006, FR-007, FR-009, FR-010, FR-011, FR-012, FR-013, NFR (odpowiedź w poniżej kilku sekund), NFR (tylko najnowszy Firefox)
- **Prerequisites:** S-01, S-02, F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Największy technicznie kawałek MVP — nowa wtyczka do przeglądarki (nie istnieje jeszcze w repo) plus zależność od AI; celowo sekwencjonowany jako pierwsza rzecz zaraz po tym, jak konto i zbiory dają mu na czym stanąć, żeby ryzykowną część zweryfikować jak najwcześniej.
- **Status:** proposed (Prerequisites S-01/S-02/F-01 jeszcze nie ukończone; brak blokujących niewiadomych)

### S-04: Eksport do druku

- **Outcome:** user can wygenerować czytelny, gotowy do druku dokument A4 (czarno-biały, tabela Słowo/Fraza | Tłumaczenie | Zdanie) dla wybranego zbioru.
- **Change ID:** printable-export
- **PRD refs:** FR-014
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Mechanizm generowania wydruku — dedykowany plik generowany po stronie serwera, czy widok tabeli w przeglądarce + druk (Ctrl+P)? Owner: użytkownik / downstream `/10x-plan`. Block: no (PRD celowo zostawia to otwarte — akceptowalne jest dowolne podejście, o ile efekt jest czytelny).
- **Risk:** Eksport ma sens dopiero, gdy istnieją zapisane wpisy — stąd na końcu, jako konsument tego, co dostarcza S-03.
- **Status:** proposed (Prerequisite S-03 jeszcze nie ukończony; Unknown powyżej nie blokuje planowania)

### S-05: Odtwarzanie wymowy

- **Outcome:** user can odtworzyć wymowę (audio) wprowadzanego w wtyczce słowa/frazy oraz wybranego przykładowego zdania.
- **Change ID:** pronunciation-playback
- **PRD refs:** FR-016, NFR (odtwarzanie bez zauważalnego opóźnienia)
- **Prerequisites:** S-03 (potrzebuje słowa/frazy i wybranego zdania już widocznych w okienku wtyczki)
- **Parallel with:** S-04 (obie są niezależnymi konsumentami S-03; żadna nie blokuje drugiej)
- **Blockers:** —
- **Unknowns:**
  - Mechanizm generowania audio — przeglądarkowe Web Speech API (darmowe, jakość zależna od systemu użytkownika) czy płatne API TTS (wyższa/spójniejsza jakość, koszt + integracja backendu)? Owner: użytkownik / downstream `/10x-plan`. Block: no (analogicznie do S-04, akceptowalne jest dowolne podejście na start).
- **Risk:** Nowa techniczna zależność (silnik TTS) dodana po ustaleniu reszty MVP — sekwencjonowana równolegle z eksportem, żeby nie wydłużać ścieżki krytycznej do north star.
- **Status:** proposed (Prerequisite S-03 jeszcze nie ukończony; Unknown powyżej nie blokuje planowania)

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes | Jira Epic | Jira Subtasks |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | minimal-database | Minimalny schemat danych: users, collections, entries | done | Zarchiwizowane — `context/archive/2026-07-20-minimal-database/` | [IL-1](https://kondi827.atlassian.net/browse/IL-1) | IL-6, IL-7, IL-8 |
| S-01 | account-auth | Konto: rejestracja, logowanie, wylogowanie | yes | Uruchom `/10x-plan account-auth` | [IL-2](https://kondi827.atlassian.net/browse/IL-2) | IL-9, IL-10, IL-11 |
| S-02 | word-collections | Zbiory: tworzenie i przeglądanie | no | Czeka na S-01 i F-01 | [IL-3](https://kondi827.atlassian.net/browse/IL-3) | IL-12, IL-13, IL-14 |
| S-03 | capture-translate-save | Przechwytywanie słowa + tłumaczenie AI + zapis (gwiazda przewodnia) | no | Czeka na S-01, S-02, F-01 | [IL-4](https://kondi827.atlassian.net/browse/IL-4) | IL-15, IL-16, IL-17, IL-18 |
| S-04 | printable-export | Eksport zbioru do druku A4 | no | Czeka na S-03 | [IL-5](https://kondi827.atlassian.net/browse/IL-5) | IL-19, IL-20 |
| S-05 | pronunciation-playback | Odtwarzanie wymowy słowa/frazy/zdania | no | Czeka na S-03 | [IL-21](https://kondi827.atlassian.net/browse/IL-21) | IL-22, IL-23 |

Jira project: **IL** (InkLingo), site `kondi827.atlassian.net`. Epic priorities: F-01/S-01 = Highest, S-02/S-03 = High, S-04/S-05 = Medium (mirrors roadmap dependency order, not business weight — S-03 is the north star but is sequenced after S-02; S-04 and S-05 sit at the same readiness tier, both blocked only by S-03).

## Open Roadmap Questions

1. **Mechanizm generowania wydruku (FR-014)** — dedykowany plik generowany po stronie serwera, czy widok tabeli w przeglądarce + druk (Ctrl+P)? Owner: użytkownik / downstream `/10x-plan`. Block: S-04 (nieblokujące — PRD świadomo zostawia to otwarte, akceptowalne jest dowolne podejście, o ile wydruk jest czytelny i dobrej jakości).
2. **Mechanizm generowania audio wymowy (FR-016)** — przeglądarkowe Web Speech API czy płatne API TTS? Owner: użytkownik / downstream `/10x-plan`. Block: S-05 (nieblokujące — analogicznie do pytania 1).

## Parked

- **FR-008 — automatyczne przechwytywanie przez zaznaczenie myszką** — Why parked: PRD odkłada to jawnie na v2 (najbardziej złożona technicznie część wtyczki — content script + Selection API); MVP działa wyłącznie przez ręczne wpisanie słowa (FR-007, w S-03).
- **System fiszek/powtórek (SRS)** — Why parked: PRD Non-Goals — zapowiedziana funkcja v2+, MVP kończy się na eksporcie do druku.
- **Aplikacja mobilna** — Why parked: PRD Non-Goals — tylko web app + wtyczka do przeglądarki w MVP.
- **Zaawansowane szablony graficzne do druku** — Why parked: PRD Non-Goals — jeden prosty czarno-biały układ tabeli w MVP.
- **Dzielone/publiczne notatki dla grup znajomych** — Why parked: PRD Non-Goals — funkcja społecznościowa to przyszłość, nie MVP.
- **Obsługa PDF-ów otwartych w przeglądarce w wtyczce** — Why parked: PRD Non-Goals — MVP działa tylko na zwykłych stronach WWW.

## Done

- **F-01: (foundation) minimalny schemat Postgres (users, collections, entries) + narzędzie migracji** — Archived 2026-07-21 → `context/archive/2026-07-20-minimal-database/`. Lesson: roadmap's Change ID was generated as `core-data-schema` but the change was actually created as `minimal-database` (`/10x-new` wasn't given the roadmap's suggested slug) — fixed here to match; worth double-checking the suggested Change ID is actually used when running `/10x-new` off a roadmap row.
