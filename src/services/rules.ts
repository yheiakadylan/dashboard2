// src/services/rules.ts
import { Record, OrderDetails, OrderItem, RefundDetails } from '../types';
import { getHighResImageUrl } from '../utils/imageUtils.js';

export interface Rule {
  name: string;
  query: string;
  kind?: 'order' | 'Funds' | 'case' | 'help';
  platform?: 'etsy' | 'ebay';
  amountOrderRe?: RegExp;
  currencyDefaultIfMissing?: string;
  currencyTag?: string;
  currencyFromGroup?: number;
  parseFrom?: 'snippet' | 'subject' | 'body';
  bodyMsgRe?: RegExp;
  bodyOidRe?: RegExp;
  bodyHelpTypeRe?: RegExp;
}

// số tiền dạng 1,234.56 hoặc 1.234,56 hoặc 1234.56
const AMOUNT_BIG = `(?:\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)`;

export const RULES: Rule[] = [
  // ==================== SALES ====================
  {
    name: "Etsy_Sales",
    platform: "etsy",
    query: 'subject:"You made a sale on Etsy"',
    // Kiểm tra body chứa "Order total" để validate là sales email thực
    amountOrderRe: new RegExp(
      `Order\\s+total\\s*:?\\s*[$£€]?\\s*(${AMOUNT_BIG})`,
      "i"
    ),
    currencyDefaultIfMissing: "USD",
    parseFrom: "body",  // ← THAY từ subject sang body
  },

  {
    name: "Ebay_Sales",
    platform: "ebay",
    // Tighten query: match chính xác subject pattern + item name
    query: 'from:ebay@ebay.com subject:"You made the sale for"',

    // Regex để validate email này có phải là sales email thực sự
    // Tìm "Great news—your item has sold!" (exact)
    amountOrderRe: new RegExp(
      `Great news\\s*—\\s*your item has sold`,
      "i"
    ),

    currencyTag: "USD",
    parseFrom: "body",
  },

  // ==================== FUNDS ====================
  {
    name: "Funds_On_The_Way",
    kind: "Funds",
    platform: "etsy",
    query: 'subject:"Your funds of"',
    amountOrderRe: new RegExp(
      // Handles: $123.45 USD, £123.45 GBP, 123.45 CAD
      // Updated to [^0-9]* to consume any currency symbol or whitespace before the amount
      `Your\\s+funds\\s+of\\s*[^0-9]*\\s*(${AMOUNT_BIG})\\s*([A-Z]{3})\\s*are\\s+on\\s+the\\s+way`,
      "i"
    ),
    currencyFromGroup: 2,
  },

  {
    name: "Ebay_Funds",
    kind: "Funds",
    platform: "ebay",
    query: 'from:ebay@ebay.com subject:"We sent your payout"',
    amountOrderRe: new RegExp(
      `\\$?\\s*(${AMOUNT_BIG})\\s*was\\s+sent\\s+to\\s+your\\s+bank\\s+account`,
      "i"
    ),
    currencyTag: "USD",
    parseFrom: "snippet",
  },

  // ==================== ETSY STATUS (REFUND) ====================

  {
    name: "Etsy_Refunded",
    kind: "order", // ✅ Changed from 'refund' to 'order'
    platform: "etsy",
    query: 'subject:"You have issued a refund"',
    // Subject: You have issued a refund (Order #3927077414)
    amountOrderRe: new RegExp(
      `You have issued a refund \\(Order #(?<oid>\\d+)\\)`,
      "i"
    ),
    parseFrom: "subject",
  },

  // ==================== ETSY CASE ====================
  {
    name: "Etsy_Case",
    kind: "case",
    platform: "etsy",
    query: 'subject:"opened a case for Order "', // để Gmail tìm được
    // Debbie opened a case for Order #3791747494
    amountOrderRe: new RegExp(
      `^(?<cust>.+?)\\s+opened\\s+a\\s+case\\s+for\\s+Order\\s*#(?<oid>\\d+)\\b`,
      "i"
    ),
    // fallback text (khi mình đã strip html)
    bodyMsgRe: new RegExp(
      `(?:Message\\s*to\\s*seller|Message\\s*from\\s*buyer|Buyer'?s\\s*message)\\s*:\\s*(?<msg>[\\s\\S]+?)$`,
      "i"
    ),
  },

  // ==================== ETSY HELP ====================
  {
    name: "Etsy_Help",
    kind: "help",
    platform: "etsy",
    query: 'subject:"needs help with an order they placed"',
    // "Help Request: Order #123456789"
    bodyOidRe: new RegExp(`\\bHelp\\s*Request\\s*:\\s*Order\\s*#\\s*(?<oid>\\d+)\\b`, "i"),
    // English: "You need help with: ..."
    // Dutch:   "Je hebt hulp nodig met: ..."
    bodyHelpTypeRe: new RegExp(
      `\\b(?:You\\s+need\\s+help\\s+with|Je\\s+hebt\\s+hulp\\s+nodig\\s+met)\\s*:?\\s*(?<kind>[^<\\n]+)`,
      "i"
    ),
  },
];

// ==================== helpers ====================

