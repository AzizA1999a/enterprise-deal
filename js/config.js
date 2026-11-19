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
  team: ["Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4", "Speaker 5"],

  // Role split and timing.
  sellerShare: 0.6,          // about 60% sellers, 40% buyers
  briefingSeconds: 60,       // role card reading time before the market opens
  marketSeconds: 600,        // 10 minutes of walking and talking
  extendSeconds: 60,         // the "+1 minute" button
  offersPerSeller: 3,        // term sheets a seller can open (each can be edited while it is unanswered)
  requireMeetingCode: true,  // a seller needs the buyer's desk number, shown only on the buyer's phone
  minBuyersPerCategory: 2,   // fewer categories are used when the class is small

  // Connections: share of sellers who get 0, 1 or 2 connections.
  connectionMix: [0.4, 0.4, 0.2],
  maxConnectionsPerBuyer: 2,

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
    sellerPilotCost: 20      // seller: cost of a pilot without the "pilot-ready" asset
  },

  // How a hidden priority is judged.
  priorityRules: {
    lowestCostSavingsPct: 25,  // "lowest cost" is met at 25% or more under the incumbent
    fastestDeployWeeks: 4      // "fastest deployment" is met at 4 weeks or less
  },

  // How often phones and screens ask the server for news (milliseconds).
  pollMs: { market: 1500, idle: 3000 }
};
