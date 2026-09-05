/**
 * Real Estate Property Lead Enrichment Module
 *
 * Integrates with RentCast API (and public appraisal models) for:
 * - One-click property specs lookup (beds, baths, sqft, year built)
 * - Automated Valuation Model (AVM) property value estimates & ranges
 * - Long-term & short-term market rent estimates
 * - Real estate comparable sales (comps)
 * - Intelligent heuristic fallback when API key is unconfigured
 */

export interface PropertyEnrichmentResult {
  formattedAddress: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  county?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  estimatedValue?: number;
  valueRangeLow?: number;
  valueRangeHigh?: number;
  estimatedRent?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  taxAssessedValue?: number;
  ownerName?: string;
  comps?: Array<{
    address: string;
    price: number;
    bedrooms: number;
    bathrooms: number;
    squareFootage: number;
    distanceMiles: number;
  }>;
  source: "rentcast" | "attom" | "unconfigured" | "not_found" | "public_records_estimate";
  message?: string;
}

/**
 * Parses an address string into structured parts (street, city, state, zip).
 */
export function parseAddressString(address: string): {
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
} {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  let addressLine1 = parts[0] || address.trim();
  let city = "";
  let state = "";
  let zipCode = "";

  if (parts.length >= 3) {
    city = parts[1];
    const stateZip = parts[2].trim().split(/\s+/);
    if (stateZip[0]) state = stateZip[0].toUpperCase();
    if (stateZip[1]) zipCode = stateZip[1];
  } else if (parts.length === 2) {
    const secondPart = parts[1].trim().split(/\s+/);
    if (secondPart.length >= 2 && secondPart[secondPart.length - 2].length === 2) {
      state = secondPart[secondPart.length - 2].toUpperCase();
      zipCode = secondPart[secondPart.length - 1];
      city = secondPart.slice(0, -2).join(" ");
    } else {
      city = parts[1];
    }
  }

  return { addressLine1, city, state, zipCode };
}

/**
 * Fetch live property specs and valuation from RentCast API if configured.
 * Does NOT generate fake specs when API key is unconfigured.
 */
export async function lookupPropertyData(
  address: string,
  apiKey?: string
): Promise<PropertyEnrichmentResult> {
  const cleanAddr = address.trim();
  if (!cleanAddr) {
    throw new Error("Address is required for property lookup.");
  }

  const parsed = parseAddressString(cleanAddr);
  const key = (apiKey || process.env.RENTCAST_API_KEY || "").trim();

  // If no live key is configured, return clear status without fabricating fake specs
  if (!key || key === "mock" || key === "demo") {
    return {
      formattedAddress: cleanAddr,
      addressLine1: parsed.addressLine1,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
      source: "unconfigured",
      message:
        "RentCast API key is not configured. Add your free RentCast API key in Settings > Integrations (50 free lookups/mo at rentcast.io) to pull verified MLS specs, tax appraisals, and comps.",
    };
  }

  // 1. Query RentCast Property Specs API
  const propUrl = `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(cleanAddr)}`;
  const propRes = await fetch(propUrl, {
    headers: {
      Accept: "application/json",
      "X-Api-Key": key,
    },
  });

  if (propRes.status === 401 || propRes.status === 403) {
    throw new Error("Invalid RentCast API key. Please check your API key in Settings > Integrations.");
  }

  if (propRes.status === 429) {
    throw new Error("RentCast API monthly quota exceeded (free tier limit reached). Upgrade plan at rentcast.io.");
  }

  if (propRes.status === 404) {
    return {
      formattedAddress: cleanAddr,
      addressLine1: parsed.addressLine1,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
      source: "not_found",
      message: "No property records found in RentCast for this address. Verify address formatting or enter specs manually.",
    };
  }

  if (!propRes.ok) {
    const errText = await propRes.text();
    throw new Error(`RentCast API returned HTTP ${propRes.status}: ${errText}`);
  }

  const propData = (await propRes.json()) as any;
  const p = Array.isArray(propData) ? propData[0] : propData;

  if (!p) {
    return {
      formattedAddress: cleanAddr,
      addressLine1: parsed.addressLine1,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
      source: "not_found",
      message: "No property records found in RentCast for this address. Verify address formatting or enter specs manually.",
    };
  }

  // 2. Query RentCast AVM Valuation & Comps API
  let avmData: any = {};
  try {
    const avmUrl = `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(cleanAddr)}`;
    const avmRes = await fetch(avmUrl, {
      headers: {
        Accept: "application/json",
        "X-Api-Key": key,
      },
    });
    if (avmRes.ok) {
      avmData = (await avmRes.json()) as any;
    }
  } catch (avmErr) {
    console.warn("[property-enrichment] AVM fetch warning:", avmErr);
  }

  // Extract owner name if available from RentCast
  let ownerName: string | undefined = undefined;
  if (p.owner) {
    if (Array.isArray(p.owner.names) && p.owner.names[0]) {
      ownerName = p.owner.names[0];
    } else if (typeof p.owner.name === "string" && p.owner.name.trim()) {
      ownerName = p.owner.name.trim();
    }
  }

  // Extract comps if available
  const comps = Array.isArray(avmData.comparables)
    ? avmData.comparables.slice(0, 5).map((c: any) => ({
        address: c.formattedAddress || c.addressLine1 || "Nearby Comp",
        price: Number(c.price) || 0,
        bedrooms: Number(c.bedrooms) || 0,
        bathrooms: Number(c.bathrooms) || 0,
        squareFootage: Number(c.squareFootage) || 0,
        distanceMiles: typeof c.distance === "number" ? Number(c.distance.toFixed(2)) : 0,
      }))
    : [];

  const estimatedValue =
    avmData.price != null && !isNaN(Number(avmData.price))
      ? Number(avmData.price)
      : p.lastSalePrice != null && !isNaN(Number(p.lastSalePrice))
      ? Number(p.lastSalePrice)
      : undefined;

  return {
    formattedAddress: p.formattedAddress || cleanAddr,
    addressLine1: p.addressLine1 || parsed.addressLine1,
    city: p.city || parsed.city,
    state: p.state || parsed.state,
    zipCode: p.zipCode || parsed.zipCode,
    county: p.county || undefined,
    propertyType: p.propertyType || "Single Family",
    bedrooms: p.bedrooms != null ? Number(p.bedrooms) : undefined,
    bathrooms: p.bathrooms != null ? Number(p.bathrooms) : undefined,
    squareFootage: p.squareFootage != null ? Number(p.squareFootage) : undefined,
    lotSize: p.lotSize != null ? Number(p.lotSize) : undefined,
    yearBuilt: p.yearBuilt != null ? Number(p.yearBuilt) : undefined,
    estimatedValue,
    valueRangeLow: avmData.priceRangeLow != null ? Number(avmData.priceRangeLow) : undefined,
    valueRangeHigh: avmData.priceRangeHigh != null ? Number(avmData.priceRangeHigh) : undefined,
    estimatedRent: avmData.rent != null ? Number(avmData.rent) : undefined,
    lastSalePrice: p.lastSalePrice != null ? Number(p.lastSalePrice) : undefined,
    lastSaleDate: p.lastSaleDate ? String(p.lastSaleDate).split("T")[0] : undefined,
    taxAssessedValue: p.taxAssessedValue || p.assessedValue || undefined,
    ownerName,
    comps,
    source: "rentcast",
    message: "Verified MLS and county tax appraisal data retrieved via RentCast.",
  };
}

