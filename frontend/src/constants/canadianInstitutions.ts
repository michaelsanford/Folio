export interface CanadianInstitution {
  id: string;
  name: string;
  shortName: string;
  category: "BIG6" | "DIGITAL" | "CREDIT_UNION" | "CARDS_OTHER" | "LENDERS";
  aliases: string[];
}

export const CANADIAN_INSTITUTIONS: CanadianInstitution[] = [
  // ----------------------------------------------------------------- Big 6 Banks
  {
    id: "rbc",
    name: "Royal Bank of Canada (RBC)",
    shortName: "RBC",
    category: "BIG6",
    aliases: ["rbc", "royal bank", "royal bank of canada", "rbc direct investing", "rbc royal bank"],
  },
  {
    id: "td",
    name: "TD Canada Trust",
    shortName: "TD",
    category: "BIG6",
    aliases: ["td", "td canada trust", "td bank", "td direct investing", "toronto dominion"],
  },
  {
    id: "scotiabank",
    name: "Scotiabank (Bank of Nova Scotia)",
    shortName: "Scotiabank",
    category: "BIG6",
    aliases: ["scotia", "scotiabank", "bank of nova scotia", "scotia itrade", "bns"],
  },
  {
    id: "bmo",
    name: "Bank of Montreal (BMO)",
    shortName: "BMO",
    category: "BIG6",
    aliases: ["bmo", "bank of montreal", "bmo nesbitt burns", "bmo investorline"],
  },
  {
    id: "cibc",
    name: "CIBC (Canadian Imperial Bank of Commerce)",
    shortName: "CIBC",
    category: "BIG6",
    aliases: ["cibc", "canadian imperial bank of commerce", "cibc investor's edge"],
  },
  {
    id: "nbc",
    name: "National Bank of Canada (Banque Nationale)",
    shortName: "National Bank",
    category: "BIG6",
    aliases: ["national bank", "nbc", "banque nationale", "nbdb", "national bank direct brokerage"],
  },

  // --------------------------------------------- Digital Banks, Fintechs & Wealth
  {
    id: "wealthsimple",
    name: "Wealthsimple",
    shortName: "Wealthsimple",
    category: "DIGITAL",
    aliases: ["wealthsimple", "ws", "wealthsimple trade", "wealthsimple cash", "wealthsimple crypto"],
  },
  {
    id: "questrade",
    name: "Questrade",
    shortName: "Questrade",
    category: "DIGITAL",
    aliases: ["questrade", "qt", "questwealth", "questrade edge"],
  },
  {
    id: "tangerine",
    name: "Tangerine Bank",
    shortName: "Tangerine",
    category: "DIGITAL",
    aliases: ["tangerine", "ing direct", "tangerine bank"],
  },
  {
    id: "simplii",
    name: "Simplii Financial",
    shortName: "Simplii",
    category: "DIGITAL",
    aliases: ["simplii", "simplii financial", "pc financial bank"],
  },
  {
    id: "eqbank",
    name: "EQ Bank (Equitable Bank)",
    shortName: "EQ Bank",
    category: "DIGITAL",
    aliases: ["eq bank", "eq", "equitable bank"],
  },
  {
    id: "neo",
    name: "Neo Financial",
    shortName: "Neo",
    category: "DIGITAL",
    aliases: ["neo", "neo financial", "neo money"],
  },
  {
    id: "koho",
    name: "KOHO",
    shortName: "KOHO",
    category: "DIGITAL",
    aliases: ["koho", "koho financial"],
  },
  {
    id: "motive",
    name: "Motive Financial",
    shortName: "Motive",
    category: "DIGITAL",
    aliases: ["motive", "motive financial", "canadian western bank"],
  },
  {
    id: "manulife",
    name: "Manulife Bank",
    shortName: "Manulife",
    category: "DIGITAL",
    aliases: ["manulife", "manulife bank", "manulife one"],
  },

  // ------------------------------------------------ Credit Unions & Regional Banks
  {
    id: "desjardins",
    name: "Desjardins (Mouvement Desjardins)",
    shortName: "Desjardins",
    category: "CREDIT_UNION",
    aliases: ["desjardins", "caisse populaire", "disnat", "mouvement desjardins"],
  },
  {
    id: "vancity",
    name: "Vancity (Vancouver City Savings)",
    shortName: "Vancity",
    category: "CREDIT_UNION",
    aliases: ["vancity", "vancouver city savings credit union"],
  },
  {
    id: "meridian",
    name: "Meridian Credit Union",
    shortName: "Meridian",
    category: "CREDIT_UNION",
    aliases: ["meridian", "meridian credit union", "meridian on"],
  },
  {
    id: "atb",
    name: "ATB Financial (Alberta Treasury Branches)",
    shortName: "ATB",
    category: "CREDIT_UNION",
    aliases: ["atb", "atb financial", "alberta treasury branches", "atb investor services"],
  },
  {
    id: "coastcapital",
    name: "Coast Capital Savings",
    shortName: "Coast Capital",
    category: "CREDIT_UNION",
    aliases: ["coast capital", "coast capital savings"],
  },
  {
    id: "servus",
    name: "Servus Credit Union",
    shortName: "Servus",
    category: "CREDIT_UNION",
    aliases: ["servus", "servus credit union"],
  },
  {
    id: "alterna",
    name: "Alterna Savings / Alterna Bank",
    shortName: "Alterna",
    category: "CREDIT_UNION",
    aliases: ["alterna", "alterna savings", "alterna bank"],
  },
  {
    id: "laurentian",
    name: "Laurentian Bank of Canada (Banque Laurentienne)",
    shortName: "Laurentian Bank",
    category: "CREDIT_UNION",
    aliases: ["laurentian", "laurentian bank", "banque laurentienne", "lbc"],
  },
  {
    id: "cwb",
    name: "Canadian Western Bank (CWB)",
    shortName: "CWB",
    category: "CREDIT_UNION",
    aliases: ["cwb", "canadian western bank"],
  },

  // ---------------------------------------------------- Credit Cards & Retailers
  {
    id: "amex",
    name: "American Express Canada (Amex)",
    shortName: "Amex",
    category: "CARDS_OTHER",
    aliases: ["amex", "american express", "american express canada"],
  },
  {
    id: "capitalone",
    name: "Capital One Canada",
    shortName: "Capital One",
    category: "CARDS_OTHER",
    aliases: ["capital one", "capital one canada"],
  },
  {
    id: "mbna",
    name: "MBNA Canada (TD)",
    shortName: "MBNA",
    category: "CARDS_OTHER",
    aliases: ["mbna", "mbna canada"],
  },
  {
    id: "rogersbank",
    name: "Rogers Bank",
    shortName: "Rogers Bank",
    category: "CARDS_OTHER",
    aliases: ["rogers", "rogers bank", "rogers red mastercard"],
  },
  {
    id: "pcfinancial",
    name: "PC Financial (President's Choice)",
    shortName: "PC Financial",
    category: "CARDS_OTHER",
    aliases: ["pc financial", "pc money", "pc optimum", "president's choice"],
  },
  {
    id: "triangle",
    name: "Canadian Tire Financial (Triangle)",
    shortName: "Canadian Tire / Triangle",
    category: "CARDS_OTHER",
    aliases: ["canadian tire", "canadian tire bank", "triangle mastercard", "ctfs"],
  },

  // ---------------------------------------------------- Mortgages, Loans & Lenders
  {
    id: "nslsc",
    name: "National Student Loans Service Centre (NSLSC)",
    shortName: "NSLSC",
    category: "LENDERS",
    aliases: ["nslsc", "national student loan", "canada student loans", "student loan"],
  },
  {
    id: "mcap",
    name: "MCAP Mortgage",
    shortName: "MCAP",
    category: "LENDERS",
    aliases: ["mcap", "mcap mortgage", "mcap financial"],
  },
  {
    id: "firstnational",
    name: "First National Financial",
    shortName: "First National",
    category: "LENDERS",
    aliases: ["first national", "first national mortgage", "fnf"],
  },
  {
    id: "cmls",
    name: "CMLS Financial",
    shortName: "CMLS",
    category: "LENDERS",
    aliases: ["cmls", "cmls financial", "cmls mortgage"],
  },
  {
    id: "hometrust",
    name: "Home Trust Company",
    shortName: "Home Trust",
    category: "LENDERS",
    aliases: ["home trust", "home capital group"],
  },
  {
    id: "fairstone",
    name: "Fairstone Financial",
    shortName: "Fairstone",
    category: "LENDERS",
    aliases: ["fairstone", "fairstone bank"],
  },
];

export const INSTITUTION_CATEGORY_LABELS: Record<CanadianInstitution["category"], string> = {
  BIG6: "Big 6 Canadian Banks",
  DIGITAL: "Digital Banks & Online Wealth",
  CREDIT_UNION: "Credit Unions & Regional Banks",
  CARDS_OTHER: "Credit Cards & Retail Finance",
  LENDERS: "Mortgage & Student Loan Lenders",
};

export function searchCanadianInstitutions(query: string): CanadianInstitution[] {
  const q = query.toLowerCase().trim();
  if (!q) return CANADIAN_INSTITUTIONS.slice(0, 10);

  return CANADIAN_INSTITUTIONS.filter((inst) => {
    return (
      inst.name.toLowerCase().includes(q) ||
      inst.shortName.toLowerCase().includes(q) ||
      inst.aliases.some((alias) => alias.includes(q))
    );
  });
}
