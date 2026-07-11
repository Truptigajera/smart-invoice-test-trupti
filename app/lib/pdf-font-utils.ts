// Font utilities for @react-pdf/renderer — safe to import in both client and server bundles.
// Font REGISTRATION (which needs Node's `path`) lives in pdf.server.ts, not here.
//
// NotoSans is the default because Helvetica/Times/Courier lack the ₹ (U+20B9) glyph;
// they fall back to ¹ (U+00B9, Latin-1 superscript 1).

export interface PdfFonts {
  base: string;
  bold: string;
  boldItalic: string;
}

export function getPdfFonts(fontFamily: string): PdfFonts {
  switch (fontFamily) {
    case "Times-Roman":
      return { base: "Times-Roman", bold: "Times-Bold", boldItalic: "Times-BoldItalic" };
    case "Courier":
      return { base: "Courier", bold: "Courier-Bold", boldItalic: "Courier-BoldOblique" };
    case "Helvetica":
    // Helvetica doesn't include ₹ — redirect to NotoSans so all existing shops get the fix.
    // eslint-disable-next-line no-fallthrough
    default:
      // "NotoSans", "Inter", or any unrecognised value → NotoSans (registered in pdf.server.ts).
      return { base: "NotoSans", bold: "NotoSans-Bold", boldItalic: "NotoSans-BoldItalic" };
  }
}
