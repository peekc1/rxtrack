import { useState, useEffect } from "react";

const SUPPLIERS = ["Cencora", "McKesson", "PharmSaver"];
const TABS = ["Dashboard", "Inventory", "Purchase Orders", "Invoice Import", "🔫 Scan Station", "Receive Stock", "Dispense", "Activity Log"];

const fmt = (n) => Number(n).toLocaleString();
const fmtMoney = (n) => `$${Number(n).toFixed(2)}`;

const statusColor = (qty, threshold) => {
  if (qty === 0) return { bg: "#fef2f2", text: "#dc2626", label: "Out of Stock" };
  if (qty <= threshold) return { bg: "#fff7ed", text: "#c2410c", label: "Low Stock" };
  return { bg: "#dcfce7", text: "#15803d", label: "In Stock" };
};

const supplierColor = { Cencora: "#6366f1", McKesson: "#2563eb", PharmSaver: "#16a34a" };

function Badge({ qty, threshold }) {
  const s = statusColor(qty, threshold);
  return <span style={{ background: s.bg, color: s.text, padding: "3px 10px", borderRadius: "99px", fontSize: "11px", fontWeight: "700", whiteSpace: "nowrap", display: "inline-block" }}>{s.label}</span>;
}

function SupplierBadge({ supplier }) {
  const color = supplierColor[supplier] || "#94a3b8";
  return <span style={{ background: color + "20", color, padding: "3px 10px", borderRadius: "99px", fontSize: "11px", fontWeight: "700", border: `1px solid ${color}40` }}>{supplier}</span>;
}

