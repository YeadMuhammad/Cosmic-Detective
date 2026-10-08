# **Cosmic Detective \- Team Pleadies**

# **1\. Vision**

Cosmic Detective is a story driven investigation game built on real astronomical survey data from NASA's SPHEREx mission. Players take on the role of a detective who inspects sky images to find objects that changed position between observations: asteroids, comets, brown dwarfs, and candidate planets.

The game exists to solve a real problem. SPHEREx returns images of more than a billion objects across the sky, and no single team of scientists can review all of it. By turning image inspection into a structured, rewarding investigation, the game invites a large number of players to do real, useful work, while teaching them how professional astronomers actually verify a discovery.

The player experience should feel like a detective story first and a data task second. Every mechanic in the game is a reskinned version of a real verification step used in professional moving object searches: comparing two exposures, subtracting one frame from another, checking a candidate against known catalogs, and ruling out false positives before anything is called a finding.

# **2\. Design Pillars**

These pillars guide every design decision. A feature that conflicts with a pillar should be cut or redesigned, not shipped as an exception.

| Pillar | What it means in practice |
| :---- | :---- |
| Real data first | Every image, coordinate, and object a player interacts with comes from an actual SPHEREx observation or a real reference catalog. Nothing is generated or faked to make a level easier or more exciting. |
| Evidence before reward | A flagged object is never automatically treated as correct. It must pass the same checks a real analyst would apply before it counts toward score, rank, or story progress. |
| Accessible to everyone | No astronomy background is required to start. Controls, color use, and onboarding must work for a first time player and for players with color vision differences. |
| Mastery through progression | Harder tools and harder tiles are earned, not given. A new player should never be handed a tool before the game has taught them why it exists. |
| No false discoveries | The game never tells a player they found a new planet, a confirmed object, or a scientific first. Confirmed language is reserved for objects verified against real catalogs. |

# **3\. Scope and Non-Goals**

This section defines what the first playable build will and will not attempt. Later phases may revisit non-goals once the core loop is proven.

## **3.1 In scope for the first build**

| Area | Included |
| :---- | :---- |
| Data | One verified pair of SPHEREx observations of the same sky region, taken months apart |
| Core loop | Case briefing, tile scan, mandatory target flag, bonus inspection |
| Tools | Blink Comparator and Difference Imaging |
| Progression | Rank 1 and Rank 2 of the campaign |
| Verification | Stationary source check and known object cross match on flagged tiles |
| Accessibility | Dark mode, light mode, colorblind safe mode, guided first time tutorial |

## **3.2 Explicit non-goals**

| Non-goal | Reason |
| :---- | :---- |
| Claiming a confirmed discovery inside the game | Only professional follow up can confirm a new object. The game must never say otherwise |
| Simulated or generated sky images | Breaks the real data first pillar and undermines player trust |
| Full six detector, full sky coverage at launch | Not achievable in the initial build; one verified region is sufficient to prove the loop |
| Monetization or paid progression | Out of scope for this design; would compromise consensus scoring integrity |
| Open ended chat or social features at launch | Adds moderation and scope risk unrelated to the core pillars |

# 

# **4\. Core Gameplay Loop**

## **4.1 Loop structure**

Every level follows the same four step loop. The loop is identical from the first tutorial level to the final open ended research level; only the tools, tile difficulty, and consequence of a flag change.

| Step | Description |
| :---- | :---- |
| 1\. Case briefing | The player reads a short narrative assignment and receives a target coordinate grid |
| 2\. Scan grid | The player uses their currently unlocked tools to inspect a batch of 10 to 15 sky tiles |
| 3\. Mandatory target | The player must identify and flag the primary anomaly in the batch to advance the story |
| 4\. Bonus inspection | The player may inspect remaining tiles for experience points, tool upgrades, and rank progress |

## **4.2 Session structure**

A level is a single sitting of one coordinate grid batch. The campaign is fifty levels long, grouped into five chapters. A player is expected to complete a level in a few minutes, so a session can be as short as one level or as long as an entire chapter.

# 

# **5\. Game Mechanics**

## **5.1 Detective tools**

Tools are unlocked in a fixed order tied to chapter progress. Each tool is a real image analysis technique presented through a simple, guided interface.

