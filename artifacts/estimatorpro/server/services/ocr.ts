// server/services/ocr.ts
import Tesseract from "tesseract.js";

export async function ocrImageBuffer(buf: Buffer, lang = "eng") {
  const { data } = await Tesseract.recognize(buf, lang, {
    // Whitelist typical plan characters (improves accuracy/perf)
    tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°\"'–-×/().,Øø+- ",
  } as any);
  // Normalize common plan quirks
  const text = (data?.text || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[\u00D8\u00F8]/g, "Ø")
    .replace(/(\d)\s*['′]/g, "$1'")    // feet
    .replace(/(\d)\s*["″]/g, '$1"');   // inches
  return { text, confidence: data?.confidence ?? 0 };
}