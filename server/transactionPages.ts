import { db } from "./db";
import { readContractPdf } from "./contractPdf";

export interface TransactionRow {
  id: number;
  org_id: number;
  client_id: number | null;
  buyer_id: number | null;
  contract_type: "psa" | "assignment";
  property_address: string;
  seller_name: string;
  seller_email: string;
  seller_phone: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  purchase_price: number;
  assignment_fee: number;
  earnest_money: number;
  emd_due_date: string;
  emd_status: "pending" | "deposited" | "hard" | "refunded";
  inspection_days: number;
  inspection_deadline: string;
  inspection_status: "active" | "passed" | "renegotiating" | "waived" | "terminated";
  closing_date: string;
  title_company_name: string;
  escrow_officer_name: string;
  escrow_officer_email: string;
  escrow_officer_phone: string;
  escrow_file_number: string;
  title_status: "pending" | "opened" | "prelim_review" | "payoff_ordered" | "clear_to_close" | "closed";
  payoff_lender: string;
  payoff_demand_amount: number;
  payoff_loan_number: string;
  state_jurisdiction: string;
  contract_pdf_id: string;
  token_hash: string;
  status: "draft" | "sent" | "signed" | "under_contract" | "closed" | "cancelled";
  signed_at: string | null;
  signer_name: string;
  signer_signature: string;
  signer_ip: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function getTransactionByToken(token: string): TransactionRow | null {
  return (db.query("SELECT * FROM transactions WHERE token_hash = ?").get(token) as TransactionRow) || null;
}

/** Render public E-Signature page for real estate contracts */
export function renderContractSignPage(token: string, clientIp: string): Response {
  const tx = getTransactionByToken(token);
  if (!tx) {
    return new Response(
      `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Contract Expired or Not Found</title>
<style>body{font-family:sans-serif;background:#0a0a0c;color:#f2f1ec;display:grid;place-items:center;height:100vh;margin:0;}</style>
</head>
<body>
<div style="text-align:center;max-width:440px;padding:30px;background:#16161b;border:1px solid #30363d;border-radius:12px;">
  <h2 style="color:#ff6b6b;margin-top:0;">Contract Link Expired or Not Found</h2>
  <p style="color:#8f8f9a;font-size:14px;line-height:1.5;">This real estate contract link is no longer active. Please contact the transaction coordinator to receive an updated e-signature request.</p>
</div>
</body>
</html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const isSigned = tx.status === "signed" || Boolean(tx.signed_at);
  const isPsa = tx.contract_type === "psa";
  const title = isPsa ? "Purchase & Sale Agreement" : "Assignment of Contract";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Sign ${title} — ${tx.property_address}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --border: #30363d;
      --ink: #f0f6fc;
      --muted: #8b949e;
      --blue: #58a6ff;
      --green: #238636;
      --green-bright: #3fb950;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 16px;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .container {
      width: 100%;
      max-width: 820px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    .header {
      padding: 24px 28px;
      background: #090d14;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      background: rgba(56, 139, 253, 0.15);
      color: var(--blue);
      border: 1px solid rgba(56, 139, 253, 0.3);
    }
    .badge.signed {
      background: rgba(46, 160, 67, 0.15);
      color: var(--green-bright);
      border-color: rgba(46, 160, 67, 0.3);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 20px 28px;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid var(--border);
    }
    .field-label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .field-val {
      font-size: 16px;
      font-weight: 700;
      margin-top: 4px;
      color: #fff;
    }
    .doc-preview {
      padding: 28px;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      transition: background 0.15s ease;
    }
    .btn-primary { background: var(--green); color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary { background: #21262d; color: var(--ink); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #30363d; }
    .sign-box {
      background: #090d14;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 22px;
      margin-top: 24px;
    }
    canvas {
      background: #ffffff;
      border-radius: 6px;
      cursor: crosshair;
      width: 100%;
      height: 140px;
      touch-action: none;
    }
    .input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #0d1117;
      color: #fff;
      font-size: 14px;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <span class="badge ${isSigned ? "signed" : ""}">${isSigned ? "✓ Fully Executed" : "Pending E-Signature"}</span>
        <h1 style="margin: 8px 0 4px; font-size: 20px; font-weight: 800;">${title}</h1>
        <p style="margin: 0; color: var(--muted); font-size: 13px;">Property: <strong style="color: var(--ink);">${tx.property_address}</strong></p>
      </div>
      <div>
        <a href="/contract-pdf/${tx.contract_pdf_id}" target="_blank" class="btn btn-secondary">
          📄 View / Download PDF
        </a>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="field-label">Purchase Price</div>
        <div class="field-val">$${tx.purchase_price.toLocaleString()}</div>
      </div>
      ${
        !isPsa
          ? `<div>
        <div class="field-label">Assignment Fee</div>
        <div class="field-val" style="color: #38bdf8;">+$${tx.assignment_fee.toLocaleString()}</div>
      </div>`
          : ""
      }
      <div>
        <div class="field-label">Earnest Money (EMD)</div>
        <div class="field-val">$${tx.earnest_money.toLocaleString()}</div>
      </div>
      <div>
        <div class="field-label">Inspection Period</div>
        <div class="field-val">${tx.inspection_days} Days</div>
      </div>
      <div>
        <div class="field-label">Closing Date</div>
        <div class="field-val">${tx.closing_date || "30 Days from EMD"}</div>
      </div>
    </div>

    <div class="doc-preview">
      ${
        isSigned
          ? `<div style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
          <h2 style="color: var(--green-bright); margin: 0 0 8px;">Document Successfully Executed</h2>
          <p style="color: var(--muted); font-size: 14px; max-width: 500px; margin: 0 auto 24px;">
            Signed electronically by <strong>${tx.signer_name}</strong> on ${new Date(tx.signed_at || "").toLocaleString()}. A permanent legal audit trail and verified PDF have been generated.
          </p>
          <a href="/contract-pdf/${tx.contract_pdf_id}" target="_blank" class="btn btn-primary" style="font-size: 15px; padding: 12px 24px;">
            📄 Download Countersigned Executed PDF
          </a>
        </div>`
          : `<div>
          <p style="font-size: 14px; line-height: 1.6; color: #c9d1d9;">
            Please review the contractual terms above and the official PDF document. By providing your signature below, you agree to execute this legally binding real estate agreement under the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001).
          </p>

          <form id="signForm" class="sign-box">
            <h3 style="margin: 0 0 14px; font-size: 15px;">Electronic Signature Verification</h3>

            <div style="margin-bottom: 14px;">
              <label class="field-label">Legal Full Name</label>
              <input type="text" id="signerName" class="input" placeholder="e.g. ${tx.seller_name || tx.buyer_name || "Full Legal Name"}" required value="${tx.seller_name || tx.buyer_name || ""}" />
            </div>

            <div style="margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label class="field-label">Sign Inside The Box (Draw or Touch)</label>
                <button type="button" id="clearBtn" style="background: none; border: none; color: var(--blue); font-size: 12px; cursor: pointer;">Clear Signature</button>
              </div>
              <canvas id="sigCanvas" width="760" height="140"></canvas>
            </div>

            <div style="margin-bottom: 20px;">
              <label style="display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: var(--muted); cursor: pointer;">
                <input type="checkbox" id="consentBox" required style="margin-top: 3px;" />
                <span>I adopt this electronic mark as my legally binding signature and certify that I have the legal authority to execute this contract.</span>
              </label>
            </div>

            <button type="submit" id="submitBtn" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 14px; font-size: 16px;">
              ✍️ Complete &amp; Sign Agreement
            </button>
          </form>
        </div>`
      }
    </div>
  </div>

  <script>
    const canvas = document.getElementById("sigCanvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      let drawing = false;
      let hasSignature = false;

      // Handle high DPI
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#000000";

      function getPos(e) {
        const r = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - r.left, y: clientY - r.top };
      }

      function startDraw(e) {
        e.preventDefault();
        drawing = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }

      function draw(e) {
        if (!drawing) return;
        e.preventDefault();
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        hasSignature = true;
      }

      function stopDraw() {
        drawing = false;
      }

      canvas.addEventListener("mousedown", startDraw);
      canvas.addEventListener("mousemove", draw);
      window.addEventListener("mouseup", stopDraw);

      canvas.addEventListener("touchstart", startDraw, { passive: false });
      canvas.addEventListener("touchmove", draw, { passive: false });
      window.addEventListener("touchend", stopDraw);

      document.getElementById("clearBtn").addEventListener("click", () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasSignature = false;
      });

      const form = document.getElementById("signForm");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const signerName = document.getElementById("signerName").value.trim();
        const consent = document.getElementById("consentBox").checked;

        if (!signerName) {
          alert("Please enter your legal name.");
          return;
        }
        if (!consent) {
          alert("Please check the electronic signature consent box.");
          return;
        }

        const dataUrl = hasSignature ? canvas.toDataURL("image/png") : "";
        const submitBtn = document.getElementById("submitBtn");
        submitBtn.disabled = true;
        submitBtn.innerText = "Signing & Stamping Document...";

        try {
          const res = await fetch("/api/public/sign-contract/${token}", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signerName,
              signatureImage: dataUrl,
            }),
          });
          const data = await res.json();
          if (data.ok) {
            window.location.reload();
          } else {
            alert(data.error || "Failed to submit signature.");
            submitBtn.disabled = false;
            submitBtn.innerText = "✍️ Complete & Sign Agreement";
          }
        } catch (err) {
          alert("Network error while submitting signature.");
          submitBtn.disabled = false;
          submitBtn.innerText = "✍️ Complete & Sign Agreement";
        }
      });
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Render public Title & Escrow Company Portal */
export function renderTitlePortalPage(token: string): Response {
  const tx = getTransactionByToken(token);
  if (!tx) {
    return new Response("Title file not found or expired.", { status: 404 });
  }

  const isPsa = tx.contract_type === "psa";
  const emdStatusMeta = {
    pending: { label: "Pending Wire", color: "#f59e0b" },
    deposited: { label: "✓ Wire Deposited", color: "#10b981" },
    hard: { label: "Non-Refundable (Hard)", color: "#ef4444" },
    refunded: { label: "Refunded", color: "#6b7280" },
  }[tx.emd_status] || { label: tx.emd_status, color: "#6b7280" };

  const titleStatusSteps = [
    { key: "opened", label: "Title Opened" },
    { key: "prelim_review", label: "Prelim Issued" },
    { key: "payoff_ordered", label: "Payoffs Ordered" },
    { key: "clear_to_close", label: "Clear to Close" },
    { key: "closed", label: "Funded & Recorded" },
  ];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Title & Escrow Portal — ${tx.property_address}</title>
  <style>
    body {
      margin: 0;
      padding: 30px 16px;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .portal-card {
      max-width: 860px;
      margin: 0 auto;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .portal-head {
      padding: 24px 30px;
      background: #0b132b;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .badge {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      background: #2563eb;
      color: #fff;
    }
    .section {
      padding: 24px 30px;
      border-bottom: 1px solid #334155;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 18px;
    }
    .label {
      font-size: 11px;
      color: #94a3b8;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .value {
      font-size: 16px;
      font-weight: 700;
      margin-top: 4px;
      color: #ffffff;
    }
    .stepper {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .step {
      flex: 1 1 120px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
    }
    .step.active {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      color: #38bdf8;
    }
    .btn {
      padding: 10px 18px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #2563eb;
      color: #fff;
      border: none;
    }
    .btn-green { background: #16a34a; }
  </style>
</head>
<body>
  <div class="portal-card">
    <div class="portal-head">
      <div>
        <span class="badge">🏦 Title &amp; Escrow Coordination Portal</span>
        <h1 style="margin: 8px 0 4px; font-size: 22px; font-weight: 800;">${tx.property_address}</h1>
        <p style="margin: 0; color: #94a3b8; font-size: 13px;">
          Escrow Officer: <strong>${tx.escrow_officer_name || "Assigned Officer"}</strong> · File #: <strong>${tx.escrow_file_number || "PENDING"}</strong>
        </p>
      </div>
      <div>
        <a href="/contract-pdf/${tx.contract_pdf_id}" target="_blank" class="btn">
          📄 Download Contract PDF
        </a>
      </div>
    </div>

    <!-- Escrow Milestone Tracker -->
    <div class="section">
      <div class="label">Current Escrow Milestone Status</div>
      <div class="stepper">
        ${titleStatusSteps
          .map((s, idx) => {
            const isCurrent = tx.title_status === s.key;
            return `<div class="step ${isCurrent ? "active" : ""}">
            <div style="font-size: 16px; margin-bottom: 2px;">${isCurrent ? "🔵" : "⚪"}</div>
            <div>${idx + 1}. ${s.label}</div>
          </div>`;
          })
          .join("")}
      </div>

      <!-- Interactive Status Selector for Escrow Officer -->
      <div style="margin-top: 18px; display: flex; align-items: center; gap: 12px; background: #0f172a; padding: 12px 16px; border-radius: 8px;">
        <span style="font-size: 13px; color: #94a3b8; font-weight: 600;">Update Escrow Milestone:</span>
        <select id="titleStatusSelect" style="background: #1e293b; color: #fff; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;">
          ${titleStatusSteps
            .map((s) => `<option value="${s.key}" ${tx.title_status === s.key ? "selected" : ""}>${s.label}</option>`)
            .join("")}
        </select>
        <button id="saveStatusBtn" class="btn btn-green" style="padding: 6px 14px; font-size: 12px;">Save Status</button>
      </div>
    </div>

    <!-- Financial Consideration Breakdown -->
    <div class="section">
      <div class="label">Financial Terms &amp; Settlement Figures</div>
      <div class="grid" style="margin-top: 12px;">
        <div>
          <div class="label">Contract Purchase Price</div>
          <div class="value">$${tx.purchase_price.toLocaleString()}</div>
        </div>
        ${
          !isPsa
            ? `<div>
          <div class="label">Wholesale Assignment Fee</div>
          <div class="value" style="color: #38bdf8;">+$${tx.assignment_fee.toLocaleString()}</div>
        </div>
        <div>
          <div class="label">Total Acquisition Consideration</div>
          <div class="value" style="color: #34d399;">$${(tx.purchase_price + tx.assignment_fee).toLocaleString()}</div>
        </div>`
            : ""
        }
        <div>
          <div class="label">Earnest Money Deposit (EMD)</div>
          <div class="value" style="color: ${emdStatusMeta.color};">
            $${tx.earnest_money.toLocaleString()} (${emdStatusMeta.label})
          </div>
        </div>
        <div>
          <div class="label">Target Closing Date</div>
          <div class="value" style="color: #fde047;">${tx.closing_date || "Within 30 Days"}</div>
        </div>
      </div>
    </div>

    <!-- Payoff Demands / Existing Loan Details (For Subject-To or Clear Title Payoffs) -->
    ${
      tx.payoff_lender || tx.payoff_demand_amount > 0
        ? `<div class="section" style="background: rgba(234, 179, 8, 0.04);">
        <div class="label" style="color: #facc15;">Existing Loan / Payoff Demand Details</div>
        <div class="grid" style="margin-top: 12px;">
          <div>
            <div class="label">Existing Lender</div>
            <div class="value">${tx.payoff_lender || "Private / Institutional"}</div>
          </div>
          <div>
            <div class="label">Estimated Payoff Demand</div>
            <div class="value">$${(tx.payoff_demand_amount || 0).toLocaleString()}</div>
          </div>
          <div>
            <div class="label">Loan Account #</div>
            <div class="value">${tx.payoff_loan_number || "Available in Title Packet"}</div>
          </div>
        </div>
      </div>`
        : ""
    }

    <!-- Transaction Parties Contact Directory -->
    <div class="section">
      <div class="label">Transaction Parties</div>
      <div class="grid" style="margin-top: 12px;">
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155;">
          <div class="label">Seller (Property Owner)</div>
          <div style="font-weight: 700; margin-top: 4px; font-size: 15px;">${tx.seller_name || "Owner of Record"}</div>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Email: ${tx.seller_email || "—"}</div>
          <div style="font-size: 12px; color: #94a3b8;">Phone: ${tx.seller_phone || "—"}</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155;">
          <div class="label">Buyer / Assignee</div>
          <div style="font-weight: 700; margin-top: 4px; font-size: 15px;">${tx.buyer_name || "Revzenta Capital and/or assigns"}</div>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Email: ${tx.buyer_email || "—"}</div>
          <div style="font-size: 12px; color: #94a3b8;">Phone: ${tx.buyer_phone || "—"}</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    document.getElementById("saveStatusBtn").addEventListener("click", async () => {
      const select = document.getElementById("titleStatusSelect");
      const newStatus = select.value;
      const btn = document.getElementById("saveStatusBtn");
      btn.disabled = true;
      btn.innerText = "Saving...";

      try {
        const res = await fetch("/api/public/title-update/${token}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titleStatus: newStatus }),
        });
        const data = await res.json();
        if (data.ok) {
          window.location.reload();
        } else {
          alert(data.error || "Failed to update title status.");
          btn.disabled = false;
          btn.innerText = "Save Status";
        }
      } catch (err) {
        alert("Network error.");
        btn.disabled = false;
        btn.innerText = "Save Status";
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
