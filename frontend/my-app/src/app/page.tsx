"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      {/* Titre / intro */}
      <section className="app-card p-5">
        <h1 className="text-2xl font-extrabold app-title">Accueil</h1>
        <p className="mt-2 app-muted">
          Interface claire, lisible et rassurante — fond beige, cartes blanches, accents bruns.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <a className="app-btn-primary" href="/import/ocr">
            Import OCR
          </a>
          <a className="app-btn-secondary" href="/recipes">
            Mes recettes
          </a>
          <a className="app-btn-secondary" href="/recipes/new">
            Nouvelle recette
          </a>
        </div>
      </section>

      {/* Carte debug API */}
      <section className="app-card p-5">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-semibold">Connexion API</div>
            <div className="text-sm app-muted">API: {API}</div>
          </div>

          <TestSyncButton />
        </div>
      </section>
    </div>
  );
}

function TestSyncButton() {
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setLoading(true);
    setErr(null);
    setOut(null);

    try {
      // 1) register (une fois)
      await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "pass1234" }),
      });

      // 2) login
      const loginRes = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "pass1234" }),
      });

      const login = await loginRes.json();
      const token = login?.token;

      if (!token) {
        throw new Error("Token manquant après login. Vérifie la réponse /auth/login.");
      }

      // 3) sync (protégée)
      const syncRes = await fetch(`${API}/auth/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ping: true }),
      });

      const sync = await syncRes.json();
      setOut(sync);
    } catch (e: any) {
      setErr(e?.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <button onClick={send} disabled={loading} className="app-btn-primary">
        {loading ? "Envoi..." : "Envoyer POST /auth/sync"}
      </button>

      {err && (
        <pre className="mt-3 p-3 app-card" style={{ borderColor: "rgba(255,0,0,0.25)" }}>
          <span style={{ color: "#b00020", fontWeight: 700 }}>Erreur:</span> {err}
        </pre>
      )}

      {out && (
        <pre className="mt-3 p-3 app-card overflow-auto text-sm">
          {JSON.stringify(out, null, 2)}
        </pre>
      )}
    </div>
  );
}
