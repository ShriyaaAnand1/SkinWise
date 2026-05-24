console.log("✅ SkinWise content script loaded");

/* =====================================================
   MAIN EXECUTION WRAPPER
===================================================== */

(function () {

/* =====================================================
   1️⃣ Detect Product Page
===================================================== */

const isAmazonProduct =
  location.href.includes("/dp/") ||
  location.href.includes("/gp/product");

const isNykaaProduct =
  location.href.includes("/p/");

const isProductPage = isAmazonProduct || isNykaaProduct;

if (!isProductPage) {
  console.log("❌ Not a product page");
  return;
}

console.log("✅ Product page detected");


/* =====================================================
   2️⃣ SMART SKINCARE DETECTION
===================================================== */

function isSkincareProduct() {

  let score = 0;

  const pageText = document.body.innerText.toLowerCase();

  const breadcrumb =
    document.querySelector("#wayfinding-breadcrumbs_feature_div")
      ?.innerText.toLowerCase() || "";

  if (
    breadcrumb.includes("beauty") ||
    breadcrumb.includes("skin") ||
    breadcrumb.includes("personal care")
  ) score += 3;

  if (pageText.includes("ingredients")) score += 2;

  const ingredients = [
    "niacinamide",
    "retinol",
    "hyaluronic acid",
    "salicylic acid",
    "ceramide",
    "vitamin c",
  ];

  const matches = ingredients.filter(i => pageText.includes(i));

  if (matches.length >= 2) score += 3;

  console.log("🧠 Skincare score:", score);

  return score >= 4;
}

setTimeout(initSkinWise, 2500);


/* =====================================================
   MAIN INITIALIZER
===================================================== */

function initSkinWise() {

  if (!isSkincareProduct()) {
    console.log("❌ Not skincare — sidebar blocked");
    return;
  }

  console.log("✅ Skincare product confirmed");


/* =====================================================
   SIDEBAR INJECTION
===================================================== */

let sidebarVisible = true;

const SIDEBAR_WIDTH = 380;

/* Create container */
const container = document.createElement("div");
container.id = "skinwise-sidebar-root";
document.body.appendChild(container);

/* Create iframe */
const iframe = document.createElement("iframe");
iframe.src = chrome.runtime.getURL("index.html");

iframe.style.position = "fixed";
iframe.style.top = "0";
iframe.style.right = "0";
iframe.style.width = SIDEBAR_WIDTH + "px";
iframe.style.height = "100vh";
iframe.style.border = "none";
iframe.style.zIndex = "999999";
iframe.style.boxShadow = "none";

container.appendChild(iframe);

console.log("✅ Sidebar injected");

/* =====================================================
   TOGGLE LOGIC (REMOVED - Now handled by React)
===================================================== */

/* =====================================================
   AMAZON DETAILS EXTRACTION (NEW)
===================================================== */

function extractAmazonDetails() {
  const titleEl = document.querySelector("#productTitle");
  if (!titleEl) return { productName: null, brand: "Unknown" };

  let productName = titleEl.innerText.trim();

  productName = productName.split(",")[0];
  productName = productName.split("-")[0];
  productName = productName.replace(/without.*$/i, "");
  productName = productName.replace(/\(.*?\)/g, "");
  productName = productName.replace(/\s+/g, " ").trim();

  const brand =
    document.querySelector("#bylineInfo")?.innerText
      .replace("Brand:", "")
      .replace("Visit the", "")
      .replace("Store", "")
      .trim() || "Unknown";

  return { productName, brand };
}

/* =====================================================
   PRODUCT DATA EXTRACTION (UPDATED)
===================================================== */

function extractProductData() {

  const { productName, brand } = extractAmazonDetails();

  const data = {
    productName,
    brand
  };

  console.log("📤 Sending product to backend:", data);

  return data;
}


/* =====================================================
   SEND DATA TO SIDEBAR WITH RETRY MECHANISM
===================================================== */

function sendProductDataToSidebar(payload) {
  let attempts = 0;
  const interval = setInterval(() => {
    console.log(`📤 Attempt ${attempts + 1} to send product data to sidebar`);
    
    // Post message to the iframe (sidebar)
    iframe.contentWindow.postMessage({ type: "PRODUCT_DATA", payload }, "*");
    
    attempts++;
    if (attempts >= 10) {
      clearInterval(interval);
      console.log("✅ Finished sending attempts (10 tries completed)");
    }
  }, 500); // Try every 500ms for ~5 seconds total
}

setTimeout(() => {

  const productData = extractProductData();

  iframe.onload = () => {
    console.log("🎯 Iframe loaded, starting product data transmission");
    sendProductDataToSidebar(productData);
  };

  // Also start sending immediately if iframe is already loaded
  if (iframe.contentWindow) {
    console.log("🎯 Iframe already loaded, starting product data transmission");
    sendProductDataToSidebar(productData);
  }

}, 3000);


/* =====================================================
   AMAZON SPA NAVIGATION FIX
===================================================== */

let lastUrl = location.href;

setInterval(() => {

  if (location.href !== lastUrl) {

    lastUrl = location.href;

    console.log("🔄 Page changed");

    setTimeout(() => {

      if (!isSkincareProduct()) return;

      const productData = extractProductData();

      // Use the retry function for navigation changes too
      sendProductDataToSidebar(productData);

    }, 2500);
  }

}, 1500);

}

})();