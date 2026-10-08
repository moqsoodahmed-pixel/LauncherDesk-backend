const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * pdfkit's built-in core-14 fonts (Helvetica etc.) are AFM/WinAnsi-encoded
 * and do NOT include U+20B9 (Rupee sign) - it silently renders as a
 * mismatched glyph rather than failing loudly, which would corrupt every
 * amount on the invoice. No open-licensed Unicode font with this glyph
 * ships with this project (none was available to source in this
 * environment, and Windows' bundled Arial - which does have it - is a
 * licensed Microsoft font, not something to commit into the repository).
 * Rather than embed a font without a clear right to redistribute it, or
 * silently render a broken glyph, this tries known-good system font
 * locations at runtime (present on this Windows dev machine, and on Linux
 * servers with fontconfig's dejavu/noto packages installed) and falls back
 * to the ASCII-safe "Rs." if none exist - correct on every platform,
 * degrading gracefully rather than corrupting.
 */
const UNICODE_REGULAR_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
];
const UNICODE_BOLD_CANDIDATES = [
  'C:/Windows/Fonts/arialbd.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/noto/NotoSans-Bold.ttf',
];
const UNICODE_REGULAR_PATH = UNICODE_REGULAR_CANDIDATES.find((p) => fs.existsSync(p)) || null;
const UNICODE_BOLD_PATH = UNICODE_BOLD_CANDIDATES.find((p) => fs.existsSync(p)) || null;
const HAS_UNICODE_FONT = Boolean(UNICODE_REGULAR_PATH);

const RUPEE = HAS_UNICODE_FONT ? '\u20b9' : 'Rs. ';
const FONT_REGULAR = HAS_UNICODE_FONT ? 'Unicode' : 'Helvetica';
const FONT_BOLD = HAS_UNICODE_FONT && UNICODE_BOLD_PATH ? 'Unicode-Bold' : (HAS_UNICODE_FONT ? 'Unicode' : 'Helvetica-Bold');
const FONT_ITALIC = 'Helvetica-Oblique'; // footer note only, never carries a rupee sign

/**
 * Pixel-accurate re-implementation of the uploaded canonical invoice
 * (DutyLaunch_Invoice_Jacobella_Parfum.pdf) + canonical letterhead
 * (LAUNCHER DESK LETTER HEAD.pdf/.png). Every coordinate below was measured
 * directly off those two files with pdfplumber (word-level bounding boxes)
 * and PyMuPDF (embedded image positions for the seal/signature) - this is
 * not a redesign, it is the same layout with dynamic values poured into the
 * same positions the original document used. Do not "improve" spacing/
 * fonts/alignment here without re-measuring the canonical files first.
 *
 * Page size matches the canonical PDF exactly: 595.32 x 841.92 pt (~A4).
 * pdfkit's y-axis, like pdfplumber's `top`, is measured from the TOP of the
 * page, so the measured coordinates are used directly, unconverted.
 */

const PAGE_WIDTH = 595.32;
const PAGE_HEIGHT = 841.92;

const ASSETS_DIR = path.join(__dirname, '../../assets/invoice');
const LETTERHEAD_PNG = path.join(ASSETS_DIR, 'letterhead.png');
const SEAL_PNG = path.join(ASSETS_DIR, 'seal.png');
const SIGNATURE_PNG = path.join(ASSETS_DIR, 'signature.png');

// Seal/signature bounding boxes, measured exactly off the canonical PDF
// (PyMuPDF page.get_images() positions for xref 22 and xref 24).
const SEAL_BOX = { x: 410.55, y: 475.99, width: 75.75, height: 78.0 };
const SIGNATURE_BOX = { x: 500.42, y: 477.5, width: 57.75, height: 75.0 };