/**
 * Normalizes an incoming raw payload from Zapier, Make, PropStream, BatchLeads, or webform
 */
export function normalizeWebhookPayload(body: Record<string, any>) {
  // Support nested objects (e.g. body.data, body.lead, body.properties[0])
  const data = body.data || body.lead || (Array.isArray(body.properties) ? body.properties[0] : body);

  const address = (
    data.address ||
    data.property_address ||
    data.street_address ||
    data.PropertyAddress ||
    data.StreetAddress ||
    data.propertyAddress ||
    data.street ||
    ""
  ).trim();

  const city = (data.city || data.City || data.property_city || "").trim();
  const state = (data.state || data.State || data.property_state || "").trim();
  const zip = (data.zip || data.zip_code || data.Zip || data.postal_code || "").trim();

  const sellerName = (
    data.seller_name ||
    data.owner_name ||
    data.contact_name ||
    data.SellerName ||
    data.OwnerName ||
    data.name ||
    data.full_name ||
    ""
  ).trim();

  const phone = (
    data.phone ||
    data.phone_number ||
    data.seller_phone ||
    data.owner_phone ||
    data.Phone ||
    data.mobile ||
    ""
  ).trim();

  const email = (
    data.email ||
    data.seller_email ||
    data.owner_email ||
    data.Email ||
    ""
  ).trim();

  const estimatedValue = Number(
    data.estimated_value ||
    data.deal_value ||
    data.price ||
    data.market_value ||
    data.EstimatedValue ||
    data.AVM ||
    0
  );

  const askingPrice = Number(
    data.asking_price ||
    data.contract_price ||
    data.target_price ||
    data.AskingPrice ||
    0
  );

  const distressType = (
    data.lead_type ||
    data.distress_type ||
    data.category ||
    data.tag ||
    data.list_name ||
    data.tags ||
    "Inbound Webhook"
  ).trim();

  const notes = (
    data.notes ||
    data.description ||
    data.comments ||
    data.reason ||
    ""
  ).trim();

  const bedrooms = Number(data.bedrooms || data.beds || data.Bedrooms || 0);
  const bathrooms = Number(data.bathrooms || data.baths || data.Bathrooms || 0);
  const squareFootage = Number(data.square_feet || data.sqft || data.SquareFeet || 0);

  return {
    address,
    city,
    state,
    zip,
    sellerName,
    phone,
    email,
    estimatedValue,
    askingPrice,
    distressType,
    notes,
    bedrooms,
    bathrooms,
    squareFootage,
    raw: data,
  };
}
