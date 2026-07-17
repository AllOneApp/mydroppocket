
## Eesmärk
Iga profiil saab kasutada kas põhikonto Google Drive'i (üks Drive, alamkaustad profiilide järgi) või ühendada oma eraldi Google konto. Olemasolevad kasutajad ei märka muudatust.

## 1. Andmemudel

**Migratsioon:**
- `user_profiles` → uus veerg `drive_mode text not null default 'shared'` (`'shared' | 'separate'`).
- `google_drive_connections` → uus veerg `profile_id uuid null references user_profiles(id) on delete cascade`.
  - Uus unikaalne indeks `(user_id) where profile_id is null` (üks põhikonto).
  - Uus unikaalne indeks `(user_id, profile_id) where profile_id is not null` (üks eraldi ühendus profiili kohta).
  - Vana `user_id_key` unique piirang eemaldatakse.
- Uus tabel `google_drive_folders`:
  - `connection_id uuid` (FK), `profile_id uuid null` (FK), `category text`, `folder_id text`, `folder_name text`.
  - Unique `(connection_id, coalesce(profile_id, '00000000-…'), category)`.
  - Ehk konkreetne kaust ühe ühenduse + profiili konteksti + kategooria kohta.

**Migreeritakse taustal olemasolevad `subfolders_json` väärtused** uude tabelisse `profile_id = null` all (need on täna kõik "MyDropPocket/{kategooria}" all põhikontos).

## 2. Kaustaresolver (üks funktsioon kõigile moodulitele)

Uus `resolveProfileDriveTarget(userId, profileId, category)` (`google-drive.server.ts`):
1. Loeb profiili + selle `drive_mode`.
2. Kui `separate` → laeb selle profiili `google_drive_connections` rea; kui puudub, tagastab „not connected" (üleslaadimine läheb vahele nagu praegu, kui Drive ühendumata).
3. Kui `shared` → laeb kasutaja põhikonto rea (`profile_id is null`).
4. Loob/leiab kausta hierarhia vastavalt režiimile:
   - `shared`: `MyDropPocket / {profiili nimi} / {kategooria}`
   - `separate`: `MyDropPocket / {kategooria}`
5. Kirjutab folder id-d `google_drive_folders` tabelisse cache'iks. Uute kategooriate lisamine tulevikus = ainult üks uus rida, koodimuudatust ei vaja.

Kõik olemasolevad üleslaadimispunktid (`agreements.tsx`, `warranties.tsx`, `expenses.tsx`, `recurring.tsx` serveri poolel + `google-drive.functions.ts`) kasutavad seda uut resolverit `(getValidAccessTokenForUser + ensureSubfolderId)` asemel. Praegune `FOLDER_KEY_TO_NAME` mapping säilib kategooria nimede allikana.

## 3. OAuth voog profiili jaoks

- `signState` payload'ile lisatakse `profileId?: string` ja `mode: 'primary' | 'separate'`.
- `startDriveConnect` serveri fn saab uue parameetri `profileId?: string`. Kui antud + režiim `separate`, alustatakse OAuth voogu selle profiili jaoks. Muidu tavaline põhikonto ühendus.
- Callback (`/api/public/google-drive/callback`) loeb state'ist `profileId` ja salvestab tokenid `google_drive_connections` reale, kus `profile_id = <uuid>` (või `null` põhikonto puhul).
- Peale eraldi ühenduse loomist: automaatselt luuakse `MyDropPocket / {kategooriad}` sellesse Drive'i (ilma profiili alamkaustata).

## 4. Profiili ümbernimetamine (kaust automaatselt kaasa)