// Indian digit grouping (2,199.00 not 2199.00), matching the canonical PDF exactly.
const INR = (minor) => (minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drawHeader(doc, { sellerName, invoiceNumber }) {
  doc.font(FONT_BOLD).fontSize(14).fillColor('#1a1a1a');
  doc.text('Tax Invoice', 0, 115.5, { width: PAGE_WIDTH, align: 'center' });

  doc.font(FONT_BOLD).fontSize(9.5);
  doc.text(`Sold By: ${sellerName}`, 29, 143.1);

  // Dashed box around the invoice number, matching the canonical PDF's
  // dotted rule at x 371-569.5, y 136.6-158.2.
  doc.save();
  doc.dash(1.5, { space: 1.5 }).lineWidth(0.72).rect(371.1, 136.6, 198.4, 21.6).stroke('#000000');
  doc.undash();
  doc.restore();
  doc.font(FONT_BOLD).fontSize(9).text('Invoice Number # ', 402.6, 142.8, { continued: true });
  doc.font(FONT_REGULAR).text(invoiceNumber, { continued: false });

  // Thin divider under the Sold-By row, matching the canonical rect at y 175.1-176.1.
  doc.rect(24.6, 175.1, PAGE_WIDTH - 24.6 - 24.3, 1.0).fill('#000000');
}

function drawBillTo(doc, { invoiceDate, customerName, totalItems }) {
  doc.font(FONT_BOLD).fontSize(9).fillColor('#1a1a1a');
  doc.text('Invoice Date: ', 29, 185.1, { continued: true });
  doc.font(FONT_REGULAR).text(invoiceDate, { continued: false });

  doc.font(FONT_BOLD).text('Bill To', 189.1, 185.3);
  doc.font(FONT_BOLD).fontSize(9.5).text(customerName, 189.1, 198.1, { width: 220 });

  doc.font(FONT_BOLD).fontSize(9).text('Total items: ', 26, 223.7, { continued: true });
  doc.font(FONT_REGULAR).text(String(totalItems), { continued: false });
}

// Column x-positions measured directly off the canonical table header row
// (y 240.3) and its thin vertical dividers (rects at these x values).
const COLS = {
  product: 29,
  qty: 245.4,
  gross: { label: 280.5, valueRight: 316 },
  discount: { label: 326.1, valueRight: 364 },
  taxable: { label: 383.7, valueRight: 414.3 },
  sgst: { label: 436.1, valueRight: 459.5 },
  cgst: { label: 480.0, valueRight: 503.5 },
  total: { label: 539.4, valueRight: 566.4 },
};

function drawTableHeader(doc) {
  doc.font(FONT_BOLD).fontSize(8.5).fillColor('#1a1a1a');
  doc.text('Product', COLS.product, 240.3);
  doc.text('Title', 94.0, 240.3);
  doc.text('Qty', COLS.qty, 240.3);
  doc.text('Gross', COLS.gross.label, 240.3);
  doc.text(`Amount ${RUPEE}`, COLS.gross.label, 251.9);
  doc.text('Discounts', COLS.discount.label, 240.3);
  doc.text(`/Coupons ${RUPEE}`, COLS.discount.label, 251.9);
  doc.text('Taxable', COLS.taxable.label, 240.3);
  doc.text(`Value ${RUPEE}`, COLS.taxable.label, 251.9);
  doc.text('SGST', COLS.sgst.label, 240.3);
  doc.text(`/UTGST ${RUPEE}`, COLS.sgst.label, 251.9);
  doc.text(`CGST ${RUPEE}`, COLS.cgst.label, 251.9);
  doc.text(`Total ${RUPEE}`, COLS.total.label, 240.3);
  // Underline below the header row, matching the canonical rect at y 235.3-236.3.
  doc.rect(26, 235.3, 540.4, 1.0).fill('#000000');
}

function rightText(doc, text, rightEdge, y) {
  doc.text(text, rightEdge - 120, y, { width: 120, align: 'right' });
}

/**
 * One row per line item. `items` shape matches billingSnapshot:
 * { sac, description, qty, grossMinor, discountMinor, taxableMinor, sgstMinor, cgstMinor, totalMinor }
 */
function drawLineItems(doc, items, startY) {
  let y = startY;
  for (const item of items) {
    doc.font(FONT_REGULAR).fontSize(8).fillColor('#1a1a1a').text(`SAC: ${item.sac}`, 29, y);
    doc.font(FONT_BOLD).fontSize(8.5).text(item.description, 94, y, { width: 140 });
    doc.font(FONT_REGULAR).fontSize(8.5);
    doc.text(String(item.qty), COLS.qty, y);
    rightText(doc, INR(item.grossMinor), COLS.gross.valueRight, y);
    rightText(doc, INR(item.discountMinor), COLS.discount.valueRight, y);
    rightText(doc, INR(item.taxableMinor), COLS.taxable.valueRight, y);
    rightText(doc, INR(item.sgstMinor), COLS.sgst.valueRight, y);
    rightText(doc, INR(item.cgstMinor), COLS.cgst.valueRight, y);
    rightText(doc, INR(item.totalMinor), COLS.total.valueRight, y);
    y += 26.8; // matches the canonical row pitch (285.0 -> 311.8 -> 338.7)
  }
  return y;
}

function drawGstNote(doc, { gstPercentage, taxableMinor, sgstMinor, cgstMinor, gstTotalMinor }, y) {
  doc.font(FONT_BOLD).fontSize(8.5).fillColor('#1a1a1a').text(`GST @ ${gstPercentage}%`, 94, y);
  rightText(doc, INR(sgstMinor), COLS.sgst.valueRight, y);
  rightText(doc, INR(cgstMinor), COLS.cgst.valueRight, y);
  rightText(doc, INR(gstTotalMinor), COLS.total.valueRight, y);
  doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#444444');
  doc.text(`SGST/UTGST ${gstPercentage / 2}% + CGST ${gstPercentage / 2}% on ${RUPEE}${INR(taxableMinor)}`, 94, y + 14.1);
  doc.fillColor('#1a1a1a');
}

function drawTotalsRow(doc, { totalItems, grossMinor, discountMinor, taxableMinor, sgstMinor, cgstMinor, totalMinor }, y) {
  doc.font(FONT_BOLD).fontSize(9).fillColor('#1a1a1a');
  doc.text('Total', 215.3, y);
  doc.text(String(totalItems), COLS.qty, y);
  rightText(doc, INR(grossMinor), COLS.gross.valueRight, y);
  rightText(doc, INR(discountMinor), COLS.discount.valueRight, y);
  rightText(doc, INR(taxableMinor), COLS.taxable.valueRight, y);
  rightText(doc, INR(sgstMinor), COLS.sgst.valueRight, y);
  rightText(doc, INR(cgstMinor), COLS.cgst.valueRight, y);
  rightText(doc, INR(totalMinor), COLS.total.valueRight, y);
}

function drawGrandTotal(doc, grandTotalMinor) {
  doc.font(FONT_BOLD).fontSize(11).fillColor('#1a1a1a');
  doc.text('Grand Total', 421.1, 443.1);
  doc.text(`${RUPEE} ${INR(grandTotalMinor)}`, 495, 442.3, { width: 74.4, align: 'right' });
}

function drawSignatureBlock(doc, { payeeName }) {
  doc.font(FONT_BOLD).fontSize(8.5).fillColor('#1a1a1a');
  doc.text(payeeName, 390, 461.4, { width: 179.4, align: 'right' });

  if (fs.existsSync(SEAL_PNG)) {
    doc.image(SEAL_PNG, SEAL_BOX.x, SEAL_BOX.y, { width: SEAL_BOX.width, height: SEAL_BOX.height });
  }
  if (fs.existsSync(SIGNATURE_PNG)) {
    doc.image(SIGNATURE_PNG, SIGNATURE_BOX.x, SIGNATURE_BOX.y, { width: SIGNATURE_BOX.width, height: SIGNATURE_BOX.height });
  }

  doc.font(FONT_REGULAR).fontSize(9);
  doc.text('Authorized Signatory', 478.3, 561.0);
}

function drawFooterNote(doc, { thankYou, terms }) {
  doc.font(FONT_ITALIC).fontSize(7.5).fillColor('#444444');
  if (thankYou) doc.text(thankYou, 29, 580, { width: 400 });
  if (terms) doc.text(terms, 29, 592, { width: 500 });
  doc.fillColor('#1a1a1a');

  doc.rect(24.6, 617.0, PAGE_WIDTH - 24.6 - 24.3, 0.72).fill('#000000');
  doc.font(FONT_REGULAR).fontSize(8);
  doc.text('E. & O.E.', 486.3, 619.3);
  doc.text('page 1 of 1', 529.2, 619.3);
}

/**
 * Builds the full invoice PDF as a Buffer. `data` shape:
 * {
 *   invoiceNumber, invoiceDate, sellerName, payeeName,
 *   customerName, totalItems, items: [...], totals: {...}, gst: {...},
 *   grandTotalMinor, thankYou, terms
 * }
 */
function generateInvoicePdfBuffer(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
      if (HAS_UNICODE_FONT) {
        doc.registerFont('Unicode', UNICODE_REGULAR_PATH);
        if (UNICODE_BOLD_PATH) doc.registerFont('Unicode-Bold', UNICODE_BOLD_PATH);
      }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // The canonical letterhead - logo, watermark, footer banner - drawn
      // as the full-page background FIRST, exactly as the original
      // document does (see page.images in the canonical PDF: the
      // letterhead is itself one full-page background image, with text
      // and the seal/signature drawn on top of it).
      doc.image(LETTERHEAD_PNG, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });

      drawHeader(doc, data);
      drawBillTo(doc, { ...data, totalItems: data.totalItems ?? data.totals?.totalItems });
      drawTableHeader(doc);
      const afterItemsY = drawLineItems(doc, data.items, 285.0);
      drawGstNote(doc, data.gst, afterItemsY + 1.1);
      drawTotalsRow(doc, data.totals, afterItemsY + 46.0);
      drawGrandTotal(doc, data.grandTotalMinor);
      drawSignatureBlock(doc, data);
      drawFooterNote(doc, data);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInvoicePdfBuffer, PAGE_WIDTH, PAGE_HEIGHT, HAS_UNICODE_FONT };
