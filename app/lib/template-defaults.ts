// Default starter Liquid+HTML template for the Code Editor
// Plain string — safe to import on client or server
export const DEFAULT_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #222; padding: 20px; }
  h1 { font-size: 18pt; text-align: center; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #666; font-size: 8pt; margin-bottom: 16px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 16px; }
  .header-left img.logo { max-width: 120px; max-height: 60px; object-fit: contain; margin-bottom: 6px; }
  .company-name { font-size: 13pt; font-weight: bold; }
  .company-detail { font-size: 8pt; color: #555; margin-top: 2px; }
  .header-right { text-align: right; }
  .inv-title { font-size: 20pt; font-weight: bold; color: #1a237e; }
  .inv-meta { font-size: 8pt; color: #555; margin-top: 3px; }
  .address-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .address-table td { padding: 8px 10px; vertical-align: top; border: 1px solid #ddd; width: 50%; }
  .address-table .section-title { font-size: 7.5pt; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 5px; }
  .address-table .addr-name { font-size: 10pt; font-weight: bold; margin-bottom: 3px; }
  .address-table .addr-line { font-size: 8.5pt; color: #444; margin-bottom: 2px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 8.5pt; }
  table.items thead tr { background: #1a237e; color: #fff; }
  table.items th { padding: 5px 4px; text-align: right; font-weight: normal; font-size: 7.5pt; }
  table.items th:first-child { text-align: left; }
  table.items td { padding: 4px; border-bottom: 1px solid #e0e0e0; text-align: right; vertical-align: top; }
  table.items td:first-child { text-align: left; }
  table.items tfoot td { font-weight: bold; border-top: 2px solid #1a237e; }
  tr.alt { background: #f5f5f5; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 14px; }
  .totals-box { width: 240px; }
  .totals-row { display: flex; justify-content: space-between; padding: 3px 6px; font-size: 8.5pt; }
  .totals-row.grand { background: #1a237e; color: #fff; font-weight: bold; padding: 6px; font-size: 10pt; margin-top: 4px; }
  .footer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 8px; display: flex; justify-content: space-between; font-size: 7.5pt; color: #888; }
  .in-words { font-size: 8pt; font-style: italic; color: #555; margin-bottom: 14px; padding: 6px; background: #f9f9f9; border-radius: 3px; }
  .signature-area { text-align: right; margin-bottom: 20px; }
  .signature-area img { max-width: 100px; max-height: 40px; object-fit: contain; }
  .signature-area p { font-size: 7.5pt; color: #777; margin-top: 3px; }
  .copy-badge { display: inline-block; background: #e8eaf6; color: #1a237e; font-size: 7.5pt; font-weight: bold; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
</style>
</head>
<body>

<h1>
  {% if invoice.type == 'CREDIT_NOTE' %}Credit Note{% else %}Tax Invoice{% endif %}
  <span class="copy-badge">{{ invoice.copyType }}</span>
</h1>
<div class="subtitle">{{ invoice.supplyType }} · {% if invoice.isIGST %}IGST (Inter-State){% else %}CGST + SGST (Intra-State){% endif %}</div>

<div class="header">
  <div class="header-left">
    {% if shop.logoUrl != '' %}<img class="logo" src="{{ shop.logoUrl }}">{% endif %}
    <div class="company-name">{{ shop.name }}</div>
    {% if shop.gstin != '' %}<div class="company-detail">GSTIN: {{ shop.gstin }}</div>{% endif %}
    {% if shop.address != '' %}<div class="company-detail">{{ shop.address }}, {{ shop.city }}</div>{% endif %}
    {% if shop.state != '' %}<div class="company-detail">{{ shop.state }} - {{ shop.pincode }}</div>{% endif %}
    {% if shop.phone != '' %}<div class="company-detail">Ph: {{ shop.phone }}</div>{% endif %}
  </div>
  <div class="header-right">
    <div class="inv-title">#{{ invoice.number }}</div>
    <div class="inv-meta">Date: {{ invoice.dateFormatted }}</div>
    <div class="inv-meta">Order: {{ invoice.orderName }}</div>
    <div class="inv-meta">Place of Supply: {{ invoice.placeOfSupply }}</div>
    {% if invoice.reverseCharge %}<div class="inv-meta" style="color:#e53935;">Reverse Charge Applicable</div>{% endif %}
  </div>
</div>

<table class="address-table">
  <tr>
    <td>
      <div class="section-title">Billed To</div>
      <div class="addr-name">{{ buyer.name }}</div>
      {% if buyer.company != '' %}<div class="addr-line">{{ buyer.company }}</div>{% endif %}
      {% if buyer.address != '' %}<div class="addr-line">{{ buyer.address }}, {{ buyer.city }}</div>{% endif %}
      <div class="addr-line">{{ buyer.state }} - {{ buyer.pincode }}</div>
      {% if buyer.phone != '' %}<div class="addr-line">Ph: {{ buyer.phone }}</div>{% endif %}
      {% if buyer.gstin != '' %}<div class="addr-line">GSTIN: {{ buyer.gstin }}</div>{% endif %}
    </td>
    <td>
      <div class="section-title">Shipped To</div>
      <div class="addr-name">{{ shipping.name }}</div>
      {% if shipping.address != '' %}<div class="addr-line">{{ shipping.address }}, {{ shipping.city }}</div>{% endif %}
      <div class="addr-line">{{ shipping.state }} - {{ shipping.pincode }}</div>
      {% if shipping.phone != '' %}<div class="addr-line">Ph: {{ shipping.phone }}</div>{% endif %}
    </td>
  </tr>
</table>

<table class="items">
  <thead>
    <tr>
      <th style="width:4%">#</th>
      <th style="width:28%;text-align:left">Item Description</th>
      {% if settings.showHsn %}<th style="width:8%">HSN</th>{% endif %}
      <th style="width:6%">Qty</th>
      <th style="width:10%">Rate</th>
      <th style="width:11%">Taxable</th>
      {% if invoice.isIGST %}
        <th style="width:14%">IGST</th>
      {% else %}
        <th style="width:8%">CGST</th>
        <th style="width:8%">SGST</th>
      {% endif %}
      <th style="width:11%">Total</th>
    </tr>
  </thead>
  <tbody>
    {% for item in lineItems %}
    {% assign _rowmod = forloop.index0 | modulo: 2 %}
    <tr {% if _rowmod == 1 %}class="alt"{% endif %}>
      <td>{{ item.index }}</td>
      <td style="text-align:left">
        <div>{{ item.name }}</div>
        {% if item.variantName != '' %}<div style="font-size:7.5pt;color:#888">{{ item.variantName }}</div>{% endif %}
        {% if item.sku != '' %}<div style="font-size:7.5pt;color:#aaa">SKU: {{ item.sku }}</div>{% endif %}
      </td>
      {% if settings.showHsn %}<td>{{ item.hsn }}</td>{% endif %}
      <td>{{ item.quantity }}</td>
      <td>{{ item.unitPrice | money }}</td>
      <td>{{ item.taxable | money }}</td>
      {% if invoice.isIGST %}
        <td>{{ item.igstRate }}%<br>{{ item.igstAmt | money }}</td>
      {% else %}
        <td>{{ item.cgstRate }}%<br>{{ item.cgstAmt | money }}</td>
        <td>{{ item.sgstRate }}%<br>{{ item.sgstAmt | money }}</td>
      {% endif %}
      <td><strong>{{ item.total | money }}</strong></td>
    </tr>
    {% endfor %}
  </tbody>
</table>

<div class="totals-wrap">
  <div class="totals-box">
    <div class="totals-row"><span>Subtotal</span><span>{{ totals.subtotal | money }}</span></div>
    {% if totals.discount > 0 %}
    <div class="totals-row"><span>Discount</span><span>- {{ totals.discount | money }}</span></div>
    {% endif %}
    <div class="totals-row"><span>Taxable Amount</span><span>{{ totals.taxable | money }}</span></div>
    {% if invoice.isIGST %}
    <div class="totals-row"><span>IGST</span><span>{{ totals.igst | money }}</span></div>
    {% else %}
    <div class="totals-row"><span>CGST</span><span>{{ totals.cgst | money }}</span></div>
    <div class="totals-row"><span>SGST</span><span>{{ totals.sgst | money }}</span></div>
    {% endif %}
    {% if totals.shipping > 0 %}
    <div class="totals-row"><span>Shipping</span><span>{{ totals.shipping | money }}</span></div>
    {% endif %}
    <div class="totals-row grand"><span>Grand Total</span><span>{{ totals.grandTotal | money }}</span></div>
  </div>
</div>

{% if invoice.amountInWords != '' %}
<div class="in-words">In Words: {{ invoice.amountInWords }}</div>
{% endif %}

{% if shop.signatureUrl != '' %}
<div class="signature-area">
  <img src="{{ shop.signatureUrl }}">
  <p>Authorized Signatory</p>
</div>
{% endif %}

<div class="footer">
  <span>{{ shop.footerText }}</span>
  <span>{{ invoice.number }} · {{ invoice.dateFormatted }}</span>
</div>

</body>
</html>`;
