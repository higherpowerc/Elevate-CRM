import { useState, useId, useRef, useMemo } from "react";
import { api, type ClientInput } from "./api";
import { money, type Client } from "./types";

export type CsvTarget = "properties" | "investors";

interface Props {
  initialTarget?: CsvTarget;
  stages?: string[];
  onClose: () => void;
  onSuccess: () => void;
}

// Robust CSV parser supporting quotes, commas, escaped quotes and multi-line fields
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  let clean = text.replace(/^\uFEFF/, "");
  if (!clean.trim()) return { headers: [], rows: [] };

  const firstLine = clean.split(/\r?\n/)[0] || "";
  let delimiter = ",";
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs > commas && tabs > semis) delimiter = "\t";
  else if (semis > commas && semis > tabs) delimiter = ";";

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }
  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);
  return { headers, rows: dataRows };
}

function cleanNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^0-9.-]+/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

interface FieldDefinition {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[];
  description: string;
}

const PROPERTY_FIELDS: FieldDefinition[] = [
  {
    key: "address",
    label: "Property Address",
    required: true,
    synonyms: ["address", "property address", "street", "street address", "location", "property", "name", "company name"],
    description: "Full street address or property headline",
  },
  {
    key: "city",
    label: "City",
    synonyms: ["city", "town", "municipality"],
    description: "City location",
  },
  {
    key: "state",
    label: "State",
    synonyms: ["state", "st", "province"],
    description: "2-letter state code or name",
  },
  {
    key: "zip",
    label: "Zip Code",
    synonyms: ["zip", "zip code", "postal code", "postal"],
    description: "5-digit postal code",
  },
  {
    key: "dealValue",
    label: "Asking / Contract Price ($)",
    synonyms: ["price", "asking price", "contract price", "deal value", "cost", "purchase price", "wholesale price"],
    description: "Price in dollars (e.g. 175000)",
  },
  {
    key: "arv",
    label: "ARV ($)",
    synonyms: ["arv", "after repair value", "market value", "retail value"],
    description: "After repair value estimate",
  },
  {
    key: "repairs",
    label: "Estimated Repairs ($)",
    synonyms: ["repairs", "estimated repairs", "repair", "rehab", "est repairs", "rehab estimate"],
    description: "Estimated rehab budget",
  },
  {
    key: "clientType",
    label: "Property Type",
    synonyms: ["type", "property type", "client type", "building type"],
    description: "Single Family, Multi-Family, Commercial, Land, etc.",
  },
  {
    key: "structure",
    label: "Financing / Structure",
    synonyms: ["structure", "strategy", "financing", "deal type", "deal structure", "terms"],
    description: "Cash, SubTo, Seller Finance, Novation, Hybrid",
  },
  {
    key: "ownerName",
    label: "Owner / Seller Name",
    synonyms: ["owner", "owner name", "seller", "seller name", "contact", "contact name", "client name"],
    description: "Contact name of the property owner",
  },
  {
    key: "phone",
    label: "Owner Phone",
    synonyms: ["phone", "owner phone", "seller phone", "contact phone", "mobile", "cell"],
    description: "Phone number",
  },
  {
    key: "email",
    label: "Owner Email",
    synonyms: ["email", "owner email", "seller email", "contact email"],
    description: "Email address",
  },
  {
    key: "agentName",
    label: "Agent Name",
    synonyms: ["agent", "agent name", "realtor", "broker", "rep"],
    description: "Real estate agent or wholesaler rep",
  },
  {
    key: "notes",
    label: "Notes / Deal Description",
    synonyms: ["notes", "description", "details", "comments", "remarks"],
    description: "Bed/bath count, square footage, condition, access notes",
  },
];

