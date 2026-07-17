# AI Assistant — Dashboard

Ehitan uue Dashboard kaardi 🤖 **AI Assistant**, mis mõistab loomulikku keelt ja otsib kõigist aktiivse profiili moodulitest.

## Arhitektuur

**Server-side (loomuliku keele → struktureeritud päring):**

- Uus fail `src/lib/ai-assistant.functions.ts` — `askAssistant` server function (`requireSupabaseAuth`).
- Loomuliku keele küsimus → AI SDK `generateText` + `Output.object` schema, mis liigitab päringu:
  - `intents`: massiiv `warranties | expenses | income | agreements | installments | recurring`
  - `filters`: `{ brand?, store?, category?, minAmount?, maxAmount?, dateFrom?, dateTo?, expiringInDays?, activeOnly? }`
  - `aggregation`: `list | sum | count`
  - `summaryPrompt`: lühike vastus kasutajale (eesti/inglise, sama keel kui küsimus)
- Mudel: `google/gemini-3.5-flash` (kiire, odav, tugev EE keel).
- Pärast klassifikatsiooni: käivitab Supabase päringud `context.supabase` kaudu (RLS + `profile_id` filter), rakendab filtreid, tagastab strukturaalse `AssistantResult`:
  ```
  { answer: string, groups: [{ kind, items: [{id, title, subtitle, date, amount, currency, meta, filePath, calendarLink?}] }], stats?: {total?, count?} }
  ```

**Modulaarne otsingu registry:**
`src/lib/ai-assistant.server.ts` ekspordib `MODULE_SEARCHERS: Record<Intent, Searcher>`. Iga searcher on funktsioon `(supabase, profileId, filters) => Item[]`. Uue mooduli lisamine = üks kirje registri. Kasutan olemasolevaid tabeleid (`warranties`, `expenses`, `agreements`, `installments`, `recurring_payments`).

Google Drive/Calendar: kasutan olemasolevaid seoseid (`gdrive_file_id`, `calendar_events` joined) tulemustele — mitte täisotsingu jaoks selles etapis, vaid tegevuste jaoks.

**Klient (`src/components/AiAssistantCard.tsx`):**

