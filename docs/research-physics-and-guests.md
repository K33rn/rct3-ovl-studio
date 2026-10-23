# RollerCoaster Tycoon 3: train physics, guest spawning and guest behaviour

Findings from the game's program (Steam RCT3plus.exe, Platinum/Gold 1.x, unpatched copy) and from its own save files
(four campaign parks: La-La-Land, Scrub Gardens, Mine Mountain, Run Down Zoo — 1,524 guests, 32 trains). Addresses
are virtual addresses in RCT3plus.exe. "Verified" means read from the code or from the game's data; anything inferred
is marked as such.

## How this was found

- The save format names every saved field and its type, and the program registers each field with its offset in the
  live object (`push offset; push size; push "type"; push "Name"; call 0x8088c0`). Reading those registrations gives
  the in-memory layout of the train (`0x56c4bb`), park (`0x707b1b`) and guest (`0x76bd23`) objects, which leads to
  the code that uses each field.
- Values (masses, friction, guest stats) come from the parks shipped in `Campaigns\Base`.
- The track-section and train layouts match the RCT3 Importer's headers (`train.h`, `tracksection.h`); three of its
  "unknown" train floats turn out to be the friction and drag coefficients (below).

## Train physics

### The train object (offsets)

| Offset | Field | Notes |
|---|---|---|
| +0x60 | State | train state machine (station, lift, launching = 0x0d, …) |
| +0x68 | Distance | position along the track spline (m) |
| +0x6c | Length | |
| +0x70 | Speed | m/s along the track |
| +0x74 | Accel | m/s² of the last step |
| +0xc8 | StaticFrictionCoeff | from the ride's train record +0x30 |
| +0xcc | DynamicFrictionCoeff | from the ride's train record +0x2c |
| +0x124 | Mass | kg (800–3,800 in the campaign parks) |
| +0x258 / 25c / 260 / 264 / 268 | SpeedThrill, NegGThrill, NegGVomitism, AccelThrill, DropIntoOblivionThrill | accumulated over a ride for the ratings |
| +0x26c / 270 | ChainState, ChainStateTimer | |
| +0x288 / 28c | LaunchSpeed, LaunchForce | |
| +0x29c | → the ride's train definition (rit) | its +0x34 is the drag coefficient |

### One physics step (`0x567390`, called from the train update at `0x576a12`)

The train update first sums, over its cars, the force along the track, the total mass and the normal load
(`0x5703e0`, `0x561d70`, per car `0x50b330` / `0x50b370`), adds state forces (chain `0x5706d0`, launch `0x570b40`
and `0x5703e0`, others `0x5665f0`), then integrates:

1. **Friction multiplier** `k`: 0 with the *NoFriction* cheat, 0.3 with *LowFriction*, otherwise the ride type's own
   value (its record +0x6c0).
2. **Standing still** (|speed| below a tiny threshold, no drive force): the train stays put while
   |F| ≤ StaticFriction × N × k (acceleration 0).
3. **Rolling:** friction μd × N × k opposes the motion (F −= it when moving forwards, += when backwards).
4. **Air drag:** F −= c × v² (sign follows the direction), c = the train definition's +0x34.
5. **a = F / m**; **speed += a × dt**.
6. Some states (lift tops, shuttle phases: state 5 with ShuttleDirection 1, state 8 waiting at the top) clamp the
   speed at 0 instead of letting the train roll back.

Then the speed feeds the car placement along the splines (`0x576d40`, `0x57a640` on the train's +0x1c0 / +0x20c
helpers).

**Gravity** is the fixed vector (0, −9.81, 0) m/s² (set at `0x5285f3`, `0x52afe6`, `0x52e888`, `0x508c97`), used
by the car code to get each car's acceleration in the world, along the track and at the seat — the saved
`WorldAccel`, `TrackAccel` and `SeatAccel` that become the lateral / vertical G-forces in the ride graphs.

