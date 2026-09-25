// Maps a tender/project's title+description text to C-Soft's product catalog.
// Keyword/rule-based on purpose: transparent (you can see exactly why something
// matched), free, instant, and easy to tune over time as real tender wording
// turns out to differ from what's expected — that's the "ever-improving" part:
// add or adjust patterns here as false positives/negatives show up in review.

const RULES = [
  {
    category: 'Structural Analysis & Design',
    products: ['STAAD.Pro', 'STAAD Advanced Concrete Design (RCDC)'],
    confidence: 'high',
    patterns: [
      /\bRCC\s+bridge\b/i, /\breinforced\s+concrete\b/i, /\bstructural\s+(design|analysis|stability)\b/i,
      /\bmulti[- ]?stor(e|ie)y\b/i, /\bhigh[- ]?rise\b/i, /\bseismic\s+(design|retrofit)\b/i,
      /\bsteel\s+structure\b/i, /\bfoundation\s+design\b/i, /\bindustrial\s+shed\b/i,
      /\bwarehouse\s+construction\b/i, /\bflyover\b/i, /\b(rob|road\s+over\s+bridge)\b/i,
      /\bculvert\s+construction\b/i, /\bviaduct\b/i,
    ],
  },
  {
    category: 'Structural Detailing',
    products: ['ProStructures', 'ProSteel', 'ProConcrete', 'Bentley PowerRebar'],
    confidence: 'medium',
    patterns: [
      /\brebar\s+detailing\b/i, /\breinforcement\s+detailing\b/i, /\bsteel\s+detailing\b/i,
      /\bfabrication\s+drawing/i, /\bbar\s+bending\s+schedule\b/i,
    ],
  },
  {
    category: 'Engineering Analysis (CAE) — Pipe Stress',
    products: ['Bentley AutoPIPE'],
    confidence: 'high',
    patterns: [
      /\bpipe\s+stress\b/i, /\bpiping\s+(design|engineering|layout)\b/i, /\bprocess\s+piping\b/i,
      /\bpower\s+plant\s+piping\b/i, /\brefinery\s+piping\b/i,
    ],
  },
  {
    category: '2D/3D Modeling & Drawing',
    products: ['AutoCAD', 'ARES Commander'],
    confidence: 'low',
    patterns: [
      /\bCAD\s+drafting\b/i, /\bdrawing\s+preparation\b/i, /\bas[- ]?built\s+drawing/i,
    ],
  },
  {
    category: 'Water & Civil Infrastructure — Water/Sewer',
    products: ['SewerGEMS', 'WaterGEMS'],
    confidence: 'high',
    patterns: [
      /\bsewerage\b/i, /\bsewer\s+(network|line|system)\b/i, /\bunderground\s+drainage\b/i,
      /\bUGD\b/, /\bwater\s+supply\s+scheme\b/i, /\bwater\s+distribution\s+network\b/i,
      /\bdrinking\s+water\b/i, /\bstorm[- ]?water\s+drain/i, /\bpipeline\s+network\b/i,
      /\bpumping\s+station\b/i, /\boverhead\s+(service\s+)?reservoir\b/i, /\boverhead\s+tank\b/i,
      /\bCPHEEO\b/, /\bWTP\b|\bwater\s+treatment\s+plant\b/i, /\bSTP\b|\bsewage\s+treatment\s+plant\b/i,
      /\bMission\s+Bhagiratha\b/i, /\bAMRUT\b/,
    ],
  },
  {
    category: 'Water & Civil Infrastructure — Roads',
    products: ['MX Road'],
    confidence: 'medium',
    patterns: [
      /\broad\s+(widening|construction|improvement)\b/i, /\bhighway\s+design\b/i,
      /\bBT\s+road\b/i, /\bpavement\s+design\b/i, /\bstrengthening\s+of\s+road/i,
    ],
  },
  {
    category: 'BIM & Documentation',
    products: ['Structural Modeler'],
    confidence: 'medium',
    patterns: [
      /\bBIM\b/, /\bbuilding\s+information\s+model/i,
    ],
  },
  {
    // Generic construction/building language with no specific structural signal —
    // still worth surfacing, just flagged as a weaker guess.
    category: 'General Building Construction',
    products: ['STAAD.Pro', 'AutoCAD'],
    confidence: 'low',
    patterns: [
      /\bconstruction\s+of\s+(building|hospital|school|college|office|complex|hostel|stadium|godown|community\s+hall)\b/i,
      /\bcivil\s+works\b/i,
    ],
  },
  {
    // Private-industry signal: a company announcing a new/expanded manufacturing
    // facility needs structural design for the building itself even when the
    // announcement text (a corporate filing or news blurb) never uses tender-style
    // scope-of-work language.
    category: 'Private Industry — New Facility / Plant',
    products: ['STAAD.Pro', 'AutoCAD'],
    confidence: 'medium',
    patterns: [
      /\bnew\s+plant\b/i, /\bgreenfield\s+project\b/i, /\bnew\s+(manufacturing\s+)?facility\b/i,
      /\bcommissioning\s+of\s+(the\s+)?(new\s+)?plant\b/i, /\bcapacity\s+expansion\b/i,
      /\bcapacity\s+addition\b/i, /\bnew\s+factory\b/i, /\bbrownfield\s+expansion\b/i,
      /\bexpansion\s+(and\s+moderni[sz]ation\s+)?(programme|program)\b/i,
      /\bcommencement\s+of\s+commercial\s+(production|operations)\b/i,
    ],
  },
  {
    // Process/chemical/petrochemical facilities specifically need pipe-stress
    // engineering in addition to the structural baseline above.
    category: 'Private Industry — Process Plant',
    products: ['Bentley AutoPIPE', 'STAAD.Pro'],
    confidence: 'medium',
    patterns: [
      /\bchemical\s+plant\b/i, /\bpetrochemical\b/i, /\brefinery\s+(expansion|project|unit)\b/i,
      /\bprocess\s+plant\b/i, /\bfertili[sz]er\s+plant\b/i, /\bpharma(ceutical)?\s+plant\b/i,
      /\bdistillery\b/i, /\bcement\s+plant\b/i,
    ],
  },
];

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function classify(text) {
  const t = String(text || '');
  const matchedProducts = new Set();
  const matchedCategories = [];
  let bestConfidence = null;

  for (const rule of RULES) {
    const hit = rule.patterns.some((p) => p.test(t));
    if (hit) {
      rule.products.forEach((p) => matchedProducts.add(p));
      matchedCategories.push(rule.category);
      if (!bestConfidence || CONFIDENCE_RANK[rule.confidence] > CONFIDENCE_RANK[bestConfidence]) {
        bestConfidence = rule.confidence;
      }
    }
  }

  return {
    matchedProducts: Array.from(matchedProducts),
    category: matchedCategories[0] || null,
    matchedCategories,
    confidence: bestConfidence || 'none',
  };
}

module.exports = { classify, RULES };