Kui kasutaja nimetab profiili ümber (`user_profiles.name` muutub) JA profiili `drive_mode = 'shared'`:
- Rakendus üritab põhikonto Drive'is kaust ümber nimetada uue nimega.
- Enne ümbernimetamist Drive'is otsitakse, kas uue nimega kaust juba eksisteerib põhikausta `MyDropPocket` all:
  - Kui **jah** → ei tehta midagi automaatselt; kasutajale kuvatakse hoiatus („Kaustanimega X on Drive'is juba olemas — palun vali teine nimi või lahenda käsitsi"). Profiili nimi jääb muutmata (tehingutehe SQL-tasemel tagasi ei võeta, aga eelvalideerime kliendi poolel enne salvestamist).
  - Kui **ei** → Drive API `files.update` (name), + uuendame `google_drive_folders.folder_name` ridu selle profiili all.

Eraldi Drive'i režiimis pole profiili alamkausta, seega ümbernimetamisel Drive'is midagi ei muudata.

## 5. Ühekordne migreerimine olemasolevatele kasutajatele

Uus staatuse päring `checkLegacyDriveLayout()`:
- Kui kasutajal on `google_drive_connections` (põhikonto) ja Drive juurkaustas „MyDropPocket" on kaustad „Garantiid" / „Lepingud" / „Tulud ja kulud" otse (ilma profiili alamkaustata) JA kasutajal on ainult vaikeprofiil („Isiklik") ilma andmeid teistes profiilides → näita bänner/dialoog:
  - „MyDropPocketi kaustastruktuur on uuendatud… Tõsta olemasolevad dokumendid automaatselt MyDropPocket/Isiklik alla?" Nupud: „Jah, tõsta automaatselt" / „Hiljem".
- „Jah" → serveri fn `migrateLegacyDriveToProfile` liigutab kolm kausta uue „Isiklik" alamkausta alla (Drive'i `files.update` parents).
- „Hiljem" → salvestatakse dismiss timestamp `profiles.legacy_drive_migration_dismissed_at` veergu; dialoog ilmub uuesti järgmisel sisselogimisel/seadete avamisel.
- „Tehtud" → salvestatakse `legacy_drive_migration_done_at`; dialoog enam ei ilmu.

Seni kuni migreerimist ei ole tehtud, salvestatakse uued failid juba KOHE uude „Isiklik / {kategooria}" struktuuri (vana struktuur ei sega — resolver töötab uue reegli järgi juhul, kui profiili alamkaust on olemas või puudub loob selle). See tähendab, et kasutaja saab „Hiljem" valida ilma andmete kadumiseta.

## 6. Seadete UI

Iga profiili kaardile lisandub `Profiilid` lehel sektsioon **Google Drive**:
- Kaks raadionuppu:
  - `✅ Kasuta põhiprofiili Google Drive'i` (vaikimisi)
  - `⭕ Ühenda teine Google Drive` — vajutamisel avaneb OAuth vooluke selle profiili jaoks
- Kui ühendatud (eraldi režiimis): kuva „🟢 Ühendatud – nimi@gmail.com", „Salvestuskoht: MyDropPocket", nupp „Katkesta ühendus".
- Jagatud režiimis kuva „Salvestuskoht: MyDropPocket / {profiili nimi}" ja lühiselgitus.
- Põhiprofiili kaardil (`is_default = true`) valikut ei kuvata — see on alati kasutaja põhi-Drive.

## 7. Ei muudeta

- AI OCR / automaattäitmine.
- Dashboard, Ülevaate, järelmaksude arvutus.
- Google Calendar integratsioon (järgmine etapp).
- Failide üleslaadimise dialoogide UX (ainult tagataust vahetub).

## Tehnilised muudetavad failid

**Andmebaas:** 1 migratsioon (uued veerud + tabel + backfill `google_drive_folders`).

**Server:**
- `src/lib/google-drive.server.ts` – uus `resolveProfileDriveTarget`, `renameProfileFolder`, `detectLegacyLayout`, `migrateLegacyDriveToProfile`; state'i laiendus.
- `src/lib/google-drive.functions.ts` – `startDriveConnect(profileId?)`, `disconnectDrive(profileId?)`, uus `getProfileDriveStatus`.
- `src/routes/api/public/google-drive/callback.ts` – kirjuta rida õige `profile_id`-ga.
- Iga mooduli salvestusloogika (`agreements.tsx`, `warranties.tsx`, `expenses.tsx`, `recurring.tsx`) – asendada olemasolev Drive-üleslaadimise helper üleskutsega, mis läbib profiili resolveri (mitte üks-ühele ümber kirjutades, ainult sisemine `ensureSubfolderId` osa).

**Klient:**
- `src/routes/_authenticated/profiles.tsx` – uus Google Drive sektsioon.
- Uus `LegacyDriveMigrationDialog` komponent, mis kuvab AppShellis pärast sisselogimist ainult kui `checkLegacyDriveLayout` ütleb, et bänner on vajalik.
- `i18n/locales/et.json` + `en.json` uued võtmed.

## Testimisplaan

1. Uus kasutaja loob profiili „Ema" → drive_mode = shared → lisab garantii → Drive: `MyDropPocket / Ema / Garantiid / <fail>`.
2. Profiil „Ettevõte" → valib „Ühenda teine Google Drive" → OAuth teise kontoga → lisab kulukande → uue konto Drive: `MyDropPocket / Tulud ja kulud / <fail>`.
3. Nimeta „Ema" → „Ema Mari" (shared) → Drive'is kaust nimetatakse ümber. Kui juba olemas → hoiatus kuvatakse, muudatust ei tehta.
4. Olemasolev kasutaja (ainult „Isiklik" + faile põhikaustas): näeb üks kord bännerit; „Jah" → kolm kausta liiguvad `MyDropPocket / Isiklik /` alla. „Hiljem" → uued failid juba lähevad õigesse alamkausta, vanad jäävad.
5. Aktiivse profiili vahetamine → järgmine üleslaadimine läheb 100% õigesse profiili kausta, ei kunagi valesse.
