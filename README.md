# Beatmap Studio

A Beat Saber map editor that runs in Chrome. Import a song, set its BPM and
offset, map four independent difficulties (Easy, Normal, Hard, Expert), let
the auto-mapper draft them if you want, check the result, and export a map
folder that plays on a modded Quest.

Status: early development. The project dashboard works today; the editor,
auto-mapper, validation and export are being built in stages.

---

## Running it

    npm install
    npm run dev        # http://127.0.0.1:5173
    npm test           # unit tests
    npm run typecheck  # strict TypeScript
    npm run build      # production build in dist/
    npm run smoke      # builds, then clicks through the app in headless Chrome

`npm run smoke` drives the installed Chrome (`/usr/bin/google-chrome`, or set
`CHROME_PATH`) and fails on any page error or failed request. Screenshots go
to `smoke-screens/` (or `SMOKE_SCREENSHOT_DIR`).

---

## Architecture

Everything runs in the browser. There is no server: projects and audio stay
in the browser's IndexedDB on your machine.

| Folder | Responsibility |
|---|---|
| `src/core` | The map model (notes, bombs, walls, arcs, chains, four charts per project) and beat/seconds timing. No browser APIs, fully unit tested. |
| `src/storage` | IndexedDB project store (projects, audio, backups) and the debounced autosaver. |
| `src/audio` | Decoding, waveform, BPM and offset analysis, playback. |
| `src/generator` | The auto-mapper. Builds each difficulty separately from the song analysis, never by thinning Expert. |
| `src/validation` | Checks that report problems as warnings and never change the map on their own. |
| `src/export` | Writes `Info.dat` (v2.1.0) and difficulty files (v3.3.0), encodes the audio to Ogg Vorbis (`.egg`) and zips the folder. |
| `src/quest` | Getting the exported map onto the headset. |
| `src/ui` | React screens. |

### Data model

A project holds the song details, one timing (BPM and offset in seconds) and
four charts, one per difficulty. Every object is placed by beat, not by
time, so changing the BPM or offset moves the whole map with the music.
Grid positions use Beat Saber's lanes: columns 0 to 3 left to right, rows 0
to 2 bottom to top.

### Storage

| Store | Key | Holds |
|---|---|---|
| `projects` | project id | The full project |
| `audio` | project id | The imported song file as bytes |
| `backups` | auto number, indexed by project | Snapshots, newest 20 per project |

Edits autosave 0.8 s after you stop changing things. Restoring a backup
first backs up the current state, so a restore can always be undone.
Deleting a project needs a second click and removes its audio and backups.

### Export format

Chosen from maps that already play on the target Quest: `Info.dat` v2.1.0
with the `Standard` characteristic, and difficulty files in v3.3.0
(`colorNotes`, `bombNotes`, `obstacles`, `sliders`, `burstSliders`).
Exported maps go in
`ModData/com.beatgames.beatsaber/Mods/SongCore/CustomLevels/<folder>/`
on the headset.

---

## Browser support

Chrome or another Chromium browser on desktop. Quest install over USB will
need WebUSB, which only Chromium browsers have.
