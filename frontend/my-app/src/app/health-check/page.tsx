"use client";
import { useState } from "react";

export default function HealthCheck() {
  const [result, setResult] = useState<string>("");

  const testApi = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/health`);
      const json = await res.json();
      setResult(JSON.stringify(json));
    } catch (err: any) {
      setResult("Erreur: " + err.message);
    }
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>Test API Render</h1>
      <button onClick={testApi} style={{ padding: "8px 16px" }}>
        Tester /health
      </button>
      <pre style={{ marginTop: 16 }}>{result}</pre>
    </main>
  );
}
