// backend/src/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// ⬇️ Mets ici les origines AUTORISÉES (à adapter)
const allowedOrigins = [
  "http://localhost:3000",               // ton frontend local
  "https://my-app-monorepo-r72yir9t7-mysias-projects-f0dde108.vercel.app"      // ton domaine Vercel (remplace-le) 
];

// Middleware CORS strict
app.use(cors({
  origin: (origin, cb) => {
    // origin = undefined pour curl/Postman → on autorise
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json());

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true }));

// TODO: tes autres routes ici
// app.get("/api/...", handler)

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, "0.0.0.0", () => {
  const addr = server.address();
  console.log(
    `API up on http://localhost:${PORT}  | bound to address:`,
    addr
  );
});

// ➜ Ajout de logs pour voir si une erreur fait arrêter le serveur
server.on("error", (err) => {
  console.error("SERVER ERROR:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

