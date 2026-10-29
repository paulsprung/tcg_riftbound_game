# Cards to review by hand

Two lists. **Unsure** cards are left undefined on purpose: their text or ruling could not be settled without guessing, so
the engine doesn't play them yet (`npx tsx scripts/cards/coverage.ts --list` shows them as undefined). **Provisional**
cards are defined and tested, but rest on a reading of the text that should be checked; the definitions stay unless the
review says otherwise.

Oracle text is quoted from `src/game/cards/oracle.gen.json` (rules text, errata applied).

## Unsure (manual review) — not implemented

| Card | Oracle text | Question | Options considered |
|---|---|---|---|
| akali-brash | The first time I move each turn, [Add] [1][A]. / The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.) | When does "Until your next Ending Phase" end if the card is banished during your own turn before your Ending Phase: at this turn's Ending Phase, or at the Ending Phase of your next turn? | (a) this turn's Ending Phase (the next one to happen); (b) the Ending Phase of your next turn (otherwise the text would say "this turn") |
| runeblade-anvil | When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.) / [2][P], [E]: Kill this. | Same as Akali, Brash: which Ending Phase ends the window? | as for akali-brash |
| neeko-blending-in | If Neeko is in your deck, choose up to 3 different legends in addition to your starting legend. / When you play me, choose one of those Legends and add it to your Legend Zone while I'm on the board. | Deck building: where do the extra legends sit before the game (revealed? domain identity?), and what does an added legend do in the Legend Zone (its abilities active, its own exhaust state, does it leave when Neeko leaves)? | (a) extra legends only add their abilities while Neeko is on the board; (b) they count for deck identity too |
| orianna-lady-of-clockwork | At the start of your Main Phase, you may pay [1] to choose a friendly gear. It becomes a unit gear with Might equal to its Energy cost until you choose another gear with me. | How does a "unit gear" behave: does it move, attack and defend, take damage and die, keep its gear abilities; a Deploy gear at a battlefield — is it a unit there; an attached Equipment — does it detach? | (a) full unit rules plus gear; (b) only Might and combat |
| the-ball | [Deploy] / [Ganking] / When you play or move this, choose one — • Draw 1. • Deal 2 to enemy units here. | Can a gear with [Ganking] make Standard Moves between battlefields (gear normally can't move), and what exhausts? | (a) it moves like a unit (Standard Move, exhausting); (b) Ganking only matters when an effect moves it |

## Implemented provisionally — review

### UNL batch A

| Card | Oracle text | Question | Options considered | Implemented as |
|---|---|---|---|---|
| altar-of-blood | If a unit here would die during combat, its controller may pay [A][A][A] to heal it, exhaust it, and recall it instead. | Is the "may" asked, or applied whenever the cost can be paid? | (a) ask the controller each time; (b) apply automatically when payable (as Sett, Unlicensed Armory) | (b) |
| diana-scorn-of-the-moon | [Reaction][>] [E]: [Add] [1]. Spend this Energy only during showdowns. | Can the ability be used outside a showdown (Energy that waits for one)? | (a) usable any time, Energy restricted to showdowns; (b) usable only while a showdown is going on, plain Energy | (b) |
| honeyfruit | This enters exhausted. / [Reaction][>] [E]: [Add] [A]. / [Level 6][>] [>>][Reaction][>] [E]: [Add] [1][A]. | What does the Level 6 line do to the first ability? | (a) a second Add ability while Level 6 (the first stays); (b) the first ability becomes "[Add] [1][A]" | (a) |
| dancing-grenade | Deal 2 to a unit. Its controller may play this spell again for [A]. If they do, this deals 1 additional Bonus Damage for each time this spell has dealt damage this turn. | What counts as "each time this spell has dealt damage", and how is the replay made? | Deals by this card this turn added to its 2; the replay is a limited play from the trash, "may" = decline at the payment | as described |
| elder-dragon | When you play me, choose up to one enemy unit at each location. Deal 1 to them. | Targets (chosen as it goes on the chain) or a resolution-time choice? | (a) targets; (b) chosen as it resolves | (b) |
| crescent-strike | Choose a battlefield and an enemy unit there. Deal 4 to that unit and 1 to each other enemy unit there. | One Deal or two? | (a) one Deal action; (b) 4 to the unit, then 1 to each other enemy unit | (b) |
| leblanc-deceiver | … play a ready Reflection unit token there. Then do this: It becomes a copy of another unit there. Give it [Temporary]. | When is "another unit there" chosen, and what does the copy take? | Chosen as the ability resolves; the Reflection copies the definition (printed traits), not modifications | as described |
| ivern-nurturer | … Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit. | What does "revealed a Bird …" read? | The tags of the card drawn this way | as described |
| gentle-gemdragon, hwei-brooding-painter | "ready up to 2 runes" | Which runes can be picked? | Any rune you control / only exhausted ones | only exhausted runes |
| atakhan | … I cost [1] less for each Energy it costs and [Y] less for each Power it costs. | Which Power symbols come off? | Only [Y] (order) symbols, one per Power symbol of the killed unit | as described |
| blue-sentinel | When I hold, [Add] [A] at the start of your next Main Phase. | Which Main Phase is "next" when the hold happens in the Beginning Phase? | (a) this turn's Main Phase; (b) the Main Phase of your next turn | (a) a delayed ability this turn |

### UNL batch B

| Card | Oracle text | Question | Implemented as |
|---|---|---|---|
| repulse | Choose a friendly unit at a battlefield. Counter an enemy spell or ability that chooses it and no other friendly unit. | Abilities on the chain can't be chosen by the engine yet (as with Not So Fast). | Counters enemy spells only |
| scuttle-crab | … You can look at their facedown cards this turn. … | Knowledge isn't time-limited in the engine. | The player looks at the facedown cards (they stay known) |
| stalking-wolf | As an additional cost to play me, kill a Bird, Cat, Dog, or Poro you control. You may [Ambush] me to its battlefield, even if you don't have other units there. | The Ambush location is chosen (step 2) before the cost is paid (step 4), so the location isn't tied to the killed unit. | Normal Ambush locations at the time of choice; any Pet may be killed |
| shard-of-undoing | The first time a friendly unit dies during your Beginning Phase each turn, … | "First time" is counted per turn for every friendly death (a death outside your Beginning Phase uses it up). | as described |
| zilean-time-mage | Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token and an additional copy of it instead. | The copy is played at the same location with the same instructions (ready, Temporary …). | A "may" replacement, asked |

### RAD

| Card | Oracle text | Question | Implemented as |
|---|---|---|---|
| ahri-confident | When you reduce the Might of an enemy unit here by 1 or more, give me +1 [M] this turn. | What counts as "you reduce"? | Any Might decrease by an effect you control (spells, abilities, Disarm); static decreases don't count; once per action |
| dockside-lock-up | When you hold here, kill this to play the banished card, ignoring its cost. | Is "kill this to …" optional? | A cost of the hold trigger, paid (not asked); the banished card is played by you from any player's banishment |
| chronobreak | As an additional cost to play this, pay any amount of Power. Banish that many units you control, then … | Units chosen as it resolves (not as targets). | as described |
| black-market | [A][A]: Draw 1. Each player may use this ability once on their turn. | — | Any player on their own turn, once per turn each |
| ekko-boy-who-shattered-time | Disempower me, [E]: Reduce the cost of the next unit you play this turn by [2][A] and give it "Kill me at end of turn." | "end of turn": the end of the turn it is played in. Tokens don't count as "the next unit". | as described |
| mechanical-bandit | … If you revealed a card with the lowest Energy cost, draw it. … | Ties | Every card with the lowest Energy cost counts (you draw yours on a tie) |
| mordekaiser-twice-slain | Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead. | The "may" and which unit | Applied automatically when another friendly unit exists; the one with the least Might is killed |
| scrutinizing-scope | They guess a card type. | Which types can be guessed | Unit, Spell, Gear (Main Deck types) |
| titanic-shrine | … exhaust me to draw 1. | Optional? | A cost of the trigger, paid automatically (as Dockside Lock-Up) |
| seraphic-wyvern | If you would channel runes, channel that many runes plus 1 exhausted rune instead. | Channel Phase too? | Every channel (the Channel Phase included), once per channel |
