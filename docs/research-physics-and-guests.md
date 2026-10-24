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
  park fell 438 → 310 and intake went 25, 23, 11 … 0.
- Counting (`0x704ab0`, the park's "guest added" handler) is below; the formulas follow.

### How many guests come (`0x43d940`, the park's update, and `0x437a10`)

Every update the park works out three numbers in `0x437a10`:

- **IdealGuests (the graph's current value)** = the sum over every ride that's open and not broken down of what the
  ride type's **attractivity** (its virtual function +0x54, `0x52f540`), plus the same for the other attractions (`0xa88450`) and
  `0xb6cab0`'s totals, capped at 65,535. More and bigger working attractions raise it.
  - Attractivity is a fixed number in each ride type's OVL record: the first field of its ride settings (vanilla
    tracked rides at trr+0x38; Soaked!/Wild! ones keep −1 there and the real value 0x1c further on, which is why
    the method checks for −1). For the tracked rides it runs from 30 to 120: 120 for the Giga, Hyper Twister,
    Floorless, Flying, Twister and Stand-Up Twister coasters; 100 for the Corkscrew, Inverted and Multi-Dimensional;
    95 for the Looping; 70 for Rapids; 50 for the Ghost Train and Vintage Cars; 40 for the boat hires; 35 for the
    Heartline Twister; 30 for the Airboats (all of them in tmp/research/attract.json). So a Giga coaster adds 120 to
    the ideal guest count, and two boat hires together add only 80.
- **AssessedEntranceFee** = 2 × the sum over rides of max(0, the ride's assessed value − its ticket price), so cheap,
  good rides raise the entrance fee guests will accept.
- **The draw** (the function's return value):
  - start from the park rating: clamp(ParkRating − 200, 0, 650) + 50, which is 50 at a rating of 200 or below and 700
    at 850 or above;
  - quarter it (÷4) for each of these that's true: guests in the park + on their way > IdealGuests; guests in the park
    + on their way > 800; the entrance fee > AssessedEntranceFee; the entrance fee > 2 × AssessedEntranceFee (so a
    fee over twice the assessed figure divides it by 16);
  - multiply by clamp(PublicityLevel, 25, 400) / 100.

Then the update (`0x43df37` on):

- **The live ideal figure** (Park+0x18c, the debug tooltip's number) = the IdealGuests graph value + the publicity
  level, where publicity above 200 counts half: ideal = IdealGuests + max(0, p ≤ 200 ? p : 200 + (p − 200) / 2).
- **A guest is generated** this tick when a random number in [0, 1) × 131,072 is below
  draw × GuestGenerationRate × dt × 96 **and** GuestsInPark < the live ideal figure. dt is the frame time; it's ×5 or
  ×2 under two game options (`0x440fd0` items 0x30 / 0x2f, most likely the fast-forward speeds) and ×0.01 in one
  special mode. Generation stops altogether while option 0x2e is set or a park flag is (paused / park closed).
  - So the chance per second is draw × rate × 96 / 131,072. A park rated 600 with publicity 100 and rate 1.0 gets
    draw 450, about **one guest every 3 seconds** while it's under its ideal number; a top park (rating 850+,
    publicity 400) gets draw 2,800, about **2 a second**. The spawn goes to `0x781da0` / `0x7a9a80` (the guest
    generator), which picks the injection point as described above.

### New guests' preferences (`0x762a00`, when a guest is created)

- Intensity band: Min = 7 × random; if Min ≤ 4, Max = Min + 3, otherwise Max = 2 × Min (8–14) and Min becomes 4; Max is
  capped at 14. PreferedRideIntensity starts at 1.
- NauseaTolerance (when the scenario hasn't set one): picked from [0, 1, 1, 2, 2, 2, 3, 3], so ⅛ get 0, ¼ get 1,
  ⅜ get 2 and ¼ get 3.
- The scenario's IntensityPreference setting (`0x758bb0`, 0–3) instead sets fixed bands: 0 → [0, 5], 1 → [1, 8],
  2 → [4, 10], 3 → [6, 12]. A guest's *ideal* intensity is Min + f × (Max − Min) with f = 0.25 / 0.5 / 0.7 / 0.9 for
  preference 0–3 (`0x758c30`).
- PoolPreference = random clamped to 0.1–0.9, PoolNeed = 1.5 × random, Toilet = 0.2 × random, sunburn sensitivity =
  random × the weather's UV value / 150.
- After a ride, a guest whose happiness is 0.784 or more gains 0.2 on their upper intensity limit, up to 14
  (`0x7691a0`). Guests get braver as they enjoy rides.
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
current vs 0.65 target, energy 0.50 vs 0.61). In memory they are two blocks of {Energy, Happiness, Nausea, Sunburn}
at Guest+0x408 and Guest+0x418; rides add to the first block's happiness and nausea, and the decisions below read the
second. Consumption is {Food, Drink, Toilet} at Guest+0x428.

**Groups** (`0x773ad0`): a GuestGroup decides with weighted averages of its members' second block and intensity band,
each member weighted by how far their value is from the middle ((x − 0.5)² + 0.25, or (x − 5)² + 10 for intensity), so
the group follows its most extreme members. Food, drink and toilet take the group's maximum. The group keeps a bit mask of
what it's looking for at Group+0xe0 (food 1, drink 2, toilet 4, umbrella 8, ATM 0x10, first aid 0x20, home 0x40;
bench, sun block and bin are in the same list), which the "ListObjectsOfDesire" debug command prints.

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

### Choosing a ride (`0x76e3a0`, wrapped by `0x76ee40`)

Each attraction gets a score for the guest (or the group) doing the choosing. The score is a weighted sum; the
weights are a table at `0x10ef880` (writable data, so they could be patched): excitement 0.24, intensity 0.22, value
for money 0.175, nausea and sunburn 0.025, queue 0.21, constant 0.075, happiness 0.03, and appeal to the guest's age
and sex 0.025. Each part is also logged on the ride (`0x4bfc00`, component numbers in brackets). The parts come from the attraction's
assessment interface (the debug panel at `0x4d7c50` lists it: valid, excitement, intensity, queue, nausea, sunburn,
ideal, fraction).

Ruled out at once (score 0, with a thought naming the reason): not a ride; closed or broken down; the ride needs
something the guest lacks (an age or height rule, thought 0x10); **can't afford it** — the price is above the
guest's cash, thought 1 when they have under $5.00, thought 2 otherwise.

score =
- **0.03 × happiness** (the guest's second health block, from the chooser's method +0x24) **+ 0.025 × the ride
  type's appeal to this guest** [5] (`0x76e010`): a table in the ride type's data (+0x5c) with one value for each
  age group (Guest+0x120: child, teenager, adult) and sex (Guest+0x121), and more values used when a group
  chooses
- **weather**:
  - rain (weather type 3 or more) on a ride that's under cover less than 0.375 of the way: 20 % of the time the guest
    refuses (thought 3);
  - on rides the game treats as weather-dependent (`0x49ac80`, likely the water rides): +0.08 above 31 °C, +0.05
    above 28 °C, −0.05 below 18 °C. The code also has −0.1 below 15 °C and −0.2 below 12 °C, but the way the tests
    are ordered seems to make those two steps unreachable.
- **+ 0.22 × intensity fit** [1]: the assessment's intensity answer for the chooser's band. It is a flat 0.5 for
  rides with a fixed answer, and −1 outright when it comes back as "too intense" or "too tame" (categories 4 / 5).
- **nausea** [2]:
  - if the ride's nausea is over 2.5 and the guest is already queasy (> 0.6): −0.3 and thought 7;
  - otherwise + 0.025 × (2 − 0.075 × (nausea + sunburn) − 0.5 × the guest's own level).
- **+ 0.175 × value for money** [4] = 0.175 × 0.006 × (value′ − price), with prices in cents. value′ is the
  assessment's "ideal" price × (1 + the best discount on offer), × 0.25 for some choosers. So each $1 below what the
  ride is worth adds about 0.1. If the guest has a pass the term is replaced by +0.2. A score above 1 here also sets
  the "good value" thought.
- **+ 0.24 × excitement** [0], or −10 if the ride's excitement is 0 or less.
  - A ride with no valid ratings skips the weather, intensity, nausea, value and excitement parts and gets a flat
    +0.4 instead.
- **+ history** [8]:
  - −0.2 for a ride the chooser has just done;
  - a term for rides they've been on before;
  - +0.6 for the chooser's favourite.
- × min(a chooser factor, 5) on weather-dependent rides, and × a fit factor where the ride has one (`0x4bd9d0`).

The wrapper then adds **0.21 × the queue's appeal** + 0.075 [9]. Queue appeal (`0x532fd0`) = 1 − 0.075 × the
number of guests in the queue at that entrance, so it reaches 0 at about 13 people and goes negative beyond that. A
ride is a candidate only when its score without the queue part is at least 0.1. Below that the guest gets a thought
naming the main reason: dull (0x15), poor value (8) or too intense (0x13).

Each score part is also kept on the ride as a running average (log = (5 × log + value) / 6, `0x4bfc00`).

#### How the pick is made

The score is only a pass / fail test (`0x76f8f0`). Which ride the guest then goes for is decided in one of two ways:

- **Passing by** (`0x76ffe0`, called from the walking code at `0x781a0b`). A guest on a tile with ride entrances
  checks each one. Among those that pass the test, the one with the higher **pull** wins (`0x76e210`): pull =
  the ride's excitement (if it is rated) + 0.1 × max(0, 50 − the number of guests queueing for the ride). A tie is
  settled by a coin toss. So a good ride the guest walks past is taken right away, and a queue of 50 or more cancels
  the queue part.
- **Looking for something of a kind** (`0x76fb20`, filtered by attraction type or by stall, `0x76e1f0` /
  `0x76f860`). The game goes through every attraction of that kind that passes the test and takes its nearest
  entrance. That entrance must be within 80 m (1,024 m when the chooser's method +8 says so, `0x761190`). Each one
  is weighted appeal / (distance² + 1): appeal is 1 for a ride, and the stall's appeal for the guest's age and sex
  for a stall (`0x594a40`). The five heaviest are kept, and one of them is picked **at random in proportion to its
  weight**. Nearby places win almost every time: one at 5 m outweighs one at 20 m about 16 to 1.

### After the ride (`0x75f3a0`): did they like it, favourite ride

The guest scores the ride S (an integer), using their happiness h (0–1) to widen the bands by w = 2.55 × h:

- **intensity fit**: 3 if inside [Min, Max]; 2 if inside [Min − 2w, Max + w]; 1 if inside [Min − 4w, Max + 2w];
  otherwise 0.
- **nausea fit**, by NauseaTolerance's comfort band [0, 3], [0, 6], [2, 8] or [4, 10] (`0x10ef810`): the same 3 / 2 / 1 / 0
  scale.
- S starts at:
  - **70** if both fits are 3;
  - otherwise 15 if one of them is 3, then +35 if both are 2 or more, else +10 if one is;
  - then +10 if both are 1 or more, else −60.
- **Price** against the ride's assessed value V: +40 if the price ≤ V, +15 if ≤ 1.5 V, −45 above that; +15 when the
  park doesn't charge for rides.
- **Queue time**: +10 under 30 s; −10 over 90 s; −25 over 300 s.
- **Novelty**: +10 if not ridden before, +10 more if they've never ridden that kind of ride.
- **Effects**:
  - happiness += S / 255, capped to 0–1;
  - the ride's satisfaction gets 2 × S;
  - nausea += nausea rating × 100 / 255 × clamp(1 − happiness, 0.25, 0.78) × clamp(2 × food, 1, 2) × ½ / ¼ / ⅛ for
    tolerance 1 / 2 / 3 (1 for tolerance 0). A full stomach doubles it.
  - The ride becomes the **favourite** when 25 × excitement + S beats FavouriteRideRating and both happiness values
    are ≥ 0.4.
- If the ride broke down while they were on it: happiness −0.4, nausea −0.1, thought 0x2d.
  - Otherwise, a very happy guest (≥ 0.85, nausea ≤ 0.5) on a ride near their limit (intensity ≥ Max − 1) who rolls
    under excitement / 3 sets EnjoyedLastRide (wants to go again).

(`0x6cf640`, which compares a ride's excitement / intensity / nausea and seven other values against a threshold, is
the scenario objectives' "coaster with excitement above …" check.)

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

The game has its own names for all of this (name tables at `0xbb5600`, `0xbb57a0`, `0xbb57e0`, used by a text form
of the programs); the interpreter is `0x500e90`.

| Type | Name | Fields | Does |
|---|---|---|---|
| 0 | AssessAlways | | resets the conditions: what follows always applies |
| 1 | AssessOpMode | value | condition: the ride's operating mode = value |
| 2–7 | AssessEQ / NE / LT / LE / GT / GE | stat, value | condition: stat =, ≠, <, ≤, >, ≥ value |
| 8 | AssessAdd | E, I, N, stat, factor | **ratings += (E, I, N) × stat × factor** |
| 9 | AssessMult | three floats | **ratings × (a, b, c)** — in practice 0.5, 0.5, 0.5 |
| 10 | AssessReliabilityRate | value, stat | the ride's breakdown rate = value × stat |
| 11 | AssessUnderCover | value, stat | how much of the ride is under cover |
| 12 | AssessValue | three floats | the ride's value = (a, b, c) · (E, I, N) |

Conditions in a row must all hold, and their result stays in force for every following action until the next
condition after an action, or an AssessAlways. Stat numbers (`0xbb5600`), with where the value comes from
(`0x500eba`–`0x5013f2`; test results at ride+0x5d0, G values converted to g by × 1/9.81):

| # | Stat | # | Stat | # | Stat |
|---|---|---|---|---|---|
| 0 | StatNone (= 1) | 12 | IsCircuit | 24 | DistanceUnderGround |
| 1 | One (= 1) | 13 | MaxSpeed | 25 | MaxTunnelSpeed |
| 2 | NRideCycles | 14 | AverageSpeed | 26 | NTunnels |
| 3 | NCars | 15 | RideLength | 27 | NTunnelsBank |
| 4 | RideTime | 16 | MaxPositiveVerticalG | 28 | NTunnelsSloped |
| 5 | AssessedScenery | 17 | MaxNegativeVerticalG | 29 | FractionUnderground |
| 6 | NTrains | 18 | MaxLateralG | 30 | NBrakes |
| 7 | TrainType | 19 | AirTime | 31 | NBoosters |
| 8 | DualTrack | 20 | NDrops | 32 | AssessedTrackScenery |
| 9 | LaunchSpeed | 21 | HighestDropHeight | 33 | TrainingLevel |
| 10 | FixedSpeed | 22 | NInversions | 34 | ShowAssessment |
| 11 | LiftChainSpeed | 23 | NLiftHills | 35 | TrackLength |

Group 512 (the "G-force terms" of the first notes) is the game's **Assessed** set, four 3-vectors that an AssessAdd
multiplies component by component: AssessedGForces, AssessedTrackTypes, AssessedDrops, AssessedTunnels (also
addressable as stats 33–36 in older programs). They're computed from the test results before the program runs:

- **AssessedGForces** (`0x4fe8f0`). With P = ½ × max vertical G, n = 0.3 × max negative G, L = ½ × max lateral G
  (all in g):
  - E = 0.625 × (0.08 P − 0.24 max(n, −2.5) + 0.4 min(L, 1.5));
  - I = (L + 0.8 P − 0.8 (n − 1)) / 11;
  - N = (L / 3 + 0.26 P − 0.222 (n − 1)) / 3.3;
  - lateral above 3.5: I gets +3.75 and N +2 inside the brackets; above 4: another +8.5 and +4, and E is halved.
- **AssessedTrackTypes** (`0x4fea70`):
  - special pieces, as (E, I, N) added before scaling: spinning tunnel (0.4, 0.55, 0.25); turntable (+0.48, +0.65,
    +0.55); splash or rapids (+0.5, +0.2, +0.3); waterfall (+0.55, 0, +0.3);
  - helices h: E + 0.0389 × min(h, 9), N + 0.0227 × min(h, 11), I + 0.2 × clamp(h − 5, 0, 10);
  - each 90° / 180° / 270° corner: flat corners E 0.0097 / 0.03 / 0.025, banked corners E 0.0113 / 0.0375 / 0.0375,
    with smaller I and N amounts;
  - sloped corners: E only, capped per size (360° turns also add intensity, 0.075 each up to 8);
  - inversions v: (0.267, 0.217, 0.5) × min(v, 6);
  - finally E × 0.227, I × 0.265, N × 0.175.
- **AssessedDrops** (`0x4fedf0`), d = NDrops, h = HighestDropHeight:
  - E = 0.444 × (0.111 min(d, 9) + 0.00244 h);
  - I = 0.238 × (0.142 min(d, 12) + 0.00488 h);
  - N = 0.5 × (0.1 min(d, 12) + 0.00156 h).
- **AssessedTunnels** (`0x4feeb0`), u = DistanceUnderGround:
  - E = 0.196 × (0.0741 MaxTunnelSpeed + 0.0014 min(u, 1000) + 0.118 min(NTunnels, 11) + 0.2 if banked + 0.2 if
    sloped);
  - I = 0.0005 min(u, 2000);
  - N = 0.357 × (0.0025 min(u, 1000) + 0.15 if banked + 0.15 if sloped).

Two more stats are worked out the same way. They add to excitement only:

- **AssessedScenery** (stat 5, `0x5003f0`): theming around the station.
  - The game takes the first station piece (or the middle of the ride if it has no station) and counts the scenery
    on the 11 × 11 tiles around it by theme (`0x48c620`).
  - score = (the count of the most common theme − the counts of the other themes; the no-theme count is left out),
    × 2 if that theme is the ride's own, × 0.5 if the ride has a different theme;
  - then × 0.01, capped at 1;
  - plus 0.17 when the station is lower than a height read from the map at that spot (perhaps below ground or water;
    not confirmed). That 0.17 is also the whole result when nothing themed is nearby.
- **AssessedTrackScenery** (stat 32, `0x4fefc0`): what the train passes during the test run.
  - The test counts the objects it passes close to by what kind they are, in 26 counters (results +0x108 to +0x16c,
    increased in `0x4ffc00`–`0x5001f0`; which kind each counter is hasn't been named).
  - The stat is 0.06826 × a weighted sum of them. Each counter is capped (5 to 70), weighted 0.006 to 0.2, and some
    count any non-zero value as +4 or +10 at once; four of them are simple flags worth +0.25 to +1.
  - The Looping Coaster's program multiplies this stat by 4.5, so it can be worth a lot of excitement.

The Looping Coaster's program, with the names:

```
E += 0.7 x min(RideLength, 6000) / 6000
if TrainType = 1:  E += 0.45, I -= 0.25, N -= 0.2
if DualTrack = 1:  E += 0.4,  I += 0.05
E += 0.2 x (NCars - 1) / 7
(E, I, N) += (0.25, 0.5, 0.2) x MaxSpeed / 37
(E, I, N) += (0.4, 0.6, 0) x AverageSpeed / 9
E += 0.6 x min(RideTime, 150) / 150
(E, I, N) += (0.6, 6.0, 2.5) * AssessedGForces + (1.8, 2.0, 4.0) * AssessedTrackTypes
           + (1.0, 3.0, 1.5) * AssessedDrops   + (1.2, 1.5, 1.5) * AssessedTunnels      (* = per component)
E += 4.5 x AssessedTrackScenery;  E += 0.24 x AssessedScenery;  (E, I, N) += (3.0, 0.5, 0.2)
halve all if: HighestDropHeight < 7 and NInversions < 1;  MaxSpeed < 10;
              MaxNegativeVerticalG > -0.1 and NInversions < 1;  NDrops < 2
```

After the program (`0x501730` on):

- under one condition (`0xaf0ef0`) the ratings are set to zero;
- **passing other objects** (`0x500780`, excitement only):
  - During the test a callback (`0x5009e0`) records each object the train passes, with how often and how close.
  - Each object adds 5 × 10⁻⁶ × a whole-number property of the object (its data +0x3c; maybe its price in cents,
    not confirmed) × max(0, 1 − 0.05 × (max(distance, 20) − 20)). That's the full amount within 20 m and nothing
    beyond 40 m.
  - Passing twice adds 20 %, three times ×0.72; more than three passes counts −0.2 instead.
- an intensity adjustment from a ride setting nudges I by 0.2 × setting × I (or × (10 − I)) while I is 0–10;
- **intensity punishes excitement** (`0x4ff2f0`): E is halved at intensity 10, 11, 12, 13.2 and 14.5 (each
  threshold again), and × 0.1 at 20;
- **value** = AssessValue's (a, b, c) · (E, I, N), × 0.8 / 0.6 / 0.4 / 0.2 / 0.1 cumulatively as intensity passes
  15 / 20 / 25 / 30 / 35, clamped to 0–2,000;
- reliability and under-cover are stored alongside (`0x531170`).

That is why, per ride type, the stored ratings of the game's designs fit a linear model of their test results almost
exactly (Looping Coaster and Body Slide R² = 1.000, Wooden Coaster 0.93–0.997) while all coasters together don't
(0.5–0.7): each type has its own program, and the Assessed terms aren't linear.

So a custom ride's ratings can be changed by editing its program in its OVL — the same writer the Heartline loop
uses could do it.

## Still open

Every question from the first three passes is now answered from the code. Details still not pinned down:

- the flat rides' attractivity (their records are laid out differently and weren't read);
- which kind of object each of the 26 track-scenery counters stands for;
- what 0x500780's per-object value is (data +0x3c), and the height test behind AssessedScenery's 0.17;
- what the chooser's "far search" flag (method +8, up to 1,024 m instead of 80 m) is; perhaps owning a park map.

All of the numbers above are read from the code and not yet checked against a running game.
