import crypto from "crypto";
import { prisma } from "~/db.server";

const SANDBOX_URL = "https://einvoice1-uat.nic.in";
const PROD_URL    = "https://einvoice1.nic.in";

type Creds = {
  username:     string;
  password:     string;
  clientId:     string;
  clientSecret: string;
  gstin:        string;
  sandbox:      boolean;
};

// AES-256-ECB — NIC uses ECB (no IV)
function aesEncrypt(plaintext: string, key: Buffer): string {
  const cipher = crypto.createCipheriv("aes-256-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

function aesDecryptBuf(base64: string, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(Buffer.from(base64, "base64")), decipher.final()]);
}

// Authenticate → returns AuthToken and decrypted SessionKey (raw 32 bytes)
async function nicAuth(creds: Creds): Promise<{ authToken: string; sessionKey: Buffer }> {
  const base = creds.sandbox ? SANDBOX_URL : PROD_URL;
  const appKey = crypto.randomBytes(32);

  const res = await fetch(`${base}/eivital/v1.04/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      gstin:         creds.gstin,
      user_name:     creds.username,
    },
    body: JSON.stringify({
      UserName:               creds.username,
      Password:               creds.password,
      AppKey:                 appKey.toString("base64"),
      ForceRefreshAccessToken: false,
    }),
  });

  const json = await res.json() as any;
  if (json.Status !== 1) {
    const msg = json.ErrorDetails?.[0]?.ErrorMessage ?? json.message ?? "NIC auth failed";
    throw new Error(msg);
  }

  // SessionKey from NIC is AES-256-ECB encrypted with our appKey
  const sessionKey = aesDecryptBuf(json.Data.SessionKey, appKey);
  return { authToken: json.Data.AuthToken, sessionKey };
}

// ── Invoice JSON builder (NIC format) ────────────────────────────────────────

function ddmmyyyy(d: Date): string {
  const dd  = String(d.getDate()).padStart(2, "0");
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function buildNICJson(invoice: any, shop: any): object {
  const isIGST = invoice.taxType === "IGST";
  const docTyp = invoice.invoiceType === "CREDIT_NOTE" ? "CRN" : "INV";

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch:     "GST",
      SupTyp:     invoice.supplyType === "B2B" ? "B2B" : "B2C",
      RegRev:     invoice.reverseCharge ? "Y" : "N",
      EcmGstin:   null,
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: docTyp,
      No:  invoice.invoiceNumber,
      Dt:  ddmmyyyy(new Date(invoice.invoiceDate)),
    },
    SellerDtls: {
      Gstin: shop.gstin,
      LglNm: shop.businessName || shop.shopDomain,
      TrdNm: shop.businessName || shop.shopDomain,
      Addr1: shop.address || ".",
      Addr2: null,
      Loc:   shop.city || shop.state || ".",
      Pin:   parseInt(shop.pincode || "0") || 0,
      Stcd:  shop.stateCode || "0",
      Ph:    shop.phone  || null,
      Em:    shop.email  || null,
    },
    BuyerDtls: {
      Gstin: invoice.buyerGstin || "URP",
      LglNm: invoice.buyerName  || "Consumer",
      TrdNm: invoice.buyerName  || "Consumer",
      Pos:   invoice.buyerStateCode || invoice.placeOfSupply || "0",
      Addr1: invoice.buyerAddress   || ".",
      Addr2: null,
      Loc:   invoice.buyerCity || invoice.buyerState || ".",
      Pin:   parseInt(invoice.buyerPincode || "0") || 0,
      Stcd:  invoice.buyerStateCode || "0",
      Ph:    invoice.buyerPhone || null,
      Em:    invoice.buyerEmail || null,
    },
    ItemList: invoice.lineItems.map((item: any, i: number) => ({
      SlNo:                  String(i + 1),
      PrdDesc:               item.productName + (item.variantName ? ` - ${item.variantName}` : ""),
      IsServc:               "N",
      HsnCd:                 item.hsnCode || item.sacCode || "9999",
      Qty:                   item.quantity,
      FreeQty:               0,
      Unit:                  item.unit || "NOS",
      UnitPrice:             item.unitPrice,
      TotAmt:                +(item.quantity * item.unitPrice).toFixed(2),
      Discount:              item.discount || 0,
      AssAmt:                item.taxableValue,
      GstRt:                 isIGST ? item.igstRate : (item.cgstRate + item.sgstRate),
      IgstAmt:               isIGST ? item.igstAmount  : 0,
      CgstAmt:               isIGST ? 0 : item.cgstAmount,
      SgstAmt:               isIGST ? 0 : item.sgstAmount,
      CesRt:                 0, CesAmt: 0, CesNonAdvlAmt: 0,
      StateCesRt:            0, StateCesAmt: 0, StateCesNonAdvlAmt: 0,
      OthChrg:               0,
      TotItemVal:            item.totalAmount,
    })),
    ValDtls: {
      AssVal:    invoice.taxableAmount,
      CgstVal:   invoice.cgstAmount,
      SgstVal:   invoice.sgstAmount,
      IgstVal:   invoice.igstAmount,
      CesVal:    0, StCesVal: 0,
      Discount:  invoice.discountAmount,
      OthChrg:   0, RndOffAmt: 0,
      TotInvVal: invoice.totalAmount,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateIRN(invoiceId: string, shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: { settings: true },
  });

  if (!shop?.settings?.eInvoiceEnabled)
    throw new Error("E-Invoice is not enabled. Configure NIC IRP credentials in Settings → E-Invoice.");
  if (!shop.gstin)
    throw new Error("GSTIN is not configured. Please set it in Settings.");

  const s = shop.settings;
  if (!s.eInvoiceApiUser || !s.eInvoiceApiPass || !s.eInvoiceClientId || !s.eInvoiceClientSecret)
    throw new Error("E-Invoice credentials are incomplete. Check Settings → E-Invoice API.");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.irn) throw new Error("E-Invoice already generated for this invoice.");

  const creds: Creds = {
    username:     s.eInvoiceApiUser,
    password:     s.eInvoiceApiPass,
    clientId:     s.eInvoiceClientId,
    clientSecret: s.eInvoiceClientSecret,
    gstin:        shop.gstin,
    sandbox:      s.eInvoiceSandbox,
  };

  const base = creds.sandbox ? SANDBOX_URL : PROD_URL;
  const { authToken, sessionKey } = await nicAuth(creds);

  const nicJson    = buildNICJson(invoice, shop);
  const encrypted  = aesEncrypt(JSON.stringify(nicJson), sessionKey);

  const res = await fetch(`${base}/eicore/v1.03/Invoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      gstin:         creds.gstin,
      user_name:     creds.username,
      AuthToken:     authToken,
    },
    body: JSON.stringify({ Data: encrypted }),
  });

  const raw = await res.json() as any;
  if (raw.Status !== 1) {
    const msg = raw.ErrorDetails?.[0]?.ErrorMessage ?? raw.message ?? "IRN generation failed";
    throw new Error(`NIC IRP: ${msg}`);
  }

  const data = JSON.parse(aesDecryptBuf(raw.Data, sessionKey).toString("utf8"));
  const { Irn, AckNo, AckDt, SignedQRCode } = data;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      irn:       Irn,
      irnStatus: "GENERATED",
      ackNo:     String(AckNo),
      ackDate:   AckDt,
      qrCode:    SignedQRCode,
    },
  });

  return { irn: Irn, ackNo: String(AckNo), ackDate: AckDt };
}

