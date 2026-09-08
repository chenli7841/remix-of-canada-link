// Client-side "download as PDF" for a DOM node — snapshots it to a canvas and
// lays that image across real A4 page(s) (matching InvoiceDocument's own
// `w-[210mm]` + `@page { size: A4 }`, so what's on screen, what prints, and
// what downloads are all the same page size). No server round trip; slices
// the canvas into one A4-page-height chunk per PDF page when content runs
// past a single page — good enough for invoice-length documents.
export async function downloadElementAsPdf(el: HTMLElement, filename: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();

  const imgWidthMm = pageWidthMm;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  if (imgHeightMm <= pageHeightMm) {
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgWidthMm, imgHeightMm);
  } else {
    // Slice the (taller-than-one-page) canvas into A4-height chunks, one PDF
    // page per chunk, instead of squashing everything onto a single giant page.
    const pageHeightPx = Math.floor((pageHeightMm * canvas.width) / imgWidthMm);
    let renderedPx = 0;
    let first = true;
    while (renderedPx < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceHeightPx;
      const ctx = slice.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
      const sliceHeightMm = (sliceHeightPx * imgWidthMm) / canvas.width;
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, imgWidthMm, sliceHeightMm);
      renderedPx += sliceHeightPx;
      first = false;
    }
  }

  pdf.save(filename);
}
