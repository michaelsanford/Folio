import type { AccountType } from "../types";

export type AccountCategoryGroup =
  | "CASH"
  | "REGISTERED"
  | "INVESTMENT"
  | "DEBT"
  | "ASSET";

export interface CanadianAccountTypeMeta {
  type: AccountType;
  name: string;
  shortName: string;
  category: AccountCategoryGroup;
  classification: "ASSET" | "LIABILITY";
  defaultIcon: string;
  defaultColor: string;
  badge: string;
  description: string;
  keyRules: string[];
  craUrl?: string;
  supportsAmortization?: boolean;
  supportsInvestments?: boolean;
}

export const CANADIAN_ACCOUNT_TYPES: Record<AccountType, CanadianAccountTypeMeta> = {
  // ------------------------------------------------------------- Cash & Banking
  CHECKING: {
    type: "CHECKING",
    name: "Chequing Account",
    shortName: "Chequing",
    category: "CASH",
    classification: "ASSET",
    defaultIcon: "wallet",
    defaultColor: "#3B82F6", // Blue
    badge: "Day-to-Day Banking",
    description: "Transactional deposit account for daily debits, bill payments, and payroll deposits.",
    keyRules: [
      "CDIC eligible: Insured up to $100,000 per depositor per member institution.",
      "Typically zero or low interest yield with frequent transaction volume.",
      "Supports pre-authorized debit (PAD) and direct payroll deposits.",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/banking/bank-accounts.html",
  },
  SAVINGS: {
    type: "SAVINGS",
    name: "Savings Account",
    shortName: "Savings",
    category: "CASH",
    classification: "ASSET",
    defaultIcon: "piggy-bank",
    defaultColor: "#10B981", // Emerald
    badge: "Interest Bearing",
    description: "Deposit account designed for short-to-medium term savings with interest earnings.",
    keyRules: [
      "CDIC insured up to $100,000 per depositor per member institution.",
      "Interest earned is taxable as income in non-registered accounts (T5 slip issued for > $50).",
      "Liquid capital with low risk and immediate withdrawal capability.",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/banking/bank-accounts/savings-account.html",
  },
  HISA: {
    type: "HISA",
    name: "High-Interest Savings Account (HISA)",
    shortName: "HISA",
    category: "CASH",
    classification: "ASSET",
    defaultIcon: "coins",
    defaultColor: "#06B6D4", // Cyan
    badge: "Elevated Yield",
    description: "High-yield cash savings account offering premium promotional or baseline interest rates.",
    keyRules: [
      "CDIC insured if held with Canadian CDIC-member financial institutions.",
      "Interest earned is 100% taxable as regular income (T5 slip).",
      "Ideal for emergency funds and short-term savings targets.",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/banking/bank-accounts/savings-account.html",
  },
  CASH: {
    type: "CASH",
    name: "Cash / Physical Currency",
    shortName: "Cash",
    category: "CASH",
    classification: "ASSET",
    defaultIcon: "banknote",
    defaultColor: "#14B8A6", // Teal
    badge: "Physical Vault",
    description: "Physical currency holdings, cash wallets, or petty cash reserves.",
    keyRules: [
      "Physical asset held outside banking institutions.",
      "Zero interest yield, not insured by CDIC.",
      "Track manual cash expenses and envelope budgeting reserves.",
    ],
  },

  // -------------------------------------------------------- Registered Accounts
  TFSA: {
    type: "TFSA",
    name: "Tax-Free Savings Account (TFSA)",
    shortName: "TFSA",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "sparkles",
    defaultColor: "#10B981", // Emerald
    badge: "100% Tax-Free Growth",
    description: "Canada's premier flexible tax-free registered account. All investment gains and withdrawals are completely tax-exempt.",
    keyRules: [
      "Contributions are made with after-tax dollars (not tax-deductible).",
      "All capital gains, dividends, and interest compound completely tax-free.",
      "Withdrawals are 100% tax-free and the full withdrawn amount is re-added to your contribution room on January 1 of the following year.",
      "Unused contribution room carries forward indefinitely for Canadian residents aged 18+.",
      "Over-contributions are subject to a 1% per month CRA penalty tax on the excess amount.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account-tfsa.html",
    supportsInvestments: true,
  },
  RRSP: {
    type: "RRSP",
    name: "Registered Retirement Savings Plan (RRSP)",
    shortName: "RRSP",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "umbrella",
    defaultColor: "#6366F1", // Indigo
    badge: "Tax-Deductible Contributions",
    description: "Tax-sheltered retirement account. Contributions reduce your taxable income, and investments grow tax-deferred until retirement.",
    keyRules: [
      "Contributions directly deduct from taxable income on your annual T1 tax return.",
      "Annual limit is 18% of previous year earned income up to annual CRA max, minus Pension Adjustments.",
      "Investments grow tax-deferred until withdrawn, at which point withdrawals are taxed as regular income.",
      "Home Buyers' Plan (HBP): Withdraw up to $60,000 tax-free for qualifying first home, repayable over 15 years.",
      "Lifelong Learning Plan (LLP): Withdraw up to $20,000 tax-free for full-time training/education.",
      "Must be collapsed or converted to a RRIF or annuity by December 31 of the year you turn 71.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/registered-retirement-savings-plan-rrsp.html",
    supportsInvestments: true,
  },
  FHSA: {
    type: "FHSA",
    name: "First Home Savings Account (FHSA)",
    shortName: "FHSA",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "home",
    defaultColor: "#8B5CF6", // Violet
    badge: "Tax-Deductible In & Tax-Free Out",
    description: "Registered plan designed for first-time home buyers combining the tax deduction of an RRSP with the tax-free withdrawal of a TFSA.",
    keyRules: [
      "Contributions are tax-deductible against taxable income (like an RRSP).",
      "Qualifying withdrawals for purchasing a first home in Canada are 100% tax-free (like a TFSA).",
      "Annual contribution limit of $8,000 up to a lifetime maximum of $40,000.",
      "Up to $8,000 in unused contribution room can carry forward to subsequent years (max $16,000 contribution in a single year).",
      "Account can stay open for up to 15 years or until December 31 of the year you turn 71; unused balances can transfer tax-free into an RRSP/RRIF without affecting RRSP room.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account.html",
    supportsInvestments: true,
  },
  RESP: {
    type: "RESP",
    name: "Registered Education Savings Plan (RESP)",
    shortName: "RESP",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "graduation-cap",
    defaultColor: "#EC4899", // Pink
    badge: "Education Savings (CESG Eligible)",
    description: "Tax-sheltered education savings plan for children and beneficiaries with government grant matching.",
    keyRules: [
      "Contributions are made with after-tax dollars (not tax-deductible).",
      "Canada Education Savings Grant (CESG): Federal government matches 20% on the first $2,500 contributed annually ($500/year match) up to a lifetime max of $7,200 per beneficiary.",
      "Canada Learning Bond (CLB): Up to $2,000 for children from low-income families without requiring contributions.",
      "Lifetime contribution maximum of $50,000 per beneficiary.",
      "Educational Assistance Payments (EAPs) are taxed in the student's hands, usually resulting in little to no tax.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/registered-education-savings-plans-resps.html",
    supportsInvestments: true,
  },
  RDSP: {
    type: "RDSP",
    name: "Registered Disability Savings Plan (RDSP)",
    shortName: "RDSP",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "heart-handshake",
    defaultColor: "#06B6D4", // Cyan
    badge: "Disability Grant Eligible",
    description: "Long-term savings plan to help Canadian individuals approved for the Disability Tax Credit (DTC) build financial security.",
    keyRules: [
      "Beneficiary must be eligible for the Disability Tax Credit (DTC) and under age 60.",
      "Canada Disability Savings Grant (CDSG): Government matching up to 300% (up to $3,500/year, $70,000 lifetime limit).",
      "Canada Disability Savings Bond (CDSB): Up to $1,000/year ($20,000 lifetime limit) for lower-income families.",
      "Lifetime contribution limit of $200,000; no annual contribution cap.",
      "Contributions grow tax-sheltered until withdrawn via Disability Assistance Payments (DAPs).",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/registered-disability-savings-plan-rdsp.html",
    supportsInvestments: true,
  },
  RRIF: {
    type: "RRIF",
    name: "Registered Retirement Income Fund (RRIF)",
    shortName: "RRIF",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "clock",
    defaultColor: "#F59E0B", // Amber
    badge: "Retirement Payout (Minimums Apply)",
    description: "Retirement payout account converted from an RRSP. Requires mandatory annual minimum withdrawals based on age.",
    keyRules: [
      "Created by rolling over RRSP funds tax-free (mandatory by age 71).",
      "No new contributions are permitted once an RRSP is converted to a RRIF.",
      "Must withdraw a mandatory prescribed minimum percentage each year based on your age (or younger spouse's age).",
      "All withdrawals are fully taxable as regular income (T4RIF slip issued).",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/registered-retirement-income-fund-rrif.html",
    supportsInvestments: true,
  },
  LIRA: {
    type: "LIRA",
    name: "Locked-In Retirement Account (LIRA / LRSP)",
    shortName: "LIRA",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "lock",
    defaultColor: "#64748B", // Slate
    badge: "Locked-In Pension Transfer",
    description: "Holds vested pension funds transferred from a former employer's registered pension plan.",
    keyRules: [
      "Funds are locked-in under federal or provincial pension legislation and cannot be withdrawn freely prior to retirement age.",
      "No ongoing contributions permitted (only initial pension transfer or consolidation).",
      "Investments compound tax-sheltered identical to an RRSP.",
      "Must convert to a Life Income Fund (LIF) or locked-in annuity by age 71 to commence retirement withdrawals.",
    ],
    craUrl: "https://www.canada.ca/en/services/benefits/publicpensions/cpp/pension-regulations.html",
    supportsInvestments: true,
  },
  LIF: {
    type: "LIF",
    name: "Life Income Fund (LIF / LRIF)",
    shortName: "LIF",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "calendar-clock",
    defaultColor: "#D97706", // Dark Amber
    badge: "Pension Payout (Min & Max Caps)",
    description: "Payout vehicle converted from a LIRA with both annual minimum and maximum withdrawal boundaries.",
    keyRules: [
      "Converted from a LIRA or locked-in pension to provide retirement income.",
      "Governed by annual MINIMUM and MAXIMUM withdrawal limits defined by provincial/federal pension formulas to prevent early depletion.",
      "All withdrawals are treated as taxable income.",
    ],
    craUrl: "https://www.canada.ca/en/services/benefits/publicpensions/cpp/pension-regulations.html",
    supportsInvestments: true,
  },
  IPP: {
    type: "IPP",
    name: "Individual Pension Plan (IPP)",
    shortName: "IPP",
    category: "REGISTERED",
    classification: "ASSET",
    defaultIcon: "briefcase",
    defaultColor: "#4338CA", // Deep Indigo
    badge: "Corporate Defined Benefit",
    description: "Defined-benefit registered pension plan set up for incorporated professionals and business owner-executives.",
    keyRules: [
      "Provides higher contribution room than an RRSP for individuals aged 40+ with substantial T4 corporate income.",
      "Corporate contributions and setup/actuarial fees are 100% tax-deductible for the corporation.",
      "Requires formal actuarial valuation every 3 years.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/registered-pension-plans-rpps.html",
    supportsInvestments: true,
  },

  // ------------------------------------------------------------- Investments
  INVESTMENT: {
    type: "INVESTMENT",
    name: "Brokerage / Investment Portfolio",
    shortName: "Brokerage",
    category: "INVESTMENT",
    classification: "ASSET",
    defaultIcon: "trending-up",
    defaultColor: "#6366F1", // Indigo
    badge: "Multi-Asset Brokerage",
    description: "General investment account holding stocks, ETFs, mutual funds, GICs, and bonds.",
    keyRules: [
      "Supports tracking asset allocation, stock lots, dividends, and total performance returns.",
      "Track money-weighted and time-weighted rates of return.",
    ],
    supportsInvestments: true,
  },
  NON_REGISTERED: {
    type: "NON_REGISTERED",
    name: "Non-Registered / Taxable Account",
    shortName: "Taxable Margin",
    category: "INVESTMENT",
    classification: "ASSET",
    defaultIcon: "bar-chart-3",
    defaultColor: "#4F46E5", // Indigo
    badge: "Taxable (Cap Gains & Dividends)",
    description: "Taxable investment account without contribution limits, subject to capital gains and dividend taxation.",
    keyRules: [
      "No contribution limits or withdrawal restrictions.",
      "Capital gains are taxed at the inclusion rate (50% on first $250k; 66.67% thereafter).",
      "Canadian eligible dividends qualify for the federal and provincial Dividend Tax Credit (DTC).",
      "Margin interest is tax-deductible when borrowed to earn investment income.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains.html",
    supportsInvestments: true,
  },
  CRYPTO: {
    type: "CRYPTO",
    name: "Cryptocurrency & Digital Assets",
    shortName: "Crypto",
    category: "INVESTMENT",
    classification: "ASSET",
    defaultIcon: "layers",
    defaultColor: "#F59E0B", // Amber
    badge: "Digital Asset / Commodity",
    description: "Bitcoin, Ethereum, digital asset wallets, and exchange holdings.",
    keyRules: [
      "CRA treats cryptocurrency as a commodity rather than legal tender currency.",
      "Disposing of crypto (selling for fiat, trading coin-to-coin, purchasing goods) is a taxable disposition.",
      "Subject to capital gains or business income rules depending on trading frequency.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/compliance/digital-currency/cryptocurrency-guide.html",
    supportsInvestments: true,
  },

  // ----------------------------------------------------- Credit, Debt & Loans
  CREDIT_CARD: {
    type: "CREDIT_CARD",
    name: "Credit Card",
    shortName: "Credit Card",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "credit-card",
    defaultColor: "#F59E0B", // Amber
    badge: "Revolving Credit",
    description: "Revolving credit line with grace periods and high interest if balances roll over.",
    keyRules: [
      "Standard 21-day interest-free grace period on new purchases when statement is paid in full.",
      "Cash advances accrue interest immediately from the transaction date.",
      "High purchase APRs (typically 19.99% - 24.99%).",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/credit-cards.html",
  },
  LINE_OF_CREDIT: {
    type: "LINE_OF_CREDIT",
    name: "Line of Credit / HELOC",
    shortName: "Line of Credit",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "scale",
    defaultColor: "#EC4899", // Pink
    badge: "Revolving LOC / Prime-Linked",
    description: "Revolving debt facility with interest charged only on the drawn balance, often tied to Canadian Prime rate.",
    keyRules: [
      "Variable interest rate expressed as Canadian Prime + margin.",
      "Home Equity Lines of Credit (HELOCs) are capped at 65% Loan-to-Value (LTV) in Canada.",
      "Flexible interest-only minimum monthly payments allowed.",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/mortgages/home-equity-line-credit.html",
    supportsAmortization: true,
  },
  MORTGAGE: {
    type: "MORTGAGE",
    name: "Residential Mortgage",
    shortName: "Mortgage",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "building-2",
    defaultColor: "#8B5CF6", // Violet
    badge: "Semi-Annual Compounding",
    description: "Secured residential home mortgage amortized over 25-30 years with fixed or variable terms.",
    keyRules: [
      "Canadian Law (Interest Act s.6): Fixed-rate mortgages in Canada are compounded semi-annually, not in advance.",
      "Standard terms are 3 or 5 years with 25 or 30-year amortizations.",
      "Subject to the OSFI B-20 Mortgage Qualifying Stress Test (+2% above contract rate).",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/mortgages.html",
    supportsAmortization: true,
  },
  VEHICLE_LOAN: {
    type: "VEHICLE_LOAN",
    name: "Vehicle / Auto Loan",
    shortName: "Auto Loan",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "car",
    defaultColor: "#3B82F6", // Blue
    badge: "Amortizing Auto Debt",
    description: "Fixed-term secured loan for vehicle financing.",
    keyRules: [
      "Fixed monthly or bi-weekly amortizing loan terms (typically 24 - 84 months).",
      "Secured by the underlying vehicle as collateral.",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/loans/car-loans.html",
    supportsAmortization: true,
  },
  STUDENT_LOAN: {
    type: "STUDENT_LOAN",
    name: "Student Loan (Canada / Provincial)",
    shortName: "Student Loan",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "book-open",
    defaultColor: "#10B981", // Emerald
    badge: "0% Federal Interest (CSL)",
    description: "Government-backed or private education loan.",
    keyRules: [
      "Canada Student Loans (CSL): 0% interest permanently eliminated on the federal portion as of April 1, 2023.",
      "Interest paid on qualifying provincial student loans generates a 15% federal non-refundable tax credit (Line 31900).",
      "Repayment Assistance Plan (RAP) available for low-income situations.",
    ],
    craUrl: "https://www.canada.ca/en/services/benefits/education/student-aid/grants-loans.html",
    supportsAmortization: true,
  },
  PERSONAL_LOAN: {
    type: "PERSONAL_LOAN",
    name: "Personal / Term Loan",
    shortName: "Personal Loan",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "file-spreadsheet",
    defaultColor: "#EF4444", // Red
    badge: "Fixed Term Debt",
    description: "Fixed-rate or variable term loan from a financial institution or lender.",
    keyRules: [
      "Fixed monthly amortizing payment schedule.",
      "Secured or unsecured borrowing options.",
    ],
    craUrl: "https://www.canada.ca/en/financial-consumer-agency/services/loans.html",
    supportsAmortization: true,
  },
  OTHER_LIABILITY: {
    type: "OTHER_LIABILITY",
    name: "Other Liability / Debt",
    shortName: "Other Debt",
    category: "DEBT",
    classification: "LIABILITY",
    defaultIcon: "landmark",
    defaultColor: "#94A3B8", // Slate
    badge: "General Liability",
    description: "Promissory notes, tax liabilities, family debt, or other financial obligations.",
    keyRules: [
      "Track custom balances, interest, and payoff terms.",
    ],
    supportsAmortization: true,
  },

  // ------------------------------------------------------------- Real & Physical
  REAL_ESTATE: {
    type: "REAL_ESTATE",
    name: "Real Estate & Property Asset",
    shortName: "Real Estate",
    category: "ASSET",
    classification: "ASSET",
    defaultIcon: "home",
    defaultColor: "#10B981", // Emerald
    badge: "Property Valuation",
    description: "Primary residence, secondary vacation home, or rental investment real estate.",
    keyRules: [
      "Principal Residence Exemption (PRE): 100% of capital gains are tax-exempt when selling your designated principal residence.",
      "Rental / Investment properties are subject to capital gains tax and rental income taxation.",
    ],
    craUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/principal-residence-other-real-estate.html",
  },
  VEHICLE_ASSET: {
    type: "VEHICLE_ASSET",
    name: "Vehicle / Auto Asset Value",
    shortName: "Vehicle Asset",
    category: "ASSET",
    classification: "ASSET",
    defaultIcon: "car",
    defaultColor: "#06B6D4", // Cyan
    badge: "Physical Asset",
    description: "Market value of owned automobiles, motorcycles, boats, or recreational vehicles.",
    keyRules: [
      "Track depreciating vehicle equity alongside auto loan liabilities for accurate net worth.",
    ],
  },
  OTHER_ASSET: {
    type: "OTHER_ASSET",
    name: "Other Physical / Valued Asset",
    shortName: "Other Asset",
    category: "ASSET",
    classification: "ASSET",
    defaultIcon: "gem",
    defaultColor: "#A855F7", // Purple
    badge: "Valued Holdings",
    description: "Precious metals, collectibles, art, jewellery, equipment, or private equity shares.",
    keyRules: [
      "Personal-use property (PUP) and listed personal property (LPP) CRA rules apply to certain gains.",
    ],
  },
};

export const ACCOUNT_CATEGORY_LABELS: Record<AccountCategoryGroup, string> = {
  CASH: "Cash & Daily Banking",
  REGISTERED: "Registered Tax-Advantaged (CRA)",
  INVESTMENT: "Investments & Wealth",
  DEBT: "Liabilities, Credit & Loans",
  ASSET: "Real Estate & Physical Assets",
};

export function getAccountTypeMeta(type: AccountType): CanadianAccountTypeMeta {
  return (
    CANADIAN_ACCOUNT_TYPES[type] || {
      type,
      name: type,
      shortName: type,
      category: "ASSET",
      classification: "ASSET",
      defaultIcon: "wallet",
      defaultColor: "#6366F1",
      badge: "Account",
      description: "Financial account",
      keyRules: [],
    }
  );
}

export function isAssetAccount(type: AccountType): boolean {
  const meta = CANADIAN_ACCOUNT_TYPES[type];
  return meta ? meta.classification === "ASSET" : true;
}

export function isInvestmentAccount(type: AccountType): boolean {
  const meta = CANADIAN_ACCOUNT_TYPES[type];
  return meta ? !!meta.supportsInvestments : type === "INVESTMENT";
}

export function isLoanAccount(type: AccountType): boolean {
  const meta = CANADIAN_ACCOUNT_TYPES[type];
  return (
    meta?.supportsAmortization ??
    ["MORTGAGE", "VEHICLE_LOAN", "LINE_OF_CREDIT", "STUDENT_LOAN", "PERSONAL_LOAN", "OTHER_LIABILITY"].includes(type)
  );
}
