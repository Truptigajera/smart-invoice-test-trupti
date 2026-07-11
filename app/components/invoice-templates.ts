import { InvoicePDFTemplate } from "./InvoicePDFTemplate";
import { InvoicePDFTemplate2 } from "./InvoicePDFTemplate2";
import { InvoicePDFTemplate3 } from "./InvoicePDFTemplate3";
import { InvoicePDFTemplate4 } from "./InvoicePDFTemplate4";
import { InvoicePDFTemplate5 } from "./InvoicePDFTemplate5";
import { InvoicePDFTemplate6 } from "./InvoicePDFTemplate6";
import { InvoicePDFTemplate7 } from "./InvoicePDFTemplate7";
import { InvoicePDFTemplate8 } from "./InvoicePDFTemplate8";
import { InvoicePDFTemplate9 } from "./InvoicePDFTemplate9";
import { InvoicePDFTemplate10 } from "./InvoicePDFTemplate10";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TemplateComponent = (props: any) => any;

const TEMPLATE_MAP: Record<string, TemplateComponent> = {
  "template-1": InvoicePDFTemplate,
  "template-2": InvoicePDFTemplate2,
  "template-3": InvoicePDFTemplate3,
  "template-4": InvoicePDFTemplate4,
  "template-5": InvoicePDFTemplate5,
  "template-6": InvoicePDFTemplate6,
  "template-7": InvoicePDFTemplate7,
  "template-8": InvoicePDFTemplate8,
  "template-9": InvoicePDFTemplate9,
  "template-10": InvoicePDFTemplate10,
};

export function getInvoiceTemplate(templateId: string): TemplateComponent {
  return TEMPLATE_MAP[templateId] ?? InvoicePDFTemplate;
}

export const TEMPLATES_META = [
  {
    id: "template-1",
    name: "Classic",
    description: "Clean blue design with alternating rows and rounded sections.",
    primaryColor: "#1a73e8",
    bgColor: "#E8F0FE",
  },
  {
    id: "template-2",
    name: "Bold",
    description: "Dark charcoal header with orange accents — high-contrast professional.",
    primaryColor: "#1C1C1E",
    bgColor: "#F5F5F5",
    accentColor: "#FF6B35",
  },
  {
    id: "template-3",
    name: "Sharp",
    description: "Deep teal with sharp edges and left-border sections.",
    primaryColor: "#00695C",
    bgColor: "#E0F2F1",
  },
  {
    id: "template-4",
    name: "Celestial",
    description: "Royal purple with accent stripes — premium elegant look.",
    primaryColor: "#4527A0",
    bgColor: "#EDE7F6",
  },
  {
    id: "template-5",
    name: "Oasis",
    description: "Warm terracotta tones — friendly and inviting.",
    primaryColor: "#BF360C",
    bgColor: "#FBE9E7",
  },
  {
    id: "template-6",
    name: "Orbix",
    description: "Dark navy ultra-minimal — precise and tech-forward.",
    primaryColor: "#0D2035",
    bgColor: "#ECEFF1",
  },
  {
    id: "template-7",
    name: "Ember",
    description: "Orange/amber accents, outer-bordered layout with 3-column address table.",
    primaryColor: "#E07B30",
    bgColor: "#FFF3E8",
  },
  {
    id: "template-8",
    name: "Ledger",
    description: "Formal accounting layout with HSN/SAC tax summary table — dark borders.",
    primaryColor: "#1A1A1A",
    bgColor: "#F7F7F7",
  },
  {
    id: "template-9",
    name: "Harvest",
    description: "Golden amber table headers, shop name large top-left, thank-you footer.",
    primaryColor: "#C8920A",
    bgColor: "#F9F1DC",
  },
  {
    id: "template-10",
    name: "Clarity",
    description: "Bordered layout, shop name centered, 3-column address, computer-generated notice.",
    primaryColor: "#E07B30",
    bgColor: "#FFF3E8",
  },
];
