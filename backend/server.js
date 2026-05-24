require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get("/", (req, res) => {
  res.send("SkinWise Backend Running");
});

// TEST DATABASE
app.get("/products", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*");

  if (error) {
    return res.status(500).json(error);
  }

  res.json(data);
});

// ── Recommendation engine ──────────────────────────────────────────────
function positionWeight(position) {
  if (position <= 5)  return 1.0;
  if (position <= 10) return 0.7;
  if (position <= 20) return 0.4;
  return 0.1;
}

function evaluateProduct(ingredientLinks, userProfile) {
  const concerns = ["acne", "oily", "dry", "sensitive", "pigmentation", "aging"];
  const scores = {};
  concerns.forEach(c => scores[c] = 0);

  for (const row of ingredientLinks) {
    const ing = row.ingredients;
    if (!ing) continue;

    const position = row.position || 99;
    const weight = positionWeight(position);
    const good  = (ing.good_for  || "").toLowerCase();
    const avoid = (ing.avoid_if  || "").toLowerCase();

    for (const c of concerns) {
      if (good.includes(c))  scores[c] += weight;
      if (avoid.includes(c)) scores[c] -= weight;
    }
  }

  const weights = {};
  concerns.forEach(c => weights[c] = 1.0);

  const skinTypeLower = (userProfile.skinType || "").toLowerCase();
  if (concerns.includes(skinTypeLower)) {
    weights[skinTypeLower] = 1.5;
  }

  for (const concern of (userProfile.concerns || [])) {
    const cl = concern.toLowerCase();
    if (concerns.includes(cl)) weights[cl] = 1.7;
  }

  const finalScore = concerns.reduce(
    (sum, c) => sum + scores[c] * weights[c], 0
  );

  // ── HARD VETO: skin type score < -1.0 → cannot be Recommended ──
  const skinTypeScore = concerns.includes(skinTypeLower) ? scores[skinTypeLower] : 0;
  const skinTypeVeto = skinTypeScore < -1.0;

  // ── CONCERN VETO: any user concern score < -1.0 → cannot be Recommended ──
  const concernVeto = (userProfile.concerns || []).some(concern => {
    const cl = concern.toLowerCase();
    return concerns.includes(cl) && scores[cl] < -1.0;
  });

  const vetoed = skinTypeVeto || concernVeto;
  const vetoReason = skinTypeVeto
    ? `Negative impact on ${userProfile.skinType} skin`
    : concernVeto
    ? `Negative impact on a key concern`
    : null;

  let status;
  if (vetoed) {
    if (finalScore >= 4) status = "Moderately Suitable";
    else                 status = "Not Recommended";
  } else {
    if (finalScore >= 8)      status = "Recommended";
    else if (finalScore >= 4) status = "Moderately Suitable";
    else                      status = "Not Recommended";
  }

  return { scores, finalScore: parseFloat(finalScore.toFixed(2)), status, vetoed, vetoReason };
}

