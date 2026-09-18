const esc = (v: unknown) =>
  String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const cell = (v: unknown, type: "String" | "Number" = "String", style = "Cell") =>
  `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
const mergedCell = (v: unknown, across: number, style = "Cell") =>
  `<Cell ss:MergeAcross="${across}" ss:StyleID="${style}"><Data ss:Type="String">${esc(v)}</Data></Cell>`;
const row = (cells: string[], height?: number) => `<Row${height ? ` ss:Height="${height}"` : ""}>${cells.join("")}</Row>`;
const address = (party: any) =>
  [party?.name, party?.address, party?.country, party?.phone && `TEL: ${party.phone}`, party?.email].filter(Boolean).join("\n");

export function downloadBatchInvoiceWorkbook(data: any) {
  const b = data.batch ?? {};
  const items = data.items ?? [];
  const adjustment = data.adjustment ?? {};
  const shipper = b.customs_shipper ?? {};
  const consignee = b.customs_consignee ?? {};
  const totalPackages = items.reduce((s: number, i: any) => s + Number(i.packages ?? 0), 0);
  const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity ?? 0), 0);
  const totalNet = items.reduce((s: number, i: any) => s + Number(i.net_weight_kg ?? 0), 0);
  const totalCbm = items.reduce((s: number, i: any) => s + Number(i.cbm ?? 0), 0);
  const totalValue = items.reduce((s: number, i: any) => s + Number(i.total_value_cad ?? 0), 0);
  const transport = String(b.shipping_method ?? "").toLowerCase().includes("air") ? "Air" : "Sea";
  const detailRows = items.map((i: any) => row([
    cell(i.packages, "Number", "Integer"), cell(i.quantity, "Number", "Integer"),
    cell(i.net_weight_kg, "Number", "Decimal"), cell(i.cbm, "Number", "Volume"), cell("piece"),
    cell(i.name_en), cell(i.material, "String", i.material === "REVIEW" ? "Review" : "Cell"),
    cell(i.hs_code), cell(i.origin || "China"), cell(i.unit_price_cad, "Number", "Money"),
    cell("CAD"), cell(i.total_value_cad, "Number", "Money"),
  ], 32));

  const rows = [
    row([mergedCell("COMMERCIAL INVOICE", 11, "Title")], 24),
    row([mergedCell("Vendor/Shipper/Exporter", 4, "Section"), cell(""), mergedCell("Ship Date", 1, "Label"), mergedCell(b.actual_ship_date ?? b.planned_ship_date, 3, "Value")]),
    row([mergedCell("Tax ID:", 1, "Label"), mergedCell(shipper.tax_id ?? "", 2, "Value"), cell(""), mergedCell("Mode of Transport", 1, "Label"), mergedCell(transport, 3, "Value")]),
    row([mergedCell("Contact Name", 1, "Label"), mergedCell(shipper.contact_name ?? "", 2, "Value"), cell(""), mergedCell("Tracking No.", 1, "Label"), mergedCell(b.batch_no, 3, "Value")]),
    row([mergedCell("Contact phone", 1, "Label"), mergedCell(shipper.phone ?? "", 2, "Value"), cell(""), mergedCell("Invoice No.:", 1, "Label"), mergedCell(b.batch_no, 3, "Value")]),
    row([mergedCell("Email", 1, "Label"), mergedCell(shipper.email ?? "", 2, "Value"), cell(""), mergedCell("Purchase Order No.:", 1, "Label"), mergedCell("", 3, "Value")]),
    row([mergedCell("Company Name", 1, "Label"), mergedCell(shipper.name ?? "", 2, "Value"), cell(""), mergedCell("Payment Terms:", 1, "Label"), mergedCell("", 3, "Value")]),
    row([mergedCell("Company address", 1, "Label"), mergedCell(shipper.address ?? "", 2, "Value"), cell(""), mergedCell("Shipping Term", 1, "Label"), mergedCell("", 3, "Value")], 34),
    row([mergedCell("Country/Territory", 1, "Label"), mergedCell(shipper.country ?? "China", 2, "Value"), cell(""), mergedCell("Bill of Lading:", 1, "Label"), mergedCell(b.vessel_no ?? "", 3, "Value")]),
    row([mergedCell("", 4, "Value"), cell(""), mergedCell("Purpose of Shipment", 1, "Label"), mergedCell("", 3, "Value")]),
    row([mergedCell("CONSIGNEE", 4, "Section"), cell(""), mergedCell("SOLD TO / IMPORTER (if different from Consignee):", 4, "Section")]),
    row([mergedCell(address(consignee), 4, "Party"), cell(""), mergedCell(address(consignee), 4, "Party")], 64),
    row(["QTY OF PACKAGE", "TOTAL QTY OF UNITS", "NET WEIGHT OF UNITS (KGS)", "CBM (VOLUME) OF UNITS", "UNIT OF MEASURE", "DESCRIPTION OF GOODS", "MATERIAL", "HS CODE", "COUNTRY OF ORIGIN", "UNIT VALUE", "CURRENCY OF VALUE", "TOTAL VALUE (QTY OF UNITS * UNIT VALUE)"].map((x) => cell(x, "String", "TableHeader")), 58),
    ...detailRows,
    row([cell(+totalPackages.toFixed(2), "Number", "Total"), cell(+totalQty.toFixed(0), "Number", "Total"), cell(+totalNet.toFixed(2), "Number", "Total"), cell(+totalCbm.toFixed(3), "Number", "Total"), cell(""), cell("TOTAL", "String", "Total"), cell(""), cell(""), cell(""), cell(""), cell("CAD", "String", "Total"), cell(+totalValue.toFixed(2), "Number", "TotalMoney")]),
    row([mergedCell("TOTAL PACKAGE", 1, "FooterLabel"), mergedCell("TOTAL NET WEIGHT", 1, "FooterLabel"), mergedCell("TOTAL GROSS WEIGHT", 1, "FooterLabel"), mergedCell("TOTAL CBM", 1, "FooterLabel"), mergedCell("HBL / CONTAINER", 3, "FooterLabel")]),
    row([mergedCell(+totalPackages.toFixed(2), 1, "FooterValue"), mergedCell(`${totalNet.toFixed(2)} kgs`, 1, "FooterValue"), mergedCell(`${Number(adjustment.target_gross_kg ?? b.hbl_total_weight_kg ?? 0).toFixed(2)} kgs`, 1, "FooterValue"), mergedCell(`${Number(adjustment.target_cbm ?? b.hbl_total_volume_m3 ?? 0).toFixed(3)} m³`, 1, "FooterValue"), mergedCell(b.container_no ?? "", 3, "FooterValue")]),
  ];

  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="9"/></Style>
    <Style ss:ID="Cell"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Title" ss:Parent="Cell"><Font ss:Bold="1" ss:Size="16"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style><Style ss:ID="Section" ss:Parent="Cell"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Label" ss:Parent="Cell"><Font ss:Bold="1"/></Style><Style ss:ID="Value" ss:Parent="Cell"/><Style ss:ID="Party" ss:Parent="Cell"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
    <Style ss:ID="TableHeader" ss:Parent="Cell"><Font ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style><Style ss:ID="Review" ss:Parent="Cell"><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Integer" ss:Parent="Cell"><NumberFormat ss:Format="0"/></Style><Style ss:ID="Decimal" ss:Parent="Cell"><NumberFormat ss:Format="0.00"/></Style><Style ss:ID="Volume" ss:Parent="Cell"><NumberFormat ss:Format="0.000"/></Style><Style ss:ID="Money" ss:Parent="Cell"><NumberFormat ss:Format="0.00"/></Style>
    <Style ss:ID="Total" ss:Parent="Cell"><Font ss:Bold="1"/><NumberFormat ss:Format="0.00"/></Style><Style ss:ID="TotalMoney" ss:Parent="Total"><NumberFormat ss:Format="0.00"/></Style><Style ss:ID="FooterLabel" ss:Parent="Cell"><Font ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:WrapText="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style><Style ss:ID="FooterValue" ss:Parent="Cell"><Font ss:Bold="1"/><Alignment ss:Horizontal="Center"/></Style>
  </Styles><Worksheet ss:Name="CI"><Table><Column ss:Width="65"/><Column ss:Width="72"/><Column ss:Width="85"/><Column ss:Width="80"/><Column ss:Width="90"/><Column ss:Width="210"/><Column ss:Width="115"/><Column ss:Width="105"/><Column ss:Width="82"/><Column ss:Width="78"/><Column ss:Width="82"/><Column ss:Width="105"/>${rows.join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>13</SplitHorizontal><TopRowBottomPane>13</TopRowBottomPane><DoNotDisplayGridlines/></WorksheetOptions></Worksheet></Workbook>`;
  const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${b.batch_no ?? "batch"}_Invoice_and_Packing_List.xls`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