function OrderStatusBadge({ status }) {
  const map = { Ordered: { bg: "#fefce8", text: "#854d0e", border: "#fde68a" }, Shipped: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" }, Received: { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" }, Cancelled: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" } };
  const c = map[status] || { bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" };
  return <span style={{ background: c.bg, color: c.text, padding: "4px 10px", borderRadius: "99px", fontSize: "11px", fontWeight: "700", border: `1px solid ${c.border}` }}>{status}</span>;
}

// ── PharmSaver XML Importer ──────────────────────────────────────────
function PharmSaverImporter({ medications, setMedications, setLog, notify }) {
  const [stage, setStage] = useState("upload");
  const [fileContent, setFileContent] = useState(null); // { text, base64, type, name }
  const [fileName, setFileName] = useState("");
  const [parsedItems, setParsedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [staffName, setStaffName] = useState("");
  const [error, setError] = useState("");
  const [importSummary, setImportSummary] = useState(null);

  const s = {
    card: { background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "14px", padding: "20px", marginBottom: "16px" },
    input: { width: "100%", background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px 13px", color: "#1a2744", fontSize: "13px", fontFamily: "'IBM Plex Sans', sans-serif", boxSizing: "border-box", outline: "none", marginBottom: "10px" },
    btn: (color, disabled) => ({ padding: "10px 20px", background: disabled ? "#e2e8f0" : (color || "#2563eb"), border: "none", borderRadius: "8px", color: disabled ? "#94a3b8" : "#fff", fontWeight: "700", fontSize: "13px", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'IBM Plex Sans', sans-serif", opacity: disabled ? 0.7 : 1 }),
    th: { padding: "10px 12px", fontSize: "11px", fontWeight: "700", color: "#6b7fa3", textTransform: "uppercase", letterSpacing: "0.8px", textAlign: "left", borderBottom: "1px solid #e2e8f0" },
    td: { padding: "11px 12px", fontSize: "13px", color: "#2d3f5e", borderBottom: "1px solid #eef2f7" },
  };

  const FILE_TYPES = {
    xml:  { label: "XML",   icon: "📄", color: "#2563eb", accept: ".xml" },
    pdf:  { label: "PDF",   icon: "📋", color: "#dc2626", accept: ".pdf" },
    csv:  { label: "CSV",   icon: "📊", color: "#16a34a", accept: ".csv" },
    xlsx: { label: "Excel", icon: "📗", color: "#15803d", accept: ".xlsx,.xls" },
  };

  const mapWholesaler = (raw) => {
    const u = (raw || "").toUpperCase();
    if (u.includes("CENCORA") || u.includes("AMERISOURCE")) return "Cencora";
    if (u.includes("MCKESSON")) return "McKesson";
    return "PharmSaver";
  };

  const getUnitLabel = (name) => {
    const u = (name || "").toUpperCase();
    return u.includes("TABS") || u.includes("TAB") ? "tablets"
      : u.includes("CAPS") || u.includes("CAP") ? "capsules"
      : u.includes("LOTN") || u.includes("SOLN") || u.includes("SUSP") ? "mL"
      : u.includes("OINT") || u.includes("CREAM") || u.includes("GEL") ? "g"
      : u.includes("PATCH") ? "patches"
      : u.includes("INJ") ? "vials"
      : "units";
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setStage("upload");
    setParsedItems([]);
    setError("");
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "pdf" || ext === "xlsx" || ext === "xls") {
      // Read as base64 for Claude AI
      const reader = new FileReader();
      reader.onload = (ev) => setFileContent({ base64: ev.target.result.split(",")[1], type: ext, name: file.name });
      reader.readAsDataURL(file);
    } else {
      // Read as text for XML/CSV
      const reader = new FileReader();
      reader.onload = (ev) => setFileContent({ text: ev.target.result, type: ext, name: file.name });
      reader.readAsText(file);
    }
  };

  // ── XML parser (fast, no AI needed) ──────────────────────────────────
  const parseXML = (text) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const rows = xmlDoc.querySelectorAll("DataRow");
    if (!rows || rows.length === 0) throw new Error("No DataRow elements found in XML.");
    return Array.from(rows).map(row => {
      const get = (tag) => row.querySelector(tag)?.textContent?.trim() || null;
      const qty = parseFloat(get("QuantityShipped") || get("Quantity") || "0");
      const price = parseFloat(get("UnitPrice") || "0");
      const total = parseFloat(get("InvTotal") || "0");
      let ndc = get("NDC") || "";
      if (ndc.length === 11) ndc = `${ndc.slice(0,5)}-${ndc.slice(5,9)}-${ndc.slice(9)}`;
      const drugName = get("DrugName") || "";
      const packMatch = drugName.match(/\((\d+)\)\s*$/);
      const packSize = packMatch ? parseInt(packMatch[1]) : 1;
      return {
        name: drugName, ndc, bottles: qty, packSize, quantity: qty * packSize,
        unitLabel: getUnitLabel(drugName), pricePerUnit: price,
        pricePerTablet: packSize > 1 ? parseFloat((price / packSize).toFixed(4)) : price,
        totalCost: total || qty * price, invoiceRef: get("OrderHeaderID"),
        wholesaler: mapWholesaler(get("WholesalerNameText")),
        shippingDate: get("ShippingDate")?.split("T")[0] || null,
      };
    }).filter(i => i.name && i.quantity > 0);
  };

  // ── Claude AI parser for PDF, CSV, Excel ─────────────────────────────
  const parseWithClaude = async (fc) => {
    const isPDF = fc.type === "pdf";
    const isExcel = fc.type === "xlsx" || fc.type === "xls";
    const mediaType = isPDF ? "application/pdf" : isExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";

    const prompt = `You are a pharmacy invoice data extractor. Extract ALL medication line items from this wholesale invoice and return ONLY a valid JSON array, no explanation, no markdown fences.

Each item must have exactly these fields:
- "name": full drug name as shown on invoice
- "ndc": NDC number as string (format XXXXX-XXXX-XX, normalize if needed)
- "bottles": number of bottles/packages ordered (number)
- "packSize": units per bottle extracted from drug name parentheses e.g. (500) means 500 (number, default 1)
- "quantity": bottles × packSize = total units (number)
- "unitLabel": "tablets" or "capsules" or "mL" or "g" or "units"
- "pricePerUnit": price per bottle (number)
- "pricePerTablet": price per single unit = pricePerUnit / packSize (number)
- "totalCost": total line cost (number)
- "invoiceRef": invoice or PO number (same for all rows, string)
- "wholesaler": supplier name as written on invoice

Return ONLY the JSON array.`;

    const messageContent = isPDF || isExcel
      ? [
          { type: isPDF ? "document" : "document", source: { type: "base64", media_type: mediaType, data: fc.base64 } },
          { type: "text", text: prompt }
        ]
      : [{ type: "text", text: prompt + "\n\nInvoice content:\n" + fc.text }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: messageContent }]
      })
    });
    const data = await response.json();
    let text = data.content?.filter(b => b.type === "text").map(b => b.text).join("").trim();
    text = text.replace(/```json|```/g, "").trim();
    const items = JSON.parse(text);
    if (!Array.isArray(items) || items.length === 0) throw new Error("No items found in invoice.");
    return items.map(i => ({ ...i, wholesaler: mapWholesaler(i.wholesaler) }));
  };

  const analyzeWithClaude = async () => {
    if (!fileContent) return setError("Please upload a file first.");
    setLoading(true);
    setError("");
    try {
      let items;
      if (fileContent.type === "xml") {
        setLoadingMsg("Reading XML invoice...");
        items = parseXML(fileContent.text);
      } else if (fileContent.type === "csv") {
        setLoadingMsg("Claude AI is reading your CSV invoice...");
        items = await parseWithClaude(fileContent);
      } else if (fileContent.type === "pdf") {
        setLoadingMsg("Claude AI is reading your PDF invoice...");
        items = await parseWithClaude(fileContent);
      } else {
        setLoadingMsg("Claude AI is reading your Excel invoice...");
        items = await parseWithClaude(fileContent);
      }
      setParsedItems(items);
      setStage("preview");
    } catch (err) {
      setError("Could not read invoice: " + err.message);
    }
    setLoading(false);
    setLoadingMsg("");
  };

  const confirmImport = () => {
    if (!staffName.trim()) return setError("Please enter the staff name confirming this import.");

    let newMeds = 0, updatedMeds = 0;
    const now = new Date().toLocaleString();
    const newLogEntries = [];

    parsedItems.forEach(item => {
      if (!item.name || !item.quantity) return;
      const existingIdx = medications.findIndex(m =>
        (item.ndc && m.ndc && m.ndc.replace(/-/g, "") === item.ndc.replace(/-/g, "")) ||
        m.name.toLowerCase() === item.name.toLowerCase()
      );

      if (existingIdx >= 0) {
        updatedMeds++;
        setMedications(prev => prev.map((m, i) => i === existingIdx ? { ...m, quantity: m.quantity + item.quantity } : m));
      } else {
        newMeds++;
        const newMed = { id: Date.now() + Math.random(), name: item.name, ndc: item.ndc || "", quantity: item.quantity, threshold: Math.max(5, Math.floor(item.quantity * 0.2)), supplier: item.wholesaler || "PharmSaver" };
        setMedications(prev => [...prev, newMed]);
      }

      newLogEntries.push({
        id: Date.now() + Math.random(), type: "IN", medName: item.name, ndc: item.ndc || "",
        quantity: item.quantity, supplier: item.wholesaler || "Wholesaler",
        pricePerUnit: item.pricePerTablet,
        totalCost: item.totalCost, staff: staffName,
        notes: `Invoice #${item.invoiceRef || "?"} · ${item.bottles} bottle(s) × ${item.packSize} ${item.unitLabel} = ${item.quantity} ${item.unitLabel}`,
        date: now
      });
    });

    setLog(prev => [...newLogEntries, ...prev]);
    setImportSummary({ newMeds, updatedMeds, totalItems: parsedItems.length, totalCost: parsedItems.reduce((s, i) => s + (i.totalCost || 0), 0) });
    setStage("done");
    notify(`Invoice imported! ${parsedItems.length} medications processed.`);
  };

  const reset = () => { setStage("upload"); setFileContent(null); setFileName(""); setParsedItems([]); setError(""); setStaffName(""); setImportSummary(null); };

  return (
    <div>
      {/* Header */}
      <div style={s.card}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "6px" }}>
          <div style={{ width: "44px", height: "44px", background: "#ecfdf5", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>📄</div>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#1a2744" }}>Wholesale Invoice Importer</div>
            <div style={{ fontSize: "13px", color: "#6b7fa3", marginTop: "2px" }}>Upload your XML invoice (Masters Pharmaceutical, PharmSaver, or any wholesaler) — it reads and adds everything to your inventory instantly.</div>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", gap: "0", marginBottom: "20px" }}>
        {[["1", "Upload XML", "upload"], ["2", "Review Items", "preview"], ["3", "Done", "done"]].map(([num, label, key], i) => {
          const isActive = stage === key;
          const isDone = (key === "upload" && (stage === "preview" || stage === "done")) || (key === "preview" && stage === "done");
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: isActive ? "#ecfdf5" : isDone ? "#f0fdf4" : "#ffffff", border: `1px solid ${isActive ? "#34d399" : isDone ? "#86efac" : "#d0dae8"}`, borderRadius: "8px", flex: 1 }}>
                <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: isActive ? "#2563eb" : isDone ? "#15803d" : "#e2e8f0", color: isActive ? "#fff" : isDone ? "#fff" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "800", flexShrink: 0 }}>{isDone ? "✓" : num}</div>
                <span style={{ fontSize: "12px", fontWeight: "600", color: isActive ? "#2563eb" : isDone ? "#15803d" : "#9aaac0" }}>{label}</span>
              </div>
              {i < 2 && <div style={{ width: "16px", height: "2px", background: "#d0dae8", flexShrink: 0 }} />}
            </div>
          );
        })}
      </div>

      {/* STAGE: UPLOAD */}
      {stage === "upload" && (
        <div style={s.card}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#1a2744", marginBottom: "12px" }}>Step 1 — Upload Your Invoice</div>

          {/* Supported format badges */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
            {[["📄","XML","#2563eb"],["📋","PDF","#dc2626"],["📊","CSV","#16a34a"],["📗","Excel","#15803d"]].map(([icon,label,color]) => (
              <div key={label} style={{ display:"flex", alignItems:"center", gap:"5px", background: color+"12", border:`1px solid ${color}30`, borderRadius:"99px", padding:"4px 12px", fontSize:"12px", fontWeight:"600", color }}>
                {icon} {label}
              </div>
            ))}
          </div>

          <label style={{ display: "block", border: `2px dashed ${fileContent ? "#16a34a" : "#d0dae8"}`, borderRadius: "12px", padding: "36px", textAlign: "center", cursor: "pointer", background: fileContent ? "#f0fdf4" : "#f8fafc", transition: "all 0.2s" }}>
            <input type="file" accept=".xml,.pdf,.csv,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
            <div style={{ fontSize: "36px", marginBottom: "10px" }}>
              {fileContent ? (fileContent.type==="pdf" ? "📋" : fileContent.type==="csv" ? "📊" : (fileContent.type==="xlsx"||fileContent.type==="xls") ? "📗" : "📄") : "📂"}
            </div>
            <div style={{ fontSize: "14px", fontWeight: "600", color: fileContent ? "#16a34a" : "#1a2744" }}>{fileName || "Click to choose your invoice file"}</div>
            <div style={{ fontSize: "12px", color: "#6b7fa3", marginTop: "6px" }}>{fileContent ? `✓ ${fileContent.type.toUpperCase()} loaded` : "XML · PDF · CSV · Excel — any wholesaler"}</div>
          </label>

          {fileContent && (
            <div style={{ marginTop: "16px" }}>
              <input style={s.input} placeholder="Your name or staff name (for the activity log)" value={staffName} onChange={e => setStaffName(e.target.value)} />
              <button style={s.btn("#2563eb", loading || !staffName.trim())} onClick={analyzeWithClaude} disabled={loading || !staffName.trim()}>
                {loading ? `⏳ ${loadingMsg || "Reading invoice..."}` : "📥 Import Invoice"}
              </button>
            </div>
          )}

          {error && <div style={{ marginTop: "12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "12px", color: "#dc2626", fontSize: "13px" }}>⚠ {error}</div>}

          {loading && (
            <div style={{ marginTop: "16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "20px", textAlign: "center" }}>
              <div style={{ fontSize: "13px", color: "#2563eb", fontWeight: "600" }}>{loadingMsg || "Reading invoice..."}</div>
              <div style={{ fontSize: "12px", color: "#6b7fa3", marginTop: "6px" }}>Extracting medication names, NDC numbers, quantities, and prices</div>
              <div style={{ marginTop: "14px", display: "flex", justifyContent: "center", gap: "6px" }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2563eb", animation: `pulse 1.2s ease-in-out ${i * 0.3}s infinite`, opacity: 0.7 }} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STAGE: PREVIEW */}
      {stage === "preview" && (
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#1a2744" }}>Step 2 — Review Extracted Items ({parsedItems.length} medications found)</div>
            <button style={{ ...s.btn("#4a6fa5"), padding: "6px 14px", fontSize: "12px" }} onClick={reset}>← Start Over</button>
          </div>

          <div style={{ background: "#ecfdf5", border: "1px solid #1a4a30", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#34d399" }}>
            ✓ Invoice read successfully ({parsedItems[0]?.wholesaler || "Wholesaler"} · Order #{parsedItems[0]?.invoiceRef} · Shipped {parsedItems[0]?.shippingDate}). Review items below before confirming.
          </div>

          <div style={{ overflowX: "auto", marginBottom: "16px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={s.th}>Medication</th>
                  <th style={s.th}>NDC</th>
                  <th style={s.th}>Bottles</th>
                  <th style={s.th}>Pack Size</th>
                  <th style={s.th}>Total Units</th>
                  <th style={s.th}>$/Bottle</th>
                  <th style={s.th}>$/Unit</th>
                  <th style={s.th}>Total Cost</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedItems.map((item, i) => {
                  const exists = medications.find(m =>
                    (item.ndc && m.ndc && m.ndc.replace(/-/g, "") === (item.ndc || "").replace(/-/g, "")) ||
                    m.name.toLowerCase() === (item.name || "").toLowerCase()
                  );
                  return (
                    <tr key={i}>
                      <td style={{ ...s.td, fontWeight: "600", color: "#1a2744" }}>{item.name || "—"}</td>
                      <td style={{ ...s.td, fontFamily: "monospace", fontSize: "11px", color: "#6b7fa3" }}>{item.ndc || "—"}</td>
                      <td style={{ ...s.td, color: "#94a3b8" }}>{item.bottles}</td>
                      <td style={{ ...s.td, color: "#94a3b8" }}>{item.packSize} {item.unitLabel}</td>
                      <td style={{ ...s.td, fontWeight: "800", color: "#15803d", fontSize: "15px" }}>{fmt(item.quantity)} <span style={{ fontSize: "10px", color: "#6b7fa3", fontWeight: "500" }}>{item.unitLabel}</span></td>
                      <td style={s.td}>{item.pricePerUnit != null ? fmtMoney(item.pricePerUnit) : "—"}</td>
                      <td style={{ ...s.td, color: "#f59e0b" }}>{item.pricePerTablet != null ? "$" + item.pricePerTablet : "—"}</td>
                      <td style={{ ...s.td, fontWeight: "700", color: "#a78bfa" }}>{item.totalCost != null ? fmtMoney(item.totalCost) : "—"}</td>
                      <td style={s.td}>
                        {exists
                          ? <span style={{ background: "#ecfdf5", color: "#34d399", padding: "3px 8px", borderRadius: "99px", fontSize: "11px", fontWeight: "700" }}>Update Stock</span>
                          : <span style={{ background: "#eff6ff", color: "#38bdf8", padding: "3px 8px", borderRadius: "99px", fontSize: "11px", fontWeight: "700" }}>New Medication</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ background: "#eef2f7", borderRadius: "8px", padding: "14px 16px", marginBottom: "14px", display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: "13px", color: "#6b7fa3" }}>Total Invoice Value</div>
            <div style={{ fontSize: "18px", fontWeight: "800", color: "#a78bfa" }}>{fmtMoney(parsedItems.reduce((s, i) => s + (i.totalCost || 0), 0))}</div>
          </div>

          {error && <div style={{ marginBottom: "12px", background: "#fef2f2", border: "1px solid #f8717140", borderRadius: "8px", padding: "12px", color: "#f87171", fontSize: "13px" }}>⚠ {error}</div>}

          <button style={s.btn("#2563eb")} onClick={confirmImport}>✓ Confirm & Import to Inventory</button>
        </div>
      )}

      {/* STAGE: DONE */}
      {stage === "done" && importSummary && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: "52px", marginBottom: "14px" }}>✅</div>
            <div style={{ fontSize: "18px", fontWeight: "800", color: "#15803d", marginBottom: "6px" }}>Invoice Successfully Imported! 🎉</div>
            <div style={{ fontSize: "13px", color: "#6b7fa3", marginBottom: "28px" }}>Your PharmSaver inventory has been added to RxTrack.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px", textAlign: "left" }}>
              <div style={{ background: "#eef2f7", borderRadius: "10px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "#6b7fa3", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px" }}>Total Items</div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#38bdf8" }}>{importSummary.totalItems}</div>
              </div>
              <div style={{ background: "#eef2f7", borderRadius: "10px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "#6b7fa3", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px" }}>New Medications</div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#15803d" }}>{importSummary.newMeds}</div>
              </div>
              <div style={{ background: "#eef2f7", borderRadius: "10px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "#6b7fa3", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px" }}>Updated Stock</div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#fb923c" }}>{importSummary.updatedMeds}</div>
              </div>
            </div>
            <div style={{ background: "#eef2f7", borderRadius: "10px", padding: "14px 20px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "#6b7fa3", fontWeight: "600" }}>Total Invoice Value Imported</span>
              <span style={{ fontSize: "20px", fontWeight: "800", color: "#a78bfa" }}>{fmtMoney(importSummary.totalCost)}</span>
            </div>
            <button style={s.btn("#2563eb")} onClick={reset}>Import Another Invoice</button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
    </div>
  );
}


// ── Scan Station ─────────────────────────────────────────────────────
const QUICK_QTYS = [30, 60, 90, 120];

function ScanStation({ medications, setMedications, setLog, notify }) {
  const [scanInput, setScanInput] = useState("");
  const [matchedMed, setMatchedMed] = useState(null);
  const [fdaLookup, setFdaLookup] = useState(null);
  const [customQty, setCustomQty] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [lastDispensed, setLastDispensed] = useState(null);
  const [stationId, setStationId] = useState("Station 1");
  const [rxNote, setRxNote] = useState("");
  const [debugInfo, setDebugInfo] = useState("Waiting for scan...");
  const inputRef = { current: null };
  const timerRef = { current: null };

  const focusInput = () => { if (inputRef.current) inputRef.current.focus(); };

  useEffect(() => { focusInput(); }, [matchedMed, fdaLookup]);

  const normalizeNDC = (n) => (n || "").replace(/[-\s]/g, "");

  const formatNDC = (ten) => `${ten.slice(0,5)}-${ten.slice(5,8)}-${ten.slice(8)}`;

  // Given raw barcode digits, return all possible NDC strings to try matching
  const getCandidates = (raw) => {
    const c = raw.replace(/[-\s]/g, "");
    let ten = c;
    if (c.length === 12 && c.startsWith("3")) ten = c.slice(1, 11);
    else if (c.length === 11 && c.startsWith("3")) ten = c.slice(1);
    const set = new Set();
    set.add(ten);
    set.add(`${ten.slice(0,5)}-${ten.slice(5,8)}-${ten.slice(8)}`);   // 5-3-2
    set.add(`${ten.slice(0,5)}-${ten.slice(5,9)}-${ten.slice(9)}`);   // 5-4-2
    set.add(`${ten.slice(0,4)}-${ten.slice(4,8)}-${ten.slice(8)}`);   // 4-4-2 e.g. 0032-2636-01
    set.add(ten.slice(0,4) + ten.slice(4,8) + ten.slice(8));          // 4-4-2 no dashes
    set.add(`0${ten.slice(0,4)}-${ten.slice(4,8)}-${ten.slice(8)}`);  // zero-padded labeler
    set.add(ten.slice(0,5) + "0" + ten.slice(5,8) + ten.slice(8));    // 5-3-2 no dashes
    return [...set];
  };

  const tryMatch = (raw) => {
    const candidates = getCandidates(raw);
    return medications.find(m => {
      const mn = normalizeNDC(m.ndc);
      return candidates.some(c => normalizeNDC(c) === mn || mn.slice(-10) === normalizeNDC(c).slice(-10));
    });
  };

  const lookupFDA = async (raw) => {
    const c = raw.replace(/[-\s]/g, "");
    let ten = c;
    if (c.length === 12 && c.startsWith("3")) ten = c.slice(1, 11);
    else if (c.length === 11 && c.startsWith("3")) ten = c.slice(1);

    // Build all candidate NDC formats: 5-3-2, 5-4-2, 4-4-2
    const ndc532 = `${ten.slice(0,5)}-${ten.slice(5,8)}-${ten.slice(8)}`;
    const ndc542 = `${ten.slice(0,5)}-${ten.slice(5,9)}-${ten.slice(9)}`;
    const ndc442 = `${ten.slice(0,4)}-${ten.slice(4,8)}-${ten.slice(8)}`;

    setDebugInfo(`Searching FDA: ${ndc532} / ${ndc442}...`);
    setFdaLookup({ loading: true, ndc: ndc532 });

    // Try each format against the free openFDA NDC API (no key required)
    const tryFDA = async (productNDC) => {
      const url = `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${productNDC}"&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      return data.results?.[0] || null;
    };

    try {
      // Try product_ndc queries (labeler-product portion only, no package code)
      const queries = [
        ndc532.split("-").slice(0,2).join("-"),  // 5-3 portion
        ndc542.split("-").slice(0,2).join("-"),  // 5-4 portion
        ndc442.split("-").slice(0,2).join("-"),  // 4-4 portion
      ];

      let result = null;
      let matchedNDC = ndc532;
      for (let i = 0; i < queries.length; i++) {
        result = await tryFDA(queries[i]);
        if (result) { matchedNDC = [ndc532, ndc542, ndc442][i]; break; }
      }

      if (result) {
        const generic = result.generic_name || "";
        const brand = result.brand_name || "";
        const strength = result.active_ingredients?.[0]?.strength || "";
        const form = result.dosage_form || "";
        const pkg = result.packaging?.[0]?.description || "";
        const packMatch = pkg.match(/^(\d+)/);
        const packSize = packMatch ? parseInt(packMatch[1]) : 1;
        const upper = form.toUpperCase();
        const unitLabel = upper.includes("TABLET") ? "tablets"
          : upper.includes("CAPSULE") ? "capsules"
          : upper.includes("SOLUTION") || upper.includes("SUSPENSION") || upper.includes("SPRAY") ? "mL"
          : upper.includes("OINTMENT") || upper.includes("CREAM") || upper.includes("GEL") ? "g"
          : upper.includes("PATCH") ? "patches"
          : upper.includes("INJECT") ? "vials"
          : "units";
        const name = `${brand ? brand + " " : ""}${generic} ${strength} ${form} (${packSize})`.trim();
        const finalNDC = result.product_ndc ? `${result.product_ndc}-${matchedNDC.split("-")[2]}` : matchedNDC;
        setFdaLookup({ loading: false, ndc: finalNDC, name, packSize, unitLabel, labeler: result.labeler_name, notFound: false });
        setDebugInfo(`✓ Found: ${name}`);
      } else {
        setFdaLookup({ loading: false, ndc: ndc532, notFound: true });
        setDebugInfo(`✗ Not found in FDA database`);
      }
    } catch(e) {
      setFdaLookup({ loading: false, ndc: ndc532, notFound: true });
      setDebugInfo(`✗ FDA lookup error: ${e.message}`);
    }
  };


  const processScan = (val) => {
    const clean = val.replace(/[-\s]/g, "");
    setScanInput("");
    setDebugInfo(`Received: ${clean} (${clean.length} digits)`);
    const found = tryMatch(clean);
    if (found) {
      setMatchedMed(found);
      setFdaLookup(null);
      setRxNote("");
      setShowCustom(false);
      setCustomQty("");
    } else {
      lookupFDA(clean);
    }
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setScanInput(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const clean = val.replace(/[-\s]/g, "");
      if (clean.length >= 10) processScan(val);
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (scanInput.trim()) processScan(scanInput);
    }
    if (e.key === "Escape") { setMatchedMed(null); setFdaLookup(null); setScanInput(""); setDebugInfo("Waiting for scan..."); focusInput(); }
  };

  const dispense = (qty) => {
    if (!staffName.trim()) return;
    if (matchedMed.quantity < qty) { notify(`Only ${matchedMed.quantity} units in stock!`, "error"); return; }
    const now = new Date().toLocaleString();
    setMedications(prev => prev.map(m => m.id === matchedMed.id ? { ...m, quantity: m.quantity - qty } : m));
    setLog(prev => [{ id: Date.now(), type: "OUT", medName: matchedMed.name, ndc: matchedMed.ndc, quantity: qty, staff: `${staffName} (${stationId})`, notes: rxNote ? `Rx: ${rxNote}` : "Scan Station", date: now }, ...prev]);
    setLastDispensed({ name: matchedMed.name, qty, remaining: matchedMed.quantity - qty });
    setMatchedMed(null); setScanInput(""); setRxNote(""); setShowCustom(false); setCustomQty("");
    setDebugInfo("Waiting for scan...");
    setTimeout(focusInput, 100);
  };

  const addFromFDA = (qty, threshold, supplier) => {
    const newMed = { id: Date.now(), name: fdaLookup.name, ndc: fdaLookup.ndc, quantity: qty, threshold, supplier, packSize: fdaLookup.packSize, unitLabel: fdaLookup.unitLabel };
    setMedications(prev => [...prev, newMed]);
    notify(`✓ ${fdaLookup.name} added to inventory!`);
    setFdaLookup(null); setScanInput(""); setDebugInfo("Waiting for scan...");
    setTimeout(focusInput, 100);
  };

  const st = {
    topBar: { display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" },
    stationSelect: { background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px 14px", color: "#2563eb", fontSize: "14px", fontWeight: "700", fontFamily: "'IBM Plex Sans', sans-serif", outline: "none" },
    staffInput: { background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px 14px", color: "#1a2744", fontSize: "14px", fontFamily: "'IBM Plex Sans', sans-serif", outline: "none", flex: 1 },
    scanBox: { background: "#f8fafc", border: "2px dashed #2563eb", borderRadius: "16px", padding: "40px 32px", textAlign: "center", cursor: "text", flex: 1 },
    matchCard: { background: "#ffffff", border: "2px solid #15803d", borderRadius: "16px", padding: "28px" },
    fdaCard: (loading, notFound) => ({ background: "#ffffff", border: `2px solid ${loading ? "#f59e0b" : notFound ? "#dc2626" : "#2563eb"}`, borderRadius: "16px", padding: "28px" }),
    qtyBtn: (disabled) => ({ padding: "20px 10px", background: disabled ? "#e2e8f0" : "#2563eb", border: "none", borderRadius: "12px", color: disabled ? "#94a3b8" : "#fff", fontWeight: "800", fontSize: "22px", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'IBM Plex Sans', sans-serif", flex: 1 }),
    cancelBtn: { padding: "10px 20px", background: "#f8fafc", border: "1px solid #d0dae8", borderRadius: "8px", color: "#64748b", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif" },
    input: { background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px 14px", color: "#1a2744", fontSize: "14px", fontFamily: "'IBM Plex Sans', sans-serif", outline: "none", width: "100%", boxSizing: "border-box" },
    lastBanner: { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" },
    debugBar: { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "8px 14px", fontSize: "11px", color: "#1d4ed8", fontFamily: "monospace", marginBottom: "16px" },
  };

  return (
    <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", gap: "0" }}>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }`}</style>

      {/* Always-visible hidden input to capture scanner */}
      <input
        ref={el => { inputRef.current = el; }}
        value={scanInput}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={{ position: "fixed", left: "-9999px", width: "1px", height: "1px", opacity: 0 }}
        autoFocus
      />

      {/* Top bar */}
      <div style={st.topBar}>
        <select style={st.stationSelect} value={stationId} onChange={e => setStationId(e.target.value)}>
          {["Station 1","Station 2","Station 3","Station 4","Station 5"].map(s => <option key={s}>{s}</option>)}
        </select>
        <input style={st.staffInput} placeholder="👤 Pharmacist / Tech name..." value={staffName} onChange={e => setStaffName(e.target.value)} />
      </div>

      {/* Debug bar */}
      <div style={st.debugBar}>🔍 {debugInfo}{scanInput ? ` | Receiving: "${scanInput}"` : ""}</div>

      {/* Last dispensed */}
      {lastDispensed && (
        <div style={st.lastBanner}>
          <div style={{ fontSize: "13px", color: "#15803d" }}>✓ Dispensed <strong>{lastDispensed.qty} units</strong> of <strong>{lastDispensed.name}</strong></div>
          <div style={{ fontSize: "12px", color: "#6b7fa3" }}>{lastDispensed.remaining} units remaining</div>
        </div>
      )}

      {/* WAITING FOR SCAN */}
      {!matchedMed && !fdaLookup && (
        <div style={st.scanBox} onClick={focusInput}>
          <div style={{ fontSize: "56px", marginBottom: "14px" }}>📷</div>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "#1a2744", marginBottom: "8px" }}>
            {staffName.trim() ? "Ready to Scan" : "Enter your name above, then scan"}
          </div>
          <div style={{ fontSize: "14px", color: "#6b7fa3" }}>Point your Zebra scanner at the bottle barcode</div>
        </div>
      )}

      {/* FDA LOOKUP */}
      {!matchedMed && fdaLookup && (
        <div style={st.fdaCard(fdaLookup.loading, fdaLookup.notFound)}>
          {fdaLookup.loading && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🔍</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "#f59e0b" }}>Looking up in FDA database...</div>
              <div style={{ fontSize: "12px", color: "#6b7fa3", marginTop: "6px", fontFamily: "monospace" }}>{fdaLookup.ndc}</div>
            </div>
          )}
          {!fdaLookup.loading && fdaLookup.notFound && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>❓</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "#dc2626" }}>Not found in FDA database</div>
              <div style={{ fontSize: "13px", color: "#6b7fa3", margin: "8px 0 20px", fontFamily: "monospace" }}>{fdaLookup.ndc}</div>
              <button style={st.cancelBtn} onClick={() => { setFdaLookup(null); setDebugInfo("Waiting for scan..."); setTimeout(focusInput, 100); }}>← Try Again</button>
            </div>
          )}
          {!fdaLookup.loading && !fdaLookup.notFound && <AddFromFDA fdaLookup={fdaLookup} onAdd={addFromFDA} onCancel={() => { setFdaLookup(null); setDebugInfo("Waiting for scan..."); setTimeout(focusInput, 100); }} />}
        </div>
      )}

      {/* MEDICATION MATCHED */}
      {matchedMed && (
        <div style={st.matchCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#1a2744" }}>{matchedMed.name}</div>
            <button style={st.cancelBtn} onClick={() => { setMatchedMed(null); setDebugInfo("Waiting for scan..."); setTimeout(focusInput, 100); }}>✕ Cancel</button>
          </div>
          <div style={{ fontSize: "13px", color: "#6b7fa3", fontFamily: "monospace", marginBottom: "6px" }}>NDC: {matchedMed.ndc}</div>
          <div style={{ display: "inline-block", background: matchedMed.quantity <= matchedMed.threshold ? "#fff7ed" : "#dcfce7", color: matchedMed.quantity <= matchedMed.threshold ? "#c2410c" : "#15803d", padding: "5px 14px", borderRadius: "99px", fontSize: "14px", fontWeight: "700", marginBottom: "20px" }}>
            {matchedMed.quantity.toLocaleString()} units in stock
          </div>
          <input style={{ ...st.input, marginBottom: "16px" }} placeholder="Rx # (optional)" value={rxNote} onChange={e => setRxNote(e.target.value)} />
          <div style={{ fontSize: "12px", color: "#6b7fa3", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "10px" }}>Units to dispense</div>
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
            {QUICK_QTYS.map(q => <button key={q} style={st.qtyBtn(q > matchedMed.quantity)} onClick={() => q <= matchedMed.quantity && dispense(q)}>{q}</button>)}
          </div>
          {!showCustom
            ? <button style={{ ...st.cancelBtn, width: "100%" }} onClick={() => setShowCustom(true)}>Enter custom quantity</button>
            : <div style={{ display: "flex", gap: "10px" }}>
                <input style={{ ...st.input, fontSize: "18px", textAlign: "center" }} type="number" placeholder="Enter qty..." value={customQty} onChange={e => setCustomQty(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && customQty && dispense(parseInt(customQty))} />
                <button style={{ ...st.qtyBtn(false), flex: "0 0 60px", fontSize: "18px", padding: "10px" }} onClick={() => customQty && dispense(parseInt(customQty))}>✓</button>
              </div>
          }
          {matchedMed.quantity <= matchedMed.threshold && (
            <div style={{ marginTop: "14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#c2410c" }}>
              ⚠ Low stock — consider reordering from {matchedMed.supplier}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Separate component to allow useState inside FDA add form
function AddFromFDA({ fdaLookup, onAdd, onCancel }) {
  const [qty, setQty] = useState("0");
  const [threshold, setThreshold] = useState("10");
  const [supplier, setSupplier] = useState("PharmSaver");
  const inp = { background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px", color: "#1a2744", fontSize: "14px", fontFamily: "'IBM Plex Sans', sans-serif", outline: "none", width: "100%", boxSizing: "border-box", textAlign: "center" };
  return (
    <div>
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#2563eb", fontWeight: "600" }}>✓ Found in FDA Drug Database — not yet in your inventory</div>
      <div style={{ fontSize: "20px", fontWeight: "800", color: "#1a2744", marginBottom: "4px" }}>{fdaLookup.name}</div>
      <div style={{ fontSize: "12px", color: "#6b7fa3", fontFamily: "monospace", marginBottom: "4px" }}>NDC: {fdaLookup.ndc}</div>
      <div style={{ fontSize: "12px", color: "#6b7fa3", marginBottom: "20px" }}>{fdaLookup.labeler} · {fdaLookup.packSize} {fdaLookup.unitLabel} per pack</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
        <div><div style={{ fontSize: "11px", color: "#6b7fa3", marginBottom: "4px" }}>Current Qty</div><input style={inp} type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
        <div><div style={{ fontSize: "11px", color: "#6b7fa3", marginBottom: "4px" }}>Low Stock Alert</div><input style={inp} type="number" value={threshold} onChange={e => setThreshold(e.target.value)} /></div>
        <div><div style={{ fontSize: "11px", color: "#6b7fa3", marginBottom: "4px" }}>Supplier</div>
          <select style={{ ...inp, textAlign: "left" }} value={supplier} onChange={e => setSupplier(e.target.value)}>
            {["Cencora","McKesson","PharmSaver"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px" }}>
        <button style={{ flex: 1, padding: "14px", background: "#2563eb", border: "none", borderRadius: "8px", color: "#fff", fontWeight: "700", fontSize: "15px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={() => onAdd(parseInt(qty)||0, parseInt(threshold)||10, supplier)}>✓ Add to Inventory</button>
        <button style={{ padding: "14px 20px", background: "#f8fafc", border: "1px solid #d0dae8", borderRadius: "8px", color: "#64748b", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}


// ── Main App ──────────────────────────────────────────────────────────
export default function PharmacyInventory() {
  const [tab, setTab] = useState("Dashboard");
  const [medications, setMedications] = useState([]);
  const [orders, setOrders] = useState([]);
  const [log, setLog] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddMed, setShowAddMed] = useState(false);
  const [notification, setNotification] = useState(null);

  const emptyMed = { name: "", ndc: "", quantity: "", threshold: "", supplier: SUPPLIERS[0] };
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ threshold: "", supplier: "" });
  const emptyOrder = { medId: "", supplier: SUPPLIERS[0], quantity: "", pricePerUnit: "", orderRef: "", notes: "" };
  const emptyReceive = { medId: "", quantity: "", supplier: SUPPLIERS[0], staff: "", pricePerUnit: "" };
  const emptyDispense = { medId: "", quantity: "", staff: "", notes: "" };

  const [medForm, setMedForm] = useState(emptyMed);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [receiveForm, setReceiveForm] = useState(emptyReceive);
  const [dispenseForm, setDispenseForm] = useState(emptyDispense);

  useEffect(() => {
    (async () => {
      try {
        const m = await window.storage.get("pharm-meds-v3");
        if (m) setMedications(JSON.parse(m.value));
        const o = await window.storage.get("pharm-orders-v3");
        if (o) setOrders(JSON.parse(o.value));
        const l = await window.storage.get("pharm-log-v3");
        if (l) setLog(JSON.parse(l.value));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) window.storage.set("pharm-meds-v3", JSON.stringify(medications)).catch(() => {}); }, [medications, loaded]);
  useEffect(() => { if (loaded) window.storage.set("pharm-orders-v3", JSON.stringify(orders)).catch(() => {}); }, [orders, loaded]);
  useEffect(() => { if (loaded) window.storage.set("pharm-log-v3", JSON.stringify(log)).catch(() => {}); }, [log, loaded]);

  const notify = (msg, type = "success") => { setNotification({ msg, type }); setTimeout(() => setNotification(null), 4000); };

  const startEdit = (m) => { setEditingId(m.id); setEditForm({ threshold: String(m.threshold), supplier: m.supplier }); };
  const saveEdit = (id) => {
    if (!editForm.threshold) return;
    setMedications(prev => prev.map(m => m.id === id ? { ...m, threshold: parseInt(editForm.threshold), supplier: editForm.supplier } : m));
    setEditingId(null);
    notify("✓ Settings updated");
  };
  const addMedication = () => {
    if (!medForm.name.trim() || !medForm.ndc.trim() || !medForm.quantity || !medForm.threshold) return notify("Please fill all fields.", "error");
    setMedications(prev => [...prev, { id: Date.now(), ...medForm, quantity: parseInt(medForm.quantity), threshold: parseInt(medForm.threshold) }]);
    setMedForm(emptyMed); setShowAddMed(false);
    notify(`${medForm.name} added!`);
  };

  const placeOrder = () => {
    if (!orderForm.medId || !orderForm.quantity || !orderForm.pricePerUnit) return notify("Fill required fields.", "error");
    const med = medications.find(m => m.id === parseInt(orderForm.medId));
    setOrders(prev => [{ id: Date.now(), medId: parseInt(orderForm.medId), medName: med.name, ndc: med.ndc, supplier: orderForm.supplier, quantity: parseInt(orderForm.quantity), pricePerUnit: parseFloat(orderForm.pricePerUnit), totalCost: parseInt(orderForm.quantity) * parseFloat(orderForm.pricePerUnit), orderRef: orderForm.orderRef, notes: orderForm.notes, status: "Ordered", datePlaced: new Date().toLocaleString(), dateReceived: null }, ...prev]);
    setOrderForm(emptyOrder);
    notify(`Order placed for ${med.name}!`);
  };

  const updateOrderStatus = (id, newStatus) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus, dateReceived: newStatus === "Received" ? new Date().toLocaleString() : o.dateReceived } : o));
    if (newStatus === "Received") {
      const order = orders.find(o => o.id === id);
      setMedications(prev => prev.map(m => m.id === order.medId ? { ...m, quantity: m.quantity + order.quantity } : m));
      setLog(prev => [{ id: Date.now(), type: "IN", medName: order.medName, ndc: order.ndc, quantity: order.quantity, supplier: order.supplier, pricePerUnit: order.pricePerUnit, totalCost: order.totalCost, staff: "Order Receipt", date: new Date().toLocaleString() }, ...prev]);
      notify(`${order.quantity} units of ${order.medName} added to inventory!`);
    }
  };

  const receiveMed = () => {
    if (!receiveForm.medId || !receiveForm.quantity || !receiveForm.staff.trim()) return notify("Fill all fields.", "error");
    const qty = parseInt(receiveForm.quantity);
    const med = medications.find(m => m.id === parseInt(receiveForm.medId));
    setMedications(prev => prev.map(m => m.id === parseInt(receiveForm.medId) ? { ...m, quantity: m.quantity + qty } : m));
    setLog(prev => [{ id: Date.now(), type: "IN", medName: med.name, ndc: med.ndc, quantity: qty, supplier: receiveForm.supplier, pricePerUnit: receiveForm.pricePerUnit ? parseFloat(receiveForm.pricePerUnit) : null, totalCost: receiveForm.pricePerUnit ? qty * parseFloat(receiveForm.pricePerUnit) : null, staff: receiveForm.staff, date: new Date().toLocaleString() }, ...prev]);
    setReceiveForm(emptyReceive);
    notify(`+${qty} units of ${med.name} received!`);
  };

  const dispenseMed = () => {
    if (!dispenseForm.medId || !dispenseForm.quantity || !dispenseForm.staff.trim()) return notify("Fill all fields.", "error");
    const qty = parseInt(dispenseForm.quantity);
    const med = medications.find(m => m.id === parseInt(dispenseForm.medId));
    if (med.quantity < qty) return notify(`Only ${med.quantity} units available!`, "error");
    setMedications(prev => prev.map(m => m.id === parseInt(dispenseForm.medId) ? { ...m, quantity: m.quantity - qty } : m));
    setLog(prev => [{ id: Date.now(), type: "OUT", medName: med.name, ndc: med.ndc, quantity: qty, staff: dispenseForm.staff, notes: dispenseForm.notes, date: new Date().toLocaleString() }, ...prev]);
    setDispenseForm(emptyDispense);
    notify(`-${qty} units of ${med.name} dispensed.`);
  };

  const lowStock = medications.filter(m => m.quantity <= m.threshold);
  const pendingOrders = orders.filter(o => o.status === "Ordered" || o.status === "Shipped");
  const filtered = medications.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.ndc.includes(search));
  const totalSpentBySupplier = SUPPLIERS.reduce((acc, sup) => { acc[sup] = log.filter(e => e.type === "IN" && e.supplier === sup && e.totalCost).reduce((s, e) => s + e.totalCost, 0); return acc; }, {});
  const totalSpent = Object.values(totalSpentBySupplier).reduce((a, b) => a + b, 0);

  const s = {
    app: { minHeight: "100vh", background: "#f0f4f8", color: "#1a2744", fontFamily: "'IBM Plex Sans', sans-serif" },
    header: { background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 },
    logo: { fontSize: "19px", fontWeight: "700", color: "#1a2744" },
    logoRx: { color: "#7eb8f7", fontWeight: "800" },
    tabs: { display: "flex", gap: "2px", background: "#eef2f7", borderRadius: "8px", padding: "3px", overflowX: "auto" },
    tabBtn: (active, t) => ({ padding: "7px 13px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: "600", fontFamily: "'IBM Plex Sans', sans-serif", whiteSpace: "nowrap", background: active ? (t === "🔫 Scan Station" ? "#10b981" : "#2563eb") : "transparent", color: active ? "#fff" : "#93b4d8", transition: "all 0.18s" }),
    body: { maxWidth: "1150px", margin: "0 auto", padding: "22px 16px" },
    statGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" },
    statCard: (accent) => ({ background: "#ffffff", border: `1px solid ${accent}40`, borderLeft: `3px solid ${accent}`, borderRadius: "12px", padding: "16px 18px" }),
    statLabel: { fontSize: "11px", color: "#6b7fa3", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" },
    statVal: (color) => ({ fontSize: "26px", fontWeight: "800", color, letterSpacing: "-1px" }),
    card: { background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "14px", padding: "20px", marginBottom: "16px" },
    sectionTitle: { fontSize: "15px", fontWeight: "700", color: "#1a2744", marginBottom: "14px" },
    input: { width: "100%", background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px 13px", color: "#1a2744", fontSize: "13px", fontFamily: "'IBM Plex Sans', sans-serif", boxSizing: "border-box", outline: "none", marginBottom: "10px" },
    select: { width: "100%", background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "8px", padding: "10px 13px", color: "#1a2744", fontSize: "13px", fontFamily: "'IBM Plex Sans', sans-serif", boxSizing: "border-box", outline: "none", marginBottom: "10px" },
    btn: (color) => ({ padding: "10px 20px", background: color || "#2563eb", border: "none", borderRadius: "8px", color: "#fff", fontWeight: "700", fontSize: "13px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif" }),
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" },
    th: { padding: "10px 12px", fontSize: "11px", fontWeight: "700", color: "#6b7fa3", textTransform: "uppercase", letterSpacing: "0.8px", textAlign: "left", borderBottom: "1px solid #e2e8f0" },
    td: { padding: "12px", fontSize: "13px", color: "#2d3f5e", borderBottom: "1px solid #eef2f7" },
    alertCard: { background: "#fff7ed", border: "1px solid #fb923c40", borderRadius: "10px", padding: "12px 16px", marginBottom: "8px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    emptyState: { textAlign: "center", padding: "36px", color: "#9aaac0", fontSize: "14px" },
    notification: (type) => ({ position: "fixed", top: "20px", right: "20px", background: type === "error" ? "#fef2f2" : "#f0fdf4", border: `1px solid ${type === "error" ? "#fca5a5" : "#86efac"}`, borderRadius: "10px", padding: "14px 20px", color: type === "error" ? "#dc2626" : "#16a34a", fontSize: "14px", fontWeight: "600", zIndex: 999, maxWidth: "340px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }),
  };

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      {notification && <div style={s.notification(notification.type)}>{notification.type === "error" ? "⚠ " : "✓ "}{notification.msg}</div>}

      <div style={s.app}>
        <div style={s.header}>
          <div style={s.logo}><span style={s.logoRx}>Rx</span>Track — Pharmacy Inventory</div>
          <div style={s.tabs}>
            {TABS.map(t => <button key={t} style={s.tabBtn(tab === t, t)} onClick={() => setTab(t)}>
              {t === "Invoice Import" ? "📥 " + t : t}
            </button>)}
          </div>
        </div>

        <div style={s.body}>

          {tab === "Dashboard" && (<>
            <div style={s.statGrid}>
              <div style={s.statCard("#38bdf8")}><div style={s.statLabel}>Total Medications</div><div style={s.statVal("#38bdf8")}>{medications.length}</div></div>
              <div style={s.statCard("#fb923c")}><div style={s.statLabel}>Low Stock Alerts</div><div style={s.statVal("#fb923c")}>{lowStock.length}</div></div>
              <div style={s.statCard("#f59e0b")}><div style={s.statLabel}>Pending Orders</div><div style={s.statVal("#f59e0b")}>{pendingOrders.length}</div></div>
              <div style={s.statCard("#a78bfa")}><div style={s.statLabel}>Total Spent</div><div style={{ fontSize: "20px", fontWeight: "800", color: "#a78bfa", letterSpacing: "-0.5px" }}>{fmtMoney(totalSpent)}</div></div>
            </div>

            <div style={s.card}>
              <div style={s.sectionTitle}>💰 Spending by Supplier</div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {SUPPLIERS.map(sup => (
                  <div key={sup} style={{ background: supplierColor[sup] + "10", border: `1px solid ${supplierColor[sup]}30`, borderRadius: "10px", padding: "14px 18px", flex: 1, minWidth: "130px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: supplierColor[sup], marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.8px" }}>{sup}</div>
                    <div style={{ fontSize: "20px", fontWeight: "800", color: "#1a2744" }}>{fmtMoney(totalSpentBySupplier[sup])}</div>
                    <div style={{ fontSize: "11px", color: "#6b7fa3", marginTop: "2px" }}>{log.filter(e => e.type === "IN" && e.supplier === sup).length} receipts</div>
                  </div>
                ))}
              </div>
            </div>

            {lowStock.length > 0 && (
              <div style={s.card}>
                <div style={s.sectionTitle}>⚠ Low Stock Alerts</div>
                {lowStock.map(m => (
                  <div key={m.id} style={s.alertCard}>
                    <div><div style={{ fontWeight: "700", color: "#fb923c", fontSize: "14px" }}>{m.name}</div><div style={{ fontSize: "12px", color: "#92400e", marginTop: "2px" }}>NDC: {m.ndc}</div></div>
                    <div style={{ textAlign: "right" }}><div style={{ fontSize: "22px", fontWeight: "800", color: m.quantity === 0 ? "#f87171" : "#fb923c" }}>{fmt(m.quantity)}</div><div style={{ fontSize: "11px", color: "#92400e" }}>Threshold: {fmt(m.threshold)}</div></div>
                  </div>
                ))}
              </div>
            )}

            {pendingOrders.length > 0 && (
              <div style={s.card}>
                <div style={s.sectionTitle}>📦 Pending Orders</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={s.th}>Medication</th><th style={s.th}>Supplier</th><th style={s.th}>Qty</th><th style={s.th}>Total</th><th style={s.th}>Status</th><th style={s.th}>Action</th></tr></thead>
                  <tbody>{pendingOrders.map(o => (
                    <tr key={o.id}>
                      <td style={{ ...s.td, fontWeight: "600", color: "#1a2744" }}>{o.medName}</td>
                      <td style={s.td}><SupplierBadge supplier={o.supplier} /></td>
                      <td style={s.td}>{fmt(o.quantity)}</td>
                      <td style={{ ...s.td, fontWeight: "700", color: "#a78bfa" }}>{fmtMoney(o.totalCost)}</td>
                      <td style={s.td}><OrderStatusBadge status={o.status} /></td>
                      <td style={s.td}>
                        {o.status === "Ordered" && <button style={{ ...s.btn("#38bdf8"), padding: "5px 10px", fontSize: "11px", marginRight: "4px" }} onClick={() => updateOrderStatus(o.id, "Shipped")}>Shipped</button>}
                        {o.status === "Shipped" && <button style={{ ...s.btn("#15803d"), padding: "5px 10px", fontSize: "11px" }} onClick={() => updateOrderStatus(o.id, "Received")}>✓ Received</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <div style={s.card}>
              <div style={s.sectionTitle}>📋 Recent Activity</div>
              {log.length === 0 ? <div style={s.emptyState}>No activity yet.</div> :
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={s.th}>Type</th><th style={s.th}>Medication</th><th style={s.th}>Qty</th><th style={s.th}>Supplier</th><th style={s.th}>$/Unit</th><th style={s.th}>Total</th><th style={s.th}>Staff</th><th style={s.th}>Date</th></tr></thead>
                  <tbody>{log.slice(0, 8).map(e => (
                    <tr key={e.id}>
                      <td style={s.td}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "3px", background: e.type === "IN" ? "#dcfce7" : "#fce7f3", color: e.type === "IN" ? "#15803d" : "#be185d", padding: "4px 0", width: "54px", borderRadius: "99px", fontSize: "11px", fontWeight: "700", textAlign: "center", border: `1px solid ${e.type === "IN" ? "#bbf7d0" : "#fbcfe8"}` }}>{e.type === "IN" ? "↑ IN" : "↓ OUT"}</span></td>
                      <td style={{ ...s.td, fontWeight: "600", color: "#1a2744" }}>{e.medName}<div style={{ fontSize: "11px", color: "#9aaac0" }}>{e.ndc}</div></td>
                      <td style={{ ...s.td, fontWeight: "700", color: e.type === "IN" ? "#15803d" : "#be185d" }}>{e.type === "IN" ? "+" : "-"}{fmt(e.quantity)}</td>
                      <td style={s.td}>{e.supplier ? <SupplierBadge supplier={e.supplier} /> : "—"}</td>
                      <td style={s.td}>{e.pricePerUnit ? fmtMoney(e.pricePerUnit) : "—"}</td>
                      <td style={{ ...s.td, fontWeight: "700", color: "#a78bfa" }}>{e.totalCost ? fmtMoney(e.totalCost) : "—"}</td>
                      <td style={s.td}>{e.staff}</td>
                      <td style={{ ...s.td, fontSize: "11px", color: "#9aaac0" }}>{e.date}</td>
                    </tr>
                  ))}</tbody>
                </table>
              }
            </div>
          </>)}

          {tab === "Inventory" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={s.sectionTitle}>💊 All Medications</div>
                <button style={s.btn("#2563eb")} onClick={() => setShowAddMed(!showAddMed)}>{showAddMed ? "✕ Cancel" : "+ Add Medication"}</button>
              </div>
              {showAddMed && (
                <div style={{ background: "#ffffff", border: "1px solid #d0dae8", borderRadius: "10px", padding: "18px", marginBottom: "18px" }}>
                  <div style={s.grid2}>
                    <input style={s.input} placeholder="Medication Name" value={medForm.name} onChange={e => setMedForm(f => ({ ...f, name: e.target.value }))} />
                    <input style={s.input} placeholder="NDC Number" value={medForm.ndc} onChange={e => setMedForm(f => ({ ...f, ndc: e.target.value }))} />
                    <input style={s.input} placeholder="Current Quantity" type="number" value={medForm.quantity} onChange={e => setMedForm(f => ({ ...f, quantity: e.target.value }))} />
                    <input style={s.input} placeholder="Low Stock Threshold" type="number" value={medForm.threshold} onChange={e => setMedForm(f => ({ ...f, threshold: e.target.value }))} />
                  </div>
                  <select style={s.select} value={medForm.supplier} onChange={e => setMedForm(f => ({ ...f, supplier: e.target.value }))}>{SUPPLIERS.map(s => <option key={s}>{s}</option>)}</select>
                  <button style={s.btn("#2563eb")} onClick={addMedication}>✓ Save</button>
                </div>
              )}
              <input style={{ ...s.input, marginBottom: "14px" }} placeholder="🔍 Search by name or NDC..." value={search} onChange={e => setSearch(e.target.value)} />
              {filtered.length === 0 ? <div style={s.emptyState}>No medications yet.</div> :
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={s.th}>Medication</th>
                    <th style={s.th}>NDC</th>
                    <th style={s.th}>Qty</th>
                    <th style={s.th}>Threshold</th>
                    <th style={s.th}>Supplier</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}></th>
                  </tr></thead>
                  <tbody>{filtered.map(m => {
                    const isEditing = editingId === m.id;
                    return (
                      <tr key={m.id} style={{ background: isEditing ? "#f0f6ff" : "transparent" }}>
                        <td style={{ ...s.td, fontWeight: "700", color: "#1a2744" }}>{m.name}</td>
                        <td style={{ ...s.td, fontFamily: "monospace", color: "#6b7fa3", fontSize: "12px" }}>{m.ndc}</td>
                        <td style={{ ...s.td, fontWeight: "800", fontSize: "16px", color: m.quantity === 0 ? "#dc2626" : m.quantity <= m.threshold ? "#c2410c" : "#15803d" }}>{fmt(m.quantity)}</td>
                        <td style={s.td}>
                          {isEditing
                            ? <input type="number" value={editForm.threshold} onChange={e => setEditForm(f => ({ ...f, threshold: e.target.value }))}
                                style={{ width: "70px", padding: "6px 8px", border: "2px solid #2563eb", borderRadius: "6px", fontSize: "13px", fontFamily: "'IBM Plex Sans', sans-serif", outline: "none", color: "#1a2744" }} />
                            : <span style={{ color: "#6b7fa3" }}>{fmt(m.threshold)}</span>
                          }
                        </td>
                        <td style={s.td}>
                          {isEditing
                            ? <select value={editForm.supplier} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))}
                                style={{ padding: "6px 8px", border: "2px solid #2563eb", borderRadius: "6px", fontSize: "13px", fontFamily: "'IBM Plex Sans', sans-serif", outline: "none", color: "#1a2744", background: "#fff" }}>
                                {SUPPLIERS.map(s => <option key={s}>{s}</option>)}
                              </select>
                            : <SupplierBadge supplier={m.supplier} />
                          }
                        </td>
                        <td style={s.td}><Badge qty={m.quantity} threshold={m.threshold} /></td>
                        <td style={{ ...s.td, whiteSpace: "nowrap" }}>
                          {isEditing ? (<>
                            <button onClick={() => saveEdit(m.id)} style={{ padding: "5px 12px", background: "#2563eb", border: "none", borderRadius: "6px", color: "#fff", fontWeight: "700", fontSize: "12px", cursor: "pointer", marginRight: "6px", fontFamily: "'IBM Plex Sans', sans-serif" }}>✓ Save</button>
                            <button onClick={() => setEditingId(null)} style={{ padding: "5px 10px", background: "#f1f5f9", border: "1px solid #d0dae8", borderRadius: "6px", color: "#64748b", fontSize: "12px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif" }}>✕</button>
                          </>) : (
                            <button onClick={() => startEdit(m)} style={{ padding: "5px 12px", background: "#f1f5f9", border: "1px solid #d0dae8", borderRadius: "6px", color: "#1a2744", fontSize: "12px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif" }}>✏️ Edit</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              }
            </div>
          )}

          {tab === "Purchase Orders" && (<>
            <div style={s.card}>
              <div style={s.sectionTitle}>🛒 Place New Order</div>
              {medications.length === 0 ? <div style={s.emptyState}>Add medications first.</div> : <>
                <div style={s.grid2}>
                  <select style={s.select} value={orderForm.medId} onChange={e => setOrderForm(f => ({ ...f, medId: e.target.value }))}><option value="">-- Select Medication --</option>{medications.map(m => <option key={m.id} value={m.id}>{m.name} ({m.ndc})</option>)}</select>
                  <select style={s.select} value={orderForm.supplier} onChange={e => setOrderForm(f => ({ ...f, supplier: e.target.value }))}>{SUPPLIERS.map(s => <option key={s}>{s}</option>)}</select>
                  <input style={s.input} placeholder="Quantity" type="number" value={orderForm.quantity} onChange={e => setOrderForm(f => ({ ...f, quantity: e.target.value }))} />
                  <input style={s.input} placeholder="Price Per Unit ($)" type="number" step="0.01" value={orderForm.pricePerUnit} onChange={e => setOrderForm(f => ({ ...f, pricePerUnit: e.target.value }))} />
                  <input style={s.input} placeholder="PO Reference # (optional)" value={orderForm.orderRef} onChange={e => setOrderForm(f => ({ ...f, orderRef: e.target.value }))} />
                  <input style={s.input} placeholder="Notes (optional)" value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                {orderForm.quantity && orderForm.pricePerUnit && <div style={{ background: "#eef2f7", borderRadius: "8px", padding: "10px 14px", marginBottom: "12px", fontSize: "14px", color: "#a78bfa", fontWeight: "700" }}>Total: {fmtMoney(parseFloat(orderForm.quantity || 0) * parseFloat(orderForm.pricePerUnit || 0))}</div>}
                <button style={s.btn("#818cf8")} onClick={placeOrder}>📦 Place Order</button>
              </>}
            </div>
            <div style={s.card}>
              <div style={s.sectionTitle}>📋 All Orders</div>
              {orders.length === 0 ? <div style={s.emptyState}>No orders yet.</div> :
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={s.th}>Medication</th><th style={s.th}>Supplier</th><th style={s.th}>Qty</th><th style={s.th}>$/Unit</th><th style={s.th}>Total</th><th style={s.th}>Ref</th><th style={s.th}>Status</th><th style={s.th}>Action</th></tr></thead>
                  <tbody>{orders.map(o => (
                    <tr key={o.id}>
                      <td style={{ ...s.td, fontWeight: "600", color: "#1a2744" }}>{o.medName}<div style={{ fontSize: "11px", color: "#9aaac0" }}>{o.ndc}</div></td>
                      <td style={s.td}><SupplierBadge supplier={o.supplier} /></td>
                      <td style={s.td}>{fmt(o.quantity)}</td>
                      <td style={s.td}>{fmtMoney(o.pricePerUnit)}</td>
                      <td style={{ ...s.td, fontWeight: "700", color: "#a78bfa" }}>{fmtMoney(o.totalCost)}</td>
                      <td style={{ ...s.td, fontFamily: "monospace", fontSize: "11px", color: "#6b7fa3" }}>{o.orderRef || "—"}</td>
                      <td style={s.td}><OrderStatusBadge status={o.status} /></td>
                      <td style={s.td}>
                        {o.status === "Ordered" && <><button style={{ ...s.btn("#38bdf8"), padding: "5px 10px", fontSize: "11px", marginRight: "4px" }} onClick={() => updateOrderStatus(o.id, "Shipped")}>Shipped</button><button style={{ ...s.btn("#f87171"), padding: "5px 10px", fontSize: "11px" }} onClick={() => updateOrderStatus(o.id, "Cancelled")}>Cancel</button></>}
                        {o.status === "Shipped" && <button style={{ ...s.btn("#15803d"), padding: "5px 10px", fontSize: "11px" }} onClick={() => updateOrderStatus(o.id, "Received")}>✓ Received</button>}
                        {(o.status === "Received" || o.status === "Cancelled") && <span style={{ fontSize: "11px", color: "#9aaac0" }}>{o.dateReceived || o.status}</span>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              }
            </div>
          </>)}

          {tab === "🔫 Scan Station" && (
            <ScanStation medications={medications} setMedications={setMedications} setLog={setLog} notify={notify} />
          )}

          {tab === "Invoice Import" && (
            <PharmSaverImporter medications={medications} setMedications={setMedications} setLog={setLog} notify={notify} />
          )}

          {tab === "Receive Stock" && (
            <div style={s.card}>
              <div style={s.sectionTitle}>📦 Receive Untracked Stock</div>
              <div style={{ fontSize: "13px", color: "#6b7fa3", marginBottom: "14px" }}>For stock not placed as a Purchase Order. For PharmSaver shipments, use the 🤖 PharmSaver Import tab instead.</div>
              {medications.length === 0 ? <div style={s.emptyState}>Add medications first.</div> : <>
                <select style={s.select} value={receiveForm.medId} onChange={e => setReceiveForm(f => ({ ...f, medId: e.target.value }))}><option value="">-- Select Medication --</option>{medications.map(m => <option key={m.id} value={m.id}>{m.name} ({m.ndc}) — {fmt(m.quantity)} in stock</option>)}</select>
                <div style={s.grid2}>
                  <input style={s.input} placeholder="Quantity Received" type="number" value={receiveForm.quantity} onChange={e => setReceiveForm(f => ({ ...f, quantity: e.target.value }))} />
                  <input style={s.input} placeholder="Price Per Unit (optional)" type="number" step="0.01" value={receiveForm.pricePerUnit} onChange={e => setReceiveForm(f => ({ ...f, pricePerUnit: e.target.value }))} />
                  <select style={s.select} value={receiveForm.supplier} onChange={e => setReceiveForm(f => ({ ...f, supplier: e.target.value }))}>{SUPPLIERS.map(s => <option key={s}>{s}</option>)}</select>
                  <input style={s.input} placeholder="Staff Name" value={receiveForm.staff} onChange={e => setReceiveForm(f => ({ ...f, staff: e.target.value }))} />
                </div>
                <button style={s.btn("#2563eb")} onClick={receiveMed}>✓ Confirm Receipt</button>
              </>}
            </div>
          )}

          {tab === "Dispense" && (
            <div style={s.card}>
              <div style={s.sectionTitle}>💊 Dispense Medication</div>
              {medications.length === 0 ? <div style={s.emptyState}>Add medications first.</div> : <>
                <select style={s.select} value={dispenseForm.medId} onChange={e => setDispenseForm(f => ({ ...f, medId: e.target.value }))}><option value="">-- Select Medication --</option>{medications.map(m => <option key={m.id} value={m.id}>{m.name} ({m.ndc}) — {fmt(m.quantity)} in stock</option>)}</select>
                <div style={s.grid2}>
                  <input style={s.input} placeholder="Quantity to Dispense" type="number" value={dispenseForm.quantity} onChange={e => setDispenseForm(f => ({ ...f, quantity: e.target.value }))} />
                  <input style={s.input} placeholder="Staff Name" value={dispenseForm.staff} onChange={e => setDispenseForm(f => ({ ...f, staff: e.target.value }))} />
                </div>
                <input style={s.input} placeholder="Notes (optional — Rx #)" value={dispenseForm.notes} onChange={e => setDispenseForm(f => ({ ...f, notes: e.target.value }))} />
                <button style={s.btn("#dc2626")} onClick={dispenseMed}>↓ Confirm Dispense</button>
              </>}
            </div>
          )}

          {tab === "Activity Log" && (
            <div style={s.card}>
              <div style={s.sectionTitle}>📋 Full Activity Log</div>
              {log.length === 0 ? <div style={s.emptyState}>No activity yet.</div> :
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={s.th}>Type</th><th style={s.th}>Medication</th><th style={s.th}>NDC</th><th style={s.th}>Qty</th><th style={s.th}>Supplier</th><th style={s.th}>$/Unit</th><th style={s.th}>Total</th><th style={s.th}>Staff</th><th style={s.th}>Notes</th><th style={s.th}>Date</th></tr></thead>
                  <tbody>{log.map(e => (
                    <tr key={e.id}>
                      <td style={s.td}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "3px", background: e.type === "IN" ? "#dcfce7" : "#fce7f3", color: e.type === "IN" ? "#15803d" : "#be185d", padding: "4px 0", width: "54px", borderRadius: "99px", fontSize: "11px", fontWeight: "700", textAlign: "center", border: `1px solid ${e.type === "IN" ? "#bbf7d0" : "#fbcfe8"}` }}>{e.type === "IN" ? "↑ IN" : "↓ OUT"}</span></td>
                      <td style={{ ...s.td, fontWeight: "600", color: "#1a2744" }}>{e.medName}</td>
                      <td style={{ ...s.td, fontFamily: "monospace", fontSize: "11px", color: "#6b7fa3" }}>{e.ndc}</td>
                      <td style={{ ...s.td, fontWeight: "700", color: e.type === "IN" ? "#15803d" : "#be185d" }}>{e.type === "IN" ? "+" : "-"}{fmt(e.quantity)}</td>
                      <td style={s.td}>{e.supplier ? <SupplierBadge supplier={e.supplier} /> : "—"}</td>
                      <td style={s.td}>{e.pricePerUnit ? fmtMoney(e.pricePerUnit) : "—"}</td>
                      <td style={{ ...s.td, fontWeight: "700", color: "#a78bfa" }}>{e.totalCost ? fmtMoney(e.totalCost) : "—"}</td>
                      <td style={s.td}>{e.staff}</td>
                      <td style={{ ...s.td, fontSize: "12px", color: "#6b7fa3" }}>{e.notes || "—"}</td>
                      <td style={{ ...s.td, fontSize: "11px", color: "#9aaac0" }}>{e.date}</td>
                    </tr>
                  ))}</tbody>
                </table>
              }
            </div>
          )}

        </div>
      </div>
    </>
  );
}