### The coefficients (ride train records, `rit`)

The RCT3 Importer's `RideTrain_V` has three "speed_unk" floats; the physics step shows what they are:

| rit offset | Importer name | Is | Usual value |
|---|---|---|---|
| +0x2c | speed_unk01 | dynamic (rolling) friction coefficient | 0.04 (suspended 0.06, log flume 0.25, rapids 0.01) |
| +0x30 | speed_unk02 | static friction coefficient | 0.06 (suspended 0.04) |
| +0x34 | speed_unk03 | air-drag coefficient (force ∝ v²) | 0.02 (suspended 0.01) |

Cable lifts, thrill lifts and the elephant transport have all three at 0. In the campaign saves: dynamic 0.04 on 24
trains, 0.06 on 2, 0 on 6; static 0.06 / 0.06 / 0; masses 800, 1,000, 2,000 and 3,800 kg; launch forces
12,882–29,527 N with launch speeds 2.6–8 m/s.

### Cheats

The cheat list (`0x410f20`) registers 32 cheats; *LowFriction* is number 18 and *NoFriction* number 19 — the two
the physics step checks (`0x40e590`, `0x40e660`). Unlike most cheats they have no guest name in the language files,
so they can't be switched on by renaming a guest. The others, by guest name: John D Rockefeller, Chris Sawyer,
Mouse, Guido Fawkes, Atari, James Hunt, D Lean, A Hitchcock, PhotoStory, ATITech, Make Me Sick, Jonny Watts (peep
cam), John Wardley (coaster heights), Frontier (unbreakable), Jon Roach (ride all rides), Sam Denney (ride all
coasters), Atomic (big explosion), Loner (all groups individuals), Jurassic Dart.

### Verified in the game

A new Heartline loop (see MODLOG, 2026-10-23): the ride graph showed vertical G of about +3.5 g at each loop's
bottom and the speed dipping at the top; with the ride's *Low friction* option off, a train on a long flat return
lane after the loops came to a stop (rolling friction and drag only), with it on the lap completed.

## Guests: where they come from

### The park's settings (Park object)

| Offset | Field | Campaign values |
|---|---|---|
| +0x60 … +0x150 | graphed values: GuestsInPark, GuestsOnWayToPark, Adults/Teenagers/ChildrenInPark, Adult/Teenager/ChildrenAppeal, GuestIntake, PublicityLevel, ParkRating, AssessedEntranceFee, IdealGuests | 268-byte history each |
| +0x168 / 16c / 170 | InitialGuestHappiness / Hunger / Thirst | 0.5–0.7 / 0.8–1.0 / 0.85–1.0 |
| +0x174 | GuestRideIntensityPreference | 0.5 in all four |
| +0x178 | GuestGenerationRate | 0.75–1.0 |
| +0x17c | GuestThinkCycle | 0 |
| +0x1a8 / 1ac | OpeningTimeMinutes / ClosingTimeMinutes | e.g. 420 / 1380 (7:00–23:00) |

A park also carries **GuestDemographics**: weights for who arrives — Pop_AdultMale 5, AdultFemale 5, AdultCouple 4,
AdultParty 4, Family 5, ChildMale 5, ChildFemale 5, TeenageMale 5, TeenageFemale 5, TeenageCouple 4, TeenageGang 4,
DayTrip 2, LoneAdult 1, LoneTeenager 1 — and Prob_SingleParentFamily 0.25, Prob_InterRacialCouple 0.25,
Prob_MaleLeader 0.5. Groups (families, couples, gangs) arrive together and share a GuestGroup.

### Spawning

- Guests don't appear at the park entrance: they appear at **guest injection points** — scenery items with the
  `GuestInjectionPoint` behaviour, placed at the map's edges (roads, car parks) — and walk to the park. Each point
  registers itself with a manager (`0x1306978`, `0x786a20`).
