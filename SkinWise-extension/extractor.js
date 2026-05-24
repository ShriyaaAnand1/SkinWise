// =============================
// SkinWise Product Extractor
// =============================

function getProductName() {
  const el = document.querySelector("#productTitle");
  return el ? el.innerText.trim() : null;
}

function getBrandName() {
  const el = document.querySelector("#bylineInfo");

  if (!el) return null;

  return el.innerText
    .replace("Visit the", "")
    .replace("Store", "")
    .trim();
}

function getIngredientsText() {
  // Method 1 — product details table
  const rows = document.querySelectorAll(
    "#productDetails_detailBullets_sections1 tr"
  );

  for (const row of rows) {
    const header = row.querySelector("th");
    const value = row.querySelector("td");

    if (
      header &&
      header.innerText.toLowerCase().includes("ingredient")
    ) {
      return value.innerText.trim();
    }
  }

  // Method 2 — fallback search
  const bodyText = document.body.innerText;

  const match = bodyText.match(/ingredients[:\-]\s*(.*)/i);

  return match ? match[1].slice(0, 500) : null;
}

// Extract category from Amazon breadcrumb
// e.g. "Beauty > Skin Care > Face > Face Masks" → "Mask"
function extractCategory() {
  const breadcrumb = document.querySelector('#wayfinding-breadcrumbs_container');
  const text = breadcrumb?.innerText?.toLowerCase() || '';
  
  console.log("🍞 Breadcrumb text for category:", text);
  
  if (text.includes('serum') || text.includes('treatment')) return 'Serum';
  if (text.includes('face wash') || text.includes('cleanser')) return 'Cleanser';
  if (text.includes('mask')) return 'Mask';
  if (text.includes('sunscreen') || text.includes('spf')) return 'Sunscreen';
  if (text.includes('moisturiser') || text.includes('moisturizer') || text.includes('cream')) return 'Moisturizer';
  if (text.includes('shampoo')) return 'Cleanser';
  if (text.includes('toner')) return 'Toner';
  if (text.includes('lip')) return 'Lip Care';
  
  console.log("⚠️ Could not determine category from breadcrumb");
  return null; // unknown
}

function extractProductData() {
  const productName = getProductName();
  const brand = getBrandName();
  const category = extractCategory();
  const ingredients = getIngredientsText();
  
  const data = {
    name: productName,
    brand: brand,
    category: category,
    ingredients: ingredients,
    url: window.location.href,
  };

  console.log("📦 Extracted Product Data:", data);
  console.log("🏷️ Category detected:", category);

  return data;
}

// Example usage when sending to sidebar:
// const productData = extractProductData();
// sendProductDataToSidebar({
//   productName: productData.name,
//   brand: productData.brand,
//   category: productData.category,
//   ingredientsText: productData.ingredients
// });

/*
  If you need to access extractProductData()
  from content.js, make sure this file is loaded
  BEFORE content.js in manifest.json
*/