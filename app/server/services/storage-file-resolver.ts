// server/services/storage-file-resolver.ts
import path from "path";
import { FileStorageService } from "./file-storage";

/**
 * Try to read a file via FileStorageService.readFile() using several
 * reasonable relative path candidates for the given storageKey.
 *
 * We DO NOT require getFilePath()/fileExists(); we ONLY use readFile(relativePath).
 * This handles keys like:
 *   - "A101.pdf"
 *   - "plans/2024/A101.pdf"
 *   - "/absolute/path/.../uploads/A101.pdf"   (we strip to a basename candidate)
 *   - keys that accidentally include subfolders while the file was saved at ./uploads/<basename>
 */
export async function loadFileBuffer(storageKey: string): Promise<Buffer | null> {
  if (!storageKey) return null;

  const base = path.basename(storageKey);
  const candidates = new Set<string>([
    storageKey,                          // as-is (relative)
    path.join("uploads", storageKey),    // uploads/<key>
    base,                                // <basename>
    path.join("uploads", base),          // uploads/<basename>
  ]);

  // If an absolute path sneaks in, try relative-from-cwd forms
  if (path.isAbsolute(storageKey)) {
    const relFromCwd = path.relative(process.cwd(), storageKey);
    if (relFromCwd && !relFromCwd.startsWith("..")) {
      candidates.add(relFromCwd);
      candidates.add(path.join("uploads", relFromCwd));
      candidates.add(path.join("uploads", path.basename(relFromCwd)));
    }
  }

  for (const rel of Array.from(candidates)) {
    try {
      if (FileStorageService.fileExists(rel)) {
        const filePath = FileStorageService.getFilePath(rel);
        const fs = await import("fs/promises");
        const buf = await fs.readFile(filePath);
        if (buf && buf.length) return buf;
      }
    } catch {
      // ignore and try next candidate
    }
  }

  return null;
}

import { db } from "../db";
import { bimElements, bimModels } from "@shared/schema";
import { eq } from "drizzle-orm";

// Single-call model delete; relies on ON DELETE CASCADE
export async function deleteModelCascade(modelId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(bimModels).where(eq(bimModels.id, modelId));
  });
}