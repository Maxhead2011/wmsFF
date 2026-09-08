# LOGOFF DURAK — playable singleplayer prototype

## Public release workflow — 2026-09-08

This section supersedes historical branch/publication notes below. Release branch:
`feature/durak-site-release`, created from `publish/main` with user approval. Only
`games/durak` is included; no WMS code, databases, applications or containers are deployed.

- Browser artifact: `node web/build.mjs`. For the Windows download, pass a fresh
  output directory under `build/` and the real packaged ZIP as the second argument.
- Windows: run `Package-Durak.ps1` in the asset-equipped development checkout,
  smoke-test the standalone executable, then run
  `python deploy/windows_archive.py <cooked-client-folder> <new-output.zip>`.
  Do not use `tar ... .`: its `./` ZIP root is hidden by Windows Explorer, even
  when CRC and SHA-256 checks pass. Test the archive with Windows Shell and
  `Expand-Archive`, and repeat against the actual public download.
  An Unreal Editor executable is not a distributable client.
- `python deploy/test_publish.py` validates the isolated Nginx route and public-file
  allowlist. `python deploy/publish.py build/site` is a read-only deployment check.
  Authentication is supplied through `DURAK_SSH_PASSWORD`, never in files or Git.
- Publication requires `--publish --review <approved PR URL>`. It uploads to a
  unique `/var/www/logoff-durak/releases/` directory, verifies SHA-256 checksums,
  atomically switches `current`, validates Nginx and reloads its configuration.
  Existing WMS proxy routes are preserved; no container restart is performed.
- The deployment report records the previous symlink and Nginx backup. Activation
  failures restore them automatically. Keep these backups for operator rollback.
- QA: run `web/qa.mjs` with Playwright; `DURAK_QA_URL` selects the tested URL.
  It checks three viewport sizes, playable cards, bot moves, restart and download
  headers. No screenshot baseline, complete accessibility audit or FPS guarantee
  is implied. Native tests require the licensed local asset packs; two JS art
  tests additionally require generated `art/output/heroes` from the art pipeline.

The browser game is single-player with three rule variants, not an Unreal browser
renderer. Multiplayer is not implemented. Native choreography remains a prototype.
The page advertises a Windows download only when its actual archive is included in
`release.json`; an absent download must never be presented as published.

Isolated game project. No WMS imports, credentials, endpoints, database access or deployment changes.

## Current scope

- Local UE 5.8 Windows **playable human-versus-bot card match**. This is now the default launch screen.
- Full 36-card deal, lowest-trump opening, attack/defense, pickup, throw-in, refill, discard and win/loss/draw.
- Simple (no throw-in), throw-in and transfer modes; choose a mode through **New game**. Six-card cap also respects the defender's starting hand.
- Click a card in your hand to play. During defense select the uncovered table card first when several are present. Legal cards are highlighted. Take / Beaten / Finish turn / Transfer buttons follow the current state.
- **Combat is OFF by default** because the choreography is rough. It is cosmetic, starts only after a legal committed defense with a face card, and can be skipped by button or Space. Skipping never changes the cards.
- Contact pass: two-bone arms/legs, shared blade/shield hit positions, shield preparation and recoil, planted feet during exchanges, a kneeling defeat and contact-driven brick break. This remains procedural prototype animation, not motion capture.
- Default launch is a normal **1280×720 resizable window**, with OS title bar, minimize/maximize and automatic centering. No `ForceRes`. `./Launch-Durak.ps1 -Resolution 2K` requests 2560×1440 explicitly; `-Resolution FHD` requests 1920×1080. UE/Windows can constrain oversized requests. Scene percentage remains 100 and dynamic resolution is disabled. `-Showcase` opens the separate combat preview; omit it to play cards.
- Escape opens/closes the new-game menu; Exit closes the game.
- Optional legacy showcase via explicit `-DuelShowcase`:
- Five legal card pairs; physical 3D figures with articulated arms, legs, shields and swords.
- Arrival, approach, two attacks, parries, counterattack, finishing strike and defeat.
- Ten-card barrier contains ten separate bricks. Trump jack defeats a non-trump ace, with red lighting.
- Original Blender crown/sword source generator and `.blend` output. Jack-versus-Queen has a separate segmented plate-armor library with shaped breastplates, layered pauldrons, closed helmets, pleated capes, heater shields and hand/foot plates. Other pairs retain primitive placeholder armor. These are stylized hard-surface characters, **not photorealistic humans or a finished skeletal rig**.
- In showcase only, buttons 1–5 / mouse choose a scene; R replays; Space pauses; Escape exits.
- The JS reducer is an independently tested future server rule/transaction contract. It is **not yet networked to UE**. The match uses `FCardMatch` and the shared C++ legal-defense predicate.

