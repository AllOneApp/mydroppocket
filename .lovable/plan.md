# MyDropPocket AI häälassistendi plaan

Suur ettepanek — jagan etappideks. Palun kinnita, milliseid etappe kohe teha (soovitan kõiki järjekorras 1→5).

## 1. Ühtne AI mikrofoni komponent (alus kõigele)
- Uus `src/components/VoiceInput.tsx` — kasutab brauseri `MediaRecorder` + Lovable AI STT (`openai/gpt-4o-mini-transcribe`) → tagastab teksti.
- Uus server function `src/lib/voice.functions.ts`:
  - `transcribeAudio` — võtab base64 audio, tagastab teksti.
  - `parseVoiceCommand` — võtab teksti + konteksti ("expense" | "income" | "search" | "document" | "warranty" | "agreement") ja tagastab AI-ga (`google/gemini-3-flash-preview`, structured output) parsitud struktuuri.
- Nupp modulaarne: `<VoiceInput context="expense" onResult={(data) => setForm(data)} />`.
- Lisan ta: Expenses, Warranties, Agreements, Search, FileDrop dialoogidesse.

## 2. Kulud → "Tulud ja kulud"
- Migratsioon: lisan `expenses` tabelisse veeru `type text not null default 'expense'` (`'expense' | 'income'`).
- Lisan kategooriad: Palk, Müük, Muu tulu, Kingitus, Investeering.
- Vormis lisan Tüüp vahetaja (Kulu/Tulu). Nimetan mooduli i18n-is ümber "Tulud ja kulud".
- Sidebar/nav: "Kulud" → "Tulud ja kulud", route jääb `/expenses` (URL katkestuste vältimiseks).

## 3. Kuupäevafiltrid + saldo
- Uus komponent `DateRangeFilter.tsx`: presetid (Täna, Eile, See/eelmine nädal/kuu/aasta) + Kohandatud (2 kuupäeva).
- Expenses lehel: filtrite riba + kokkuvõtte kaardid: Tulud / Kulud / Saldo valitud perioodil.
- Dashboardil: kaardid Täna/Nädal/Kuu/Aasta — igas tulud, kulud, saldo.

## 4. AI otsing
- Search lehele mikrofon + AI parser tagastab `{ module, filters: { store?, category?, dateRange?, type? } }` → päring kõigi tabelite peale.

## 5. Dokumendi AI linkimine + harjumuste õpe
- Dokumendi lisamisel: kui kasutaja räägib, AI otsib olemasolevatest kirjetest (warranty/expense/agreement) sobivaimad ja pakub linkimist (uus tabel `document_links` või lisan `related_id` olemasolevatesse).
- Harjumused: pärast salvestamist kirjutan `store→category` seosed `profiles.preferences` jsonb-veergu; järgmisel korral eeltäidetakse.

## Tehnilised detailid
- STT: `openai/gpt-4o-mini-transcribe` (Lovable AI Gateway).
- Parser: `google/gemini-3-flash-preview` structured output-iga, keel = kasutaja i18n keel (et/en).
- AI ei salvesta automaatselt — täidab vaid vormi, kasutaja kinnitab.
- Kõik server functions `requireSupabaseAuth` all.

## Küsimused enne kodeerimist
1. Kas alustan **kõigist 5 etapist järjest** ühe suure PR-ina, või teeme etapp-haaval (soovitan **etapp 1+2+3 kohe**, siis 4, siis 5)?
2. Uute tuluokategooriate loetelu OK (Palk, Müük, Muu tulu, Kingitus, Investeering)?
3. Kas mikrofoni nupp peaks olema **eraldi nupp vormis** või **hõljuv nupp (FAB) igal moodulilehel**, mis avab dialoogi?