const toFloat = (s: string): number => {
  s = (s || "").trim();
  // Remove currency symbols and non-breaking spaces
  s = s.replace(/[^\d.,-]/g, '');

  if (s.includes(',') && s.includes('.')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const last = Math.max(lastDot, lastComma);
    const intPart = s.substring(0, last).replace(/[.,]/g, '');
    const fracPart = s.substring(last + 1);
    s = `${intPart}.${fracPart}`;
  } else if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    if (parts.length > 1 && parts[parts.length - 1].length === 2 && parts.every(p => /^\d+$/.test(p))) {
      s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    } else {
      s = parts.join('');
    }
  } else if (s.split('.').length > 2) {
    const parts = s.split('.');
    s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
  }
  return parseFloat(s);
};

/** Parse "City, State Zip" hoặc "City State PostalCode" (US/CA/AU/UK) */
const parseCityStateZip = (raw: string): { city: string; state: string; zip: string } => {
  const result = { city: raw, state: '', zip: '' };

  // Pattern 1: US — "City, ST 12345" or "City, ST 12345-6789"
  const usMatch = raw.match(/^(.*),\s*(\w+)\s+(.+)$/);
  if (usMatch) {
    result.city = usMatch[1].trim();
    result.state = usMatch[2].trim();
    result.zip = usMatch[3].trim();
    return result;
  }

  // Pattern 2: Canadian — "STIRLING ON K0K 3E0"
  const caMatch = raw.match(/^(.+?)\s+([A-Z]{2})\s+([A-Z]\d[A-Z]\s*\d[A-Z]\d)$/i);
  if (caMatch) {
    result.city = caMatch[1].trim();
    result.state = caMatch[2].trim();
    result.zip = caMatch[3].trim();
    return result;
  }

  // Pattern 3: AU/NZ — "MELBOURNE VIC 3000"
  const auMatch = raw.match(/^(.+?)\s+([A-Z]{2,3})\s+(\d{4,5})$/i);
  if (auMatch) {
    result.city = auMatch[1].trim();
    result.state = auMatch[2].trim();
    result.zip = auMatch[3].trim();
    return result;
  }

  // Pattern 4: UK — "LONDON SW1A 1AA"
  const ukMatch = raw.match(/^(.+?)\s+([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i);
  if (ukMatch) {
    result.city = ukMatch[1].trim();
    result.zip = ukMatch[2].trim();
    return result;
  }

  return result;
};

// footer mà Etsy hay chèn
const _STOP_AFTER = new RegExp(
  `(?:^|\\n)\\s*(?:This\\s+case\\s+has\\s+been\\s+submitted|We['’]?ll\\s+follow\\s+up|We\\s+will\\s+follow\\s+up|Thanks,?|Regards,?|Case\\s+(?:ID|type)|Order\\s+number)`,
  "i"
);

// strip html đơn giản - Updated to be more robust with block elements
const stripHtmlBasic = (s: string): string => {
  if (!s) return "";
  return s
    .replace(/\r\n/g, "\n")  // 🔥 Normalize CRLF -> LF TRƯỚC (critical for Etsy emails)
    .replace(/\r/g, "\n")    // Normalize remaining CR
    .replace(/&nbsp;/gi, " ") // Replace &nbsp; first to avoid splitting words incorrectly
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // Strip CSS <style> blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // Strip <script> blocks too
    .replace(/&amp;/gi, "&")   // Đổi &amp; -> &
    .replace(/&quot;/gi, '"')  // Đổi &quot; -> "
    .replace(/&#39;/gi, "'")   // Đổi &#39; -> '
    .replace(/&lt;/gi, "<")    // Đổi &lt; -> <
    .replace(/&gt;/gi, ">")    // Đổi &gt; -> >
    .replace(/<\/(div|tr|p|h\d|br|li|td|th|table)>/gi, "\n") // Add newline after block closers
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ") // Strip remaining open tags
    .replace(/[ \t]+\n/g, "\n") // Trim trailing spaces on each line
    .replace(/\n{3,}/g, "\n\n") // Compress 3+ newlines to 2 (now works since \r\n normalized)
    .replace(/[ \t]{2,}/g, " ") // Compress multiple spaces
    .trim();
};

// tìm đúng label “Message to seller:” rồi lấy phần sau
const CASE_LABEL_RE =
  /(Message\s*to\s*seller|Message\s*from\\s*buyer|Buyer'?s\s*message)\s*:\s*/i;

const extractCaseMessage = (body: string): string => {
  const text = body.includes('<') ? stripHtmlBasic(body) : body;
  const m = text.match(CASE_LABEL_RE);
  if (!m || m.index == null) return "";

  const start = m.index + m[0].length;
  let rest = text.slice(start).trim();

  // cắt theo footer của Etsy
  const stop = rest.match(_STOP_AFTER);
  if (stop && typeof stop.index === "number") {
    rest = rest.slice(0, stop.index).trim();
  }

  // cắt ở đoạn trống đầu tiên
  const parts = rest.split(/\n\s*\n/);
  let msg = (parts[0] || "").trim();

  // đôi khi nó sẽ là "I want refund\nDebbie" → bỏ tên
  msg = msg.replace(/\n+Debbie\s*$/i, "").trim();

  return msg;
};

const _cleanCaseMessage = (s: string): string => {
  if (!s) return "";
  s = s.trim();
  const m = s.match(_STOP_AFTER);
  if (m && typeof m.index === 'number') {
    s = s.substring(0, m.index).trim();
  }
  const firstParagraph = s.split(/\n\s*\n/)[0] || "";
  return firstParagraph.replace(/\s+/g, ' ');
};

// ==================== EBAY DETAIL EXTRACTION ====================
const extractEbayDetails = (html: string, subject?: string): OrderDetails => {
  let shippingAddress = {
    name: "", address1: "", address2: "", city: "", state: "", zip: "", country: ""
  };
  let items: OrderItem[] = [];
  let financials = {
    itemTotal: 0, discount: 0, shipping: 0, tax: 0, orderTotal: 0
  };
  let customerName = "";
  let customerEmail = "";

  // 1. Extract Shipping Address
  // Structure: <h3>Your buyer's shipping details:</h3> <p> ... </p>
  const addressSectionRegex = /<h3[^>]*>\s*Your buyer's shipping details:[\s\S]*?<\/h3>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i;
  const addrMatch = html.match(addressSectionRegex);
  if (addrMatch) {
    const addrLines = stripHtmlBasic(addrMatch[1].replace(/<br\s*\/?>/gi, '\n')).split('\n').map(l => l.trim()).filter(l => l);
    if (addrLines.length > 0) {
      shippingAddress.name = addrLines[0];
      customerName = shippingAddress.name;
      if (addrLines.length >= 4) {
        shippingAddress.country = addrLines[addrLines.length - 1];
        const cityStateZip = addrLines[addrLines.length - 2];
        const csz = parseCityStateZip(cityStateZip);
        shippingAddress.city = csz.city;
        shippingAddress.state = csz.state;
        shippingAddress.zip = csz.zip;

        shippingAddress.address1 = addrLines[1];
        if (addrLines.length > 4) {
          shippingAddress.address2 = addrLines[2];
        }
      } else if (addrLines.length === 3) {
        shippingAddress.address1 = addrLines[1];
        shippingAddress.country = addrLines[2]; // Fallback assumption
      }
    }
  }

  // 2. Extract Product & Order Table
  // We loop through tables to find key-value pairs
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const colRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const rows = [...html.matchAll(rowRegex)];

  let soldPrice = 0;
  let shippingCost = 0;
  let orderId = "";
  let size = "";
  let material = "";
  // let buyer = "";

  rows.forEach(row => {
    const cols = [...row[0].matchAll(colRegex)];
    if (cols.length >= 2) {
      const keyRaw = stripHtmlBasic(cols[0][1]).replace(':', '').trim();
      const valRaw = stripHtmlBasic(cols[1][1]).trim();

      if (/^Sold$/i.test(keyRaw)) soldPrice = toFloat(valRaw);
      else if (/^Shipping$/i.test(keyRaw)) shippingCost = toFloat(valRaw);
      else if (/^Order$/i.test(keyRaw)) orderId = valRaw;
      else if (/^Size$/i.test(keyRaw)) size = valRaw;
      else if (/^Material$/i.test(keyRaw)) material = valRaw;
      // else if (/^Buyer$/i.test(keyRaw)) buyer = valRaw; // Unused
    }
  });

  // 3. Extract Buyer Message (Personalization)
  // <h2>A message from the buyer</h2> ... <p> ... </p>
  const msgSectionRegex = /<h2[^>]*>\s*A message from the buyer[\s\S]*?<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i;
  const msgMatch = html.match(msgSectionRegex);
  let personalization = "";
  if (msgMatch) {
    personalization = stripHtmlBasic(msgMatch[1]).trim();
  }

  // 4. Extract Product Name (PRIORITY: Subject > Body HTML)
  let title = "eBay Item";

  // PRIORITY 1: Extract from subject "You made the sale for [Product Name]"
  if (subject) {
    const subjectMatch = subject.match(/You made the sale for\s+(.+)$/i);
    if (subjectMatch && subjectMatch[1]) {
      title = subjectMatch[1].trim();
    }
  }

  // FALLBACK: Extract from body HTML if subject extraction failed
  if (title === "eBay Item") {
    const h3Regex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    const h3Matches = [...html.matchAll(h3Regex)];
    for (const m of h3Matches) {
      const text = stripHtmlBasic(m[1]).trim();
      if (!text) continue;
      // Filter out known section headers
      if (/shipping details|Ship by|packaging|labels|Get labels|right way to package|message from the buyer/i.test(text)) continue;
      title = text;
      break; // First valid h3 is the item title
    }
  }

  // 5. Extract Image
  let image = "";
  const imgTagRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  const imgMatches = [...html.matchAll(imgTagRegex)];

  for (const m of imgMatches) {
    let src = m[1];
    // Handle Gmail image proxy which appends original URL after #
    if (src.includes('#')) {
      const parts = src.split('#');
      if (parts.length > 1 && parts[1].startsWith('http')) {
        src = parts[1];
      }
    }

    // Decode entities (e.g. &amp; -> &)
    src = src.replace(/&amp;/g, '&');

    // Check for eBay image domains
    if (src.includes('ebay.com/imageser') || src.includes('i.ebayimg.com')) {
      // Convert to high resolution immediately
      image = getHighResImageUrl(src) || src;
      break;
    }
  }

  // Construct Item
  let variantParts = [];
  if (size) variantParts.push(`Size: ${size}`);
  if (material) variantParts.push(`Material: ${material}`);
  const variant = variantParts.join(', ');

  items.push({
    name: title,
    quantity: 1, // eBay emails usually per listing, assumption 1 unless found otherwise
    price: soldPrice,
    image: image,
    variant: variant,
    personalization: personalization,
    transactionId: orderId
  });

  financials.itemTotal = soldPrice;
  financials.shipping = shippingCost;
  financials.orderTotal = soldPrice + shippingCost;

  return {
    customerName,
    customerEmail,
    shippingAddress,
    items,
    financials
  };
};

const detectCurrencyFromPrefix = (prefix: string): string => {
  if (!prefix) return "USD"; // Mặc định nếu không tìm thấy gì
  const p = prefix.toUpperCase();

  if (p.includes("AU")) return "AUD";
  if (p.includes("CA")) return "CAD";
  if (p.includes("NZ")) return "NZD";
  if (p.includes("SG")) return "SGD";
  if (p.includes("£") || p.includes("GBP")) return "GBP";
  if (p.includes("€") || p.includes("EUR")) return "EUR";

  // Nếu chỉ là dấu $ hoặc rỗng thì mặc định là USD
  return "USD";
};

// ==================== ETSY DETAIL EXTRACTION ====================

const extractEtsyDetails = (html: string): OrderDetails => {
  let shippingAddress = {
    name: "", address1: "", address2: "", city: "", state: "", zip: "", country: ""
  };

  // 1. Extract Address from <address> block
  const addressMatch = html.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
  if (addressMatch) {
    const addrContent = addressMatch[1];

    // --- Outlook Specific Extraction (using x_ classes) ---
    // Example: <span class="x_name">Name</span>
    const nameMatch = addrContent.match(/class=["']x_name["'][^>]*>([^<]+)/);
    const addr1Match = addrContent.match(/class=["']x_first-line["'][^>]*>([^<]+)/);
    const addr2Match = addrContent.match(/class=["']x_second-line["'][^>]*>([^<]+)/);
    const cityMatch = addrContent.match(/class=["']x_city["'][^>]*>([^<]+)/);
    const stateMatch = addrContent.match(/class=["']x_state["'][^>]*>([^<]+)/);
    const zipMatch = addrContent.match(/class=["']x_zip["'][^>]*>([^<]+)/);
    const countryMatch = addrContent.match(/class=["']x_country-name["'][^>]*>([^<]+)/);

    if (nameMatch) {
      shippingAddress.name = nameMatch[1].trim();
      if (addr1Match) shippingAddress.address1 = addr1Match[1].trim();
      if (addr2Match) shippingAddress.address2 = addr2Match[1].trim();
      if (cityMatch) shippingAddress.city = cityMatch[1].trim();
      if (stateMatch) shippingAddress.state = stateMatch[1].trim();
      if (zipMatch) shippingAddress.zip = zipMatch[1].trim();
      if (countryMatch) shippingAddress.country = countryMatch[1].trim();
    } else {
      // --- Fallback: Standard / Gmail extraction ---
      // Replace <br> with newlines to preserve structure, then strip tags
      const cleanAddr = stripHtmlBasic(addrContent);
      const lines = cleanAddr.split('\n').map(l => l.trim()).filter(l => l);

      if (lines.length > 0) {
        shippingAddress.name = lines[0];
        if (lines.length >= 2) shippingAddress.address1 = lines[1];

        const validLines = lines.filter(l => !l.includes('country_code') && l.length > 0);

        if (validLines.length >= 4) {
          // Assume: Name, Address1, (Address2?), CityStateZip, Country
          shippingAddress.country = validLines[validLines.length - 1];
          const cityStateZip = validLines[validLines.length - 2];

          const csz = parseCityStateZip(cityStateZip);
          shippingAddress.city = csz.city;
          shippingAddress.state = csz.state;
          shippingAddress.zip = csz.zip;

          if (validLines.length > 4) {
            shippingAddress.address2 = validLines[2];
          }
        } else if (validLines.length === 3) {
          // Name, Address, CityStateZip
          const cityStateZip = validLines[2];
          const csz2 = parseCityStateZip(cityStateZip);
          shippingAddress.city = csz2.city;
          shippingAddress.state = csz2.state;
          shippingAddress.zip = csz2.zip;
        }
      }
    }

    // 🔍 DEBUG LOG - Shipping Address
    const _addrMethod = addrContent.match(/class=["']x_name["']/) ? 'OUTLOOK' : 'GMAIL_FALLBACK';
    const _rawLines = stripHtmlBasic(addrContent).split('\n').map(l => l.trim()).filter(l => l);
    console.group(`[DEBUG] ShippingAddress (method:${_addrMethod})`);
    console.log('rawLines =>', _rawLines);
    console.log('parsed =>', shippingAddress);
    console.groupEnd();
    // 🔍 END DEBUG
  }

  // 2. Extract Email
  // Sample: <a href="mailto:kerzwik@comcast.net" ...>
  const emailMatch = html.match(/href=["']mailto:([^"']+)["']/i);
  const customerEmail = emailMatch ? emailMatch[1].trim() : "";
  const customerName = shippingAddress.name;

  // 3. Extract Items (Unified Logic for Outlook & Gmail)
  // ==================== 3. EXTRACT ITEMS (FIXED FOR GMAIL + OUTLOOK) ====================
  const items: OrderItem[] = [];

  // Lấy từng block avatar-media-block giống Python
  const blockRegex =
    /<div\s+class=["']avatar-media-block["'][\s\S]*?<\/table>\s*<\/div>/gi;

  const blockMatches = [...html.matchAll(blockRegex)];

  blockMatches.forEach((bm) => {
    const blockHtml = bm[0];

    // ===== 1) Lấy tất cả <div> con trong block =====
    const divMatches = [...blockHtml.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)];
    const divTexts = divMatches
      .map((m) => stripHtmlBasic(m[1]).trim())
      .filter((t) => t.length > 0);

    // div đầu tiên là name
    let title = "Unknown Item";
    if (divTexts.length > 0) {
      title = divTexts[0];
    }

    // ===== 2) Lọc variant: các div còn lại, loại Shop/Transaction/Quantity/Price/noise =====
    const metaStarts = [
      /^Shop:/i,
      /^Transaction ID:/i,
      /^Quantity:/i,
      /^Price:/i,
    ];
    const noisePatterns = [
      /Download files/i,
      /View your files/i,
      /No returns/i,
      /exchanges accepted/i,
      /Send them a Convo/i,
      /Send them an email/i,
      /Personalized item/i,
    ];

    const variantLines = divTexts.slice(1).filter((line) => {
      if (!line) return false;
      if (line === title) return false;
      if (metaStarts.some((re) => re.test(line))) return false;
      if (noisePatterns.some((re) => re.test(line))) return false;
      return true;
    });

    // 🚀 IN RA RAW 
    console.log(`\n\n[raw_variant_data] => Item: "${title}" =>`, variantLines);

    let variant = "";
    let variant2 = "";
    let personalizationArr: string[] = [];
    let isPersonalizationBlock = false;

    for (const [idx, line] of variantLines.entries()) {
      // Bắt đầu khối personalization nếu dòng có chữ Personalization: hoặc các từ đa ngôn ngữ
      if (/^(personalization|personalisation|personnalisation|wunschtext|personalizzazioni|personalización|personalização|personalisatie|peronalizacja|personalizácia|personaliseer|personalized|personalised)/i.test(line)) {
        isPersonalizationBlock = true;
      }
      
      // Bỏ qua hẳn dòng rác "Personalized item" hoặc "Personalised item"
      if (/personali[zs]ed\s*item/i.test(line)) {
        continue;
      }

      if (isPersonalizationBlock) {
        personalizationArr.push(line);
      } else {
        // Dòng đầu tiên là variant, dòng thứ hai là variant2
        if (idx === 0) {
          variant = line;
        } else if (idx === 1) {
          variant2 = line;
        } else {
          // Từ dòng thứ 3 trở đi coi như là Personalization (nếu Etsy thiếu tag Personalization)
          personalizationArr.push(line);
        }
      }
    }

    const personalization = personalizationArr.join('\n').trim();

    // ===== 3) Clean text để lấy Transaction ID / Qty / Price =====
    let clean = blockHtml;
    clean = clean.replace(/<br\s*\/?>/gi, "\n");
    clean = clean.replace(/<[^>]+>/g, " ");
    clean = clean.replace(/\s+/g, " ").trim();

    const txMatch = clean.match(/Transaction ID:\s*(\d+)/i);
    const transactionId = txMatch ? txMatch[1] : "";

    const qtyMatch = clean.match(/Quantity:\s*(\d+)/i);
    const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    // Group 1: Prefix (NZ$)
    // Group 2: Giá tiền (50.52)
    const priceMatch = clean.match(/Price:\s*([^0-9-]*)\s*([\d.,]+)/i);

    // Lưu ý: Lấy số từ group [2]
    const price = priceMatch ? parseFloat(priceMatch[2].replace(/,/g, "")) : 0;

    // ===== 4) MAIN IMAGE =====
    const imgRegex = /https:\/\/i\.etsystatic\.com\/[^"']+\/il\/[^"']+/gi;

    const imgs = blockHtml.match(imgRegex) || [];
    // Convert to high resolution immediately
    const image = imgs.length ? (getHighResImageUrl(imgs[0]) || imgs[0]) : "";

    // BỎ các block không phải item thực (price = 0)
    if (!price || price === 0) {
      return;
    }

    items.push({
      name: title,
      variant,
      variant2,
      personalization,
      quantity,
      price,
      transactionId,
      image,
    });
  });



  // 4. Extract Financials
  //
  // NGUYÊN TẮC: KHÔNG PHÁ VỠ NHỮNG GÌ ĐANG CHẠY TỐT
  // - itemTotal, orderTotal: dùng REGEX cũ (chưa bao giờ sai)
  // - discount, shipping, tax: dùng TABLE PARSING (robust) + regex fallback
  //   vì các field này có nhiều label/format khác nhau giữa các shop

  const stripped = stripHtmlBasic(html);

  // === itemTotal & orderTotal: REGEX (ổn định, không đổi) ===
  const itemTotalMatch = stripped.match(/Item\s+total\s*:\s*([^\d\n]*)\s*(\d[\d.,]*)/i);
  const orderTotalMatch = stripped.match(/(?:Order|Grand)\s+total\s*:\s*([^\d\n]*)\s*(\d[\d.,]*)/i);

  const itemTotal = itemTotalMatch ? parseFloat(itemTotalMatch[2].replace(/,/g, '')) : 0;
  const orderTotal = orderTotalMatch ? parseFloat(orderTotalMatch[2].replace(/,/g, '')) : 0;

  // Currency: lấy từ prefix của Order Total (AU$, £, €, etc.)
  let currencyPrefix = orderTotalMatch?.[1]?.trim() || '';

  // === discount, shipping, tax: TABLE PARSING (robust, nhiều format) ===
  // Helper: extract số tiền từ text của một cell
  const extractAmount = (raw: string): number => {
    const m = raw.replace(/[^\d.,]/g, '').match(/\d[\d.,]*/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : 0;
  };

  // Label matchers — bao phủ nhiều cách viết Etsy quốc tế
  const isDiscount = (k: string) => /^(discount|coupon|promo|promotion|sale|you\s+saved)/i.test(k);
  const isShipping = (k: string) => /^(shipping|delivery|postage|freight|ship\s+cost)/i.test(k);
  const isTax = (k: string) => /^(sales\s*tax|tax|vat|gst|hst|pst|qst|import\s+duty)/i.test(k);

  let discount = 0;
  let shipping = 0;
  let tax = 0;
  let shippingFromTable = false;
  let taxFromTable = false;

  // Parse HTML table rows: <tr><td>Label</td><td>Value</td></tr>
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  for (const trMatch of html.matchAll(trRegex)) {
    const cells = [...trMatch[0].matchAll(tdRegex)];
    if (cells.length < 2) continue;

    const keyRaw = stripHtmlBasic(cells[0][1]).replace(/:/g, '').trim();
    const valRaw = stripHtmlBasic(cells[cells.length - 1][1]).trim();
    if (!keyRaw || !valRaw) continue;

    const amount = extractAmount(valRaw);

    if (isDiscount(keyRaw)) { discount = Math.max(discount, amount); }
    if (isShipping(keyRaw)) { shipping = amount; shippingFromTable = true; }
    if (isTax(keyRaw)) { tax = amount; taxFromTable = true; }
  }

  // === Fallback regex cho shipping & tax nếu không parse được từ table ===
  if (!shippingFromTable) {
    const shM = stripped.match(/(?:Shipping|Delivery|Postage)\s*:\s*([^\d\n]*)\s*(\d[\d.,]*)/i);
    if (shM) shipping = parseFloat(shM[2].replace(/,/g, ''));
  }
  if (!taxFromTable) {
    const txM = stripped.match(/(?:Sales\s*tax\s*:?|(?:VAT|GST|HST|Tax)\s*:)\s*([^\d\n]*)\s*(\d[\d.,]*)/i);
    if (txM) tax = parseFloat(txM[2].replace(/,/g, ''));
  }
  if (!discount) {
    const dcM = stripped.match(/(?:Discount|Coupon|Promo)\s*:\s*([^\d\n]*)\s*(\d[\d.,]*)/i);
    if (dcM) discount = parseFloat(dcM[2].replace(/,/g, ''));
  }

  // === FALLBACK: Tính tax ngược nếu tax = 0 nhưng có khoảng chênh lệch ===
  // orderTotal = itemTotal - discount + shipping + tax
  if (tax === 0 && orderTotal > 0 && itemTotal > 0) {
    const computedTax = parseFloat((orderTotal - itemTotal + discount - shipping).toFixed(2));
    if (computedTax > 0) tax = computedTax;
  }

  // 🔍 DEBUG LOG - XÓA SAU KHI FIX XONG
  console.group(`[DEBUG] Financials (shipping:${shippingFromTable ? 'TABLE' : 'REGEX'} tax:${taxFromTable ? 'TABLE' : 'REGEX'})`);
  console.log({ itemTotal, discount, shipping, tax, orderTotal, currencyPrefix });
  console.groupEnd();
  // 🔍 END DEBUG

  const financials = {
    itemTotal,
    discount,
    shipping,
    tax,
    orderTotal,
  };

  // --- 5. Detect Currency ---
  // Dựa vào currencyPrefix đã detect từ Order Total row
  let detectedCurrency = "USD";
  if (currencyPrefix) {
    detectedCurrency = detectCurrencyFromPrefix(currencyPrefix);
  }

  return {
    customerName,
    customerEmail,
    shippingAddress,
    items,
    financials,
    detectedCurrency // Trả về để hàm parseMessage sử dụng
  };
};

// ==================== REFUND EXTRACTION ====================

const extractRefundDetails = (html: string, order_id: string): RefundDetails | null => {
  const stripped = stripHtmlBasic(html);

  // 1. Extract Main Refund Amount
  // "You have issued Robin Edwards a refund of $14.00 for order number 3927077414."
  const mainRegex = /You have issued .*? a refund of\s*(?<curr>[^0-9\s]*)\s*(?<amt>[\d.,]+)\s*for order number/i;
  const mainMatch = stripped.match(mainRegex);

  if (!mainMatch) return null; // Bắt buộc phải tìm thấy dòng này

  const refundAmount = toFloat(mainMatch.groups?.amt || "0");
  const refundCurrency = detectCurrencyFromPrefix(mainMatch.groups?.curr || "$");

  // 2. Extract Deduction
  // "NZ$22.28 was deducted from your Shop Payment Account."
  // Note: Dùng [^0-9\n]* để bắt prefix, [\d.,]+ bắt số
  const deductionRegex = /(?<curr>[^0-9\n]*)(?<amt>[\d.,]+)\s*was deducted from your Shop Payment Account/i;
  const deductionMatch = stripped.match(deductionRegex);

  const deductedFromShop = deductionMatch ? toFloat(deductionMatch.groups?.amt || "0") : 0;
  const deductedCurrency = deductionMatch ? detectCurrencyFromPrefix(deductionMatch.groups?.curr || "") : refundCurrency;

  // 3. Extract Fee Refunded
  // "NZ$1.24 of your payment processing fee was refunded by Etsy."
  const feeRegex = /(?<curr>[^0-9\n]*)(?<amt>[\d.,]+)\s*of your payment processing fee was refunded by Etsy/i;
  const feeMatch = stripped.match(feeRegex);

  const refundedFee = feeMatch ? toFloat(feeMatch.groups?.amt || "0") : 0;
  const feeCurrency = feeMatch ? detectCurrencyFromPrefix(feeMatch.groups?.curr || "") : refundCurrency;

  // 4. Extract Reason - Try multiple patterns
  // Pattern 1: "Refund reason\nCancellation requested"
  // Pattern 2: "Reason: Cancellation requested"
  // Pattern 3: After "reason" keyword in various formats
  let reason = "";

  // Try pattern 1: Standard format
  const reasonRegex1 = /Refund reason\s*[\n:]\s*([^\n]+)/i;
  const match1 = stripped.match(reasonRegex1);
  if (match1) {
    reason = match1[1]?.trim() || "";
  }

  // Try pattern 2: Alternative format if pattern 1 failed
  if (!reason) {
    const reasonRegex2 = /reason[:\s]+([^\n]+)/i;
    const match2 = stripped.match(reasonRegex2);
    if (match2) {
      reason = match2[1]?.trim() || "";
    }
  }

  console.log('[RefundDetails] Extracted reason:', reason || '(empty)');

  return {
    refundAmount,
    refundCurrency,
    deductedFromShop,
    deductedCurrency,
    refundedFee,
    feeCurrency,
    reason
  };
};

// ==================== MAIN PARSER ====================

export const parseMessage = (
  rule: Rule,
  subject: string,
  snippet: string,
  body: string
): Partial<Record> | null => {
  const kind = rule.kind || 'order';

  // ====== RULE KHÔNG CÓ amountOrderRe (Etsy_Help) ======
  if (!rule.amountOrderRe) {
    if (rule.name === "Etsy_Help" && rule.bodyOidRe) {
      const oidMatch = body.match(rule.bodyOidRe);
      const order_id = oidMatch?.groups?.oid?.trim() || null;
      if (!order_id) return null;

      let help_kind: string | null = null;
      if (rule.bodyHelpTypeRe) {
        const helpMatch = body.match(rule.bodyHelpTypeRe);
        help_kind = helpMatch?.groups?.kind?.trim() || null;
      }

      return { amount: 0.0, order_id, kind: 'help', help_kind };
    }
    return null;
  }

  // ====== CÓ amountOrderRe ======
  let textToParse: string;
  if (rule.parseFrom === 'snippet') {
    textToParse = snippet;
  } else if (rule.parseFrom === 'body') {
    textToParse = body.includes('<') ? stripHtmlBasic(body) : body;
  } else {
    textToParse = subject;
  }

  const m = textToParse.match(rule.amountOrderRe);

  // For Etsy/Ebay, allow fallback if subject/snippet regex fails but body has details
  if (!m && rule.name !== "Etsy_Sales" && rule.name !== "Ebay_Sales") return null;

  const groups = m?.groups || {};

  // ====== FUNDS ======
  if (rule.currencyFromGroup && m) {
    const amount = toFloat(m[1]);
    const currency = m[rule.currencyFromGroup]?.toUpperCase() || null;
    return { amount, order_id: null, currency, kind };
  }


  // ====== CASE / HELP ======
  if (kind === 'case' || kind === 'help') {
    const order_id = (groups.oid || (groups as any).oid2 || "").trim() || null;
    if (!order_id) return { amount: 0.0, order_id: null, currency: null, kind };

    // Common result structure
    const result: Partial<Record> = { amount: 0.0, order_id, kind };

    if (kind === 'case') {
      let caseMsg = extractCaseMessage(body);
      if (!caseMsg) {
        const textBody = body.includes('<') ? stripHtmlBasic(body) : body;
        const textMatch = (rule.bodyMsgRe || CASE_LABEL_RE).exec(textBody);
        if (textMatch && (textMatch as any).groups?.msg) {
          caseMsg = (textMatch as any).groups.msg.trim();
        }
      }
      result.case_msg = _cleanCaseMessage(caseMsg);
    }

    if (kind === 'help') {
      let helpKind = "";
      const helpMatch = rule.bodyHelpTypeRe?.exec(body);
      if (helpMatch && (helpMatch as any).groups?.kind) {
        helpKind = (helpMatch as any).groups.kind.trim();
      }
      result.help_kind = helpKind || null;
    }

    return {
      kind: result.kind as 'case' | 'help',
      amount: result.amount!,
      order_id: result.order_id!,
      currency: null,
      case_msg: result.case_msg || null,
      help_kind: result.help_kind || null,
    };
  }

  // ====== REFUNDED (now treated as orders) ======
  if (rule.name === 'Etsy_Refunded') {
    const order_id = (groups.oid || "").trim() || null;
    if (!order_id) {
      return {
        kind: 'order',
        amount: 0,
        order_id: null,
        currency: null,
      };
    }

    const result: any = {
      kind: 'order', // ✅ Always 'order'
      amount: 0,
      order_id,
      currency: null,
    };

    result.status = 'Refunded';
    try {
      const refundDetails = extractRefundDetails(body, order_id);
      if (refundDetails) {
        result.refund_details = refundDetails;
      }
    } catch (e) {
      console.warn("Error parsing refund details", e);
    }

    return result;
  }

  // ==================== ETSY SALES (STRICT VALIDATION) ======
  if (rule.name === "Etsy_Sales" && body) {
    // 1. Validate: email phải chứa dấu hiệu của real sales email
    const stripped = stripHtmlBasic(body);

    // FIX VALIDATION: Thêm (?:[A-Z]{1,3})? để chấp nhận AU, CA... trước dấu $
    // Match: "Order total: $22.10", "Order total: AU$22.10"
    const isSalesEmail = /Order\s+total\s*:?\s*(?:[A-Z]{1,3})?\s*[$£€]?\s*[\d.,]+/i.test(stripped);

    if (!isSalesEmail) return null;

    // 2. Try detailed extraction
    try {
      const details = extractEtsyDetails(body);
      const hasItems = (details?.items?.length || 0) > 0;
      const hasAmount = (details?.financials?.orderTotal || 0) > 0;

      if (!hasItems || !hasAmount) return null;

      // 3. Extract order ID (ƯU TIÊN TỪ SUBJECT)
      let order_id = null;

      // Cách 1: Lấy từ Subject trước (để tránh nhầm lẫn)
      const subjectMatch = subject.match(/Order\s*#\s*(\d+)/i);
      if (subjectMatch) {
        order_id = subjectMatch[1];
      }

      // Cách 2: Nếu Subject không có, tìm "Order number" trong Body
      if (!order_id) {
        const bodyOrderMatch = stripped.match(/(?:Order\s+(?:number|#)\s*(?:is)?\s*:?|Order\s*#)\s*(\d+)/i);
        if (bodyOrderMatch) {
          order_id = bodyOrderMatch[1];
        }
      }

      // Cách 3: Fallback sang Item Transaction ID (chỉ khi 2 cách trên tạch)
      if (!order_id && details?.items?.[0]?.transactionId) {
        order_id = details.items[0].transactionId;
      }

      // Reject nếu không có order ID
      if (!order_id) {
        return null;
      }

      const tax = details.financials.tax || 0;
      const orderTotal = details.financials.orderTotal || 0;

      return {
        amount: parseFloat((orderTotal - tax).toFixed(2)),
        order_id: order_id,
        // FIX CURRENCY: Dùng currency đã detect được từ hàm extractEtsyDetails
        currency: details.detectedCurrency || "USD",
        kind: "order",
        details: details
      };

    } catch (e) {
      console.warn("Failed to extract details for Etsy order:", e);
      return null;
    }
  }


  // ====== EBAY SALES (STRICT VALIDATION) ======
  if (rule.name === "Ebay_Sales" && body) {
    // 1. Validate: email phải chứa dấu hiệu của real sales email
    const stripped = stripHtmlBasic(body);

    // Kiểm tra email có phải là sales notification không (exact match)
    const isSalesEmail = /Great news\s*—\s*your item has sold/i.test(stripped);

    if (!isSalesEmail) {
      // Reject: không phải sales email
      return null;
    }

    // 2. Try detailed extraction
    try {
      const details = extractEbayDetails(body, subject);

      // Kiểm tra: phải có ít nhất item hoặc amount
      const hasItems = (details?.items?.length || 0) > 0;
      const hasAmount = (details?.financials?.orderTotal || 0) > 0 ||
        (details?.financials?.shipping || 0) > 0;

      if (!hasItems && !hasAmount) {
        // Reject: không extract được dữ liệu meaningful
        return null;
      }

      // 3. Calculate final amount (fallback logic)
      let finalAmount = details?.financials?.orderTotal || 0;

      if (finalAmount === 0) {
        // Fallback 1: lấy từ item price
        const itemPrice = (details?.items?.[0]?.price || 0);
        if (itemPrice > 0) {
          finalAmount = itemPrice + (details?.financials?.shipping || 0);
        }
      }

      if (finalAmount === 0) {
        // Fallback 2: match từ regex trong body
        const soldMatch = stripped.match(/Sold:\s*\$?\s*([\d.]+)/i);
        if (soldMatch) {
          finalAmount = toFloat(soldMatch[1]);
          // Add shipping nếu có
          const shippingMatch = stripped.match(/Shipping:\s*\$?\s*([\d.]+)/i);
          if (shippingMatch) {
            finalAmount += toFloat(shippingMatch[1]);
          }
        }
      }

      // 4. Final check: phải có amount > 0
      if (finalAmount <= 0) {
        return null;
      }

      // 5. Extract order ID
      let order_id = null;
      if (details?.items?.[0]?.transactionId) {
        order_id = details.items[0].transactionId;
      } else if (groups?.oid) {
        order_id = groups.oid;
      } else {
        // Last resort: match "Order: XXXXX" từ body
        const orderMatch = stripped.match(/\bOrder\s*:\s*([0-9\-]+)/i);
        if (orderMatch) {
          order_id = orderMatch[1];
        }
      }

      return {
        amount: finalAmount,
        order_id: order_id,
        currency: "USD",
        kind: "order",
        details: details
      }

    } catch (e) {
      console.warn("Failed to extract details for eBay order:", e);
      return null;
    }
  }

  // ====== GENERIC SALES (if specific body parse fails) ======
  if (!m) return null;

  const amtStr = groups.amt || groups.soldAmt || m[1];
  if (!amtStr) return null;

  let amount = toFloat(amtStr);
  const order_id = (groups.oid || "").trim() || null;

  // Special case Ebay fallback: Add shipping to total if detailed parsing failed
  if (rule.name === "Ebay_Sales" && groups.shipAmt) {
    amount += toFloat(groups.shipAmt);
  }

  let cc = (groups.cc1 || groups.cc2 || "").toUpperCase() || null;
  if (!cc) {
    cc = rule.currencyDefaultIfMissing || rule.currencyTag || null;
  }

  const map2to3: { [k: string]: string } = { "US": "USD", "AU": "AUD", "CA": "CAD", "NZ": "NZD" };
  const currency = (cc && map2to3[cc]) || cc;

  return { amount, order_id, currency: currency || null, kind };
};
