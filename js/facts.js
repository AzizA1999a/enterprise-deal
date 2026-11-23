/* The research shown on the slides. Edit the text here; the slides pick it up.
   (js/facts-render.js turns this into slide content.)
   Every figure must come from the source named beside it. Do not add a number without one.

   Each fact:  n = the big figure (optional)   t = one plain sentence   src = short source note
   "sources" is the APA reference list at the end; put *asterisks* around titles that should be italic. */
window.B2B_FACTS = {

  // ================= 1. What is it, and why now? =================
  defNote: "Researchers call it using start-ups as suppliers: the large firm gets new technology by buying it, not by investing in the start-up. The start-up brings agility; the corporation brings resources. (Kurpjuweit and Wagner, 2020; Weiblen and Chesbrough, 2015)",
  size: [
    { n: "$1.47 tn", t: "is what the world will spend on enterprise software in 2026, up 15.5% in one year.",
      src: "Gartner, worldwide IT spending forecast, July 2026." },
    { n: "90%", t: "of the leading corporations surveyed already buy from start-ups as a \"venture client\".",
      src: "Mind the Bridge, Jan 2025. Innovation heads at top corporations; sample size not disclosed." }
  ],
  whynow: [
    { n: "63%", t: "of what enterprises spent on generative-AI applications in 2025 went to start-ups, up from 36% a year earlier.",
      src: "Menlo Ventures, The State of Generative AI in the Enterprise, Dec 2025. Investor source; 495 US decision-makers." },
    { n: "67%", t: "of B2B buyers prefer to buy without a sales rep, up from 61% the year before.",
      src: "Gartner sales surveys, June 2025 and March 2026." }
  ],
  examples: [
    { name: "Harvey and Allen & Overy", year: "2023", how: "A beta from November 2022: about 3,500 lawyers asked about 40,000 questions before the firm announced the partnership.",
      way: "Got in with: a small first step", src: "Allen & Overy press release, 15 Feb 2023. The buyer's own account." },
    { name: "Celonis and Siemens", year: "2011", how: "About 1,500 handwritten letters to large companies. Siemens' audit department tried the software the year Celonis launched.",
      way: "Got in with: a personal approach, then one department", src: "Celonis; Munich Startup (Ring), 2025. Company-told story." },
    { name: "Snowflake and Capital One", year: "2020 filing", how: "One early enterprise customer was about 17% of revenue in fiscal 2019. Existing customers then spent 158% of the year before.",
      way: "Got in, then: land and expand", src: "Snowflake Inc., Form S-1, 2020." }
  ],

  // ================= 2. How and why does it work? =================
  chain: [
    { t: "A new, unknown supplier", s: "The liability of newness", src: "Stinchcombe, 1965" },
    { t: "The buyer feels personal risk", s: "Personal value counts twice as much as business value", src: "CEB, 2013" },
    { t: "A committee has to agree", s: "5 to 16 people, any of whom can say no", src: "Gartner, 2025" },
    { t: "Doing nothing feels safest", s: "Status quo bias", src: "Samuelson and Zeckhauser, 1988" },
    { t: "The deal stalls", s: "40-60% of deals are lost to no decision", src: "Dixon and McKenna, 2022" }
  ],
  risk: [
    { n: "2x", t: "Personal value to the buyer has twice the impact of business value. One fear buyers named: losing their job over a failed purchase.",
      src: "CEB Marketing Leadership Council, From Promotion to Emotion, 2013. Survey of 3,000 B2B buyers. Dated." }
  ],
  incumbent: [
    { n: "40-60%", t: "of deals are lost to nobody. The customer says they want to buy, then does nothing.",
      src: "Dixon and McKenna, Harvard Business Review, June 2022. From 2.5 million recorded sales conversations; the authors sell related training." },
    { n: "86%", t: "of B2B purchases stall at some point in the buying process.",
      src: "Forrester, The State of Business Buying 2024 (press release, Dec 2024). Stalled is not the same as lost." },
    { t: "People disproportionately stick with the option they already have.",
      src: "Samuelson and Zeckhauser, Journal of Risk and Uncertainty, 1988. Lab experiments with individuals." }
  ],
  committee: [
    { n: "5 to 16", t: "people sit in a B2B buying group, across as many as four functions.",
      src: "Gartner press release, 7 May 2025." },
    { n: "17%", t: "of buying time is spent meeting suppliers. That is all suppliers combined, not each one.",
      src: "Gartner press release, 15 Sept 2020. The underlying data is from before 2019." },
    { t: "Marketing has called this the buying center since 1972: buying is a group decision.",
      src: "Webster and Wind, Journal of Marketing, 1972." }
  ],
  trust: [
    { n: "~90%", t: "of B2B buyers end up buying from a vendor that was already on their list on day one.",
      src: "Dave et al., Bain and Company, June 2026. Survey of 750 buyers. Measures familiarity, not introductions." },
    { t: "We found no rigorous public study that compares warm introductions with cold outreach in B2B. The popular \"84% start with a referral\" traces back to a vendor's marketing page. Our room is a small test of exactly that.",
      src: "Our own source check." }
  ],
  proof: [
    { n: "80%", t: "of organisations require a security or privacy assessment before they buy software.",
      src: "G2, 2024 Buyer Behavior Report. Over 1,900 software buyers. G2 sells related products." },
    { t: "Why buyers insist: Walgreens put Theranos blood tests in its stores. It later closed 40 sites, sued for $140 million, and paid $44 million to patients.",
      src: "Reuters, Nov 2016; Axios (Rubin), Sept 2023." },
    { t: "Proof is a signal: a costly action that shows what the seller knows. Mainstream buyers want references from buyers like themselves.",
      src: "Spence, Quarterly Journal of Economics, 1973; Moore, Crossing the Chasm, 1991." }
  ],
  pilot: [
    { n: "81%", t: "of corporate programmes say fewer than a quarter of their start-up pilots turned into commercial deals. A pilot gets you in the door, not through it.",
      src: "500 Startups survey of 100 corporate innovation programmes, reported by Fortune (Griffith), June 2017. Dated." },
    { t: "Palantir told investors it wins large accounts with short pilots \"at no or low cost\" to the customer, and runs them at a loss.",
      src: "Palantir Technologies, Form S-1, 2020." },
    { t: "\"Pilots need to be sufficiently sized to be relevant.\"",
      src: "D\u00f6rner et al., McKinsey, 2020. Germany, Austria and Switzerland." }
  ],
  partner: [
    { n: "84% vs 57%", t: "of start-ups were satisfied when they partnered with one business unit, against a company-wide programme.",
      src: "D\u00f6rner et al., McKinsey, Can't buy love, 2020. Start-ups in Germany, Austria and Switzerland." },
    { n: "95%", t: "of Microsoft's commercial revenue flows through its partner ecosystem.",
      src: "Schuster, Official Microsoft Blog, Feb 2019. The company's own claim." }
  ],
  // Our own view, said as opinions: "What surprised us was..." Each one repeats a sourced finding from the slides before it.
  surprised: [
    { n: "40-60%", t: "of deals are lost to no decision at all. We expected rival start-ups to be the threat. The real rival is \"do nothing\".",
      src: "Dixon and McKenna, Harvard Business Review, 2022." },
    { n: "27th of 36", t: "is where cost ranks as a driver of B2B loyalty. We expected price to be the way in. It is the ticket, not the win.",
      src: "Almquist, Cleghorn and Sherer, Harvard Business Review, 2018." },
    { n: "84%", t: "\"of deals start with a referral\" is quoted everywhere. We traced it to a vendor's marketing page. Check the source before you build a plan on it.",
      src: "Our own check: we found no rigorous public study behind it." }
  ],
  price: [
    { n: "27th of 36", t: "is where cost reduction ranked as a driver of customer loyalty, although buyers said it mattered most.",
      src: "Almquist, Cleghorn and Sherer, Harvard Business Review, 2018. Measures loyalty, not the first purchase." },
    { n: "14%", t: "of buyers see enough difference between suppliers to pay more. When you look the same, price decides.",
      src: "CEB, From Promotion to Emotion, 2013 (2009 survey of 9,000 buyers). Dated." },
    { t: "Price still matters: buyers rank pricing information as the most helpful thing on review sites.",
      src: "G2, 2024 Buyer Behavior Report." }
  ],

  // ================= 3. Who is it best for? =================
  fit: [
    { test: "Is one deal worth months of selling?",
      yes: "A contract is large and recurring enough to pay for a long, staffed sale.",
      no: "The price is low enough that customers should simply buy it online.",
      src: "Rule of thumb: about $10k a year per account rarely funds field sales (Janz, 2014). Learn how to sell before hiring a sales force (Leslie and Holloway, 2006)." },
    { test: "How big a leap is it for the buyer?",
      yes: "It solves a contained problem that one department owns.",
      no: "It replaces a core system the whole company runs on, from day one.",
      src: "A start-up is a \"new task\" purchase, the most scrutinised buy class (Robinson, Faris and Wind, 1967; Anderson, Chu and Weitz, 1987)." },
    { test: "Can you prove it works?",
      yes: "You have a reference customer, a certification, or a result the buyer can measure.",
      no: "Proof only arrives after years of use.",
      src: "Signalling (Spence, 1973). 80% of organisations require a security assessment (G2, 2024)." },
    { test: "Does it grow after the first sale?",
      yes: "Users and usage can spread from one unit to the next.",
      no: "It is a one-off purchase with nothing to expand into.",
      src: "Top-quartile revenue retention: 109% for larger accounts, 65% for the smallest (Jain, ChartMogul, 2023)." }
  ],
  fitcases: [
    { n: "91%", t: "of generative-AI spending on finance and operations tools went to start-ups, while incumbents kept 56% of infrastructure. Start-ups win the department tool, not the core system.",
      src: "Menlo Ventures, Dec 2025. Investor source. The last sentence is our reading." },
    { n: "56% vs 29%", t: "of start-ups hit their financial goals when they worked with one business unit on one topic, against a company-wide programme.",
      src: "D\u00f6rner et al., McKinsey, 2020. Germany, Austria and Switzerland." },
    { n: "158%", t: "Snowflake's existing customers spent 158% of what they had spent a year earlier. The first sale was the start, not the prize.",
      src: "Snowflake Inc., Form S-1, 2020. One unusually strong company." }
  ],

  // ================= 4. Where does it fall short? =================
  limits: [
    { n: "45% / 55%", t: "of corporates and of start-ups say they are dissatisfied with their partnerships.",
      src: "Boston Consulting Group, After the Honeymoon Ends, 2019. Germany, Austria and Switzerland." },
    { n: "$10k-80k", t: "is the usual all-in cost of a first SOC 2 security audit, often before the first enterprise sale.",
      src: "Vanta, n.d. Vendor source." },
    { t: "Relying on one large customer hurts profitability early in the relationship. It pays off only as the relationship matures.",
      src: "Irvine, Park and Y\u0131ld\u0131zhan, The Accounting Review, 2016. Public-company data." },
    { t: "Stay away for now if your price is near $10k a year, you cannot fund a long sale, or one buyer would be most of your revenue.",
      src: "Our reading of Janz (2014), Leslie and Holloway (2006) and Irvine et al. (2016)." }
  ],
  failure: {
    title: "GT Advanced Technologies and Apple, 2013 to 2014",
    points: [
      { t: "October 2013: GT Advanced signs to supply sapphire to Apple, exclusively.", s: "Apple lends up to $578 million to build the plant. Apple commits to no minimum purchase." },
      { t: "Apple decides not to use the sapphire for the iPhone 6 screen.", s: "GT Advanced has one customer, and that customer is not buying." },
      { t: "6 October 2014: GT Advanced files for bankruptcy, less than a year after signing.", s: "Its operations chief told the court the deal shifted all the risk to the supplier. Apple disputed that." }
    ],
    lesson: "One giant customer can be the whole business, and then the end of it. Exclusivity without a purchase commitment left all the risk with the small firm.",
    src: "GT Advanced Technologies, Form 10-Q, 2014; Heller, CFO, Nov 2014. GT Advanced was a listed supplier, not a start-up. The \"bait and switch\" claim is one side's allegation."
  },

  // ================= 6. Where is it heading? =================
  future: [
    { n: "90%", t: "of B2B buying will be \"AI-agent intermediated\" by 2028, Gartner predicts: more than $15 trillion of spending.",
      src: "Gartner, Strategic Predictions for 2026, Nov 2025." },
    { n: "75%", t: "of B2B buyers will prefer sales experiences that put human interaction ahead of AI by 2030, Gartner also predicts.",
      src: "Gartner press release, 25 Aug 2025." },
    { n: "2 in 3", t: "providers will lose deals because buyers cannot verify their claims, Forrester predicts for 2027.",
      src: "Forrester, 2027 B2B predictions, Oct 2026." }
  ],
  playbook: [
    { t: "Pick one kind of buyer and one problem they already feel.", watch: "chasing every famous logo at once." },
    { t: "Find a warm path in: investors, advisers, former colleagues, their current suppliers.", watch: "a cold pitch to a committee that has never heard of you." },
    { t: "Get your proof ready before the first meeting.", watch: "the security review arriving before you are ready for it." },
    { t: "Offer a small first step in one business unit, with the next step agreed in writing.", watch: "a free pilot with no path to a contract." },
    { t: "Expand from that unit, and keep selling to others.", watch: "one giant customer becoming most of your revenue." }
  ],

  // ================= References (APA 7) =================
  sources: [
    "Allen & Overy. (2023, February 15). *A&O announces exclusive launch partnership with Harvey* [Press release]. https://www.aoshearman.com/en/news/ao-announces-exclusive-launch-partnership-with-harvey",
    "Almquist, E., Cleghorn, J., & Sherer, L. (2018, March-April). The B2B elements of value. *Harvard Business Review*. https://www.bain.com/insights/the-b2b-elements-of-value-hbr/",
    "Anderson, E., Chu, W., & Weitz, B. (1987). Industrial purchasing: An empirical exploration of the buyclass framework. *Journal of Marketing, 51*(3), 71-86. https://doi.org/10.1177/002224298705100305",
    "Boston Consulting Group. (2019, June 13). *After the honeymoon ends: Making corporate-startup relationships work*. https://www.bcg.com/publications/2019/corporate-startup-relationships-work-after-honeymoon-ends",
    "CEB Marketing Leadership Council. (2013). *From promotion to emotion: Connecting B2B customers to brands*. The Corporate Executive Board Company.",
    "Celonis. (n.d.). *Siemens + Celonis*. https://www.celonis.com/solutions/stories/siemens-digital-transformation-process-mining",
    "Dave, R., Prauer, Z., Carikcioglu, I., Whitley, M., Nazander, E., & Cleghorn, J. (2026, June 19). *Raising the odds on a deal: How likelihood to buy rewires B2B growth*. Bain & Company. https://www.bain.com/insights/raising-the-odds-on-a-deal-how-likelihood-to-buy-rewires-b2b-growth/",
    "Dixon, M., & McKenna, T. (2022, June 24). Stop losing sales to customer indecision. *Harvard Business Review*. https://hbr.org/2022/06/stop-losing-sales-to-customer-indecision",
    "D\u00f6rner, K., Fl\u00f6totto, M., Henz, T., & Str\u00e5lin, T. (2020, September 30). *Can't buy love: Corporate-start-up partnerships in the DACH region*. McKinsey & Company. https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/cant-buy-love-corporate-start-up-partnerships-in-the-dach-region",
    "Forrester. (2024, December 4). *Forrester: The state of business buying, 2024* [Press release]. https://www.forrester.com/press-newsroom/forrester-the-state-of-business-buying-2024/",
    "Forrester. (2026, October 21). *Forrester's 2027 B2B go-to-market predictions* [Press release]. https://www.forrester.com/press-newsroom/forresters-2027-b2b-go-to-market-predictions-ai-agents-will-influence-75-of-b2b-purchase-decisions/",
    "G2. (2024). *2024 buyer behavior report: Proving value in the age of AI*. https://research.g2.com/2024-buyer-behavior-report",
    "Gartner. (2020, September 15). *Gartner says 80% of B2B sales interactions between suppliers and buyers will occur in digital channels by 2025* [Press release]. https://www.gartner.com/en/newsroom/press-releases/2020-09-15-gartner-says-80--of-b2b-sales-interactions-between-su",
    "Gartner. (2025a, May 7). *Gartner sales survey finds 74% of B2B buyer teams demonstrate \"unhealthy conflict\" during the decision process* [Press release]. https://www.gartner.com/en/newsroom/press-releases/2025-05-07-gartner-sales-survey-finds-74-percent-of-b2b-buyer-teams-demonstrate-unhealthy-conflict-during-the-decision-process",
    "Gartner. (2025b, June 25). *Gartner sales survey finds 61% of B2B buyers prefer a rep-free buying experience* [Press release]. https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-sales-survey-finds-61-percent-of-b2b-buyers-prefer-a-rep-free-buying-experience",
    "Gartner. (2025c, August 25). *Gartner says by 2030 that 75% of B2B buyers will prefer sales experiences that prioritize human interaction over AI* [Press release]. https://www.gartner.com/en/newsroom/press-releases/2025-08-25-gartner-says-by-2030-that-75-percent-of-b2b-buyers-will-prefer-sales-experiences-that-prioritize-human-interaction-over-ai",
    "Gartner. (2025d, November 14). *Strategic predictions for 2026: How AI's underestimated influence is reshaping business*. https://www.gartner.com/en/articles/strategic-predictions-for-2026",
    "Gartner. (2026a, March 9). *Gartner sales survey finds 67% of B2B buyers prefer a rep-free experience* [Press release]. https://www.gartner.com/en/newsroom/press-releases/2026-03-09-gartner-sales-survey-finds-67-percent-of-b2b-buyers-prefer-a-rep-free-experience",
    "Gartner. (2026b, July 27). *Gartner forecasts worldwide IT spending to grow 14.2% in 2026, totaling $6.37 trillion* [Press release]. https://www.gartner.com/en/newsroom/press-releases/2026-07-27-gartner-forecasts-worldwide-it-spending-to-grow-14-point-2-percent-in-2026-totaling-6-point-37-trillion",
    "Griffith, E. (2017, June 22). Why are corporations so bad at working with startups? *Fortune*. https://fortune.com/2017/06/22/corporate-innovation-programs",
    "GT Advanced Technologies Inc. (2014). *Form 10-Q for the quarterly period ended June 28, 2014*. U.S. Securities and Exchange Commission. https://www.sec.gov/Archives/edgar/data/0001394954/000144530514003496/gtatq2cy2014-10q.htm",
    "Heller, M. (2014, November 12). Glass supplier accuses Apple of \"bait and switch\". *CFO*. https://www.cfo.com/news/glass-supplier-accuses-apple-of-bait-and-switch/664792/",
    "Irvine, P. J., Park, S. S., & Y\u0131ld\u0131zhan, \u00c7. (2016). Customer-base concentration, profitability, and the relationship life cycle. *The Accounting Review, 91*(3), 883-906. https://doi.org/10.2308/accr-51246",
    "Jain, S. (2023, November 1). *SaaS retention report 2023*. ChartMogul. https://chartmogul.com/reports/saas-retention-report/",
    "Janz, C. (2014, October 27). *Five ways to build a $100 million business*. Point Nine. https://writing.pointnine.com/p/five-ways-to-build-a-100-million",
    "Kurpjuweit, S., & Wagner, S. M. (2020). Startup supplier programs: A new model for managing corporate-startup partnerships. *California Management Review, 62*(3). https://doi.org/10.1177/0008125620914995",
    "Leslie, M., & Holloway, C. A. (2006, July-August). The sales learning curve. *Harvard Business Review*. https://hbr.org/2006/07/the-sales-learning-curve",
    "Moore, G. A. (1991). *Crossing the chasm*. HarperBusiness.",
    "Orizi, S. (2025, January 17). *Open innovation in 2025: Budgets bounce back, but better KPIs are needed*. Mind the Bridge. https://mindthebridge.com/?p=52097",
    "Palantir Technologies Inc. (2020). *Form S-1 registration statement*. U.S. Securities and Exchange Commission. https://www.sec.gov/Archives/edgar/data/1321655/000119312520230013/d904406ds1.htm",
    "Reuters. (2016, November 9). Walgreens sues Theranos for breach of contract, seeks $140 million. *Fox News*. https://www.foxnews.com/health/walgreens-sues-theranos-for-breach-of-contract-seeks-140-million",
    "Ring, K. (2025, November 6). *The Celonis story: Almost too good to be true*. Munich Startup. https://www.munich-startup.de/en/132216/the-celonis-story-almost-too-good-to-be-true/",
    "Robinson, P. J., Faris, C. W., & Wind, Y. (1967). *Industrial buying and creative marketing*. Allyn & Bacon.",
    "Rubin, A. (2023, September 11). Walgreens settles lawsuit with Theranos patients for $44 million. *Axios*. https://www.axios.com/2023/09/11/walgreens-theranos-class-action-settlement-44-million",
    "Samuelson, W., & Zeckhauser, R. (1988). Status quo bias in decision making. *Journal of Risk and Uncertainty, 1*(1), 7-59.",
    "Schuster, G. (2019, February 5). *Inspired and powered by partners*. Official Microsoft Blog. https://blogs.microsoft.com/blog/2019/02/05/inspired-and-powered-by-partners/",
    "Snowflake Inc. (2020). *Form S-1 registration statement*. U.S. Securities and Exchange Commission. https://www.sec.gov/Archives/edgar/data/1640147/000162828020013010/snowflakes-1.htm",
    "Spence, M. (1973). Job market signaling. *The Quarterly Journal of Economics, 87*(3), 355-374.",
    "Stinchcombe, A. L. (1965). Social structure and organizations. In J. G. March (Ed.), *Handbook of organizations* (pp. 142-193). Rand McNally.",
    "Tully, T., Redfern, J., Das, D., & Xiao, D. (2025, December 9). *2025: The state of generative AI in the enterprise*. Menlo Ventures. https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/",
    "Vanta. (n.d.). *How much does a SOC 2 audit cost?* https://www.vanta.com/collection/soc-2/soc-2-audit-cost",
    "Webster, F. E., Jr., & Wind, Y. (1972). A general model for understanding organizational buying behavior. *Journal of Marketing, 36*(2), 12-19. https://doi.org/10.1177/002224297203600204",
    "Weiblen, T., & Chesbrough, H. W. (2015). Engaging with startups to enhance corporate innovation. *California Management Review, 57*(2), 66-90. https://doi.org/10.1525/cmr.2015.57.2.66",
  ]
};