Not implemented yet: multiplayer transport/authentication, Windows redistributable installer, website publication, final characters/mocap and production sound design. The hero pair has original short procedural swing, clash, impact and resolution sounds. Rendering is still a prototype and is heavy on this laptop's integrated GPU. No million-dollar quality claim is made by this prototype.

## Build

Engine: `C:\Program Files\Epic Games\UE_5.8` (5.8.2). Requires C++ Build Tools, Windows SDK and .NET Framework 4.8 SDK.

1. Run Blender in background with `--python art/create_props.py`.
2. Build `DurakArenaEditor Win64 Development` with UE `Engine/Build/BatchFiles/Build.bat`, passing the absolute `.uproject` path. Use `-MaxParallelActions=2 -NoUBA` on the development laptop.
3. Run `UnrealEditor-Cmd.exe <project> -run=pythonscript -script=<absolute art/build_unreal_assets.py> -unattended -nullrhi` to generate materials, import props and save the empty map.
4. Run `Launch-Durak.ps1`. This development preview still needs UE installed; it is not the distributable game.

Tests: existing repository Vitest runs `core/combat.test.mjs` and `core/launch.test.mjs` (43 tests; launch tests use PowerShell 7 without starting UE or changing execution policy). Run UE's built-in automation filter `Durak.` for all ten tests (no extra test framework installed). The match test plays 100 seeded games in each of three modes and verifies card uniqueness/conservation after every move. Interface tests exercise the same action dispatcher as mouse clicks through a full match, modal blocking, new-game modes and animation skipping. Motion tests check contact error, fixed limb lengths, planted feet and continuity.

## Local verification — 2026-09-07

- `DurakArenaEditor Win64 Development`: successful C++ build using MSVC 14.44 and Windows SDK 10.0.26100.0.
- All 43 JS/launcher tests passed. All ten UE automation tests reported `Result={Success}`, including 300 complete model games, a full controller-action match and motion regressions.
- `CardMatchTests.cpp` first failed to compile before the missing match implementation was added (red), then passed after implementation (green).
- Sword-direction regression first reported `Result={Fail}` on the backwards rotation, then passed after the pitch fix. UE's `TestExit` can still return process exit code 0 on a failing test: check the actual per-test results, not the process code alone.
- UE card game initialized with the human hand, a bot's opening attack, deck/trump and legal-move highlighting, and generated a 1920×1080 off-screen frame at `Saved/cards-game.png`. Test command uses `-ForceRes`; otherwise the desktop can clamp the capture size. Screenshots are not a claim of physical mouse end-to-end coverage.
- Native automation evidence is local at `unreal/DurakArena/Saved/Logs/verified-card-game-tests.log`. Generated logs/binaries are ignored by Git. When adding a C++ source file, use UBT `-gather` if its cached makefile does not discover it.
- WMS test suites were not run: no WMS code was changed. Nothing committed, pushed or deployed.

## Multiplayer boundary

The eventual isolated room service must authenticate actors, serialize commands per room, persist a committed state/event atomically, hide opponents' hands and only then broadcast combat events. The current in-memory reducer replay cache holds 128 recent commands; it is not durable delivery infrastructure. Never let an animation modify cards or grant a win.

## Art direction

Jack: mobile swordsman. Queen: precision counters. King: heavier armored strikes. Ace: imposing champion. Figure-on-figure pairs need real contact, parry and recovery animations, including trump-over-rank and mirror pairs. The present procedural pose sequence is a blocking pass to validate the scene and timings, not final combat animation.

## Motion inspection / 1440p pass

- Blender inventory: `RoyalProps.blend` contains two unparented meshes, Crown and Sword; no armature or animation. Scale is 0.01 m per unit. Sword grip center is local Z=-10 cm, blade tip Z=73.7272 cm. Character limbs are generated and posed in UE, not retargeted Blender characters.
- Six 2560×1440 diagnostic frames were captured around guard, four contacts and defeat. Rendered weapon-component transform checks reported 0.0000 cm tip-to-contact error at 3.00, 4.15, 5.30 and 6.50 seconds. Separate continuous tests check feet/limbs between sampled frames; stills alone are not proof of good choreography.
- Captures use `-DuelShowcase -DuelScenario=3 -DuelCaptureSequence=<absolute prefix> -DuelAutoExit=30` with `-ForceRes -ResX=2560 -ResY=1440`. Diagnostics do not run during normal play.
- Native 1440p rendering is GPU-heavy on the integrated Intel Arc. Resolution and contact correctness are verified; smooth 60 FPS and production-quality characters are not claimed.