const INVESTOR_FIELDS: FieldDefinition[] = [
  {
    key: "companyName",
    label: "Investor / Entity Name",
    required: true,
    synonyms: ["investor", "investor name", "entity", "company", "company name", "buyer", "buyer name", "buyer / entity", "firm"],
    description: "LLC, Corporation, or individual investor name",
  },
  {
    key: "contactName",
    label: "Contact Person",
    synonyms: ["contact", "contact person", "contact name", "person", "representative", "name"],
    description: "Individual contact person",
  },
  {
    key: "email",
    label: "Email",
    synonyms: ["email", "email address", "contact email", "investor email"],
    description: "Email address for deal pitches",
  },
  {
    key: "phone",
    label: "Phone",
    synonyms: ["phone", "phone number", "mobile", "cell", "telephone"],
    description: "Phone number for SMS / calls",
  },
  {
    key: "dealValue",
    label: "Max Budget / Buy Box Cap ($)",
    synonyms: ["budget", "max budget", "buy box cap", "max price", "purchase limit", "capital", "deal value"],
    description: "Maximum acquisition budget",
  },
  {
    key: "strategies",
    label: "Investment Strategies",
    synonyms: ["strategy", "strategies", "investment strategy", "buyer type", "types", "method"],
    description: "Cash Buyer, Creative Financing, Fix & Flip, Buy & Hold, etc.",
  },
  {
    key: "pof",
    label: "Proof of Funds (POF)",
    synonyms: ["pof", "proof of funds", "pof status", "funding", "verification"],
    description: "Verified Cash, Hard Money Approved, Pre-Approved, etc.",
  },
  {
    key: "targetMarkets",
    label: "Target Markets / Zip Codes",
    synonyms: ["target markets", "markets", "locations", "target areas", "cities", "zip codes", "areas", "location"],
    description: "Target cities, counties, or zip codes",
  },
  {
    key: "notes",
    label: "Buy Box Criteria & Notes",
    synonyms: ["buy box", "criteria", "buy box criteria", "notes", "requirements", "specs"],
    description: "Minimum return, square footage, asset classes, closing speed",
  },
];

