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
  // Every player runs a start-up's marketing campaign to get inside one large company ("giant").
  // A giant is four doors, one person behind each: the manager with the problem, security,
  // procurement, and the executive who signs. Each round a start-up has a small budget and
  // spends it on marketing moves. Each move shows its cost and its chance of opening the door
  // the start-up is standing at. The network is the room: every player knows one person inside
  // one giant, and can introduce a few classmates to them.
  // Every number here is a game setting, not a measured fact.
  briefingSeconds: 60,       // time to read the card and choose a target before round 1
  roundSeconds: 100,         // each round
  revealSeconds: 30,         // each reveal, before the next round starts by itself
  extendSeconds: 30,         // the "+30 s" button

  game: {
    rounds: 4,
    budget: 2,               // marketing budget per round (it does not carry over)
    startupsPerGiant: 7,     // about this many start-ups per giant; a small class plays with fewer giants
    slots: 2,                // each giant signs only its first two start-ups
    vouches: 2,              // classmates each player can introduce to the person they know
    awareBoost: 10,          // after "content": every later move is this much more likely to work
    fit: 10,                 // the right message for this giant: this much more likely, at the doors below
    misfit: 10,              // the wrong message: this much less likely
    fitDoors: [0, 3],        // the message matters to the manager and to the executive
    // cost: budget it uses. odds: chance (%) of opening each door, in order
    // [manager, security, procurement, executive]. once: can be done one time only.
    moves: {
      cold:     { cost: 1, odds: [12, 4, 4, 4] },       // an email to someone who has never heard of you
      content:  { cost: 1, once: true },                 // publish a case study: makes you known inside the giant
      research: { cost: 1, once: true },                 // find out which message this giant cares about
      intro:    { cost: 1, odds: 70 },                   // a warm introduction; only for the door your contact sits behind
      proof:    { cost: 1, odds: [10, 70, 25, 15] },    // a reference customer and a security certificate
      pilot:    { cost: 2, odds: [25, 15, 15, 60] },    // a small first step the executive can point to
      partner:  { cost: 2, odds: [15, 15, 75, 15] }     // go in beside a supplier the giant already approved
    }
  },

  // Points.
  points: {
    door: 1,                 // each door opened
    win: 6,                  // signed, among the giant's first start-ups
    late: 2,                 // reached the executive's signature after the giant's slots were taken
    vouch: 2                 // for each classmate you introduced who went on to sign
  },

  // An optional short clip for the slides. Leave url empty and nothing shows.
  // When set, a "Play the clip" button appears on the slide numbered below (press V there too).
  // url: a YouTube link (watch, youtu.be or embed) or a direct .mp4 file.
  // start / end: seconds into the clip; 0 = from the beginning / to the end.
  // src: the source note shown under the clip (the brief asks for one on every slide with outside material).
  video: { url: "", start: 0, end: 0, title: "", src: "", slide: 9 },

  // How often phones and screens ask the server for news (milliseconds).
  pollMs: { market: 1500, idle: 3000 }
};