// ANALYZE PRODUCT BY NAME WITH CATEGORY-AWARE FUZZY MATCHING
app.post("/analyze-product", async (req, res) => {
  try {
    const { productName, category, userProfile = {} } = req.body;

    console.log("🔍 Searching for product:", productName);
    console.log("🏷️ With category:", category || "none");
    console.log("👤 User profile:", JSON.stringify(userProfile, null, 2));

    // Clean the incoming name: take only first part before |
    const cleanName = productName.split('|')[0].trim();
    
    // Extract key words (meaningful words longer than 3 chars)
    const words = cleanName.split(' ')
      .filter(w => w.length > 3)
      .slice(0, 5);
    
    console.log("📝 Cleaned name:", cleanName);
    console.log("🔑 Keywords:", words);

    let productData = null;

    // Try with category filter first (most accurate)
    if (category) {
      console.log("🎯 Attempting category-filtered search...");
      
      for (let count = words.length; count >= 2; count--) {
        const pattern = words.slice(0, count).join('%');
        console.log(`  🔍 Trying ${count} keywords with category: ${pattern}`);
        
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .ilike("product_name", `%${pattern}%`)
          .ilike("category", `%${category}%`)
          .limit(5);

        if (!error && data?.length > 0) {
          console.log(`  ✅ Found ${data.length} potential matches with category`);
          
          // Sort by relevance (how many keywords match)
          productData = data.sort((a, b) => {
            const aScore = words.filter(w =>
              a.product_name.toLowerCase().includes(w.toLowerCase())
            ).length;
            const bScore = words.filter(w =>
              b.product_name.toLowerCase().includes(w.toLowerCase())
            ).length;
            return bScore - aScore;
          })[0];
          
          if (productData) {
            console.log(`  🎯 Selected: "${productData.product_name}"`);
            break;
          }
        }
      }
    }

    // Fallback: search without category if no match found
    if (!productData) {
      console.log("🔄 Falling back to search without category filter...");
      
      for (let count = words.length; count >= 2; count--) {
        const pattern = words.slice(0, count).join('%');
        console.log(`  🔍 Trying ${count} keywords: ${pattern}`);
        
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .ilike("product_name", `%${pattern}%`)
          .limit(5);

        if (!error && data?.length > 0) {
          console.log(`  ✅ Found ${data.length} potential matches`);
          
          // Sort by relevance (how many keywords match)
          productData = data.sort((a, b) => {
            const aScore = words.filter(w =>
              a.product_name.toLowerCase().includes(w.toLowerCase())
            ).length;
            const bScore = words.filter(w =>
              b.product_name.toLowerCase().includes(w.toLowerCase())
            ).length;
            return bScore - aScore;
          })[0];
          
          if (productData) {
            console.log(`  🎯 Selected: "${productData.product_name}"`);
            break;
          }
        }
      }
    }

    if (!productData) {
      console.log("❌ Product not found after all attempts");
      return res.status(404).json({ 
        error: "Product not found",
        searchedName: cleanName,
        keywords: words,
        category: category
      });
    }

    console.log(`✅ Matched: "${productData.product_name}" [${productData.category || 'No category'}]`);

    // Get product ingredients with cluster field
    const { data: ingredientLinks, error: linkError } = await supabase
      .from("product_ingredients")
      .select(`
        position,
        ingredients (
          ingredient_name,
          good_for,
          avoid_if,
          cluster
        )
      `)
      .eq("product_id", productData.id)
      .order("position");

    if (linkError) {
      console.error("❌ Error fetching ingredients:", linkError);
      return res.status(500).json(linkError);
    }

    console.log(`✅ Found ${ingredientLinks.length} ingredients for product`);

    // ── Run recommendation engine with user profile ──
    const { scores, finalScore, status, vetoed, vetoReason } = evaluateProduct(
      ingredientLinks,
      userProfile
    );

    console.log(`📊 Recommendation: ${status} (score: ${finalScore})`);
    console.log(`📈 Per-concern scores:`, scores);
    if (vetoed) console.log(`🚫 Veto applied: ${vetoReason}`);

    // Return analysis with recommendation
    res.json({
      product: productData,
      ingredients: ingredientLinks,
      recommendation: {
        status,        // "Recommended" | "Moderately Suitable" | "Not Recommended"
        score: finalScore,
        scores,        // per-concern breakdown
        vetoed,
        vetoReason
      }
    });

  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ 
      error: "Server error",
      message: err.message 
    });
  }
});

// ── XAI Explanation Engine (matches Python exactly) ───────────────────
function generateExplanation(sim, currentVec, candVec, currentIngs, candIngs, userProfile = {}) {
  const explanation = [];

  // REMOVED: High cosine similarity score line
  
  // Shared skincare features (good_for tags) - SMARTER: show unique/differentiating ones
  const currentGoodTags = new Set(
    Object.keys(currentVec)
      .filter(k => k.startsWith('good_') && currentVec[k] > 0)
      .map(k => k.replace('good_', ''))
  );
  const candGoodTags = new Set(
    Object.keys(candVec)
      .filter(k => k.startsWith('good_') && candVec[k] > 0)
      .map(k => k.replace('good_', ''))
  );
  const sharedGoodTags = [...currentGoodTags].filter(t => candGoodTags.has(t));
  // Only show if there are specific shared targets, skip generic ones
  const meaningfulTags = sharedGoodTags.filter(t => 
    !['skin', 'care', 'face', 'all'].includes(t)
  );
  if (meaningfulTags.length > 0) {
    explanation.push(`Targets: ${meaningfulTags.slice(0, 3).join(', ')}`);
  }

  // Common ingredients - LIMITED TO 3
  const currentIngNames = new Set(
    (currentIngs || []).map(i => (i.ingredients?.ingredient_name || '').toLowerCase().trim()).filter(Boolean)
  );
  const candIngNames = (candIngs || [])
    .map(i => i.ingredients?.ingredient_name || '')
    .filter(name => name && currentIngNames.has(name.toLowerCase().trim()));
  const commonIngs = [...new Set(candIngNames)].slice(0, 3);
  if (commonIngs.length > 0) {
    explanation.push(`Shared: ${commonIngs.join(', ')}`);
  }

  // REMOVED: Products belong to similar ingredient clusters line
  
  // Skin type suitability match - REMOVED
  // const concerns = ["acne", "oily", "dry", "sensitive", "pigmentation", "aging"];
  // const userSkin = (userProfile.skinType || "").toLowerCase();
  // if (userSkin && concerns.includes(userSkin)) {
  //   const currentGoodForSkin = currentVec[`good_${userSkin}`] > 0;
  //   const candGoodForSkin = candVec[`good_${userSkin}`] > 0;
  //   if (currentGoodForSkin && candGoodForSkin) {
  //     explanation.push(`Both suitable for ${userProfile.skinType} skin`);
  //   }
  // }

  // Avoids your flagged ingredients
  const avoidList = (userProfile.avoidIngredients || []);
  if (avoidList.length > 0) {
    const candIngredientNames = (candIngs || [])
      .map(i => (i.ingredients?.ingredient_name || '').toLowerCase());
    
    const safeFrom = avoidList.filter(avoid => 
      !candIngredientNames.some(name => name.includes(avoid.toLowerCase()))
    );
    
    if (safeFrom.length > 0) {
      explanation.push(`Free from: ${safeFrom.join(', ')}`);
    }
  }

  // No harmful ingredients for user
  const userSkin = (userProfile.skinType || "").toLowerCase();
  const concerns = ["acne", "oily", "dry", "sensitive", "pigmentation", "aging"];
  if (userSkin && concerns.includes(userSkin)) {
    const hasHarmful = (candIngs || []).some(item => {
      const avoid = (item.ingredients?.avoid_if || "").toLowerCase();
      return avoid.includes(userSkin);
    });
    if (!hasHarmful) {
      explanation.push(`No ingredients flagged for ${userProfile.skinType} skin`);
    }
  }

  return explanation;
}

