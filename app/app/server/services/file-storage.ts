import fs from "fs";
import crypto from "crypto";
import path from "path";

export interface FileStorageResult {
  storagePath: string;
  fileHash: string;
  relativePath: string;
}

export class FileStorageService {
  private static getStorageDir(): string {
    return process.env.LOCAL_STORAGE_DIR || "./uploads";
  }

  /**
   * Save uploaded file with proper organization and hashing
   * Inspired by the attachment's approach but integrated with our existing system
   */
  static async saveFile(
    file: Express.Multer.File, 
    projectId: string, 
    documentId: string
  ): Promise<FileStorageResult> {
    const fileData = fs.readFileSync(file.path);
    const hash = crypto.createHash("sha256").update(fileData).digest("hex");

    const baseDir = this.getStorageDir();
    const destDir = path.join(baseDir, "projects", projectId, "documents", documentId, "revisions");
    
    // Create directory structure
    fs.mkdirSync(destDir, { recursive: true });

    // Generate unique filename with timestamp and original name
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const destFilename = `${timestamp}_${sanitizedName}`;
    const destPath = path.join(destDir, destFilename);
    
    // Move file to final location
    fs.renameSync(file.path, destPath);

    // Return both absolute and relative paths
    const relativePath = path.join("projects", projectId, "documents", documentId, "revisions", destFilename);

    return { 
      storagePath: destPath, 
      fileHash: hash,
      relativePath: relativePath
    };
  }

  /**
   * Get file path for reading
   */
  static getFilePath(relativePath: string): string {
    return path.join(this.getStorageDir(), relativePath);
  }

  /**
   * Check if file exists
   */
  static fileExists(relativePath: string): boolean {
    const fullPath = this.getFilePath(relativePath);
    return fs.existsSync(fullPath);
  }

  /**
   * Delete file
   */
  static deleteFile(relativePath: string): boolean {
    try {
      const fullPath = this.getFilePath(relativePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Get file stats
   */
  static getFileStats(relativePath: string): fs.Stats | null {
    try {
      const fullPath = this.getFilePath(relativePath);
      return fs.statSync(fullPath);
    } catch (error) {
      return null;
    }
  }
}