export async function cancelIRN(
  invoiceId: string,
  shopId:    string,
  reason:    string,   // "1"=Duplicate "2"=Data error "3"=Order cancelled "4"=Other
  remark:    string,
) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: { settings: true },
  });

  if (!shop?.settings?.eInvoiceEnabled || !shop.gstin)
    throw new Error("E-Invoice not configured.");

  const s = shop.settings;
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });

  if (!invoice?.irn)           throw new Error("No IRN found for this invoice.");
  if (invoice.irnStatus === "CANCELLED") throw new Error("IRN already cancelled.");

  const creds: Creds = {
    username:     s.eInvoiceApiUser!,
    password:     s.eInvoiceApiPass!,
    clientId:     s.eInvoiceClientId!,
    clientSecret: s.eInvoiceClientSecret!,
    gstin:        shop.gstin,
    sandbox:      s.eInvoiceSandbox,
  };

  const base = creds.sandbox ? SANDBOX_URL : PROD_URL;
  const { authToken, sessionKey } = await nicAuth(creds);

  const payload   = { Irn: invoice.irn, CnlRsn: reason, CnlRem: remark };
  const encrypted = aesEncrypt(JSON.stringify(payload), sessionKey);

  const res = await fetch(`${base}/eicore/v1.03/Invoice/Cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      gstin:         creds.gstin,
      user_name:     creds.username,
      AuthToken:     authToken,
    },
    body: JSON.stringify({ Data: encrypted }),
  });

  const raw = await res.json() as any;
  if (raw.Status !== 1) {
    const msg = raw.ErrorDetails?.[0]?.ErrorMessage ?? "Cancellation failed";
    throw new Error(`NIC IRP: ${msg}`);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { irnStatus: "CANCELLED" },
  });
}
