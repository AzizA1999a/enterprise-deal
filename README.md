# The Enterprise Deal

A classroom game about marketing a start-up to a large company, played in four short rounds. Every student
joins on a phone and runs a start-up. Each picks one large company to go after and has to get four people
there to say yes: a manager, security, procurement and an executive. Each round a start-up spends a small
marketing budget on moves (a cold email, a case study, proof, a pilot, a partner), and each move has a
chance of opening the door it stands at. Every student also knows one person inside one company and can
introduce classmates to that person, so the room itself is the network. After every round the projector
shows which moves opened doors.

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
5. After round 4 closes, the next slides show this room's results beside the research.
6. In the host panel, **Download CSV files** saves every marketing move, every player and the event log.
   **Reset game** clears players and results but keeps the game code.

## How the game is played

- **Briefing.** Each student sees their start-up, their two-digit code, and the one person they know
  inside one company. They choose a company to go after and a message to lead with: it saves money, it
  lowers risk, or it gets you there faster.
- **Four doors.** Manager, security, procurement, executive, in that order. A start-up stands at one door
  at a time.
- **Each round** a start-up has a budget of 2 and spends it on moves. The phone shows the cost and the
  chance of each move at the current door before the student taps.
  - Cold outreach: cheap, and rarely works.
  - Publish a case study: opens no door, but makes every later move more likely to work.
  - Research the account: reveals which message this company cares about most.
  - Show proof: strong with security. Offer a pilot: strong with the executive. Go in with a partner:
    strong with procurement.
  - Use an introduction: a high chance, but only at the door of the person the introducer knows.
- **The network.** A student can introduce two classmates to the person they know, by typing the
  classmate's code. To get an introduction, a student has to find the right classmate in the room.
- **The message.** Each company cares most about one of the three messages, drawn at random per game. The
  right message helps with the manager and the executive; the wrong one hurts. A student learns it from
  their own contact (if they go after that company) or by researching.
- **Scarcity.** Each company signs only its first two start-ups. Later ones get every yes, but too late.
- **Points.** 1 for each door, 6 for a contract (2 if too late), 2 for each start-up you introduced that
  went on to sign.

All the numbers are in `game` and `points` in `js/config.js`. They are design choices, not measured facts:
the game is set up so that an introduction beats a cold email. The result screens say so, and the script
tells the speakers to say so. What the game does not decide is what the students do with those chances.

## Rehearsing alone (demo mode)

In the host panel, **Add simulated players** fills the game with bots. About a third of the simulated
start-ups only ever send cold emails; the rest market first, and some introduce each other. You can join
from your own phone at the same time. Any result that includes bots is labelled "Simulated run" on the
projector.

**Test speed.** To get through a rehearsal quickly, choose 2×, 4×, 8× or 16× under Demo mode in the host panel
(or press **Test speed** in the slide controls after adding simulated players). The briefing, the rounds
and the reveals get that much shorter (at 4× a round lasts 25 seconds), and the simulated players keep pace.
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
| `data/cards.json` | The large companies and the people inside them, the start-ups, the three rules on the briefing screen, and the wording of each move and message. All invented, all drafts: rewrite freely. |
| `data/benchmarks.json` | The "Real world" line under each dashboard metric. Empty until you fill it in. |
| `css/theme.css` | The colour palette and font. |
| `js/config.js` | Team names, timings, the rounds, budget and chances of each move (`game`), points (`points`), Supabase connection. |
| `js/facts.js` | The research figures, cases, playbook and APA reference list shown on the slides. Never add a number without its source. |
| `deck.html` | The slides themselves. |
| `art/` | The illustrations (made with Higgsfield in one print style). |

After editing, reload the pages (and redeploy if the site is hosted). Each page loads its scripts and styles with a version stamp
(`?v=...`). When a `js/` or `css/` file changes, change that stamp in all five HTML pages, so no browser keeps an old copy.

## How the rules work

- When the host presses Start, the laptop draws which message each company cares about, deals a start-up
  and a contact to every player (contacts are spread evenly over every door of every company in play), and
  stores it all. The number of companies follows the class size (about seven start-ups per company).
- A move is rolled by the referee the moment it is made: this browser in offline mode, the database in the
  live game. The chance, the result and the time are recorded.
- A company is fixed once a start-up has made its first move there; the message can change at any time.
- Which message a company cares about is never sent to a phone that has not earned it, nor to the projector.
- Points are worked out from the moves and introductions; nothing else is stored.

## Checking it works

```bash
node test/simulate.js 28 40
```

plays 40 offline games of 28 simulated players and checks every rule.

```bash
node test/online.js 26
```

plays one short real-time game against the live database (about a minute and a half). If it stalls, the connection has
probably hung: stop it and run it again.

## Database

`supabase/schema.sql`, then `002_face_to_face.sql`, `003_rivals.sql`, `004_tokens.sql`, `005_rounds.sql` and
`006_campaign.sql` in `supabase/` is the full database: private tables plus the `sim_*` functions that phones call.
The game uses the functions in `006_campaign.sql` (`sim_camp_*`); the earlier files are kept because that file
builds on their tables.
Phones can never read a table directly, so hidden card information stays hidden.
