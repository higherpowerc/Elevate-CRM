import type { Client } from "./types";

export interface MatchReason {
  label: string;
  type: "budget" | "market" | "strategy" | "general";
  detail: string;
}

export interface BuyBoxMatch {
  property: Client;
  buyer: Client;
  matchScore: number; // 0 to 100
  budgetFit: boolean;
  marketFit: boolean;
  strategyFit: boolean;
  reasons: MatchReason[];
}

export interface PropertyMatchGroup {
  property: Client;
  matches: BuyBoxMatch[];
}

export interface BuyerMatchGroup {
  buyer: Client;
  matches: BuyBoxMatch[];
}

/** Extract a custom field safely by name (case-insensitive) */
export function getCustomField(client: Client, name: string): string {
  if (!client.customFields || !Array.isArray(client.customFields)) return "";
  const found = client.customFields.find((f) => f.name.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() || "";
}

/** Parse numeric price / budget from dealValue or text */
export function getPropertyPrice(p: Client): number {
  if (typeof p.dealValue === "number" && p.dealValue > 0) return p.dealValue;
  const rawPrice = getCustomField(p, "Purchase Price") || getCustomField(p, "Asking Price") || getCustomField(p, "Contract Price");
  if (rawPrice) {
    const num = Number(rawPrice.replace(/[^0-9.]/g, ""));
    if (!isNaN(num) && num > 0) return num;
  }
  return p.dealValue || 0;
}

/** Parse buyer max budget */
export function getBuyerMaxBudget(b: Client): number {
  if (typeof b.dealValue === "number" && b.dealValue > 0) return b.dealValue;
  const raw = getCustomField(b, "Max Budget") || getCustomField(b, "Budget");
  if (raw) {
    const num = Number(raw.replace(/[^0-9.]/g, ""));
    if (!isNaN(num) && num > 0) return num;
  }
  return b.dealValue || 0;
}

/** Determine if a property matches a buyer's buy box */
export function evaluateMatch(property: Client, buyer: Client): BuyBoxMatch | null {
  const reasons: MatchReason[] = [];
  let scorePoints = 0;
  const maxPoints = 3;

  // 1. Budget Evaluation
  const propPrice = getPropertyPrice(property);
  const maxBudget = getBuyerMaxBudget(buyer);
  let budgetFit = false;

  if (maxBudget <= 0) {
    budgetFit = true;
    scorePoints += 1;
    reasons.push({
      label: "Open Budget",
      type: "budget",
      detail: "Buyer has no max budget cap specified.",
    });
  } else if (propPrice <= 0) {
    budgetFit = true;
    scorePoints += 0.5;
    reasons.push({
      label: "Budget Eligible",
      type: "budget",
      detail: `Buyer max budget is $${maxBudget.toLocaleString()}.`,
    });
  } else if (propPrice <= maxBudget) {
    budgetFit = true;
    scorePoints += 1;
    const diff = maxBudget - propPrice;
    reasons.push({
      label: "Budget Fit",
      type: "budget",
      detail: `$${propPrice.toLocaleString()} is within buyer's $${maxBudget.toLocaleString()} limit (+$${diff.toLocaleString()} headroom).`,
    });
  } else {
    budgetFit = false;
  }

  // 2. Market / Location Evaluation
  const buyerMarkets = (
    getCustomField(buyer, "Target Markets") ||
    buyer.address ||
    ""
  ).toLowerCase();

  const propLocation = [
    property.address,
    property.city,
    property.state,
    property.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let marketFit = false;
  if (!buyerMarkets || buyerMarkets.includes("any") || buyerMarkets.includes("all") || buyerMarkets.includes("nationwide")) {
    marketFit = true;
    scorePoints += 1;
    reasons.push({
      label: "Any Market",
      type: "market",
      detail: "Buyer acquires in any / all markets nationwide.",
    });
  } else {
    const marketTokens = buyerMarkets
      .split(/[,/;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);

    const matchedTokens = marketTokens.filter((token) => propLocation.includes(token));

    if (matchedTokens.length > 0 || (property.state && buyerMarkets.includes(property.state.toLowerCase()))) {
      marketFit = true;
      scorePoints += 1;
      reasons.push({
        label: "Market Match",
        type: "market",
        detail: `Location matches buyer target: ${matchedTokens.join(", ") || property.state || "Target Area"}.`,
      });
    } else {
      if (!property.city && !property.state) {
        marketFit = true;
        scorePoints += 0.5;
        reasons.push({
          label: "Market Pending",
          type: "market",
          detail: "Property city/state pending verification.",
        });
      }
    }
  }

  // 3. Strategy / Property Type Evaluation
  // Buyer can have multiple strategies (e.g. Cash Buyer, Creative Financing / SubTo, Fix & Flip, Buy & Hold)
  const buyerStrategies: string[] = (() => {
    const raw = getCustomField(buyer, "Buyer Type");
    const list: string[] = [];
    if (raw) {
      list.push(...raw.split(/[,/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
    if (buyer.services && Array.isArray(buyer.services)) {
      list.push(...buyer.services.map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
    if (list.length === 0) list.push("cash buyer");
    return Array.from(new Set(list));
  })();

  const propType = (property.clientType || "").toLowerCase();
  const propStructures = (property.services || []).map((s) => s.toLowerCase());
  const propNotes = (property.notes || "").toLowerCase();
  const propFullText = `${property.companyName} ${propType} ${propStructures.join(" ")} ${propNotes}`.toLowerCase();

  let strategyFit = false;
  const matchedStrategies: string[] = [];

  const isCreativeBuyer = buyerStrategies.some((s) => s.includes("creative") || s.includes("subto") || s.includes("seller finance") || s.includes("wrap"));
  const isCashBuyer = buyerStrategies.some((s) => s.includes("cash"));
  const isFlipBuyer = buyerStrategies.some((s) => s.includes("flip"));
  const isHoldBuyer = buyerStrategies.some((s) => s.includes("hold") || s.includes("rental"));

  // Creative financing match
  if (isCreativeBuyer && (propStructures.some((s) => s.includes("creative") || s.includes("subto") || s.includes("seller finance") || s.includes("wrap")) || propNotes.includes("creative") || propNotes.includes("subto") || propNotes.includes("terms"))) {
    matchedStrategies.push("Creative Financing (SubTo / Seller Finance)");
  }

  // Cash buyer match
  if (isCashBuyer && (propStructures.some((s) => s.includes("cash") || s.includes("wholesale")) || !propStructures.some((s) => s.includes("creative")))) {
    matchedStrategies.push("Cash Buyer");
  }

  // Fix & Flip match
  if (isFlipBuyer && (propFullText.includes("flip") || propFullText.includes("rehab") || propFullText.includes("tlc") || propFullText.includes("distressed"))) {
    matchedStrategies.push("Fix & Flip");
  }

  // Buy & Hold match
  if (isHoldBuyer && (propType.includes("multi") || propFullText.includes("tenant") || propFullText.includes("rent") || propFullText.includes("hold"))) {
    matchedStrategies.push("Buy & Hold");
  }

  if (matchedStrategies.length > 0) {
    strategyFit = true;
    scorePoints += 1;
    reasons.push({
      label: "Strategy Match",
      type: "strategy",
      detail: `Matches buyer strategy: ${matchedStrategies.join(" & ")}.`,
    });
  } else if (isCashBuyer || isCreativeBuyer) {
    strategyFit = true;
    scorePoints += 0.9;
    reasons.push({
      label: isCreativeBuyer && isCashBuyer ? "Cash & Creative Buyer" : isCreativeBuyer ? "Creative Financing Buyer" : "Cash Buyer",
      type: "strategy",
      detail: `Buyer utilizes ${isCreativeBuyer && isCashBuyer ? "both Cash & Creative Financing" : isCreativeBuyer ? "Creative Financing" : "Cash"}.`,
    });
  } else {
    strategyFit = true;
    scorePoints += 0.75;
    reasons.push({
      label: "Strategy Compatible",
      type: "strategy",
      detail: `Buyer strategies: ${buyerStrategies.join(", ")}.`,
    });
  }

  const matchScore = Math.min(100, Math.round((scorePoints / maxPoints) * 100));

  if (matchScore >= 50 && (budgetFit || marketFit)) {
    return {
      property,
      buyer,
      matchScore,
      budgetFit,
      marketFit,
      strategyFit,
      reasons,
    };
  }

  return null;
}

/** Get all matches grouped by Property */
export function getMatchesByProperty(
  properties: Client[],
  buyers: Client[],
): PropertyMatchGroup[] {
  const activeProps = properties.filter(
    (p) => !p.archived && !p.lost && p.clientType !== "buyer" && p.stage !== "Buyer",
  );
  const activeBuyers = buyers.filter(
    (b) => !b.archived && !b.lost && (b.clientType === "buyer" || b.stage === "Buyer"),
  );

  const groups: PropertyMatchGroup[] = [];

  for (const property of activeProps) {
    const matches: BuyBoxMatch[] = [];
    for (const buyer of activeBuyers) {
      const match = evaluateMatch(property, buyer);
      if (match) matches.push(match);
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);
    if (matches.length > 0) {
      groups.push({ property, matches });
    }
  }

  return groups;
}

/** Get all matches grouped by Buyer */
export function getMatchesByBuyer(
  properties: Client[],
  buyers: Client[],
): BuyerMatchGroup[] {
  const activeProps = properties.filter(
    (p) => !p.archived && !p.lost && p.clientType !== "buyer" && p.stage !== "Buyer",
  );
  const activeBuyers = buyers.filter(
    (b) => !b.archived && !b.lost && (b.clientType === "buyer" || b.stage === "Buyer"),
  );

  const groups: BuyerMatchGroup[] = [];

  for (const buyer of activeBuyers) {
    const matches: BuyBoxMatch[] = [];
    for (const property of activeProps) {
      const match = evaluateMatch(property, buyer);
      if (match) matches.push(match);
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);
    if (matches.length > 0) {
      groups.push({ buyer, matches });
    }
  }

  return groups;
}