## Windowed-launch regression — 2026-09-07

- User journey: open a normal manageable desktop window rather than a forced oversized 1440p viewport.
- RED: `node node_modules/vitest/vitest.mjs run core/launch.test.mjs` ran four tests, three failed: default size, forced resolution, missing explicit OS-frame/resize settings.
- GREEN: `node node_modules/vitest/vitest.mjs run core/combat.test.mjs core/launch.test.mjs` passed all 45 tests after the launcher/config-only fix.
- Tests cover all three resolution selections, default launcher parameter, no forced desktop-limit override, normal OS-frame configuration and optional showcase. Native window dragging/maximizing is not automated; PowerShell line coverage is not instrumented. No 80% coverage claim is made.
- C++ gameplay/motion code was not modified in this fix. The earlier ten UE tests belong to the preceding verified build, not a new run for this launcher-only change.
- No checkpoint commits created: the game remains untracked from earlier work; unrelated prototype files were not staged into this narrow launcher fix. RED/GREEN evidence is preserved here.

## Jack / Queen art preview

This first art pass is for the non-trump Jack/Queen pair. Trump defenses retain the previous red-aura rig; an automated regression checks that it is not silently replaced by aura-less armor.

Run `./Launch-HeroDuel.ps1` for the isolated comparison fight in a normal window; `-Resolution 2K` is optional. R replays, Space pauses, Escape exits. `Launch-Durak.ps1` still opens the card match, not the showcase.

Rebuild original hero assets with Blender `--background --python art/create_hero_pair.py`, then run UE's Python commandlet on `art/import_hero_pair.py`. This imports only `/Game/Heroes`; original props, card rules and other characters remain unchanged. Generation produces `art/output/heroes/JackQueen.blend`, 24 FBX meshes, four PCM WAV cues and a machine-readable bounds/material/triangle manifest. UE import asserts matching centimeter bounds and assigns all imported material slots explicitly. No paid or third-party assets are used.

The characters use the existing two-bone contact rig. Armor is segmented, not skinned; cape movement is a small procedural sway, not simulated cloth. Sounds trigger when the clock crosses an event, survive slow frames, never repeat on a paused frame, and are stopped when the scene is cleared/skipped. Fixed-time diagnostic captures are silent.

Verification for this art pass (2026-09-07):

- 47 Vitest tests passed: 41 rule/transaction tests, four existing launcher tests, two generated mesh/PCM checks.
- 12 UE automation tests passed, including the ten existing tests, audio event boundaries and three complete hero create/clear cycles. The sound-boundary test first failed before its implementation.
- The Blender manifest reports 24 unique meshes / 25,988 triangles, unit scale and grounded boot bounds. The importer checks all centimeter extents against that manifest. Segments are instanced into the existing UE IK rig, not retargeted from an unverified armature.
- A separate reload inspection first failed because reflected material-slot array mutations were not persisted: UE used WorldGridMaterial. Fixed with StaticMesh.set_material; the same reload test now passes and reports the real hero material paths. Run `art/inspect_hero_assets.py` through UE's Python commandlet to repeat it.
- Six 2560x1440 frames at guard, four contacts and defeat were inspected. Blade-component tip errors at all four contacts were 0.0000 cm. Captures are under `Saved/hero-final-*.png`; test results under `Saved/Logs/verified-hero-tests.log`.
- Local fill light and lower camera apply only to the hero pair. This is an initial original stylized armor pass, not a claim of final AAA art or mocap. Sound waveform levels and event timing are tested; subjective audio quality still needs listening on the user's speakers.
- WMS/sold-WMS code, card rules, default window settings, server and network code were not changed. Entire pre-existing game remains untracked; no unrelated files were staged, committed or published.

Branch for that initial pass: `feature/durak-jack-queen-art`, created from `fix/durak-windowed-launch`.

## Whole-body combat pass — 2026-09-08

The user selected graphics/combat, not networking. The non-trump Jack/Queen pair now has a shared waist/chest pivot: breastplate, pauldrons, head and cape move together while two-bone arms follow the shoulder sockets. Anticipation winds the chest back; the attack turns it forward and shifts weight over planted feet. Parries recoil through the body; defeat bows the torso and lowers the weapon. The second Jack attack uses a lateral windup, and the Queen's first counter uses a lower preparation. These remain authored procedural poses, not mocap or simulated cloth.