- Park entrances are listed too (`ParkEntranceBehaviour`, count `0x708960`, by index `0x708970`, random choice
  `0x708980`: random 0–1 × count).
- For an entrance, the game routes from every injection point to it with the path finder and takes the one with the
  shortest route (`0x786f70`, called from the entrance at `0x708a30`). So guests start at the injection point
  nearest (by walking route) to the entrance they're heading for. A point with no route can't be used; `0x7870a0`
  checks that at least one can.
- While walking in they count as *GuestsOnWayToPark*; on entering they pay (CashInfo.SpentOnParkEntry) and count in
  *GuestIntake* and *GuestsInPark*.
- How many come: the park keeps a live **ideal guests** figure at Park+0x18c (the toolbar's debug tooltip "Debug
  ideal guests: %.0f" prints it, `0x658386`) and records it monthly in the IdealGuests graph, next to appeal by age
  group, park rating and publicity, and a *GuestGenerationRate* (0.75–1.0 in the campaigns; the scenario editor shows
  it ×100 as a percentage, `0x5f9c72`). In the saved graph histories (newest first) intake runs while guests in the
  park are below the ideal figure and dries up above it — Run Down Zoo: ideal 115 → 334 → 155 while guests in the
  park fell 438 → 310 and intake went 25, 23, 11 … 0. The formula that produces the ideal figure is still not found.
- Counting (`0x704ab0`, the park's "guest added" handler): a guest already in the park adds 1 to GuestsInPark and to
  their age group's graph (Guest+0x120: child / teenager / adult); otherwise they count as on their way.

## Guests: what they're made of

### Stats (Guest object, all verified offsets)

| Offset | Field | Range seen |
|---|---|---|
| +0x434 | PreferedRideIntensity | 0–3 (0: 84 guests, 1: 1,022, 2: 320, 3: 98) |
| +0x438 / 43c | PreferedIntensityMax / Min | max 3.9–13.8 (median 7.9), min −3.0–6.0 (median 0) |
| +0x440 | NauseaTolerance | 0–3 (168 / 382 / 592 / 382) |
| +0x444 | IsInPark | |
| +0x310 | TimeInPark | minutes |
| +0x470 / 474 / 478 | NumFoodItemsBought / NumDrinksBought / NumSouvenirsBought | |
| +0x47c / 490 | FavouriteRide / its rating | |
| +0x4b0 | PriceModifier | |
| +0x504 / 508 / 50c | Wetness, PoolPreference, PoolNeed | Soaked! |
| +0x518 | SeenSpeciesList | Wild! |
| CurrentHealth / TargetHealth | EnergyF, HappinessF, NauseaF (0–1) | |
| Consumption | FoodF, DrinkF, ToiletF (0–1; 1 = full) | |
| CashInfo | CurrentCash, ATMCash, WithdrawnCash, SpentOn… (in cents) | cash $19–$93 |

Stats come in pairs: **Current** and **Target**; in the saves they differ for most guests (mean happiness 0.66
current vs 0.65 target, energy 0.50 vs 0.61). Inferred, not traced in code yet: events set the target and the
current value eases toward it.

### Thinking

- Guests think on a timer (`ThinkTimer`, `TimeToNextThink`, `ThinksToNextBigThink`, `DecideTime`) rather than every
  frame; a "big think" re-plans what to do next.
- Thoughts are kept as `RecentThoughts` {Thought id, Variant, About (the ride / shop), Time}; the park-wide thought
  summaries (`Thought_PI_Guests_Hungry`, `_Thirsty`, `_Tired`, `_Toilet`) feed the park inspector's messages.
- States, from 6,800 guests in every campaign park (what the guests in each state are doing and what they're aimed
  at) and the game's own state descriptions (`0x7c8d23`, the person-state console text; the queue, swim, high-dive
  and jacuzzi sub-state names are strings in the exe):

  | State | Guests | Meaning | Evidence |
  |---|---|---|---|
  | 0 | 139 | just arrived / choosing | TimeInPark 0, moving, targets of every kind |
  | 4 | 18 | heading for a chosen ride or shop | moving, target ride / stall |
  | 7 | 453 | **queueing** | the code's queue sub-states 0 Start, 1 PushingIn, 2 Queueing (442 of them), 3 Waiting, 4 Entering, 5 WaitingToPay, 6 Paying, 7 Leaving; standing, target ride |
  | 8 | 446 | **on a ride** | target ride, seated animations (100, 104) |
  | 9 | 2 | getting off | |
  | 10 | 92 | **using a shop, viewing gallery or special attraction** | target stall / gallery / attraction |
  | 11 | 7 | walking to a ride's entrance | |
  | 12 | 20 | **sitting on a bench** | target bench, sitting animations |
  | 13 | 20 | **waiting outside the park** at an injection point | IsInPark 0, target injection point |
  | 14 | 3 | at the park entrance (entering or leaving) | target the entrance |
  | 16 | 5,479 | **walking** (the paths, or in from / out to an injection point) | path tiles, injection points; sub-states 0–6 |
  | 19 | 2 | watching a firework display | target FireworkDisplay |
  | 20 | 9 | watching an entertainer | target Entertainer |
  | 256 (0x100) | 32 | standing watching a ride (inferred) | still, idle animation, target ride |
  | 258 | 1 | high dive (Soaked!) | sub-states AlignLadder, ClimbLadder, WalkAlongBoard, Dive |
  | 259 | 103 | **swimming** (Soaked!) | sub-states Start, Idle, Travel, Queue, Shower, Diving, SunLounger, Splashing Someone |
  | 260 | 2 | jacuzzi (Soaked!) | sub-states In, Sit, Out |

  States from 0x100 up are the pool states (the describer tests for 0x100 first). Names marked in bold match both
  the data and the code's own words; the rest are read from the data.

### How a guest feels about a ride (`0x7592aa`)

Correction to the first version of these notes: this is the guest's **reaction** to a ride, not the choice to ride
it. Each guest has an intensity band [Min, Max] (PreferedIntensityMin/Max); the ride's intensity and nausea ratings
(an unrated ride counts as intensity 10, nausea 0) give six scores — neutral (always 0.5), too tame (squared), in the
band, tame, too intense, too sickening:

- The outer quarter of the band at each end is a fade zone, edge = (Max − Min) × 0.25.
- Too tame: intensity below Min + edge → appeal falls off as 1 − (intensity − Min) / edge (squared).
- Too intense: intensity above Max − edge → 1 − (Max − intensity) / edge.
- Nausea: the guest's limit is **2 × NauseaTolerance + 2** (2, 4, 6 or 8); a ride above it is penalised by
  (nausea − limit) × 0.5.
- `0x7c34f0` sorts the six scores, largest first, and packs the order into Guest+0x378 (3 bits each); `0x7d647b`
  then takes the first one the guest's seat type has an animation for (mask table `0xfc5348`) — the on-ride reaction
  (bored, enjoying, scared, sick) kept in TargetOnRideReaction. Other situations set fixed orders (`0x7c3610`).

What a guest weighs when *choosing* a ride goes through each attraction's assessment interface — the debug panel at
`0x4d7c50` lists its methods: valid, excitement, intensity, queue, nausea, sunburn, ideal, fraction. The weighting
inside the guest's choice is still not traced. (`0x6cf640`, which compares a ride's excitement / intensity / nausea
and seven other values against a threshold, is the scenario objectives' "coaster with excitement above …" check.)

The scenario settings that switch parts of this off: GuestsIgnoreRideIntensity, GuestsIgnoreRideNausea,
GuestsIgnoreRideCost, GuestsRideUnratedRides, GuestsRevisitRides, GuestsHaveFixedHealth, GuestsHaveNoCameras /
Camcorders, and the GuestDefault_* values (Cash, Happiness, Hunger, Thirst, IntensityPreference, GenerationRate).

### Per-ride statistics the game keeps

TotalProfit, TotalGuests, BuildTime, Popularity, Satisfaction, TimeSinceLastCrash and IntervalData {GuestsPerInterval,
…} (`0x4c2e40`), used for the ride's popularity and the guests' choices.

## Ride ratings: a small program per ride type

Excitement, intensity and nausea are not one formula in the program: every ride type carries its own **rating
program** in its OVL — the RideOption list of its Ride record (vanilla tracked rides at trr+0x40, Soaked!/Wild! ones
through the pointer at trr+0x12c, then +8; flat rides likewise). The layout is the RCT3 Importer's `RideOption`;
read here for all 162 ride types (tmp/research/programs.json). Each entry is one instruction:

| Type | Fields | Does |
|---|---|---|
| 12 | three floats (e.g. 50, 30, 10) | header |
| 10 | value, stat | setup values (15, 18, 20…) |
| 8 | E, I, N, stat, group, factor | **ratings += (E, I, N) × stat × factor** (stat 0 = the constant 1) |
| 4 | stat, group, value | guard: stat **<** value |
| 7 | stat, group, value | guard: stat **≥** value |
| 2 | stat, group, value | guard: stat **=** value (yes/no features) |
| 6 | stat, group, value | guard: stat **>** value |
| 9 | three floats | **ratings × (a, b, c)** — always 0.5, 0.5, 0.5: halve everything |
| 0 | | separator |
| 11 | value, stat | trailer |

Guards apply to the next action, and several guards in a row must all hold (the guard meanings are read from how the
programs are built, e.g. `< 6000` followed by its `≥ 6000` twin). The Looping Coaster's program, decoded:

```
E += 0.7 x min(s15, 6000) / 6000
if s7 = 1:  E += 0.45, I -= 0.25, N -= 0.2
if s8 = 1:  E += 0.4,  I += 0.05
E += 0.2 x s3 / 7;   E -= 0.2 x s1 / 7
(E, I, N) += (0.25, 0.5, 0.2) x s13 / 37
(E, I, N) += (0.4, 0.6, 0) x s14 / 9
E += 0.6 x min(s4, 150) / 150
(E, I, N) += (0.6, 6.0, 2.5) x G0 + (1.8, 2.0, 4.0) x G1 + (1.0, 3.0, 1.5) x G2 + (1.2, 1.5, 1.5) x G3   [group 512]
E += 4.5 x s32;  E += 0.24 x s5;  (E, I, N) += (3.0, 0.5, 0.2)
halve all: if s21 < 7 and s22 < 1;  if s13 < 10;  if s17 > -0.1 and s22 < 1;  if s20 < 2
```

That is why, per ride type, the stored ratings of the game's designs fit a linear model of their test results almost
exactly (Looping Coaster and Body Slide R² = 1.000, Wooden Coaster 0.93–0.997) while all coasters together don't
(0.5–0.7). Group 256 stats are ride measurements; group 512 are four G-force terms that carry most of the intensity
and nausea (Heartline's older program writes the same four as stats 33–36). Which measurement each stat number is, is
inferred from the scales the programs use, not read from code: s13 ≈ top speed (÷37–45, "below 10 → halve"),
s15 ≈ ride length (thresholds 100–6,000), s4 ≈ ride time (÷150), s14 ≈ inversions or drops (÷9), s18 a G value
(compared with 1.2–1.5), s1 / s3 counts (÷7), s7 / s8 yes/no features.

So a custom ride's ratings can be changed by editing its program in its OVL — the same writer the Heartline loop
uses could do it.

## Still open

- The formula that produces the ideal guests figure (Park+0x18c), and the spawn interval.
- The exact stat numbers of the rating programs (the lookup isn't a plain switch and wasn't found), and the four
  G-force terms of group 512.
- The weighting inside a guest's choice of ride (price, queue, needs against the assessment interface).
