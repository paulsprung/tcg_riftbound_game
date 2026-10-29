# Card rulings

The cards whose text needed a ruling before the engine could play them (formerly `docs/CARDS-UNSURE.md`). Each entry
gives the question, the ruling the engine follows, where the ruling comes from, and its status:

- **official**: Riot's Core Rules, FAQ, patch notes or errata say so directly.
- **official (by analogy)**: an official ruling on another card with the same wording.
- **unofficial, CR-cited**: riftboundfaq.com, an unofficial rulings site that cites Core Rules rule numbers; checked
  against the Core Rules.
- **rules-consistent reading**: no official ruling found. The engine follows the reading that fits the Core Rules best,
  and the reasoning is given.

"Changed" says whether this pass changed the engine's behaviour for that card. Oracle text comes from
`src/game/cards/oracle.gen.json` (rules text, errata applied). Tests: `tests/game/rulings.test.ts`, plus the card's
test in `tests/game/*-all.test.ts`.

## Sources

| Short name | Document |
|---|---|
| CR | Riftbound Core Rules, "Last Updated: 2026-10-09" (version 1.5): <https://playriftbound.com/en-us/rules-hub/> → <https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf> |
| Radiance FAQ | "Radiance Rules FAQ and Clarifications" (2026-10-26): <https://playriftbound.com/en-us/news/organizedplay/radiance-rules-faq-and-clarifications/> |
| Radiance patch notes | "Core Rules: Radiance Patch Notes (Effective October 16, 2026)", section "Unique Radiance Interactions": <https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/> |
| Radiance errata | "Radiance Errata Updates" (2026-10-09): <https://playriftbound.com/en-us/news/announcements/radiance-errata-updates/> |
| Unleashed FAQ | "Unleashed Rules FAQ and Clarifications" (2026-04-29), with the Unleashed errata: <https://playriftbound.com/en-us/news/rules-and-releases/unleashed-rules-faq-and-clarifications/> |
| Vendetta FAQ | "Vendetta Rules FAQ and Clarifications": <https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications/> |
| riftboundfaq | riftboundfaq.com card pages (unofficial, cite CR 1.5), e.g. <https://www.riftboundfaq.com/cards/mordekaiser-twice-slain> |

The FAQs and patch notes describe themselves as "a collection of official rulings" that take precedence over the Core
Rules document where they differ.

## The six cards that were left undefined (now defined)

### Akali, Brash (RAD) and Runeblade Anvil (RAD)

*"… banish the top card of your Main Deck. Until your next Ending Phase, you may play that card."*

- **Question:** If the card is banished during your own turn before your Ending Phase, does the window end at this
  turn's Ending Phase or at your next turn's?
- **Ruling:** The permission lasts until the next of your Ending Phases *begins*. Banished during your turn before its
  Ending Phase: it ends as this turn's Ending Phase begins (you can't play it during that Ending Phase). Banished during
  your Ending Phase or another player's turn: it ends as your next turn's Ending Phase begins. You still pay the card's
  costs. Akali: the first move each turn adds [1][A]; the second banishes and gives the permission.
