/* Settings you can change without touching the rest of the code. */
window.B2B_CONFIG = {
  // Supabase connection (the key is the public "publishable" key, safe to ship in a web page).
  // Leave both empty to run fully offline on this laptop.
  supabaseUrl: "https://kqydilwmumemsrkqipiv.supabase.co",
  supabaseKey: "sb_publishable_atYXMPS_y8LujIMOUlVWOA_Q0VHJwCr",

  // Shown on every screen.
  title: "The Enterprise Deal",
  subtitle: "A B2B selling simulation",

  // The presenting team, in speaking order. Used on the slides ("Lead: ...").
  team: ["Aziz", "Speaker 2", "Speaker 3", "Speaker 4"],

  // ---------------------------------------------------------------- the game
  // One gamble, three short rounds. A buyer can stay with the supplier they have (safe) or sign a
  // start-up (a bigger win if it delivers, a bigger loss if it fails). Some start-ups are secretly
  // not ready. Each round gives the room one more way to tell them apart.
  // Every number here is a game setting, not a measured fact.
  sellerShare: 0.55,         // about 55% play start-ups, 45% play buyers
  briefingSeconds: 45,       // time to read the role card before round 1
  roundSeconds: 120,         // each round: 2 minutes of walking and talking
  revealSeconds: 45,         // each reveal, before the next round starts by itself
  extendSeconds: 30,         // the "+30 s" button

  game: {
    lemonShare: 0.34,        // share of start-ups whose product is not ready (they know; buyers do not)
    proofShare: 0.5,         // share of the ready start-ups that hold proof (a reference customer)
    introsPerBuyer: 1,       // start-ups each buyer "knows" (used in the round with introductions)
    // What each round allows. The wording players see is in data/cards.json ("rounds").
    //   pilot:  buyers may sign a small pilot instead of the full deal
    //   proof:  a start-up's proof is shown to a buyer who types its deal code
    //   record: what each start-up did in earlier rounds is shown (its references)
    //   intros: each buyer sees the truth about the start-ups they "know"
    rounds: [
      { pilot: false, proof: false, record: false, intros: false },
      { pilot: true,  proof: true,  record: false, intros: false },
      { pilot: true,  proof: true,  record: true,  intros: true }
    ]
  },

  // Points per round. Staying is safe; a blind full deal loses on average; a pilot limits the damage.
  payoff: {
    stay: 1,                 // buyer: stayed with the current supplier
    fullWin: 4,              // buyer: full deal, the start-up delivered
    fullLose: -6,            // buyer: full deal, the start-up failed
    pilotWin: 2,             // buyer: pilot, the start-up delivered
    pilotLose: -1,           // buyer: pilot, the start-up failed
    sellerFull: 3,           // start-up: a full deal signed
    sellerPilot: 1           // start-up: a pilot signed
  },

  // An optional short clip for the slides. Leave url empty and nothing shows.
  // When set, a "Play the clip" button appears on the slide numbered below (press V there too).
  // url: a YouTube link (watch, youtu.be or embed) or a direct .mp4 file.
  // start / end: seconds into the clip; 0 = from the beginning / to the end.
  // src: the source note shown under the clip (the brief asks for one on every slide with outside material).
  video: { url: "", start: 0, end: 0, title: "", src: "", slide: 8 },

  // How often phones and screens ask the server for news (milliseconds).
  pollMs: { market: 1500, idle: 3000 }
};