export default function CsvImportModal({ initialTarget = "properties", stages = [], onClose, onSuccess }: Props) {
  const [target, setTarget] = useState<CsvTarget>(initialTarget);
  const [csvRaw, setCsvRaw] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [defaultStage, setDefaultStage] = useState<string>(stages[0] || (target === "investors" ? "Buyer" : "Lead In"));
  const [step, setStep] = useState<"upload" | "map" | "preview" | "importing" | "done">("upload");
  const [importCount, setImportCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const fieldDefs = target === "properties" ? PROPERTY_FIELDS : INVESTOR_FIELDS;

  function autoMap(headers: string[], fields: FieldDefinition[]) {
    const map: Record<string, string> = {};
    const normalizedHeaders = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

    for (const f of fields) {
      let matchedHeader = "";
      for (const synonym of f.synonyms) {
        const normSyn = synonym.toLowerCase().replace(/[^a-z0-9]/g, "");
        const idx = normalizedHeaders.findIndex((nh) => nh === normSyn || nh.includes(normSyn) || normSyn.includes(nh));
        if (idx !== -1) {
          matchedHeader = headers[idx];
          break;
        }
      }
      if (matchedHeader) {
        map[f.key] = matchedHeader;
      }
    }
    return map;
  }

  function handleFileSelected(file: File) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setCsvRaw(text);
      processCsvText(text);
    };
    reader.readAsText(file);
  }

  function processCsvText(text: string) {
    setError(null);
    const result = parseCsv(text);
    if (result.headers.length === 0 || result.rows.length === 0) {
      setError("The CSV file appears to be empty or missing headers.");
      return;
    }
    setParsed(result);
    const guessed = autoMap(result.headers, fieldDefs);
    setMappings(guessed);
    setStep("map");
  }

  function handleTargetChange(newTarget: CsvTarget) {
    setTarget(newTarget);
    if (parsed) {
      const defs = newTarget === "properties" ? PROPERTY_FIELDS : INVESTOR_FIELDS;
      setMappings(autoMap(parsed.headers, defs));
    }
  }

  function downloadSampleTemplate() {
    let content = "";
    let downloadName = "";
    if (target === "properties") {
      downloadName = "elevate_properties_template.csv";
      content = [
        "Property Address,City,State,Zip,Asking Price,ARV,Estimated Repairs,Property Type,Structure,Owner Name,Phone,Email,Agent Name,Notes",
        '"742 Evergreen Terrace","Springfield","IL","62704","185000","260000","25000","Single Family","Cash","Homer Simpson","(555) 733-4900","homer@example.com","Lionel Hutz","Motivated seller, needs cosmetic updates"',
        '"100 Ocean Drive","Miami","FL","33139","340000","475000","40000","Single Family","SubTo","Tony Montana","(555) 867-5309","tony@example.com","","Needs quick closing, 3.25% existing mortgage"',
        '"456 Oak Avenue","Dallas","TX","75201","220000","310000","30000","Single Family","Cash","Sarah Connor","(555) 123-4567","sarah@example.com","","Vacant property, roof replaced in 2022"',
      ].join("\n");
    } else {
      downloadName = "elevate_investors_template.csv";
      content = [
        "Investor / Entity Name,Contact Person,Email,Phone,Investment Strategies,Proof of Funds,Max Budget,Target Markets,Buy Box Criteria",
        '"Apex Capital Holdings LLC","Michael Vance","michael@apexholdings.com","(555) 234-5678","Cash Buyer, Fix & Flip","Verified Cash","550000","Dallas, Fort Worth, 75001","Single family 3/2+, 70% ARV minus repairs, close in 10 days"',
        '"Lone Star Equity Partners","Sarah Jenkins","sarah@lonestarequity.com","(555) 876-5432","Creative Financing (SubTo / Seller Finance), Buy & Hold (Rental)","Hard Money Approved","750000","Phoenix, Scottsdale, Mesa","Low interest rate subject-to wrap deals, minimum $400/mo cashflow"',
        '"Blue Ridge REI Group","David Clark","david@blueridge.com","(555) 998-1122","Cash Buyer","Verified Cash","400000","Atlanta Metro, 30301","Cosmetic fixers, high cap rate rentals"',
      ].join("\n");
    }

    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", downloadName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function buildClientInput(row: string[]): ClientInput | null {
    if (!parsed) return null;
    const getValue = (fieldKey: string): string => {
      const headerName = mappings[fieldKey];
      if (!headerName) return "";
      const idx = parsed.headers.indexOf(headerName);
      if (idx === -1) return "";
      return (row[idx] || "").trim();
    };

    if (target === "properties") {
      const address = getValue("address");
      if (!address) return null;

      const city = getValue("city");
      const state = getValue("state");
      const zip = getValue("zip");
      const dealVal = cleanNumber(getValue("dealValue"));
      const arv = getValue("arv");
      const repairs = getValue("repairs");
      const rawType = getValue("clientType") || "Single Family";
      const structure = getValue("structure") || "Cash";
      const ownerName = getValue("ownerName");
      const phone = getValue("phone");
      const email = getValue("email");
      const agentName = getValue("agentName");
      const notes = getValue("notes");

      const lowerType = rawType.toLowerCase();
      let safeClientType: "residential" | "commercial" | "single_family" | "multi_family" = "residential";
      if (lowerType.includes("single")) safeClientType = "single_family";
      else if (lowerType.includes("multi")) safeClientType = "multi_family";
      else if (lowerType.includes("commercial")) safeClientType = "commercial";

      const customFields: Array<{ name: string; value: string }> = [];
      if (arv) customFields.push({ name: "ARV", value: `$${cleanNumber(arv).toLocaleString()}` });
      if (repairs) customFields.push({ name: "Estimated Repairs", value: `$${cleanNumber(repairs).toLocaleString()}` });
      if (structure) customFields.push({ name: "Structure", value: structure });

      return {
        companyName: address,
        contactName: ownerName || address,
        email: email || "",
        phone: phone || "",
        industry: "Real Estate",
        services: [structure, rawType].filter(Boolean),
        customFields,
        dealValue: dealVal,
        stage: defaultStage || (stages[0] ?? "Lead In"),
        nextAction: "Review imported CSV details",
        notes: notes || `Imported wholesale property (${rawType})`,
        archived: false,
        clientType: safeClientType,
        address,
        city,
        state,
        zip,
        website: "",
        leadSource: "CSV Upload",
        agentName: agentName || "",
      };
    } else {
      const companyName = getValue("companyName");
      if (!companyName) return null;

      const contactName = getValue("contactName") || companyName;
      const email = getValue("email");
      const phone = getValue("phone");
      const maxBudget = cleanNumber(getValue("dealValue"));
      const rawStrategies = getValue("strategies") || "Cash Buyer";
      const strategies = rawStrategies
        .split(/[,/|]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (strategies.length === 0) strategies.push("Cash Buyer");

      const pof = getValue("pof") || "Verified Cash";
      const targetMarkets = getValue("targetMarkets") || "All Markets";
      const notes = getValue("notes") || "Imported investor profile";

      return {
        companyName,
        contactName,
        email: email || "",
        phone: phone || "",
        industry: "Real Estate Investor",
        services: strategies,
        customFields: [
          { name: "Buyer Type", value: strategies.join(", ") },
          { name: "Proof of Funds", value: pof },
          { name: "Max Budget", value: maxBudget ? `$${maxBudget.toLocaleString()}` : "" },
          { name: "Target Markets", value: targetMarkets },
          { name: "Buy Box", value: notes },
        ],
        dealValue: maxBudget,
        stage: "Buyer",
        nextAction: "Send matching deals",
        notes,
        archived: false,
        clientType: "buyer",
        address: targetMarkets,
        city: "",
        state: "",
        zip: "",
        website: "",
        leadSource: "CSV Upload",
      };
    }
  }

  const previewRecords = useMemo(() => {
    if (!parsed) return [];
    const out: ClientInput[] = [];
    for (const row of parsed.rows) {
      const item = buildClientInput(row);
      if (item) {
        out.push(item);
        if (out.length >= 5) break;
      }
    }
    return out;
  }, [parsed, mappings, target, defaultStage]);

  async function handleExecuteImport() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    setStep("importing");

    const validItems: ClientInput[] = [];
    for (const row of parsed.rows) {
      const item = buildClientInput(row);
      if (item) validItems.push(item);
    }

    if (validItems.length === 0) {
      setError(`No valid ${target === "properties" ? "properties" : "investors"} could be generated. Check your column mappings.`);
      setStep("preview");
      setBusy(false);
      return;
    }

    try {
      const res = await api.batchCreateClients(validItems);
      setImportCount(res.count);
      setStep("done");
      onSuccess();
    } catch (e) {
      try {
        let inserted = 0;
        for (const item of validItems) {
          await api.createClient(item);
          inserted++;
        }
        setImportCount(inserted);
        setStep("done");
        onSuccess();
      } catch (innerErr) {
        setError(innerErr instanceof Error ? innerErr.message : "Failed to import records.");
        setStep("preview");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Upload CSV">
      <div className="modal" style={{ maxWidth: "780px", width: "95%" }}>
        <div className="modal-head" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
              <span>📥</span> Upload CSV Data
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted)" }}>
              Import spreadsheet data directly into your CRM records
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div
          style={{
            display: "flex",
            background: "var(--surface-subtle, rgba(255,255,255,0.03))",
            padding: "8px 20px",
            borderBottom: "1px solid var(--border)",
            gap: "12px",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className={target === "properties" ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: "12px", padding: "6px 14px" }}
              onClick={() => handleTargetChange("properties")}
              disabled={busy || step === "done"}
            >
              🏠 Properties / Pipeline Deals
            </button>
            <button
              type="button"
              className={target === "investors" ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: "12px", padding: "6px 14px" }}
              onClick={() => handleTargetChange("investors")}
              disabled={busy || step === "done"}
            >
              💼 Investors / Cash Buyers
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px", color: "var(--accent)" }}
            onClick={downloadSampleTemplate}
            title={`Download sample template for ${target}`}
          >
            📥 Download Sample CSV
          </button>
        </div>

        <div className="modal-body" style={{ padding: "18px 20px", maxHeight: "68vh", overflowY: "auto" }}>
          {error && <div className="alert alert-error" style={{ marginBottom: "14px" }}>{error}</div>}

          {step === "upload" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelected(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--border, #444c56)",
                  borderRadius: "10px",
                  padding: "36px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  backgroundColor: "var(--card-bg, rgba(255,255,255,0.02))",
                  transition: "border-color 0.2s ease",
                }}
              >
                <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>📄</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-main)" }}>
                  Click to browse or drag &amp; drop a CSV file here
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px" }}>
                  Supports .csv and text exports from Excel, Google Sheets, PropStream, Privy, BatchLeads, etc.
                </div>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelected(e.target.files[0]);
                    }
                  }}
                />
              </div>

              <div style={{ textAlign: "center", fontSize: "12px", color: "var(--muted)" }}>
                — OR PASTE RAW CSV CONTENT —
              </div>

              <label className="field" style={{ margin: 0 }}>
                <textarea
                  rows={4}
                  placeholder={`Paste CSV data here with headers... e.g.\nAddress,Asking Price,Property Type\n"123 Main St",150000,"Single Family"`}
                  value={csvRaw}
                  onChange={(e) => setCsvRaw(e.target.value)}
                  style={{ fontFamily: "monospace", fontSize: "12px" }}
                />
              </label>

              {csvRaw.trim() && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => processCsvText(csvRaw)}
                  style={{ alignSelf: "flex-end" }}
                >
                  Continue with Pasted CSV →
                </button>
              )}
            </div>
          )}

          {step === "map" && parsed && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>
                    Map CSV Columns → {target === "properties" ? "Property" : "Investor"} Fields
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                    Found {parsed.rows.length} rows and {parsed.headers.length} columns in {fileName || "your CSV"}.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: "11px" }}
                  onClick={() => setStep("upload")}
                >
                  Change File
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: "12px",
                  background: "var(--card-bg, #161b22)",
                  padding: "14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                }}
              >
                {fieldDefs.map((field) => {
                  const currentMapped = mappings[field.key] || "";
                  return (
                    <label key={field.key} className="field" style={{ margin: 0 }}>
                      <span className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>
                          {field.label} {field.required && <strong style={{ color: "var(--danger)" }}>*</strong>}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--muted)" }}>{field.description}</span>
                      </span>
                      <select
                        value={currentMapped}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMappings((prev) => ({ ...prev, [field.key]: val }));
                        }}
                        style={{
                          borderColor: field.required && !currentMapped ? "rgba(248, 81, 73, 0.4)" : undefined,
                        }}
                      >
                        <option value="">(Skip this field)</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>

              {target === "properties" && stages.length > 0 && (
                <label className="field" style={{ maxWidth: "260px" }}>
                  <span className="field-label">Initial Pipeline Stage</span>
                  <select value={defaultStage} onChange={(e) => setDefaultStage(e.target.value)}>
                    {stages.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" className="btn btn-subtle" onClick={() => setStep("upload")}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const requiredKey = target === "properties" ? "address" : "companyName";
                    if (!mappings[requiredKey]) {
                      setError(`Please select a column for the required field: ${target === "properties" ? "Property Address" : "Investor / Entity Name"}.`);
                      return;
                    }
                    setError(null);
                    setStep("preview");
                  }}
                >
                  Preview Records ({parsed.rows.length}) →
                </button>
              </div>
            </div>
          )}

          {step === "preview" && parsed && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>
                    Ready to Import ({parsed.rows.length} records)
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                    Here is a preview of the first {previewRecords.length} records parsed from your CSV.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: "11px" }}
                  onClick={() => setStep("map")}
                >
                  Adjust Mappings
                </button>
              </div>

              <div className="table-wrap" style={{ border: "1px solid var(--border)", borderRadius: "8px", overflowX: "auto" }}>
                <table className="table" style={{ fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{target === "properties" ? "Property Address" : "Investor Name"}</th>
                      <th>{target === "properties" ? "Location" : "Contact"}</th>
                      <th>{target === "properties" ? "Price / Deal Value" : "Max Budget"}</th>
                      <th>{target === "properties" ? "Structure & Type" : "Strategies"}</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRecords.map((r, i) => (
                      <tr key={i}>
                        <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                        <td className="cell-strong">{r.companyName}</td>
                        <td>
                          {target === "properties"
                            ? [r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"
                            : r.contactName || r.phone || r.email || "—"}
                        </td>
                        <td style={{ color: "var(--green)", fontWeight: 600 }}>{money(r.dealValue || 0)}</td>
                        <td>
                          <span className="badge tone-blue" style={{ fontSize: "11px" }}>
                            {r.services?.join(" · ") || r.clientType}
                          </span>
                        </td>
                        <td style={{ maxWidth: "200px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(59, 130, 246, 0.08)",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div style={{ fontSize: "13px" }}>
                  <strong>{parsed.rows.length} total rows</strong> will be imported into{" "}
                  <strong>{target === "properties" ? "Properties (Pipeline)" : "Investors (Dispo Directory)"}</strong>.
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" className="btn btn-subtle" onClick={() => setStep("map")}>
                    ← Edit Mapping
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleExecuteImport} disabled={busy}>
                    {busy ? "Importing..." : `Import ${parsed.rows.length} Records`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: "2rem", marginBottom: "12px" }}>⏳</div>
              <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Importing Records into Database...</h3>
              <p style={{ color: "var(--muted)", fontSize: "13px" }}>
                Validating fields and inserting {parsed?.rows.length || ""} rows into your CRM.
              </p>
            </div>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "36px 20px" }}>
              <div style={{ fontSize: "3rem", marginBottom: "12px" }}>🎉</div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--green)" }}>
                Successfully Imported {importCount} {target === "properties" ? "Properties" : "Investors"}!
              </h3>
              <p style={{ color: "var(--muted)", fontSize: "13px", maxWidth: "420px", margin: "8px auto 20px" }}>
                Your {target === "properties" ? "wholesale property pipeline" : "investor buyers list"} has been updated with the new records.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onClose}
                >
                  Done &amp; View Records
                </button>
              </div>
            </div>
          )}
        </div>

        {step === "upload" && (
          <div className="modal-foot" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "12px 20px" }}>
            <button type="button" className="btn btn-subtle" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
