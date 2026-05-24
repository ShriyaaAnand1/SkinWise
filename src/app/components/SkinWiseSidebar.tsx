import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldX,
  MessageSquare,
  ArrowLeftRight,
  Sparkles,
  Send,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  Settings,
  User,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { saveProfile, getProfile } from "../../utils/indexedDB";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ingredient {
  name: string;
  safety: 'safe' | 'warning' | 'harmful';
  function: string;
  benefits: string[];
  sideEffects: string[];
  suitability: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UserProfile {
  skinType: string;
  ageGroup: string;
  concerns: string[];
  avoidIngredients: string[];
}

// ─── Helper: derive safety purely from good_for / avoid_if tags ──────────────
function deriveSafety(raw: any, userProfile?: { skinType?: string; concerns?: string[] }): 'safe' | 'warning' | 'harmful' {
  const goodTags = (raw.good_for || '').toLowerCase();
  const avoidTags = (raw.avoid_if || '').toLowerCase();

  // No data at all → neutral warning
  if (!goodTags && !avoidTags) return 'warning';

  // If user profile is available, check personalised match
  if (userProfile?.skinType) {
    const skin = userProfile.skinType.toLowerCase();
    if (avoidTags.includes(skin)) return 'harmful';
    if (goodTags.includes(skin)) return 'safe';
  }

  // Check user concerns
  if (userProfile?.concerns?.length) {
    for (const concern of userProfile.concerns) {
      const c = concern.toLowerCase();
      if (avoidTags.includes(c)) return 'harmful';
    }
  }

  // Generic fallback: has any avoid tags = warning, otherwise safe
  if (avoidTags && avoidTags !== 'empty') return 'warning';
  return 'safe';
}

// ─── Helper: map one backend ingredient row → Ingredient ─────────────────────
function mapIngredient(item: any, userProfile?: { skinType?: string; concerns?: string[] }): Ingredient {
  const raw = item.ingredients;

  const benefits: string[] = (raw.good_for && raw.good_for.toUpperCase() !== 'EMPTY')
    ? raw.good_for.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  const avoidList: string[] = (raw.avoid_if && raw.avoid_if.toUpperCase() !== 'EMPTY')
    ? raw.avoid_if.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  const safety = deriveSafety(raw, userProfile);

  // Human-readable function label — use cluster if available, else build from tags
  const clusterLabels: Record<number, string> = {
    0: 'Emollient / Moisturizer',
    1: 'Active Treatment',
    2: 'Preservative / Stabilizer',
    3: 'Surfactant / Cleanser',
    4: 'Humectant',
  };

  const functionLabel =
    (raw.cluster != null ? clusterLabels[raw.cluster] : null) ||
    (benefits.length > 0 ? `Good for: ${benefits.slice(0, 2).join(', ')}` : 'Skin Care Ingredient');

  return {
    name: raw.ingredient_name || 'Unknown Ingredient',
    safety,
    function: functionLabel,
    benefits: benefits.length > 0 ? benefits : ['No benefit data available'],
    sideEffects: avoidList.length > 0 ? avoidList : ['No known side effects'],
    suitability:
      avoidList.length > 0
        ? `Avoid if: ${avoidList[0]}`
        : safety === 'safe'
        ? 'Safe for most skin types'
        : safety === 'warning'
        ? 'Use with caution'
        : 'Avoid if possible',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SkinWiseSidebar() {
  const [isLoading, setIsLoading] = useState(false);
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const [expandedIngredient, setExpandedIngredient] = useState<number | null>(null);
  const [hoveredIngredient, setHoveredIngredient] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        "Hi! I can help answer questions about this product's ingredients and suitability for your skin. What would you like to know?",
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isVisible, setIsVisible] = useState(true);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showAllIngredients, setShowAllIngredients] = useState(false);

  // Separate states for product info (from extractor) and analysis (from backend)
  const [productInfo, setProductInfo] = useState<any>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Profile states
  const [userProfile, setUserProfile] = useState<UserProfile>({
    skinType: '',
    ageGroup: '',
    concerns: [],
    avoidIngredients: [],
  });
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>({
    skinType: '',
    ageGroup: '',
    concerns: [],
    avoidIngredients: [],
  });

  // Similar products states
  const [similarProducts, setSimilarProducts] = useState<any[]>([]);
  const [isSimilarOpen, setIsSimilarOpen] = useState(false);
  const [isSimilarLoading, setIsSimilarLoading] = useState(false);
  const [expandedSimilar, setExpandedSimilar] = useState<number | null>(null);

  // ── Load profile from IndexedDB ──────────────────────────────────────────
  useEffect(() => {
    async function loadProfile() {
      const profile: any = await getProfile();
      if (profile) {
        setUserProfile({
          skinType: profile.skinType || '',
          ageGroup: profile.ageGroup || '',
          concerns: profile.concerns || [],
          avoidIngredients: profile.avoidIngredients || [],
        });
        console.log('✅ Profile loaded from IndexedDB', profile);
      }
    }
    loadProfile();
  }, []);

  // ── Listen for product data from content.js (IGNORES DUPLICATES) ─────────
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'PRODUCT_DATA' && !productInfo) {
        console.log('✅ SkinWise received product data (first time only):', event.data.payload);
        setProductInfo(event.data.payload);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [productInfo]);

  // ── Fetch analysis from backend when productInfo arrives ─────────────────
  useEffect(() => {
    async function fetchAnalysis() {
      if (!productInfo?.productName) return;

      setIsLoading(true);
      setFetchError(null);

      try {
        console.log('📡 Fetching from backend for:', productInfo.productName);
        console.log('👤 Sending user profile:', {
          skinType: userProfile.skinType,
          concerns: userProfile.concerns,
        });

        const response = await fetch('http://localhost:3001/analyze-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productName: productInfo.productName,
            category: productInfo.category,
            userProfile: {
              skinType: userProfile.skinType,
              concerns: userProfile.concerns,
            }
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Backend ${response.status}: ${errText}`);
        }

        const data = await response.json();
        console.log('✅ Backend response:', JSON.stringify(data, null, 2));
        setAnalysisData(data);
      } catch (error: any) {
        console.error('❌ API Fetch Error:', error?.message || error);
        setFetchError(error?.message || 'Failed to reach backend');
      }

      setIsLoading(false);
    }

    fetchAnalysis();
  }, [productInfo?.productName, userProfile.skinType, userProfile.concerns]);

  // ── Derive dynamic data from analysisData ────────────────────────────────
  const ingredientLinks: any[] = analysisData?.ingredients ?? [];

  // Pass userProfile to mapIngredient for personalized safety
  const ingredients: Ingredient[] = ingredientLinks.map((item) => 
    mapIngredient(item, { skinType: userProfile.skinType, concerns: userProfile.concerns })
  );

  // Use recommendation from backend instead of local calculation
  const recommendation = analysisData?.recommendation;
  const isRecommended = recommendation?.status === "Recommended" || 
                         recommendation?.status === "Moderately Suitable";
  const recommendationStatus = recommendation?.status || "Analyzing...";
  const recommendationScore = recommendation?.score;
  
  // Extract warnings from harmful/warning ingredients using new deriveSafety
  const warnings: string[] = [];
  ingredientLinks.forEach((item) => {
    const raw = item.ingredients;
    if (!raw) return;
    
    const safety = deriveSafety(raw, { skinType: userProfile.skinType, concerns: userProfile.concerns });
    if (safety === 'harmful' && raw.avoid_if && raw.avoid_if.toUpperCase() !== 'EMPTY') {
      warnings.push(`${raw.ingredient_name}: ${raw.avoid_if.split(',')[0].trim()}`);
    }
    if (safety === 'warning' && raw.avoid_if && raw.avoid_if.toUpperCase() !== 'EMPTY') {
      warnings.push(`${raw.ingredient_name} — use with caution`);
    }
  });

  const productName =
    analysisData?.product?.product_name ||
    productInfo?.productName ||
    'Analyzing product...';

  const productCategory = analysisData?.product?.category || 'Skincare Product';

  // ── Safety icon / color helpers ──────────────────────────────────────────
  const getSafetyIcon = (safety: Ingredient['safety']) => {
    switch (safety) {
      case 'safe':
        return <Shield className="w-4 h-4 text-green-600" />;
      case 'warning':
        return <ShieldAlert className="w-4 h-4 text-amber-500" />;
      case 'harmful':
        return <ShieldX className="w-4 h-4 text-red-600" />;
    }
  };

  const getSafetyColor = (safety: Ingredient['safety']) => {
    switch (safety) {
      case 'safe':
        return 'bg-green-50 border-green-100';
      case 'warning':
        return 'bg-amber-50 border-amber-100';
      case 'harmful':
        return 'bg-red-50 border-red-100';
    }
  };

  const getHoverColor = (safety: Ingredient['safety']) => {
    switch (safety) {
      case 'safe':
        return 'hover:bg-green-100/50 hover:border-green-200 hover:shadow-[0_2px_8px_rgba(34,197,94,0.15)]';
      case 'warning':
        return 'hover:bg-amber-100/50 hover:border-amber-200 hover:shadow-[0_2px_8px_rgba(245,158,11,0.15)]';
      case 'harmful':
        return 'hover:bg-red-100/50 hover:border-red-200 hover:shadow-[0_2px_8px_rgba(239,68,68,0.15)]';
    }
  };

  // ── Chatbot with local backend proxy (NO direct Anthropic calls) ─────────
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isChatLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');

    const newMessages: ChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: userMessage },
    ];
    setChatMessages(newMessages);
    setIsChatLoading(true);

    try {
      // Build context from current product data
      const productContext = `
Product: ${productName}
Category: ${productCategory}
Recommendation: ${recommendationStatus} (Score: ${recommendationScore})
User Skin Type: ${userProfile.skinType || 'Not set'}
User Concerns: ${userProfile.concerns.join(', ') || 'None'}
Key Ingredients: ${ingredients.map(i => `${i.name} (${i.safety})`).join(', ')}
Warnings: ${warnings.join('; ') || 'None'}
Per-Concern Scores: ${recommendation?.scores ? Object.entries(recommendation.scores).map(([k,v]) => `${k}: ${Number(v).toFixed(1)}`).join(', ') : 'N/A'}
      `.trim();

      const systemPrompt = `You are SkinWise, an expert skincare AI assistant. You help users understand skincare products and ingredients.

Here is the current product context:
${productContext}

Answer questions about this product, its ingredients, suitability for the user's skin type, and skincare in general. Be concise (2-4 sentences max). If asked about something unrelated to skincare, politely redirect to skincare topics.`;

      const response = await fetch('http://localhost:3001/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          messages: newMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await response.json();
      const assistantReply = data.reply || 'Sorry, I could not generate a response.';

      setChatMessages([
        ...newMessages,
        { role: 'assistant', content: assistantReply },
      ]);
    } catch (error) {
      console.error('Chat API error:', error);
      setChatMessages([
        ...newMessages,
        { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' },
      ]);
    }

    setIsChatLoading(false);
  };

  // ── Similar products handler ─────────────────────────────────────────────
  const handleFindSimilar = async () => {
    if (!analysisData?.product?.id) return;

    setIsSimilarOpen(true);
    setIsSimilarLoading(true);

    try {
      const response = await fetch('http://localhost:3001/similar-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: analysisData.product.id,
          category: analysisData.product.category,
          userProfile: {
            skinType: userProfile.skinType,
            concerns: userProfile.concerns,
          }
        }),
      });

      const data = await response.json();
      setSimilarProducts(data.alternatives || []);
    } catch (err) {
      console.error('Failed to fetch similar products:', err);
      setSimilarProducts([]);
    }

    setIsSimilarLoading(false);
  };

  // ── Profile helpers ───────────────────────────────────────────────────────
  const handleOpenProfileSettings = () => {
    setTempProfile({ ...userProfile });
    setIsProfileSettingsOpen(true);
  };

  const handleSaveProfile = async () => {
    setUserProfile({ ...tempProfile });
    await saveProfile(tempProfile);
    console.log('✅ Profile saved to IndexedDB');
    setIsProfileSettingsOpen(false);
  };

  const handleCancelProfile = () => setIsProfileSettingsOpen(false);

  const toggleConcern = (concern: string) => {
    setTempProfile((prev) => ({
      ...prev,
      concerns: prev.concerns.includes(concern)
        ? prev.concerns.filter((c) => c !== concern)
        : [...prev.concerns, concern],
    }));
  };

  const toggleAvoid = (ingredient: string) => {
    setTempProfile((prev) => ({
      ...prev,
      avoidIngredients: prev.avoidIngredients.includes(ingredient)
        ? prev.avoidIngredients.filter((i) => i !== ingredient)
        : [...prev.avoidIngredients, ingredient],
    }));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className={`fixed top-0 right-0 h-screen w-[380px] bg-white shadow-lg overflow-hidden font-sans flex flex-col transition-transform duration-300 ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3">

            {/* ── Header ── */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h1 className="text-base font-semibold text-gray-900">SkinWise Analysis</h1>
              </div>
              <button
                onClick={() => setIsVisible(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ── Product Name (real, from backend) ── */}
            {(analysisData || productInfo) && (
              <div className="pb-2 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900 leading-snug">{productName}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{productCategory}</p>
              </div>
            )}

            {/* ── Fetch error notice ── */}
            {fetchError && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-xs text-orange-700 font-medium">⚠ Could not reach backend</p>
                <p className="text-xs text-orange-600 mt-0.5">{fetchError}</p>
                <p className="text-xs text-orange-500 mt-1">
                  Make sure your backend is running: <code>node server.js</code>
                </p>
              </div>
            )}

            {isLoading ? (
              <LoadingState />
            ) : (
              <>
                {/* ── User Skin Profile ── */}
                <div className="bg-blue-50/60 rounded-lg p-3.5 border border-blue-100 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-600" />
                      <h2 className="text-xs font-semibold text-gray-900">Your Skin Profile</h2>
                    </div>
                    <button
                      onClick={handleOpenProfileSettings}
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-xs text-gray-700 space-y-1">
                    <p><span className="font-medium">Skin Type:</span> {userProfile.skinType || 'Not set'}</p>
                    <p><span className="font-medium">Age Group:</span> {userProfile.ageGroup || 'Not set'}</p>
                    <p>
                      <span className="font-medium">Concerns:</span>{' '}
                      {userProfile.concerns.length > 0 ? userProfile.concerns.join(', ') : 'Not set'}
                    </p>
                    <p>
                      <span className="font-medium">Avoid:</span>{' '}
                      {userProfile.avoidIngredients.length > 0
                        ? userProfile.avoidIngredients.join(', ')
                        : 'Not set'}
                    </p>
                  </div>
                </div>

                {/* ── Profile Settings Form ── */}
                {isProfileSettingsOpen && (
                  <div className="bg-white border rounded-lg p-3 mb-3 space-y-3">
                    <h3 className="text-xs font-semibold text-gray-900">Edit Skin Profile</h3>

                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1">Skin Type</p>
                      <div className="space-y-1">
                        {['Oily', 'Dry', 'Normal', 'Sensitive', 'Combination'].map((type) => (
                          <label key={type} className="flex items-center gap-2 text-xs">
                            <input
                              type="radio"
                              name="skinType"
                              checked={tempProfile.skinType === type}
                              onChange={() => setTempProfile({ ...tempProfile, skinType: type })}
                              className="text-blue-600"
                            />
                            {type}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1">Age Group</p>
                      <div className="space-y-1">
                        {['Under 18', '18–25', '26–35', '36–45', '45+'].map((age) => (
                          <label key={age} className="flex items-center gap-2 text-xs">
                            <input
                              type="radio"
                              name="ageGroup"
                              checked={tempProfile.ageGroup === age}
                              onChange={() => setTempProfile({ ...tempProfile, ageGroup: age })}
                              className="text-blue-600"
                            />
                            {age}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1">Concerns</p>
                      <div className="space-y-1">
                        {['Acne', 'Pigmentation', 'Anti-aging', 'Hydration'].map((c) => (
                          <label key={c} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={tempProfile.concerns.includes(c)}
                              onChange={() => toggleConcern(c)}
                              className="text-blue-600 rounded"
                            />
                            {c}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1">Avoid Ingredients</p>
                      <div className="space-y-1">
                        {['Fragrance', 'Alcohol', 'Parabens'].map((i) => (
                          <label key={i} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={tempProfile.avoidIngredients.includes(i)}
                              onChange={() => toggleAvoid(i)}
                              className="text-blue-600 rounded"
                            />
                            {i}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={handleSaveProfile}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleCancelProfile}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Recommendation Status (from backend) ── */}
                <div
                  className={`rounded-lg p-3.5 border ${
                    recommendation?.status === "Recommended"
                      ? 'bg-green-50/80 border-green-200/60'
                      : recommendation?.status === "Moderately Suitable"
                      ? 'bg-amber-50/80 border-amber-200/60'
                      : 'bg-red-50/80 border-red-200/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {recommendation?.status === "Recommended" && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                    {recommendation?.status === "Moderately Suitable" && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                    {recommendation?.status === "Not Recommended" && <XCircle className="w-5 h-5 text-red-600" />}
                    {!recommendation && <CheckCircle2 className="w-5 h-5 text-gray-400" />}
                    <div>
                      <p className="text-xs font-medium text-gray-600">
                        Status {recommendationScore !== undefined && `· Score: ${recommendationScore}`}
                      </p>
                      <p className={`text-sm font-semibold ${
                        recommendation?.status === "Recommended" ? 'text-green-700'
                        : recommendation?.status === "Moderately Suitable" ? 'text-amber-600'
                        : 'text-red-700'
                      }`}>
                        {recommendationStatus}
                        {userProfile.skinType ? ` for ${userProfile.skinType} skin` : ''}
                      </p>
                      {recommendation?.vetoReason && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          ⚠ {recommendation.vetoReason}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Per-Concern Scores (UPDATED BLOCK) ── */}
                <div className="bg-gray-50/60 rounded-lg p-3 border border-gray-100/80">
                  <p className="text-xs text-gray-400 mb-2">Per-concern scores</p>
                  {recommendation?.scores && (
                    <div className="grid grid-cols-3 gap-y-3 gap-x-2">
                      {Object.entries(recommendation.scores).map(([concern, score]) => (
                        <div key={concern} className="text-center">
                          <p className={`text-sm font-medium ${
                            Number(score) >= 0 ? 'text-green-500' : 'text-red-400'
                          }`}>
                            {Number(score).toFixed(1)}
                          </p>
                          <p className="text-xs text-gray-400 capitalize mt-0.5">{concern}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Key Ingredients ── */}
                <div className="bg-gray-50/60 rounded-lg p-3.5 border border-gray-100/80">
                  <div className="flex items-center justify-between mb-2.5">
                    <h2 className="text-xs font-semibold text-gray-900">
                      Key Ingredients
                      {ingredients.length > 0 && (
                        <span className="ml-2 text-gray-400 font-normal">({ingredients.length})</span>
                      )}
                    </h2>
                    <div className="flex items-center gap-1.5">
                      {ingredients.filter(i => i.safety === 'harmful').length > 0 && (
                        <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">
                          {ingredients.filter(i => i.safety === 'harmful').length} harmful
                        </span>
                      )}
                      {ingredients.filter(i => i.safety === 'warning').length > 0 && (
                        <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">
                          {ingredients.filter(i => i.safety === 'warning').length} caution
                        </span>
                      )}
                    </div>
                  </div>

                  {!analysisData && !isLoading && (
                    <p className="text-xs text-gray-400 italic">
                      {fetchError
                        ? 'Backend unreachable — check that your server is running.'
                        : 'Waiting for product data...'}
                    </p>
                  )}

                  {analysisData && ingredients.length === 0 && (
                    <p className="text-xs text-gray-400 italic">
                      No ingredients found for this product in the database.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    {ingredients.slice(0, showAllIngredients ? ingredients.length : 4).map((ingredient, index) => {
                      const isExpanded = expandedIngredient === index;
                      const isHovered = hoveredIngredient === index;
                      return (
                        <div
                          key={index}
                          className={`rounded-md border ${getSafetyColor(ingredient.safety)} ${getHoverColor(
                            ingredient.safety
                          )} overflow-hidden transition-all duration-300 ease-in-out`}
                          onMouseEnter={() => setHoveredIngredient(index)}
                          onMouseLeave={() => setHoveredIngredient(null)}
                        >
                          <button
                            onClick={() => setExpandedIngredient(isExpanded ? null : index)}
                            className="w-full flex items-center justify-between p-2 cursor-pointer transition-all duration-200 ease-in-out"
                          >
                            <span className={`font-medium text-gray-700 ${
                              ingredient.name.length > 25 ? 'text-[11px]' : 'text-xs'
                            }`}>
                              {ingredient.name}
                            </span>
                            <div className="flex items-center gap-1">
                              <div
                                className={`transition-all duration-200 ease-in-out ${
                                  isHovered && !isExpanded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
                                }`}
                              >
                                <Info className="w-3 h-3 text-blue-500" />
                              </div>
                              {getSafetyIcon(ingredient.safety)}
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-gray-500 transition-transform duration-200" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-gray-500 transition-transform duration-200" />
                              )}
                            </div>
                          </button>

                          <div
                            className={`transition-all duration-300 ease-in-out ${
                              isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                            } overflow-hidden`}
                          >
                            <div className="px-2 pb-2 space-y-2 border-t border-gray-200/50 pt-2">
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-0.5">Function</p>
                                <p className="text-xs text-gray-700 italic">{ingredient.function}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-0.5">Benefits</p>
                                <ul className="space-y-0.5 ml-2">
                                  {ingredient.benefits.map((benefit, i) => (
                                    <li key={i} className="text-xs text-gray-700">• {benefit}</li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-0.5">Possible Side Effects</p>
                                <ul className="space-y-0.5 ml-2">
                                  {ingredient.sideEffects.map((effect, i) => (
                                    <li key={i} className="text-xs text-gray-700">• {effect}</li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-0.5">Suitability</p>
                                <div
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                                    ingredient.safety === 'safe'
                                      ? 'bg-green-100 text-green-700'
                                      : ingredient.safety === 'warning'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-red-100 text-red-700'
                                  }`}
                                >
                                  {ingredient.safety === 'safe' && '✓ '}
                                  {ingredient.safety === 'warning' && '⚠ '}
                                  {ingredient.safety === 'harmful' && '✕ '}
                                  {ingredient.suitability}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {ingredients.length > 4 && (
                    <button
                      onClick={() => setShowAllIngredients(!showAllIngredients)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-md transition-colors mt-2"
                    >
                      {showAllIngredients ? (
                        <>
                          <ChevronUp className="w-3 h-3" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          Show {ingredients.length - 4} more ingredients
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* ── Warnings ── */}
                {warnings.length > 0 && (
                  <div className="bg-red-50/70 rounded-lg p-3.5 border border-red-100/70">
                    <div className="flex items-start gap-2 mb-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <h2 className="text-xs font-semibold text-red-900">Important Warnings</h2>
                    </div>
                    <ul className="space-y-1 ml-6">
                      {warnings.slice(0, 3).map((warning, index) => (
                        <li key={index} className="text-xs text-red-700">• {warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── Action Buttons ── */}
                <div className="space-y-2 pt-1">
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm h-9 text-sm"
                    size="sm"
                    onClick={handleFindSimilar}
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-2" />
                    Find Similar Products
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-gray-300 hover:bg-gray-50 h-9 text-sm"
                    size="sm"
                    onClick={() => setIsChatbotOpen(!isChatbotOpen)}
                  >
                    <MessageSquare className="w-3.5 h-3.5 mr-2" />
                    {isChatbotOpen ? 'Close Chatbot' : 'Open Chatbot'}
                  </Button>
                </div>

                {/* ── Similar Products Panel ── */}
                {isSimilarOpen && (
                  <div className="bg-gray-50/60 rounded-lg p-3.5 border border-gray-100/80 mt-2">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xs font-semibold text-gray-900">Similar Products</h2>
                        {similarProducts.length > 0 && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                            {similarProducts.length}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setIsSimilarOpen(false)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {isSimilarLoading ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map(i => (
                          <div key={i} className="animate-pulse bg-gray-200 rounded-md h-14" />
                        ))}
                      </div>
                    ) : similarProducts.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">
                        No suitable alternatives found in the same category.
                      </p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {similarProducts.map((product, index) => (
                            <div
                              key={index}
                              className={`rounded-md border p-2.5 ${
                                product.status === 'Recommended'
                                  ? 'bg-green-50/70 border-green-100'
                                  : 'bg-amber-50/70 border-amber-100'
                              }`}
                            >
                              {/* Top row: status + score + match */}
                              <div className="flex items-center justify-between mb-1.5">
                                <span className={`text-xs font-medium ${
                                  product.status === 'Recommended' ? 'text-green-700' : 'text-amber-600'
                                }`}>
                                  {product.status === 'Recommended' ? '✓' : '⚠'} {product.status}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">Score {product.score}</span>
                                  <span className="text-xs text-gray-400">{Math.round(product.similarity * 100)}% match</span>
                                </div>
                              </div>

                              {/* Full product name */}
                              <p className={`text-xs font-medium leading-snug ${
                                product.status === 'Recommended' ? 'text-green-900' : 'text-amber-900'
                              }`}>
                                {product.name}
                              </p>

                              {/* XAI Explanation — collapsed by default, expand on click */}
                              {product.explanation && product.explanation.length > 0 && (
                                <div className="mt-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedSimilar(expandedSimilar === index ? null : index);
                                    }}
                                    className={`text-xs flex items-center gap-1 ${
                                      product.status === 'Recommended' ? 'text-green-600' : 'text-amber-500'
                                    }`}
                                  >
                                    <ChevronDown className={`w-3 h-3 transition-transform ${
                                      expandedSimilar === index ? 'rotate-180' : ''
                                    }`} />
                                    {expandedSimilar === index ? 'Hide reasons' : 'Why recommended?'}
                                  </button>

                                  {expandedSimilar === index && (
                                    <div className="mt-1 space-y-0.5">
                                      {product.explanation.map((reason: string, i: number) => (
                                        <p key={i} className="text-xs text-gray-500 flex items-start gap-1">
                                          <span className={`flex-shrink-0 font-medium ${
                                            product.status === 'Recommended' ? 'text-green-600' : 'text-amber-500'
                                          }`}>+</span>
                                          {reason}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {similarProducts.length > 0 && (
                          <p className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100 mt-1">
                            Ranked by skin compatibility · same category only
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Debug toggle (remove before shipping) ── */}
            <div className="pt-3 border-t border-gray-100">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-gray-500 h-7"
                onClick={() => setIsLoading(!isLoading)}
              >
                {isLoading ? 'Show Analysis' : 'Show Loading State'}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Chatbot Panel ── */}
        <div
          className={`border-t border-gray-200 bg-white transition-all duration-300 ease-in-out ${
            isChatbotOpen ? 'h-[320px]' : 'h-0'
          } overflow-hidden flex flex-col`}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs font-semibold text-gray-900">AI Assistant</span>
            </div>
            <button
              onClick={() => setIsChatbotOpen(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-gray-50/30">
            {chatMessages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-700'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-gray-100 bg-white">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isChatLoading ? 'Thinking...' : 'Ask about ingredients...'}
                disabled={isChatLoading}
                className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
              />
              <Button
                size="sm"
                onClick={handleSendMessage}
                disabled={isChatLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 h-8 disabled:opacity-50"
              >
                {isChatLoading
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </Button>
            </div>
          </div>
        </div>
      </div>

      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          className="fixed top-20 right-4 z-[9999] w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 transition-all"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}
    </>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-2 py-2">
        <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        <span className="text-xs text-gray-600 font-medium ml-1">Analyzing ingredients...</span>
      </div>
      <div className="rounded-lg p-3.5 bg-gray-50 border border-gray-100 animate-pulse">
        <div className="flex items-center gap-3">
          <Skeleton className="w-5 h-5 rounded-full bg-gray-200" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-2.5 w-14 bg-gray-200" />
            <Skeleton className="h-3 w-28 bg-gray-200" />
          </div>
        </div>
      </div>
      <div className="bg-gray-50 rounded-lg p-3.5 border border-gray-100 animate-pulse">
        <Skeleton className="h-3 w-36 mb-2.5 bg-gray-200" />
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-5 w-14 rounded-full bg-gray-200" />
          ))}
        </div>
      </div>
      <div className="bg-gray-50 rounded-lg p-3.5 border border-gray-100 animate-pulse">
        <Skeleton className="h-3 w-28 mb-2.5 bg-gray-200" />
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md bg-gray-200" />
          ))}
        </div>
      </div>
      <div className="bg-gray-50 rounded-lg p-3.5 border border-gray-100 animate-pulse">
        <div className="flex items-start gap-2 mb-1.5">
          <Skeleton className="w-4 h-4 rounded bg-gray-200" />
          <Skeleton className="h-3 w-32 bg-gray-200" />
        </div>
        <div className="ml-6 space-y-1.5">
          <Skeleton className="h-2.5 w-full bg-gray-200" />
          <Skeleton className="h-2.5 w-4/5 bg-gray-200" />
        </div>
      </div>
      <div className="space-y-2 pt-1 animate-pulse">
        <Skeleton className="h-9 w-full rounded-md bg-gray-200" />
        <Skeleton className="h-9 w-full rounded-md bg-gray-200" />
      </div>
    </div>
  );
}

export default SkinWiseSidebar;