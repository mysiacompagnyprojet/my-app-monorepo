// backend/src/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const authRouter = require("./routes/auth");

// ⬇️ 1) CORS d'abord
const allowedOrigins = [
  "http://localhost:3000",
  "https://my-app-monorepo-r72yir9t7-mysias-projects-f0dde108.vercel.app",
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ⬇️ 2) Parser JSON avant les routes
app.use(express.json());

// ⬇️ 3) Monter les routes APRÈS express.json()
app.use("/auth", authRouter);

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, "0.0.0.0", () => {
  const addr = server.address();
  console.log(`API up on http://localhost:${PORT}  | bound to address:`, addr);
});

server.on("error", (err) => console.error("SERVER ERROR:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));
