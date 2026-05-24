

export default function App() {
  return (
    <div className="size-full bg-gray-100 relative">
      {/* Main page content simulation */}
      <div className="p-8 max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Product Page</h1>
        <p className="text-gray-600 mb-4">
          This simulates a typical product page where the SkinWise browser extension
          sidebar would appear on the right side, analyzing the skincare product.
        </p>

        <div className="bg-white p-6 rounded-lg shadow-sm mb-4">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Hydrating Face Serum
          </h2>
          <p className="text-gray-600">
            A lightweight, fast-absorbing serum designed to provide intense hydration
            and improve skin texture. Suitable for daily use on all skin types.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Features</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            <li>24-hour hydration</li>
            <li>Reduces fine lines and wrinkles</li>
            <li>Non-comedogenic formula</li>
            <li>Dermatologist tested</li>
          </ul>
        </div>
      </div>
    </div>
  );
}