// ── Similar Products Endpoint ──────────────────────────────────────────
app.post("/similar-products", async (req, res) => {
  try {
    const { productId, category, userProfile = {} } = req.body;

    console.log("🔍 Finding similar products for:", productId, "category:", category);
    console.log("🆔 Product ID type:", typeof productId, "value:", productId);
    console.log("🏷️ Category:", category, "type:", typeof category);
    console.log("👤 User profile for XAI:", JSON.stringify(userProfile, null, 2));

    // 1. Get all products in same category (FIXED: removed 'brand' column)
    const { data: allProducts, error: prodError } = await supabase
      .from("products")
      .select("id, product_name, category")
      .ilike("category", `%${category}%`);

    if (prodError || !allProducts) {
      console.error("❌ Error fetching products:", prodError);
      return res.status(500).json({ error: "Failed to fetch products" });
    }

    // DIAGNOSTIC LOGGING - Show all products in DB
    console.log("📋 All products in DB (for category search):", allProducts.map(p => ({
      id: p.id,
      name: p.product_name,
      category: p.category
    })));
    
    console.log("🏷️ Looking for category containing:", category);
    console.log("🆔 Current product ID:", productId, "type:", typeof productId);
    
    // Filter out current product
    const candidates = allProducts.filter(p => p.id !== productId);
    
    console.log(`📦 Total products in DB (matching category): ${allProducts.length}`);
    console.log(`📦 Candidates after removing current: ${candidates.length}`);
    
    if (candidates.length === 0) {
      console.log("⚠️ No candidates found - only one product in this category");
      console.log("Available categories in DB:", [...new Set(allProducts.map(p => p.category))]);
      return res.json({ alternatives: [] });
    }

    // 2. Get current product's ingredients (for similarity)
    const { data: currentIngs, error: currentIngError } = await supabase
      .from("product_ingredients")
      .select(`position, ingredients(ingredient_name, good_for, avoid_if, cluster)`)
      .eq("product_id", productId)
      .order("position");

    if (currentIngError) {
      console.error("❌ Error fetching current product ingredients:", currentIngError);
    }
    
    console.log(`📝 Current product has ${currentIngs?.length || 0} ingredients`);

    // Build ingredient set using actual ingredient names
    function buildIngredientSet(ingredientLinks) {
      const names = new Set();
      (ingredientLinks || []).forEach(item => {
        const ing = item.ingredients;
        if (!ing || !ing.ingredient_name) return;
        names.add(ing.ingredient_name.toLowerCase().trim());
      });
      return names;
    }

    // Jaccard similarity between two sets
    function similarity(setA, setB) {
      if (setA.size === 0 && setB.size === 0) return 0;
      const intersection = [...setA].filter(x => setB.has(x)).length;
      const union = new Set([...setA, ...setB]).size;
      return parseFloat((intersection / union).toFixed(2));
    }

    // Build feature vector for a product (for XAI explanation)
    function buildFeatureVector(ingredientLinks) {
      const vec = {};
      (ingredientLinks || []).forEach(item => {
        const ing = item.ingredients;
        if (!ing) return;
        
        // Add good_for tags
        if (ing.good_for) {
          const tags = ing.good_for.toLowerCase().split(',');
          tags.forEach(tag => {
            const key = `good_${tag.trim()}`;
            vec[key] = (vec[key] || 0) + 1;
          });
        }
        
        // Add avoid_if tags (negative)
        if (ing.avoid_if) {
          const tags = ing.avoid_if.toLowerCase().split(',');
          tags.forEach(tag => {
            const key = `avoid_${tag.trim()}`;
            vec[key] = (vec[key] || 0) - 1;
          });
        }
      });
      return vec;
    }

    // Use ingredient set for current product
    const currentIngredients = buildIngredientSet(currentIngs || []);
    console.log(`🏷️ Current product has ${currentIngredients.size} unique ingredients`);
    if (currentIngredients.size > 0) {
      console.log(`🏷️ Ingredients:`, [...currentIngredients].slice(0, 10)); // Show first 10
    }

    // Build current product's feature vector (for XAI)
    const currentVec = buildFeatureVector(currentIngs || []);

    // 3. Score + rank each candidate with enhanced debugging
    const results = [];

    console.log(`🔁 Looping through ${candidates.length} candidates...`);

    for (const product of candidates) {
      console.log(`  ⏳ Checking: ${product.product_name} (id: ${product.id})`);
      
      // Get candidate ingredients
      const { data: candIngs, error: candError } = await supabase
        .from("product_ingredients")
        .select(`position, ingredients(ingredient_name, good_for, avoid_if, cluster)`)
        .eq("product_id", product.id)
        .order("position");

      if (candError) {
        console.log(`  ❌ Error fetching ingredients for ${product.product_name}:`, candError);
        continue;
      }

      if (!candIngs || candIngs.length === 0) {
        console.log(`  ⚠️ No ingredients found for ${product.product_name}`);
        continue;
      }

      // Evaluate candidate with user profile
      const { finalScore, status, vetoed } = evaluateProduct(candIngs, userProfile);
      console.log(`  📊 ${product.product_name}: score=${finalScore}, status=${status}`);

      // Skip Not Recommended
      if (status === "Not Recommended") {
        console.log(`  ❌ Skipped — Not Recommended`);
        continue;
      }

      // Compute similarity using ingredient names
      const candIngredients = buildIngredientSet(candIngs);
      const sim = similarity(currentIngredients, candIngredients);
      console.log(`  🔗 Ingredient overlap: ${sim * 100}% (${candIngredients.size} unique ingredients)`);

      // Build candidate feature vector (for XAI)
      const candVec = buildFeatureVector(candIngs);

      const normalizedScore = Math.min(finalScore / 20, 1);
      // Give more weight to product score (70%) than similarity (30%)
      const finalRank = (sim * 0.3) + (normalizedScore * 0.7);

      console.log(`  ✅ Added: sim=${sim}, rank=${finalRank}`);

      // Generate XAI explanation with user profile
      const explanation = generateExplanation(
        sim, currentVec, candVec, currentIngs, candIngs, userProfile
      );

      results.push({
        id: product.id,
        name: product.product_name,
        category: product.category,
        score: finalScore,
        status,
        similarity: parseFloat(sim.toFixed(2)),
        rank: parseFloat(finalRank.toFixed(3)),
        explanation, // ← XAI reasons
      });
    }

    // Sort by rank, return top 5
    results.sort((a, b) => b.rank - a.rank);
    const top5 = results.slice(0, 5);

    console.log(`✅ Returning ${top5.length} similar products`);
    if (top5.length > 0) {
      console.log("🏆 Top results:", top5.map(r => `${r.name} (${r.similarity} sim, ${r.score} score)`));
      console.log("📝 XAI explanations:", top5.map(r => ({ name: r.name, explanation: r.explanation })));
    }
    
    res.json({ alternatives: top5 });

  } catch (err) {
    console.error("❌ Similar products error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat endpoint ──────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { messages, systemPrompt } = req.body;

    console.log("💬 Gemini chat request received");
    console.log("📨 Messages count:", messages?.length);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
      systemInstruction: systemPrompt,
    });

    // Get only user/assistant messages, exclude the initial assistant greeting
    // by only keeping messages AFTER the first user message
    const allMessages = (messages || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Find first user message index
    const firstUserIndex = allMessages.findIndex(m => m.role === "user");
    
    if (firstUserIndex === -1) {
      return res.status(400).json({ error: "No user message found" });
    }

    // History = everything from first user message up to (not including) last message
    const history = allMessages.slice(firstUserIndex, -1);
    
    // Last message = current user input
    const lastMessage = allMessages[allMessages.length - 1].parts[0].text;

    console.log("📜 History length:", history.length);
    console.log("💬 Last message:", lastMessage);

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage);
    const reply = result.response.text();

    console.log("✅ Gemini reply:", reply.slice(0, 100));
    res.json({ reply });

  } catch (err) {
    console.error("❌ Gemini chat error:", err?.message || err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => {
  console.log("🚀 Server running on port 3001");
});