- Kaart Dashboardil kohe kiirtoimingute all.
- Struktuur: ikoon + textarea + saada nupp + `VoiceInput` (mikrofon).
- Enter = saada, Shift+Enter = uus rida.
- Autocomplete: hardcoded soovituste massiiv i18n-ist, filtreeritud kirjutamise ajal (`starts-with`/`includes`).
- `useMutation` kutsub `askAssistant` server fn'i koos `activeProfileId`-ga.
- Laadimisanimatsioon (`Shimmer`-laadne pulseeriv tekst).
- Vastus: `answer` tekstina + `groups` kaartide grid'ina (`ResultCard` komponent).
- `ResultCard`: pealkiri, alapealkiri, kuupäev, summa, badge (garantii kehtiv jne), tegevusnupud (Ava dokument → `signedUrl`, Ava Drive'is → `gdrive_file_id` link, Ava moodulis → `navigate`).
- Häälsisestus: `VoiceInput` context `"search"` (olemas), tagastab transkribeeritud teksti → paneb textarea'sse ja saadab.

**Profiilid:**

- `activeProfileId` `useActiveProfile` hookist saadetakse iga päringuga.
- Server fn valideerib `profile_id` kuulub kasutajale, filtreerib kõik SELECT'id `.eq("profile_id", profileId)`.
- Profiili vahetusel: query cache võti `["ai-assistant", profileId, question]` — vahetamine tühistab automaatselt (juba invalidateeritakse `PROFILE_SCOPED_KEYS`-is, lisan `"ai-assistant"`).

## Failid

**Uued:**

- `src/lib/ai-assistant.server.ts` — searchers registry, tüübid, filterite rakendamine.
- `src/lib/ai-assistant.functions.ts` — `askAssistant` server fn, AI klassifikatsioon + päring.
- `src/components/AiAssistantCard.tsx` — UI kaart.
- `src/components/AiAssistantResultCard.tsx` — üksiku tulemuse kaart.

**Muudetud:**

- `src/routes/_authenticated/dashboard.tsx` — sisesta `<AiAssistantCard />` kiirtoimingute all.
- `src/i18n/locales/{et,en}.json` — placeholder, nupud, soovitused, tegevused.
- `src/hooks/useActiveProfile.tsx` — lisa `["ai-assistant"]` `PROFILE_SCOPED_KEYS`-i.

## Tehnilised detailid

- AI kutse: `createLovableAiGatewayProvider(process.env.LOVABLE_API_KEY)` (juba kasutuses projektis, vt `ai-gateway.server.ts`).
- Schema constraint-free (i18n.json juhises): väljad nullable, ei `.min()/.max()`, `NoObjectGeneratedError` fallback.
- Kuupäeva parsing: mudelile juhis "eelmine kuu" jne → ISO kuupäevad.
- Tulemuste piiranguga (max 50 iga moodul), summa/count agregeeritud DB-s.
- Ei muuda olemasolevat OCR/AI täitmist ega Drive/Calendar sünkri.

## Ulatus (mis EI ole selles etapis)

- Ei implementeeri Drive-i failide sisu otsingut (ainult failide viide olemasolevate kirjete kaudu).
- Ei genereeri PDF-i (nupp Prindi PDF viitab olemasolevale voogudele kui olemas, muidu peida).
- Autocomplete on staatiline soovituste komplekt (ei kutsu AI-d iga klahvivajutuse peale).1. AI võiks "mäletada" vestlust (kõige olulisem)
  Praegu tundub plaan selline, et iga küsimus on täiesti uus.
  Mina tahaksin, et AI Assistant käituks nagu vestlus.
  Näiteks:
  **Kasutaja:**
  > Leia minu Puma tossude tšekk.
  **AI:**
  > Leidsin 2 Puma ostu...
  Seejärel kasutaja kirjutab:
  > Aga millisel neist garantii enne lõppeb?
  AI peab aru saama, et jutt käib **eelmises vastuses leitud Puma ostudest**, mitte alustama otsingut nullist.
  Samuti:
  > Näita selle ostu PDF-i.
  või
  > Ava see Google Drive'is.
  See teeb kasutuskogemuse kordades loomulikumaks.
  ---
  ## 2. AI võiks ise soovitada järgmisi küsimusi
  Pärast vastust võiks all olla väikesed soovitusnupud.
  Näiteks pärast:
  > Leidsin sinu Boschi trelli.
  AI pakub:
  - 📄 Näita garantiid
  - ☁️ Ava Google Drive'is
  - 📅 Näita meeldetuletusi
  - 🧾 Näita seotud kulusid
  See vähendab kirjutamist.
  ---
  ## 3. AI võiks öelda ka siis, kui midagi ei leia
  Praegu ei ole seda mainitud.
  Näiteks:
  > Ma ei leidnud ühtegi Puma ostu.
  Selle asemel võiks AI kirjutada:
  > Ma ei leidnud ühtegi Puma toodet aktiivsest profiilist.
  >
  > Võib-olla proovi:
  >
  > - "Nike"
  > - "Sportland"
  > - "2026"
  See jätab palju parema mulje.
  ---
  ## 4. AI võiks parandada kirjavigu
  Näiteks inimene kirjutab:
  > purma tossud
  või
  > eronics
  AI peaks ikkagi aru saama.
  See on AI üks suur eelis võrreldes tavalise otsinguga.
  ---
  ## 5. AI võiks mõista sünonüüme
  Näiteks kõik need peaksid andma sama tulemuse:
  - tšekk
  - ostutšekk
  - ost
  - arve
  - dokument
  Samamoodi:
  - telefon
  - mobiil
  - nutitelefon
  - garantii
  - garantiiaeg
  - garantii lõpp
  See muudab AI palju targemaks.
  ---
  ## 6. AI võiks olla veidi proaktiivne
  Kui kasutaja küsib:
  > Kas mul on Boschi trelli garantii?
  AI võiks vastata:
  > Jah, garantii kehtib veel 1 aasta ja 2 kuud.
  >
  > Muide, sul on veel kaks Boschi toodet:
  >
  > - Akutrell
  > - Muruniiduk
  See lisab väärtust ilma, et kasutaja peaks uuesti küsima.
  ---
  # Üks asi, mille ma veel lisaksin (ja mis võib saada MyDropPocketi tunnusfunktsiooniks)
  Seda ei ole plaanis üldse.
  ### 🧠 "AI soovitused" Dashboardil
  Lisaks AI Assistantile võiks olla väike kaart:
  **🤖 AI soovitab**
  Näiteks:
  - ⚠️ Sinu Boschi garantii lõpeb 12 päeva pärast.
  - 💰 Eelmisel kuul kulutasid autole 286 € rohkem kui tavaliselt.
  - 📄 Sul on 3 dokumenti, millel puudub kategooria.
  - ☁️ 2 uut dokumenti pole veel Google Drive'i sünkroonitud.
  Need ei pea tulema kasutaja küsimuse peale – AI saab neid ise märgata.
  See muudaks rakenduse passiivsest hoidlast aktiivseks abiliseks.Täiendus – AI Assistanti privaatsus ja andmekaitse
  ## Eesmärk
  MyDropPocket on privaatne dokumentide haldamise rakendus.
  Soovin, et kogu AI Assistanti töö vastaks põhimõttele:
  > **Kasutaja andmed kuuluvad ainult kasutajale ning neid ei kasutata kunagi AI treenimiseks ega avalikuks jagamiseks.**
  See peab kehtima kogu AI Assistanti ning kõikide olemasolevate ja tulevaste AI funktsioonide kohta.
  ---
  # Privaatsuse põhimõtted
  AI Assistant võib kasutada ainult aktiivse kasutaja profiili andmeid.
  AI ei tohi:
  - salvestada kasutaja küsimusi avalikku andmebaasi;
  - kasutada kasutaja dokumente AI mudelite treenimiseks;
  - jagada kasutaja andmeid teiste kasutajatega;
  - kasutada ühe kasutaja dokumente teise kasutaja vastuste koostamisel;
  - salvestada dokumentide sisu väljapoole MyDropPocketi süsteemi.
  Kõik päringud peavad olema seotud ainult selle kasutaja ja aktiivse profiiliga.
  ---
  # AI päringud
  Kui kasutaja küsib näiteks:
  > "Leia minu Puma tossude tšekk."
  või
  > "Kas Boschi trellil on garantii?"
  või
  > "Kui palju kulutasin eelmisel kuul?"
  siis:
  AI võib kasutada ainult MyDropPocketis oleva kasutaja enda infot.
  AI ei tohi kasutada internetti ega väliseid allikaid nendele küsimustele vastamiseks.
  ---
  # Dokumentide sisu
  Kõik:
  - tšekid
  - garantiid
  - lepingud
  - kulud
  - tulud
  - märkmed
  - Google Drive'i failid
  - Google Calendariga seotud andmed
  on rangelt privaatsed.
  Need jäävad ainult kasutaja MyDropPocketi kontole.
  ---
  # AI mudel
  Kui kasutatakse Gemini või mõnda muud AI mudelit, tuleb kasutada ainult sellist API kasutusviisi, kus:
  - kasutaja päringuid ei kasutata mudelite treenimiseks;
  - kasutaja dokumente ei salvestata AI teenuse püsivasse mällu;
  - AI töötleb päringut ainult vastuse genereerimiseks;
  - pärast vastuse tagastamist ei jää kasutaja sisu AI teenuse püsivaks osaks.
  Kasuta AI teenuse pakkuja privaatsus- ja andmekaitse võimalusi (API-režiim), mitte avalikku vestlusliidest.
  ---
  # Turvalisus
  Kõik AI päringud peavad toimuma ainult serveri kaudu.
  Dokumentide sisu ei tohi töödelda otse kliendipoolelt.
  Kõik andmepäringud peavad järgima olemasolevat autentimist, RLS (Row Level Security) reegleid ning aktiivset profiili (`activeProfileId`).
  ---
  # Profiilide eraldatus
  Kui kasutajal on mitu profiili:
  - AI võib kasutada ainult aktiivse profiili dokumente;
  - AI ei tohi kunagi segada erinevate profiilide andmeid;
  - AI ei tohi kunagi näidata teise profiili dokumente.
  ---
  # Tulevikukindel põhimõte
  Kõik tulevased AI funktsioonid peavad järgima täpselt samu privaatsusreegleid.
  See hõlmab näiteks:
  - AI Assistantit;
  - AI OCR-i;
  - automaatset dokumentide täitmist;
  - tulevasi AI analüüse;
  - AI soovitusi;
  - AI vestlusi.
  Kõik need peavad olema täielikult privaatsed.
  ---
  # Kasutajale nähtav info
  Soovin lisada AI Assistanti alla väikese usaldust suurendava teate:
  🔒 **Sinu küsimused ja dokumendid jäävad privaatseks. AI kasutab ainult sinu MyDropPocketi andmeid ning neid ei kasutata AI mudelite treenimiseks ega jagata kolmandatele osapooltele.**
  ---
  ## Eesmärk
  Soovin, et MyDropPocket oleks kasutajate jaoks usaldusväärne AI dokumentide assistent, kus kogu AI töötab ainult kasutaja enda andmetega, järgib täielikku privaatsust ning säilitab andmete konfidentsiaalsuse kogu süsteemis.