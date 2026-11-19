# The Enterprise Deal

A 10-minute classroom simulation of enterprise B2B selling. Students join on their phones, become
start-up sellers or enterprise buyers, negotiate face to face, and the projector then shows what
actually drove the deals.

## The pages

| Page | Who uses it | File |
|---|---|---|
| Presentation | the projector: slides with the live game built in | `deck.html` |
| Player | every student, on a phone (the QR code points here) | `index.html` |
| Host panel | your laptop: roster, data export, reset | `host.html` |
| Projector only | the game screens without slides, for rehearsals | `screen.html` |
| Speaking script | the five speakers: what to say and press, slide by slide | `script.html` |

One window must stay open for the whole game, because it runs the automatic steps (late joiners, opening
the market, locking at zero, resolving deliveries): either the presentation or the host panel. If both
are open in the same browser, only one of them does that work.

## Running the presentation

1. Open `host.html`, press **Create game**, then **Open the presentation**. Move that window to the
   projector and press **F** for full screen.
2. Arrow keys (or a clicker) move through the slides. Some slides reveal one item per click.
3. On the game slide, small controls sit at the bottom left: **Start**, **Open market now**, **Pause**,
   **+1 min**, **Lock market**. They are faint until you point at them.
4. Students scan the QR code on that slide and type their name.
5. After the market closes, the next slides show this room's results beside the research.
6. In the host panel, **Download CSV files** saves every term sheet, every player and the event log.
   **Reset game** clears players and results but keeps the game code.

## How the game is played

- Everyone stands up. Sellers walk to buyers in their category and pitch face to face.
- Each buyer has a private desk number on their Inbox tab. A seller needs it to open a term sheet, so
  nobody can send offers from across the room.
- The seller writes what was agreed (price, pilot, proof shown) and can edit it while they haggle. Editing
  is free; opening a term sheet uses one of the seller's three.
- The buyer signs it or rejects it. A buyer signs one deal, or stays with the incumbent.
- The Badge tab turns the phone into a name tag.

## Rehearsing alone (demo mode)

In the host panel, **Add simulated players** fills the game with bots that join, send offers, decide and
answer the exit question. You can join from your own phone at the same time. Any result that includes
bots is labelled "Simulated run" on the projector.

## If the Wi-Fi fails

Double-click **Start Offline.command**. The whole game then runs inside the laptop's browser with
simulated players only; phones cannot join. To go back to the live game, choose **Live** on the host
panel's first screen.

## What you can edit

| File | What it controls |
|---|---|
| `data/cards.json` | Role card templates, categories, wording of rules, exit options. Drafts: rewrite freely. |
| `data/benchmarks.json` | The "Real world" line under each dashboard metric. Empty until you fill it in. |
| `css/theme.css` | The colour palette and font. |
| `js/config.js` | Team names, timings, seller/buyer split, term sheets per seller, points, Supabase connection. |
| `js/facts.js` | The research figures and sources shown on the slides. Never add a number without its source. |
| `deck.html` | The slides themselves. |
| `art/` | The illustrations (made with Higgsfield in one print style). |

After editing, reload the pages (and redeploy if the site is hosted).

## How the rules work

- A connection gives no points. A connected seller sees the buyer's hidden priority and boss's rule; a
  connected buyer sees the seller's true reliability; a connection's offer is pinned to the top of the inbox.
- Each signed deal is drawn once against the seller's hidden reliability when the market locks.
- Points are set in `js/config.js` and explained on every role card.

## Checking it works

```bash
node test/simulate.js 28 40
```

plays 40 offline games of 28 simulated players and checks every rule.

```bash
node test/online.js 30 40
```

plays one real-time game against the live database (about a minute).

## Database

`supabase/schema.sql` followed by `supabase/002_face_to_face.sql` is the full database: private tables plus the `sim_*` functions that phones call.
Phones can never read a table directly, so hidden card information stays hidden.
