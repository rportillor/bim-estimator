// server/routes/uploads.ts
import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const uploadsRouter = Router();

const TMP_DIR = process.env.UPLOAD_TMP_DIR || path.join(process.cwd(), "tmp_uploads");
const FINAL_DIR = process.env.UPLOAD_FINAL_DIR || path.join(process.cwd(), "uploads");
const MAX_SIZE_MB = Number(process.env.UPLOAD_MAX_MB || 200);
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

// ensure dirs
for (const d of [TMP_DIR, FINAL_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

function sniffType(buf: Buffer) {
  // PDFs: %PDF-
  if (buf.slice(0, 5).toString() === "%PDF-") return "application/pdf";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  // JPG: FF D8
  if (buf.slice(0, 2).toString("hex") === "ffd8") return "image/jpeg";
  // DWG: AC10… variants (header "AC10xx" usually at start)
  const head = buf.slice(0, 6).toString();
  if (/^AC1[0-9A-Z]{3}/.test(head)) return "image/vnd.dwg";
  // DXF: ASCII starts with "AutoCAD" or "SECTION"
  const str = buf.slice(0, 16).toString();
  if (str.startsWith("AutoCAD") || str.startsWith("SECTION")) return "image/vnd.dxf";
  return "application/octet-stream";
}

function assertAllowed(mime: string) {
  const ALLOWED = new Set([
    "application/pdf",
    "image/png", "image/jpeg",
    "image/vnd.dwg", "image/vnd.dxf",
  ]);
  if (!ALLOWED.has(mime)) throw new Error(`Disallowed file type: ${mime}`);
}

// INIT
uploadsRouter.post("/uploads/initiate", async (req, res) => {
  try {
    const { filename, sizeBytes } = req.body || {};
    if (!filename || !Number.isFinite(+sizeBytes)) return res.status(400).json({ error: "filename & sizeBytes required" });
    if (+sizeBytes > MAX_SIZE) return res.status(413).json({ error: `Max size ${MAX_SIZE_MB}MB` });

    const uploadId = crypto.randomUUID();
    const tmpPath = path.join(TMP_DIR, uploadId + ".part");
    fs.writeFileSync(tmpPath, Buffer.alloc(0));

    return res.json({ uploadId, chunkSize: 2 * 1024 * 1024 }); // 2MB chunks by default
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "initiate failed" });
  }
});

// CHUNK
uploadsRouter.post("/uploads/:id/chunk", async (req, res) => {
  try {
    const uploadId = req.params.id;
    const tmpPath = path.join(TMP_DIR, uploadId + ".part");
    if (!fs.existsSync(tmpPath)) return res.status(404).json({ error: "upload not found" });

    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      const current = fs.statSync(tmpPath).size;
      if (current + buf.length > MAX_SIZE) return res.status(413).json({ error: "exceeds max size" });
      fs.appendFileSync(tmpPath, buf);
      return res.json({ ok: true, received: buf.length });
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "chunk failed" });
  }
});

// COMPLETE
uploadsRouter.post("/uploads/:id/complete", async (req, res) => {
  try {
    const { filename, sha256 } = req.body || {};
    const uploadId = req.params.id;
    const tmpPath = path.join(TMP_DIR, uploadId + ".part");
    if (!filename || !fs.existsSync(tmpPath)) return res.status(400).json({ error: "missing filename or upload not found" });

    const buf = fs.readFileSync(tmpPath);
    const mime = sniffType(buf.slice(0, 64));
    assertAllowed(mime);

    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha256 && sha256 !== hash) return res.status(400).json({ error: "sha256 mismatch" });

    // SECURITY FIX: Add UUID prefix to prevent filename collisions and overwrites
    const safeName = `${crypto.randomUUID()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const finalPath = path.join(FINAL_DIR, safeName);

    fs.writeFileSync(finalPath, buf);
    fs.unlinkSync(tmpPath);

    return res.json({ ok: true, filename: safeName, mime, size: buf.length, sha256: hash });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "complete failed" });
  }
});