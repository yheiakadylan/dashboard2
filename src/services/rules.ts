// src/services/rules.ts
import { Record, OrderDetails, OrderItem } from '../types';
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

// footer mà Etsy hay chèn
const _STOP_AFTER = new RegExp(
  `(?:^|\\n)\\s*(?:This\\s+case\\s+has\\s+been\\s+submitted|We['’]?ll\\s+follow\\s+up|We\\s+will\\s+follow\\s+up|Thanks,?|Regards,?|Case\\s+(?:ID|type)|Order\\s+number)`,
  "i"
);

// strip html đơn giản - Updated to be more robust with block elements
const stripHtmlBasic = (s: string): string => {
  if (!s) return "";
  return s
    .replace(/&nbsp;/gi, " ") // Replace &nbsp; first to avoid splitting words incorrectly
    .replace(/&amp;/gi, "&")   // Đổi &amp; -> &
    .replace(/&quot;/gi, '"')  // Đổi &quot; -> "
    .replace(/&#39;/gi, "'")   // Đổi &#39; -> '
    .replace(/&lt;/gi, "<")    // Đổi &lt; -> <
    .replace(/&gt;/gi, ">")    // Đổi &gt; -> >
    .replace(/<\/(div|tr|p|h\d|br|li|td|th|table)>/gi, "\n") // Add newline after block closers including table cells
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ") // Strip tags
    .replace(/[ \t]+\n/g, "\n") // Trim end of lines
    .replace(/\n{3,}/g, "\n\n") // Compress newlines
    .replace(/[ \t]{2,}/g, " ") // Compress spaces
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
        const cszMatch = cityStateZip.match(/^(.*),\s*(\w{2})\s+([\w-]+)$/);
        if (cszMatch) {
          shippingAddress.city = cszMatch[1].trim();
          shippingAddress.state = cszMatch[2].trim();
          shippingAddress.zip = cszMatch[3].trim();
        } else {
          // Fallback for international addresses
          shippingAddress.city = cityStateZip;
        }

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
    // address2 is usually just a text node or separate line, tough to regex with specific class if not consistent
    const cityMatch = addrContent.match(/class=["']x_city["'][^>]*>([^<]+)/);
    const stateMatch = addrContent.match(/class=["']x_state["'][^>]*>([^<]+)/);
    const zipMatch = addrContent.match(/class=["']x_zip["'][^>]*>([^<]+)/);
    const countryMatch = addrContent.match(/class=["']x_country-name["'][^>]*>([^<]+)/);

    if (nameMatch) {
      shippingAddress.name = nameMatch[1].trim();
      if (addr1Match) shippingAddress.address1 = addr1Match[1].trim();
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

        const validLines = lines.filter(l => !l.includes('country_code') && l.length > 1);

        if (validLines.length >= 4) {
          // Assume: Name, Address1, (Address2?), CityStateZip, Country
          shippingAddress.country = validLines[validLines.length - 1];
          const cityStateZip = validLines[validLines.length - 2];

          const cszMatch = cityStateZip.match(/^(.*),\s*(\w+)\s+(.+)$/);
          if (cszMatch) {
            shippingAddress.city = cszMatch[1].trim();
            shippingAddress.state = cszMatch[2].trim();
            shippingAddress.zip = cszMatch[3].trim();
          } else {
            shippingAddress.city = cityStateZip;
          }

          if (validLines.length > 4) {
            shippingAddress.address2 = validLines[2];
          }
        } else if (validLines.length === 3) {
          // Name, Address, CityStateZip
          const cityStateZip = validLines[2];
          const cszMatch = cityStateZip.match(/^(.*),\s*(\w+)\s+(.+)$/);
          if (cszMatch) {
            shippingAddress.city = cszMatch[1].trim();
            shippingAddress.state = cszMatch[2].trim();
            shippingAddress.zip = cszMatch[3].trim();
          }
        }
      }
    }
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

    // Mỗi div 1 dòng
    const variant = variantLines.join("\n");

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
      quantity,
      price,
      transactionId,
      image,
    });
  });



  // 4. Extract Financials (Case Insensitive)
  const stripped = stripHtmlBasic(html);

  // Group 1 ([^0-9-]*): Bắt lấy prefix (VD: "AU$", "$", "GBP", "Sales Tax: ")
  // Group 2 ([\d.,]+): Bắt lấy số tiền

  const itemTotalMatch = stripped.match(/Item\s+total\s*:?\s*([^\d\n]*)\s*([\d.,]+)/i);
  const discountMatch = stripped.match(/Discount\s*:?\s*([^\d\n]*)\s*([\d.,]+)/i);
  const shippingMatch = stripped.match(/(?:Shipping|Delivery)\s*:?\s*([^\d\n]*)\s*([\d.,]+)/i);
  const taxMatch = stripped.match(/(?:Sales\s+tax|Tax)\s*:?\s*([^\d\n]*)\s*([\d.,]+)/i);
  const orderTotalMatch = stripped.match(/Order\s+total\s*:?\s*([^\d\n]*)\s*([\d.,]+)/i);

  const financials = {
    //Số tiền luôn ở Group 2
    itemTotal: itemTotalMatch ? parseFloat(itemTotalMatch[2].replace(/,/g, '')) : 0,
    discount: discountMatch ? parseFloat(discountMatch[2].replace(/,/g, '')) : 0,
    shipping: shippingMatch ? parseFloat(shippingMatch[2].replace(/,/g, '')) : 0,
    tax: taxMatch ? parseFloat(taxMatch[2].replace(/,/g, '')) : 0,
    orderTotal: orderTotalMatch ? parseFloat(orderTotalMatch[2].replace(/,/g, '')) : 0,
  };

  // --- 5. Detect Currency ---
  // Dựa vào prefix của Order Total để quyết định loại tiền
  let detectedCurrency = "USD";
  if (orderTotalMatch && orderTotalMatch[1]) {
    detectedCurrency = detectCurrencyFromPrefix(orderTotalMatch[1]);
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
