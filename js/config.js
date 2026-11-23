/* Settings you can change without touching the rest of the code.
   Prices everywhere are in thousands of dollars per year. */
window.B2B_CONFIG = {
  // Supabase connection (the key is the public "publishable" key, safe to ship in a web page).
  // Leave both empty to run fully offline on this laptop.
  supabaseUrl: "https://kqydilwmumemsrkqipiv.supabase.co",
  supabaseKey: "sb_publishable_atYXMPS_y8LujIMOUlVWOA_Q0VHJwCr",

  // Shown on every screen.
  title: "The Enterprise Deal",
  subtitle: "A B2B selling simulation",

  // The presenting team, in speaking order. Used on the slides ("Lead: ...").
  team: ["Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4"],

  // Role split and timing.
  sellerShare: 0.6,          // about 60% sellers, 40% buyers
  briefingSeconds: 60,       // role card reading time before the market opens
  marketSeconds: 480,        // 8 minutes of walking and talking (was 10; shortened to keep the opening short)
  extendSeconds: 60,         // the "+1 minute" button
  offersPerSeller: 3,        // term sheets a seller can open (each can be edited while it is unanswered)
  requireMeetingCode: true,  // a seller needs the buyer's desk number, shown only on the buyer's phone
  minBuyersPerCategory: 2,   // fewer categories are used when the class is small

  // Connections: share of sellers who get 0, 1 or 2 connections.
  connectionMix: [0.4, 0.4, 0.2],
  maxConnectionsPerBuyer: 2,

  // You cannot give everything. Each seller has a few resource tokens: a small team's time.
  // Tokens are tied up by every open or signed term sheet, and come back when a buyer says no.
  // These are game settings, not measured facts. Set on: false to make every extra free again.
  tokens: {
    on: true,
    perSeller: 6,     // tokens a seller holds
    pilot: 3,         // a pilot
    pilotReady: 2,    // ...for a seller whose card says "pilot-ready"
    fast: 2,          // fast-track deployment (a dedicated team)
    proof: 1,         // each proof shown: a reference call, a security review
    fastWeeks: 4      // a fast-tracked deployment takes this many weeks
  },

  // The big vendors fight back. Every buyer's incumbent has an account manager played by the computer.
  // These are game settings, not measured facts. Set on: false to switch the account managers off.
  rivals: {
    on: true,
    reactSeconds: [12, 30],      // how long an account manager takes to answer a start-up's term sheet
    earlyRenewalAt: [0.3, 0.55], // share of the market time after which a buyer nobody has pitched gets an early-renewal offer
    earlyDiscount: 5,            // % off the renewal for closing early
    firstDiscount: 8,            // the smallest first counter-offer, in % off the incumbent's price
    matchShare: 0.35,            // first counter: this share of the start-up's saving is matched
    finalMatchShare: 0.6,        // final counter: this share is matched
    finalStep: 3,                // the final counter is at least this many points deeper than the one before
    maxDiscount: 20,             // an account manager never discounts more than this
    addonPoints: 15,             // the final counter adds an extra aimed at the buyer's hidden priority
    maxCounters: 3               // counter-offers per buyer, at most
  },

  // Points. A connection never changes any of these.
  points: {
    incumbent: 50,           // buyer stays with the incumbent
    startupBase: 50,         // buyer signs a start-up that delivers
    perPercentSaved: 1,      // plus 1 per 1% under the incumbent price...
    savingsCap: 40,          // ...up to this many (and down to minus this many)
    priorityBonus: 30,       // offer fits the buyer's hidden priority
    constraintPenalty: 30,   // offer breaks the boss constraint
    failed: 0,               // start-up fails to deliver
    failedWithPilot: 25,     // start-up fails, but the deal began with a pilot
    sellerDeal: 40,          // seller: each delivered deal
    sellerPriceHeld: 60,     // seller: up to this many for holding price above the floor
    sellerPilotCost: 20      // seller: cost of a pilot without the "pilot-ready" asset (only when tokens are off)
  },

  // How a hidden priority is judged.
  priorityRules: {
    lowestCostSavingsPct: 25,  // "lowest cost" is met at 25% or more under the incumbent
    fastestDeployWeeks: 4      // "fastest deployment" is met at 4 weeks or less
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