- **Source:** Radiance FAQ (Runeblade Anvil: three Q&As); the same reading for Akali, Brash on riftboundfaq
  (<https://www.riftboundfaq.com/cards/akali-brash>), CR 316.9.b, 317.3.
- **Status:** official (Anvil); official by analogy (Akali, same wording).
- **Engine:** instruction `allowPlay` (effect `playFromBanish`, removed as that player's Ending Phase begins).

### Neeko, Blending In (RAD)

*"If Neeko is in your deck, choose up to 3 different legends in addition to your starting legend. When you play me,
choose one of those Legends and add it to your Legend Zone while I'm on the board."*

- **Question:** When and how are the legends chosen, what does an added legend do, and when does it leave?
- **Ruling:** Up to 3 legends (errata: "up to") are chosen while building the deck, different from each other and from
  the Champion Legend; they are shared by every Neeko in the deck and don't need to be revealed until added. When the
  play effect resolves, its controller adds one of them to their Legend Zone, ready, alongside the Champion Legend, for
  as long as that Neeko is on the board; it then ceases to exist. At most one of each can be in play (a legend already
  in play can't be added again). The added legends are legend cards, not tokens, and work like any legend. A Neeko an
  opponent plays (Kharox) uses its controller's own chosen legends.
- **Source:** Radiance patch notes ("So how does Neeko, Blending In actually work?"); Radiance FAQ (Kharox); Radiance
  errata (Neeko); CR 103.1, 440.2.b.4, 440.3.b, 440.3.c.
- **Status:** official.
- **Engine:** deck lists already carry `extra['neeko-blending-in']` (validated by `decks/validate.ts`); instruction
  `addLegend` creates the legend with `existsWhile` = Neeko (deleted as she leaves the board). Domain identity is the
  Champion Legend's only (CR 103.2.b).

### Orianna, Lady of Clockwork (RAD, legend)

*"At the start of your Main Phase, you may pay [1] to choose a friendly gear. It becomes a unit gear with Might equal to
its Energy cost until you choose another gear with me."*

- **Question:** How does a unit gear behave?
- **Ruling:** It is both a gear and a unit: it has Might (its Energy cost), can make Standard Moves, attack and defend,
  takes damage and dies like a unit. An attached Equipment detaches as it becomes a unit and stays where it is; while it
  is a unit its effect text is inactive and Equip/Weaponmaster can't attach it (nothing happens). A Deploy gear made a
  unit at a battlefield its controller doesn't control applies Contested (a showdown or combat opens after the chain).
  The previous gear stops being a unit as soon as another gear is chosen (at finalization of the next trigger); Equipment
  attached to it stays attached; a Deploy gear in base stays in base; a non-Deploy gear left at a battlefield is
  recalled by the next cleanup. Copies of a unit gear are gear (copyable traits don't include the change).
- **Source:** Radiance patch notes (three Orianna Q&As, "Equipment Units"); CR 137.3.b, 143.5–143.5.b, 149.3, 459.1;
  riftboundfaq (<https://www.riftboundfaq.com/cards/lady-of-clockwork>).
- **Status:** official.
- **Engine:** `GameObject.asUnit` (`typesOf` adds 'unit'; base Might from it), `makeUnitGear` / `endUnitGears`,
  instruction `becomeUnit`.

### The Ball (RAD)

*"[Deploy] [Ganking] (While this is a unit, it can move from battlefield to battlefield.) When you play or move this,
choose one — • Draw 1. • Deal 2 to enemy units here."*

- **Question:** Can a gear with [Ganking] make Standard Moves, and what exhausts?
- **Ruling:** Only units have a Standard Move and Ganking only adds options to it, so The Ball moves on its own only
  while it is a unit (Orianna, Lady of Clockwork): then it moves like any unit (exhausting it), from battlefield to
  battlefield too. As a plain gear it moves only when an effect moves it (Command: Attack); either kind of move triggers
  "when you … move this".
- **Source:** the card's reminder text; CR 144 (Standard Move is a unit's), 144.4.c, 810.1.a–c.
- **Status:** official (CR + reminder text).

### Shady Spectacles (VEN)

*"As this is attached to a unit, choose another friendly unit. The equipped unit becomes a copy of that unit for as long
as this is attached to it."*

- **Question:** What does the copy take and keep, when is the unit chosen, and when does it end?
- **Ruling:** A copy effect: the equipped unit takes the chosen unit's copyable traits (printed, or already copied,
  traits; a token's traits as created) and nothing else. Its own status stays: damage, buffs, Might modifications,
  Empowered, Temporary given by effects, designation. The unit to copy is chosen anew each time Spectacles is attached,
  right after the attach (Vendetta: a replacement that adds the copy to the attach event). The copy ends when
  Spectacles is detached or leaves the board. A copy of a unit gear is a gear.
- **Source:** Vendetta FAQ (three Shady Spectacles Q&As); CR 446, 479.1–479.1.d; riftboundfaq
  (<https://www.riftboundfaq.com/cards/shady-spectacles>: granted Temporary isn't copied).
- **Status:** official.
- **Engine:** `GameObject.copyFx` (the object's definition while the effect lasts), `mut.setCopy`; static
  `copyOnAttach` read by the attach instructions.

## Provisional readings, reviewed

### Unleashed

| Card | Question | Ruling (engine) | Source | Status | Changed |
|---|---|---|---|---|---|
| altar-of-blood | Is "may pay [A][A][A]" asked? | Asked: the dying unit's controller decides (and pays). | card text ("its controller may pay"); CR 370 (replacement effects), 372 (the affected object's controller decides between them) | rules-consistent reading | yes: was applied automatically |
| diana-scorn-of-the-moon | Usable outside showdowns? | Yes: a [Reaction] Add ability usable any time (CR 430.3); the Energy it adds can be spent only while a showdown is going on. | CR 430.1–430.3; card text | rules-consistent reading (the restriction is on spending, not on using) | yes: was usable only in showdowns |
| honeyfruit | What does "[Level 6][>] [>>][Reaction][>] [E]: [Add] [1][A]" do to the first ability? | A second Add ability while you have 6+ XP; the first one stays (both need [E]). | CR 824 (Level: "while … I have"), card layout | rules-consistent reading | no |
| dancing-grenade | What counts as "each time this spell has dealt damage", how is the replay made? | Each Deal by this card this turn adds 1 Bonus Damage to its 2; the replay is a limited play from the trash its controller may decline at the payment. | CR 418, 712 (Bonus Damage), 420.3 | rules-consistent reading | no |
| elder-dragon | Targets or a resolution-time choice? | Targets: up to one enemy unit per location, each bound to its location; a target that moved to another location is unaffected. | Unleashed FAQ (Elder Dragon and Flash); riftboundfaq (targets chosen at finalization) | official | yes: was a resolution-time choice |
| crescent-strike | One Deal or two? | One instruction, one Deal action dealing 4 and 1 at the same time. | CR 418.1.c–d (damage can be dealt to several units at once) | rules-consistent reading | yes: was two Deals |
| leblanc-deceiver | When is "another unit there" chosen, what does the Reflection take? | "Then do this:" is a reflexive trigger: the copy target is chosen after the Reflection has entered, among the other units there; the Reflection takes the copyable traits only and gets [Temporary]. | Unleashed errata + FAQ (Zilean/Deceiver walkthrough); CR 388, 479.1.b; riftboundfaq (<https://www.riftboundfaq.com/cards/deceiver>) | official | no |
| ivern-nurturer | What does "if you revealed a Bird, Cat, Dog, or Poro" read? | The tags of the unit revealed (and drawn) this way. | card text; CR 425 | rules-consistent reading | no |
| gentle-gemdragon, hwei-brooding-painter | Which runes can "ready up to 2 runes" pick? | The engine offers exhausted runes only: readying a ready object does nothing more (CR 416.1.b–c), so the outcome is the same. | CR 416.1 | rules-consistent reading | no |
| atakhan | Which Power symbols come off? | One [Y] per Power symbol of the killed unit, one Energy per Energy; the discount is fixed as the total cost is determined (the kill is paid after the Energy and Power). | Unleashed FAQ (Atakhan and Accelerate); Radiance FAQ (Atakhan and Iron Revenant: CR 356.4.g, 357.1–357.2) | official (timing); rules-consistent (symbols, card text) | no |
| blue-sentinel | Which Main Phase is "your next Main Phase" when the hold happens in the Beginning Phase? | This turn's: the next one to begin. | Radiance FAQ on "your next Ending Phase" (the next of that phase to begin) | official (by analogy) | no |
| repulse | Can it counter abilities? | Yes: "a spell or ability" is a finalized spell or ability on the chain; an enemy ability that chooses only that friendly unit can be countered. | CR 355.9.a.2; card text; Unleashed FAQ (Repulse and Alpha Strike: targeting relationships) | official (CR) | yes: abilities can now be chosen (Not So Fast too) |
| scuttle-crab | "You can look at their facedown cards this turn" | The opponent's facedown cards now, and the ones they hide later that turn as they are hidden; what was seen stays known. | card text; CR 422, 425 | rules-consistent reading | yes: later hides now seen |
| stalking-wolf | Where can it Ambush? | Ambush locations as the location is chosen (step 2, before the cost's kill in step 4): the Pet to be killed is still there, so its battlefield qualifies even if it is your only unit there. | CR 355 (finalization order), 357.2, 822 (Ambush) | rules-consistent reading | no |
| shard-of-undoing | What does "the first time" count? | The first friendly death *during your Beginning Phase* each turn; deaths at other times don't use it up. | card text (the phase is part of the counted event); CR 383.1.b | rules-consistent reading | yes: every friendly death used to count |
| zilean-time-mage | Asked? Same instructions for the copy? | A "may" replacement, asked; the copy is played the same way (location, ready, Temporary …) — it inherits the event's modifications. | Unleashed FAQ (Zilean/Deceiver: rule 375); CR 446.3 | official | no |

### Radiance

| Card | Question | Ruling (engine) | Source | Status | Changed |
|---|---|---|---|---|---|
| ahri-confident | What counts as "you reduce the Might"? | Any -[M] that an ability of an object you control applies: spells, triggered and activated abilities (non-zero -[M]), and passives when they newly apply a non-zero decrease (Leona, Zealot's -8 as a unit becomes stunned; "to a minimum of" counts what it takes off). | Radiance patch notes (Ahri, Confident / Discipline / Leona, Zealot) | official | yes: passives used not to count |
| dockside-lock-up | Is "kill this to play the banished card" optional? | A cost within instructions at the start of the effect: the trigger's base cost, which its controller may decline (the trigger then leaves the chain). The banished card is played by you, from any player's banishment, ignoring its cost. | CR 383.3.b, 404.1.b.1, 405.2, 740.4.a.2 | official (CR) | yes: was paid without asking |
| chronobreak | Units chosen how; order; tokens? | Units are picked as it resolves (no "choose"); the turn player plays their units back first, in their chosen order, then the others; a banished token ceases to exist and can't come back. | Radiance patch notes (Chronobreak reminder text); CR 186.1, 303.2.a; riftboundfaq (<https://www.riftboundfaq.com/cards/chronobreak>) | official | no |
| black-market | Who may use it? | Any player, on their own turn, once per turn each, even without controlling the battlefield. | card text | rules-consistent reading | no |
| ekko-boy-who-shattered-time | "Kill me at end of turn": which turn? Do tokens count as "the next unit you play"? | The end of this turn only; if the unit's death is replaced it won't die later; banished and replayed, it is a new object without the ability. A token unit you play is "the next unit you play" too (it uses the discount and gets the ability). | Radiance patch notes (Ekko and Unlicensed Armory); riftboundfaq (<https://www.riftboundfaq.com/cards/boy-who-shattered-time>); CR 440.2.c (tokens are played) | official (end of turn); rules-consistent reading (tokens) | yes: tokens didn't count |
| mechanical-bandit | Ties for the lowest Energy cost? | "A card with the lowest Energy cost": a shared lowest counts, so you draw yours on a tie. | card text | rules-consistent reading | no |
| mordekaiser-twice-slain | Is the "may" asked, and which unit? | Asked; its controller picks the friendly unit to kill — another one about to die with him included. Kills nobody can be asked about (a kill paid as a cost) keep the old default: the friendly unit with the least Might. | riftboundfaq (<https://www.riftboundfaq.com/cards/mordekaiser-twice-slain>, CR 370.1.c, 371.1, 740.4.a); card text "may" | unofficial, CR-cited | yes: was automatic, least Might |
| scrutinizing-scope | Which types can be guessed? | Unit, spell or gear: the card types a Main Deck holds. | CR 103.3 | rules-consistent reading | no |
| titanic-shrine | Is "exhaust me to draw 1" optional? | The trigger's base cost, which may be declined. | CR 383.3.b, 405.2 | official (CR) | yes: was paid without asking |
| seraphic-wyvern | Channel Phase too? What does "if you couldn't channel" see? | Every channel, the Channel Phase included; the extra rune is a separate object: an instruction that checks how many runes it channelled counts the original ones only (Mobilize, Catalyst of Aeons). | Radiance FAQ (Seraphic Wyvern with Mobilize / Catalyst of Aeons, CR 359.3.e.14.c) | official | no |

### Vendetta

| Card | Question | Ruling (engine) | Source | Status | Changed |
|---|---|---|---|---|---|
| stargazer | Spells given [Flow] by an effect (Kennen, Storm of Shuriken)? | They have [Flow] too and get the discount when played from the trash. | CR 829 (Flow), 479.3 (granted keywords are had) | rules-consistent reading | yes: only printed [Flow] counted |
| zed-master-of-shadows | What counts as "you banish"? | Banishes you are responsible for: by your spells, abilities and costs, and the "then banish it" of a [Flow] card you played; a "banish it instead" replacement of someone's death doesn't count as yours. | CR 412.1, 412.4 (responsibility), 829.1.b.1 | rules-consistent reading | no |
| wild-claw | When is "Then you may do this: Empower it" decided? | "Then … do this:" is a reflexive trigger added after the played card: the card enters first, then its controller may empower it. | CR 388–389, 354.3; Unleashed FAQ (reflexive trigger order, Deceiver) | official (CR) | no |
| threshold-of-the-gray | When does "When combat starts here" trigger? | A start-of-combat effect: at the start of combat, before attacker and defender get their designations; the attacker and the defender each add [1]. | CR 466.2.b | official (CR) | yes: used to trigger with the designations |
| temporal-breach | A unit at a base other than its owner's? | It can't be played to a base of a player other than its owner: it stays in banishment. At a battlefield, its owner plays it there; at its owner's base, there. | Vendetta FAQ (Hostile Takeover + Temporal Breach); riftboundfaq (<https://www.riftboundfaq.com/cards/temporal-breach>) | official | yes: was played to its owner's base |

## Engine-wide rules this pass added

- **A trigger's cost may be declined** (CR 405.2): a mandatory triggered ability whose effect starts with a cost
  ("kill this to …", "exhaust me to …", "recycle me to …") asks its controller whether to pay; declining removes it.
- **Optional death replacements are asked** (Altar of Blood, Mordekaiser, Sett, Unlicensed Armory): before a cleanup's
  kills and a kill instruction, each dying unit's controller decides (Mordekaiser: and picks the unit). A kill no one can
  be asked about mid-way (a cost's kill) applies them when payable.
- **Spells and abilities on the chain as targets** (CR 355.9.a.2): "a spell or ability" selectors (Repulse, Not So Fast)
  offer finalized ability items too (option key `t:item<id>`).
- **Unit gear, copy effects, extra legends**: see Orianna, Shady Spectacles and Neeko above.
