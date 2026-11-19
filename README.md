# The Enterprise Deal

A 10-minute classroom simulation of enterprise B2B selling. Students join on their phones, become
start-up sellers or enterprise buyers, negotiate face to face, and the projector then shows what
actually drove the deals.

## The three pages

| Page | Who uses it | File |
|---|---|---|
| Player | every student, on a phone (the QR code points here) | `index.html` |
| Projector | the big screen | `screen.html` |
| Host panel | your laptop | `host.html` |

Keep the host panel open and visible for the whole game. It runs the automatic steps: late joiners,
opening the market after the briefing, locking at zero, and resolving deliveries.

## Running a game

1. Open `host.html`, choose a PIN, press **Create game**.
2. Press **Open projector screen** and move that window to the projector.
3. Students scan the QR code and type their name.
4. **Start: assign roles** gives everyone a card and starts the 60-second briefing. The market opens by itself.
5. During the market you can **Pause**, add **+1 minute**, or **Lock the market**. It locks by itself at zero.
6. After the lock, switch the projector between **Market closed**, **Quick reveal** and the four dashboard
   pages. The left and right arrow keys on the projector window do the same.
7. **Download CSV files** saves every offer, every player and the event log.
8. **Reset game** clears players and results but keeps the game code, so a QR code on a slide stays valid.

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
| `js/config.js` | Timings, seller/buyer split, offers per seller, points, Supabase connection. |

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

`supabase/schema.sql` is the full database: private tables plus the `sim_*` functions that phones call.
Phones can never read a table directly, so hidden card information stays hidden.