The Blender library now exports 26 meshes / 30,732 triangles. The Jack uses a broad bronze-hilted blade; the Queen uses a narrower silver blade with a swept knuckle guard. Both keep the verified local grip Z=-10 cm / tip Z=73.7272 cm contract. Materials and centimeter bounds were reimported and checked. No paid assets or external downloads.

Implementation: `DuelMotion.h` (`Chest`, `BodyAction`, opt-in `Evaluate` and `Strike`), `DuelStage.h/.cpp` (`FFigureRig`, `HeroFigure`, `Pose`, `Tick`), and `art/create_hero_pair.py`. Tests: `BodyMotionTests.cpp` and `core/heroes.test.mjs`. Existing card rules, other combat pairs, trump aura, default 1280x720 resizable window and all WMS code/configuration are unchanged.

Verification:

- RED: `Durak.Motion.BodyAnticipationAndRecovery` failed on rigid chest, missing weight shift, defeat bow and parry recoil. The generated asset test failed on missing `J_Sword` before the new meshes existed.
- GREEN: C++ build succeeded; all 47 Vitest tests and all 15 `Durak.` automation tests passed. Continuous tests sample every 0.01 seconds across the exchanges, checking shoulder attachment, fixed arm lengths, planted feet, reachable ankles, blade clearance and motion continuity. Four exact contacts are checked independently.
- `Durak.Art.BodySceneRendering` checks actual UE chest transforms, both new sword assets, persisted authored materials, world-space grip and tip positions at six poses. The original lifecycle/trump regressions also passed. Test evidence: `Saved/Logs/verified-body-tests.log`.
- Six 2560x1440 frames were rendered at windup, four contacts and defeat (`Saved/body-final-0.png` through `body-final-5.png`). Render diagnostics report 0.0000 cm weapon-tip contact error for all four hits. This verifies resolution and transforms, not a 60 FPS target or final photorealistic art.
- No WMS tests were run because WMS and sold-WMS files were not touched. Nothing was deployed, pushed or committed. The entire earlier game prototype remains untracked and was not swept into an unrelated commit.

Current local branch: `feature/durak-combat-body-motion` (the intervening `feature/durak-network-rooms` branch contains no network changes). Proposed eventual PR target: `feature/our-vm`, after approval to include the previously untracked game project. Multiplayer is postponed.

## Licensed skeletal fighter import — 2026-09-08

