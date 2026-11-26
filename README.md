# The Enterprise Deal

A classroom game about selling to a large company, played in three two-minute rounds. Students join on
their phones and become start-ups or buyers. Each round a buyer can stay with the supplier they have
(safe) or sign a start-up (more to win, more to lose), and some start-ups are secretly not ready. After
every round the projector shows who signed and who got burned.

## The pages

| Page | Who uses it | File |
|---|---|---|
| Presentation | the projector: slides with the live game built in | `deck.html` |
| Player | every student, on a phone (the QR code points here) | `index.html` |
| Host panel | your laptop: roster, data export, reset | `host.html` |
| Projector only | the game screens without slides, for rehearsals | `screen.html` |
| Speaking script | the four speakers: what to say and press, slide by slide | `script.html` |

One window must stay open and in front for the whole game, because it runs the automatic steps (dealing
role cards, late joiners, opening and closing each round on the clock): either the presentation or the host panel. If both
are open in the same browser, only one of them does that work.

## How the slides follow the assignment brief

Hook (the game) and a one-slide roadmap, then the six required sections in order: 1 what it is and why
now, 2 how and why it works, 3 who it is best for, 4 where it falls short, 5 audience engagement (the
room's results and a table-group task), 6 where it is heading and a sequenced playbook. References are
in APA format on the last slides. The wording is a draft for the team to rewrite in its own words.

## Running the presentation

1. Open `host.html`, press **Create game**, then **Open the presentation**. Move that window to the
   projector and press **F** for full screen.
2. Arrow keys (or a clicker) move through the slides. Some slides reveal one item per click.
3. On the game slide, small controls sit at the bottom left: **Start**, then per round **+30 s** and
   **Close the round**, and during a reveal **Start round 2 now** and **Hold**. They are faint until you
   point at them. If you press nothing after Start, the whole game runs on the clock.
4. Students scan the QR code on that slide and type their name.
5. After round 3 closes, the next slides show this room's results beside the research.
6. In the host panel, **Download CSV files** saves every decision of every round, every player and the event log.
   **Reset game** clears players and results but keeps the game code.

## How the game is played

One gamble, repeated three times, with a reveal after each round.

- **Buyers** make one decision per round. Stay with the current supplier: +1, always. Or sign a start-up:
  +4 if it delivers, −6 if it fails. To sign, the buyer types the start-up's two-digit deal code, which
  they can only get by talking to it.
- **Start-ups** try to get signed: +3 for a full deal, +1 for a pilot. One buyer can sign a start-up per
  round. About one start-up in three is dealt a product that is **not ready**: it will fail every time,
  it knows, and nobody else does.
- **Round 1, words only.** Buyers have nothing to go on but the pitch.
- **Round 2, proof and a small first step.** Half of the start-ups that work hold proof (a reference
  customer), which a buyer sees when they type the code. Buyers may also sign a pilot: +2 or −1.
- **Round 3, references and introductions.** Everyone can see what each start-up did in rounds 1 and 2,
  and each buyer is told the truth about one start-up.
- A buyer who does nothing in a round stays. Whether a start-up delivers is fixed by its card: no dice.

On average a blind full deal is worth less than staying, and a blind pilot about the same as staying, so
the room should be cautious in round 1 and bolder as it can check more. All of it is in `game` and
`payoff` in `js/config.js`. These are game settings, not measured facts.

## Rehearsing alone (demo mode)

In the host panel, **Add simulated players** fills the game with bots. Simulated buyers hear a few pitches
each round and decide like a cautious class would; simulated start-ups can be tapped from a buyer's phone,
since you cannot talk to them. You can join from your own phone at the same time. Any result that includes
bots is labelled "Simulated run" on the projector.

**Test speed.** To get through a rehearsal quickly, choose 2×, 4×, 8× or 16× under Demo mode in the host panel
(or press **Test speed** in the slide controls after adding simulated players). The briefing, the rounds
and the reveals get that much shorter (at 4× a round lasts 30 seconds), and the simulated players keep pace.
The clock shows real seconds. The speed is remembered per game
code, in this browser only, and it is ignored unless the game has simulated players in it, so a real class
always runs at normal speed.

## If the Wi-Fi fails

Double-click **Start Offline.command**. The whole game then runs inside the laptop's browser with
simulated players only; phones cannot join. To go back to the live game, choose **Live** on the host
panel's first screen.

## What you can edit

| File | What it controls |
|---|---|
| `data/cards.json` | Start-up and buyer names, the three rules on the briefing screen, and the wording of each round. Drafts: rewrite freely. |
| `data/benchmarks.json` | The "Real world" line under each dashboard metric. Empty until you fill it in. |
| `css/theme.css` | The colour palette and font. |
| `js/config.js` | Team names, timings, start-up/buyer split, what each round allows (`game`), points (`payoff`), Supabase connection. |
| `js/facts.js` | The research figures, cases, playbook and APA reference list shown on the slides. Never add a number without its source. |
| `deck.html` | The slides themselves. |
| `art/` | The illustrations (made with Higgsfield in one print style). |

After editing, reload the pages (and redeploy if the site is hosted). Each page loads its scripts and styles with a version stamp
(`?v=...`). When a `js/` or `css/` file changes, change that stamp in all five HTML pages, so no browser keeps an old copy.

## How the rules work

- Whether a start-up is ready, and whether it holds proof, is dealt at random when the host presses Start,
  in fixed proportions (`lemonShare`, `proofShare`). Only a start-up that works can hold proof.
- A buyer's decision is recorded the moment it is made. The outcome is fixed by the start-up's card, and is
  shown to nobody, the buyer included, until the round closes.
- During a round the projector shows only how many buyers have decided. Names and outcomes appear in the reveal.
- Points are worked out from the decisions and `payoff`; nothing else is stored.

## Checking it works

```bash
node test/simulate.js 28 40
```

plays 40 offline games of 28 simulated players and checks every rule.

```bash
node test/online.js 26
```

plays one short real-time game against the live database (about a minute). If it stalls, the connection has
probably hung: stop it and run it again.

## Database

`supabase/schema.sql`, then `002_face_to_face.sql`, `003_rivals.sql`, `004_tokens.sql` and `005_rounds.sql` in `supabase/` is the full database: private tables plus the `sim_*` functions that phones call. The game uses the functions in `005_rounds.sql`
(`sim_round_*` and `sim_sign`); the earlier files are kept because that file builds on their tables.
Phones can never read a table directly, so hidden card information stays hidden.
