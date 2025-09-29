// backend/src/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const authRouter = require("./routes/auth");

// 1) CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  process.env.FRONTEND_VERCEL_URL || "", // ton Vercel
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 2) JSON
app.use(express.json());

// 3) Routes
app.use("/auth", authRouter);

// ❌ (supprimé) app.post('/auth/sync', ...)

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/", (_req, res) => {
  res.json({ name: "my-app API", status: "ok", docs: "/health" });
});

// 4) Listen (HOST pilotable)
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0"; // en local tu peux mettre HOST=127.0.0.1 dans .env

const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(`API up on http://${HOST}:${PORT}`, "| bound to:", addr);
});

server.on("error", (err) => console.error("SERVER ERROR:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));