| Tool | Unlocked in | What it does for the player | Real operation underneath |
| :---- | :---- | :---- | :---- |
| Blink Comparator | Chapter 1 | Toggles between two exposures of the same tile so a moving object appears to jump | Displays two registered, wavelength matched images in alternation |
| Difference Imaging | Chapter 2 | Produces a single image showing only what changed between two exposures | Subtracts one registered frame from another |
| Sector Map and Multi-Band Compositor | Chapter 3 | Lets the player choose their own coordinates and view them across SPHEREx's spectral channels | Renders a chosen sky position across multiple wavelength bands |
| Light Curve Analyzer | Chapter 4 | Plots an object's brightness over time as a graph | Reads photometry values from the mission's spectrophotometry tool |
| Full Research Suite | Chapter 5 | Combines all tools plus an export function | Runs the full verification pipeline and prepares a candidate file |

## **5.2 Tile inspection**

Each tile in a batch is a small cropped image of one sky region. A tile carries its own metadata: observation dates, detector, wavelength, and point spread function size. This metadata is always visible so the player learns to read it the way an analyst would.

## 

## **5.3 Verification pipeline**

When a player flags a tile, the flag is not accepted at face value. It passes through the same checks a real moving object search uses, and the result of each check is shown to the player rather than hidden.

| Check | What it catches | Result shown to player |
| :---- | :---- | :---- |
| Stationary source check | A star that only appears to move because of a small registration error | Rejected, with the reason: same object, no real motion |
| Blend and halo check | A false signal caused by two overlapping sources or the glow around a bright star | Rejected, with the reason: image artifact, not a real object |
| Catalog cross match | An object that already has a known identity | Labeled known object, with the catalog name shown |
| No remaining match | An object that survives every check above | Labeled candidate for follow up, never labeled confirmed |

## **5.4 Scoring and weighted consensus**

Score is not based on a fixed answer key alone. Early chapters use known answers to measure accuracy. Later chapters rely on agreement across many players, weighted by how accurate a player has proven to be.

| Chapter | How a flag is scored |
| :---- | :---- |
| 1 | Compared only against a known answer. Does not affect any other player's score |
| 2 | Compared against the combined answers of many previous players, with heavy redundancy since players are still new |
| 3 and 4 | A high ranking player's flag counts for more, so fewer total reviews are needed to resolve a tile |
| 5 | A tile is only marked for professional follow up once expert consensus agrees and the tile survives the full verification pipeline |

# 

# **6\. Progression Systems**

## **6.1 Ranks**

| Rank | Title | Unlocked around | Cumulative tiles reviewed |
| :---- | :---- | :---- | :---- |
| 1 | Learner | Level 1 | 100 to 120 |
| 2 | Field Analyst | Level 11 | 200 to 250 |
| 3 | Sky Inspector | Level 21 | 320 to 380 |
| 4 | Deep Space Lead | Level 31 | 420 to 480 |
| 5 | Master Investigator | Level 41 | 500 or more |

## **6.2 Experience and unlock rules**

Experience points come from the bonus inspection step, never from the mandatory target alone. A tool never unlocks mid level; it always unlocks at the start of a chapter, after a short guided lesson on how to use it.

# **7\. Narrative**

## **7.1 Setting and premise**

The player is a detective hired to investigate irregularities in survey data from a real NASA mission. The narrative frame is light and does not require prior knowledge of astronomy; it exists to give purpose and pacing to what would otherwise be a repetitive task.

## 

## **7.2 Chapter synopses**

| Chapter | Title | Arc summary |
| :---- | :---- | :---- |
| 1 | The Training Grounds | The player is hired to review archived telemetry and learns to spot genuine moving objects while filtering out noise and artifacts |
| 2 | The Phantom Orbit | An anomalous signal near a dense star field leads the player to learn frame subtraction to cancel out static stars |
| 3 | The Cold Companion | Tracking an object that emits almost no visible light, the player gains free choice of sky sector and learns multi band comparison, eventually identifying a cold, faint companion object |
| 4 | The Shattered Record | A scattered debris field points to a massive, unseen body. The player learns to read brightness over time to separate ordinary variation from a real signal |
| 5 | Open Sky Research Portal | The linear story concludes. The game becomes an open ended portal where the player chooses coordinates freely and contributes to a live, ongoing review effort |

## **7.3 Tone and voice**