Current branch: `feature/durak-realistic-fighters`, based on the preceding body-motion branch.
The user's Fab library now contains Epic Games' [Kwang](https://www.fab.com/listings/f4c67e92-b976-4b5b-ab9f-4c25b010f6f3) and [Countess](https://www.fab.com/listings/0bf014eb-f2ed-4029-adda-81a855eb5220) packs. Both were downloaded and added to this exact UE5.8 project through Epic Games Launcher. The user handled Fab account authentication and EULA acceptance. No purchase was made.

Licensed source packs `/Game/ParagonKwang` and `/Game/ParagonCountess` are intentionally excluded from Git. Acquire them from Fab for another checkout; do not publish their source files in the repository. Original models, skinning, materials and clips are preserved. The library includes 177 Kwang and 234 Countess animation sequences; this is an inventory, not 411 integrated fighting moves.

`art/inspect_realistic_assets.py` is a read-only UE Python commandlet check of real SkeletalMesh classes, skeletons, bones, material references, and selected animation compatibility/durations. Its generated report is `Saved/realistic-asset-inspection.json`. Verified base rigs: Kwang 117 bones, Countess 126 bones. Native Unreal assets are inspected directly instead of unnecessarily round-tripping them through Blender.

`art/build_realistic_preview.py` generates/updates only `/Game/Art/RealisticPreview` and its isolated `BP_RealisticPreviewMode`. It places two native skeletal actors with serialized idle animation, a dedicated camera, studio lighting and a neutral floor. `art/test_realistic_preview.py` reloads this map and checks persisted animation, upright pitch/roll, camera position/auto-activation, absence of a default pawn and explicit light units. The rotation regression failed with `Fighter is lying sideways` before replacing positional `Rotator` arguments with named axes.

Run `./Launch-RealisticPreview.ps1` to review these characters in a normal window; optional `-Resolution 2K` requests 2560x1440. Close with the window X or Alt+F4. This is an animated character review, **not a finished duel**. `Launch-Durak.ps1` still runs the unchanged card match and `Launch-HeroDuel.ps1` still runs the earlier procedural fight. Integration of skeletal attacks/parries, contact choreography, trump aura and final render profiling remains to be done.

The preview overrides virtual shadows only for its own process because the existing project runs SM5; enabling SM6/Lumen/VSM globally has not been validated on this integrated GPU. No claim of 60 FPS, Mortal Kombat quality or finished game artwork is made.

Verification: all 51 Vitest tests pass (41 rules/transactions, four existing launcher tests, two original mesh/audio tests, three licensed-source exclusions, one preview-launch test). The new launcher test first failed before its script was created. Native asset inventory and saved-preview checks run separately through Unreal Python. C++ gameplay code is unchanged; the preceding 15 C++ automation results are historical, not a new run for this asset-only pass. WMS, sold-WMS and server files were not changed. No commit/push/deployment; eventual PR target remains `feature/our-vm` after approval to include the existing untracked game.

## First skeletal duel — 2026-09-08

Branch `feature/durak-skeletal-duel`. `Launch-SkeletalDuel.ps1` opens a separate looping 11-second Jack/Queen fight using the two licensed rigs, original attack sequences, matching full-body reactions, a finishing fall, crossfades, camera movement and the prototype audio cues. Optional `-Resolution 2K` preserves the existing 2560x1440 profile; default remains a normal window. Close via Alt+F4 or the window X. This first staged duel is not yet invoked by card-table events; other ranks/trump choreography still use the older prototype.

Build order (UE Python commandlet, one process at a time): `art/inspect_duel_clips.py`, `art/prepare_duel_reactions.py`, `art/build_skeletal_duel.py`, `art/test_skeletal_duel.py`. The project enables the bundled SequencerScripting plugin only for Editor targets. Generated map `/Game/Art/SkeletalDuelArena` is a copy of the character gallery, with its own camera, lighting and actor placements. It does not modify `/Game/Arena` or `/Game/Art/RealisticPreview`.

Inspection samples root, pelvis, head, feet, hands and weapon bones at 21 points in each source clip (`Saved/skeletal-duel-clips.json`). Attacks reach their forward swing near 0.18–0.25 seconds, not their midpoint. Timeline tests constrain reaction/swing timing to within two frames and require continuous animation coverage of all 330 frames. These checks do not claim exact blade-surface contact or eliminate all foot sliding; spatial choreography remains a review item.

An actual runtime warning exposed unsupported mesh-space additive hit reactions. The regression test first failed on the original `Hitreact_Fwd`. `prepare_duel_reactions.py` now creates separate non-additive copies under `/Game/Art/DuelReactions`, preserving original source tracks/assets. Seven key bone positions at five times match resolved original poses to <1e-12 cm in the raw-pose comparison. Licensed derivatives are also excluded from Git. Sequencer uses only non-additive clips and suppresses original gameplay notifies; sound cues are explicit audio tracks.

53 Vitest tests pass. The persisted Unreal cinematic test first failed with `Missing skeletal duel`, then passed after generation; additional checks cover clip types, reaction timing, playback settings and upright actors. No WMS/card-rule C++ changes and no deployment, push or commit. Proposed PR target remains `feature/our-vm` after approval for the earlier untracked project.

The full existing `Durak.` UE automation suite was rerun after enabling SequencerScripting: all 15 tests reported `Result={Success}` (including 300 complete seeded games). Evidence: `Saved/Logs/verified-skeletal-pass-regressions.log`. A live window run confirmed the skeletal sequence plays; after the reaction conversion the unsupported-additive runtime warning no longer appears. These are a first staged exchange and timing checks, not a claim that spatial sword contacts, footwork or production sound are finalized.

## Card-game integration and royal roster — 2026-09-08

Current isolated branch: `feature/durak-card-skeletal-combat`. This section supersedes the earlier preview-only status above.

- Actual legal defenses invoke `ASkeletalCardDuel` when combat animation is enabled. The five-scene `Launch-HeroDuel.ps1` viewer also uses the native roster; `-ProceduralDuel` explicitly selects the old diagnostic fallback.
- Jack uses Kwang GDC; Queen uses Countess; King uses the distinct Kwang Manbun mesh; Ace uses Countess Shogun armor. These are four mesh variants on two compatible native skeletons, not four independently authored character/animation packs.
- Royal fights last eleven seconds; number-card wall strikes last five. Pause, skip and restart clean up the cinematic and restore the card camera without changing the already-resolved card move. Trump fighters receive a following red light, not a finished volumetric aura.
- The gallery camera has a wider lens and a lower offset to keep feet above the bottom HUD. Rim-light specular intensity is reduced to avoid large bright discs on the backdrop. Final contact choreography and footwork still need refinement.
- All 36 card faces and the back use public-domain printed artwork from Adrian Kennard, based on Goodall & Son. See `art/cards/CREDITS.md`. `art/raster_cards.mjs` converts SVG to 512×717 PNG and `art/import_printed_cards.py` imports `/Game/Cards`. Native HUD and browser game use the same artwork.
- Generate native variants with `art/build_royal_duels.py`; verify meshes/materials with `art/inspect_royal_cast.py`. Licensed character sources and derivatives remain excluded from Git.
- Browser single-player is under `web/`: `node web/build.mjs`, then `node web/serve.mjs`, then open `http://127.0.0.1:4197/durak/`. It has three rule variants, an independent seeded match engine and responsive layouts. It neither calls WMS APIs nor implements multiplayer.
- Browser verification: 59 Vitest tests pass; isolated Edge QA checks 1440, 768 and 375 px widths, loaded card images, legal moves, restart dialog and absence of horizontal overflow. There is no established screenshot-regression baseline.
- Native regression evidence is `Saved/Logs/royal-final-regressions.log`; framing RED evidence is `Saved/Logs/royal-framing-red.log`. The new tests cover native roster selection, actual legal defense, pause/skip, cleanup, camera restoration and missing-asset fallback.

`Package-Durak.ps1` prepares an isolated Windows build, but a standalone client has not yet been packaged/verified or published. The site build exposes a download only when supplied a real archive. `/durak/` publication and PR creation are pending approval; no WMS server, database, sold-WMS code, protected branch or production deployment was changed. Proposed PR target: `feature/our-vm`, after approval to include the previously untracked game project. Do not publish the Fab source packs.

## Entrance and planted-idle cleanup — 2026-09-08

Current branch: `feature/durak-combat-polish`, created from the preceding game branch. Only game files changed; no WMS code or server operations.

`ASkeletalCardDuel` now stages a 1.4-second entrance before the original combat: the two exact rank/suit prints fall onto the arena, then full-size fighters rise through them. The opaque floor occludes the emerging bodies; this is a staged magical emergence, not cloth deformation or a destructive simulation. No bone scaling or licensed material changes. The complete royal sequence is now 12.4 seconds; wall strikes are 6.4 seconds. Pause, skip, replay, direct review seeking and cleanup include the entrance props.

Motion-state inspection found 21.39 cm of Countess root travel during a planted idle interval (2.8–3.2 seconds). Root translation now occurs during attacks/reactions, with linear keys and exact idle holds. The same evaluated-runtime sample now reports zero root travel and approximately 0.05 cm of Countess left-foot drift. The Kwang planted left foot moves approximately 0.23 cm on that interval; the unplanted right foot moves about 5.26 cm. This fixes the measured idle glide, not every contact/footwork issue in all clips.

Generate assets in order: `art/build_summoning_material.py`, `art/build_skeletal_duel.py`, `art/build_royal_duels.py`, then `art/test_skeletal_duel.py`. Polished variants are an isolated immutable revision under `/Game/Art/RoyalDuelsPolish`; the generator reuses that revision if already present, and does not delete older variants. If changing its source choreography again, generate a new revision and update the runtime path explicitly. The base sequence before this cleanup was saved under `Saved/PolishBackup`.

The new paper material has a dynamic `Face` texture; the arena uses a separate matte material instead of mirror-like obsidian. The wider camera and reduced bloom keep raised weapons and paper more readable. Native review renders support `-DuelCaptureTime=<seconds including entrance>`, `-DuelScreenshot=<absolute PNG path>` and `-DuelAutoExit=<seconds>`; diagnostic flags do not activate during normal play.

Verification: 59 Vitest tests and all 19 `Durak.` Unreal automation tests pass. New `CardSummoning` and `NativeFootwork` regressions failed before implementation. Logs: `Saved/Logs/summoning-red.log`, `footwork-red.log`, `polish-regressions.log`; evaluated pose samples: `Saved/native-footwork.csv`. Two 2560×1440 review renders are generated as `Saved/polish-final-entrance.png` and `Saved/polish-final-royals.png`. This verifies pixel dimensions and sampled states, not a real-time 60 FPS performance target. Exact weapon-surface contacts in every royal pairing and full sound polish remain unfinished.