Writing should read like a measured field report, not a tabloid headline. A tile that is rejected is treated as useful progress, not failure. The narrator never overstates a finding; excitement in the writing should come from the process of narrowing down an answer, not from premature claims.

# 

# **8\. Onboarding: First Time Experience**

## **8.1 Guided tutorial sequence**

A new player is introduced to the game by a guide character who highlights one interface element at a time and requires a real action before continuing, similar to the mentor style seen in many mobile strategy games. The player cannot skip ahead of the current step, but can skip the tutorial as a whole from a visible control at any time.

| Step | Guide highlights | Player must do |
| :---- | :---- | :---- |
| 1 | The case briefing panel | Read the first case and tap continue |
| 2 | A single sky tile | Open the tile to view it full size |
| 3 | The Blink Comparator control | Toggle between the two exposures at least once |
| 4 | The flag button | Flag the tile the guide points to |
| 5 | The result panel | View whether the flag passed or was rejected, and why |
| 6 | The experience and rank bar | Collect the experience reward and see progress toward Rank 2 |
| 7 | The chapter map | Confirm the next level has been unlocked |

## **8.2 Tutorial content rules**

The tutorial always uses a tile with a known, guaranteed correct answer, so a first time player always experiences a successful flag before facing an ambiguous one. The guide character never blocks the colorblind safe mode toggle, which is reachable from the very first screen. The full tutorial can be replayed at any time from the settings menu.

# **9\. Accessibility Systems**

## **9.1 Display modes**

Three display modes are available from the first screen the player sees, before login or tutorial: dark mode as the default, light mode, and a colorblind safe mode. Switching modes never changes game logic, only presentation.

## 

## **9.2 Colorblind safe mode: the Okabe Ito palette**

In colorblind safe mode, every color that carries meaning in the interface, rather than pure decoration, is drawn from the Okabe Ito palette. This palette remains distinguishable across the most common forms of color vision deficiency.

| Color name | Hex code | Meaning it is assigned to |
| :---- | :---- | :---- |
| Orange | E69F00 | Player rank and experience indicators |
| Sky blue | 56B4E9 | Known object, matched against a catalog |
| Bluish green | 009E73 | Flag accepted, passed verification |
| Yellow | F0E442 | Pending review, awaiting more player consensus |
| Blue | 0072B2 | Neutral information and metadata labels |
| Vermillion | D55E00 | Flag rejected, with a shown reason |
| Reddish purple | CC79A7 | Candidate for professional follow up |
| Black | 000000 | Default text and interface structure |

# **10\. Content Plan**

## **10.1 Data sources**

| Source | Used for |
| :---- | :---- |
| SPHEREx Level 2 spectral images | The raw tiles players inspect |
| SPHEREx spectral mosaic tool | Multi band views in Chapter 3 |
| SPHEREx spectrophotometry tool | Light curve data in Chapter 4 |
| Public star and small body catalogs | Known object cross matching, and the guaranteed correct tutorial tile |

## **10.2 Level and tile plan**

The campaign totals fifty levels across five chapters, with each level presenting a batch of ten to fifteen tiles. Across the full campaign a player will have inspected upward of five hundred individual sky tiles by the end of Chapter 5\.

## **10.3 Live content**

Chapter 5 draws from unclassified, real, currently unreviewed sky tiles rather than a fixed content set. This is the only chapter where content is not authored in advance.

# **11\. Systems Overview**

This section is a design level summary, not a technical specification. It exists so that narrative, art, and engineering decisions can be checked against the same shared picture of how the game is built.

| System | Responsibility |
| :---- | :---- |
| Client | Presents tiles, tools, case briefings, rank and experience state, and the guided tutorial |
| Verification service | Runs the stationary source check, blend and halo check, and catalog cross match on every flagged tile |
| Progress and consensus service | Tracks player rank, experience, and the weighted agreement across players described in Section 5.4 |
| Data service | Serves registered, wavelength matched tile pairs and metadata from the source catalogs listed in Section 10.1 |

# **12\. Success Criteria for the First Build**

The first playable build is considered complete when all of the following are true.

* A new player can complete the guided tutorial and finish the first level without external help

* At least one full chapter is playable start to finish using real, registered SPHEREx data

* Every flag a player submits returns a visible, correct verification result, including rejections

* Dark mode, light mode, and colorblind safe mode are all functional and reachable before login

* No text anywhere in the build claims a confirmed discovery or names a candidate as Planet X