import { Router } from 'express';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const router = Router();
const execAsync = promisify(exec);

/**
 * POST /api/reprocess-pdf/:documentId
 * Re-process a failed PDF using the robust Python parser
 */
router.post('/:documentId', async (req, res) => {
  const { documentId } = req.params;
  
  try {
    logger.info(`Starting PDF re-processing for document ${documentId}`);
    
    // Get document info
    const document = await storage.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    logger.info(`Re-processing PDF: ${document.filename}`);
    logger.info(`Current status - pageCount: ${document.pageCount}, textContent length: ${document.textContent?.length || 0}`);
    
    // Check if document needs re-processing
    if (document.pageCount && document.textContent && document.textContent.length > 5000) {
      return res.json({
        success: true,
        message: 'Document already properly processed',
        stats: {
          pageCount: document.pageCount,
          textLength: document.textContent.length,
          status: 'already_processed'
        }
      });
    }
    
    // Get file path from storage key
    if (!document.storageKey) {
      return res.status(400).json({
        success: false,
        message: 'Document has no storage key - cannot re-process'
      });
    }
    
    // Build path to the PDF file (storageKey already includes uploads/ prefix)
    const uploadPath = path.join(process.cwd(), document.storageKey);
    
    logger.info(`Checking for PDF file at: ${uploadPath}`);
    logger.info(`Storage key: ${document.storageKey}`);
    
    // Check if file exists
    try {
      await fs.access(uploadPath);
      logger.info(`PDF file found successfully at: ${uploadPath}`);
    } catch (error) {
      logger.error(`PDF file not found at: ${uploadPath}`, { error });
      return res.status(400).json({
        success: false,
        message: `PDF file not found on disk - cannot re-process. Expected path: ${uploadPath}`
      });
    }
    
    // Create output directory for Python parser
    const outputDir = path.join(process.cwd(), 'temp', 'reprocess', documentId);
    await fs.mkdir(outputDir, { recursive: true });
    
    logger.info(`Processing PDF with robust Python parser...`);
    logger.info(`Input: ${uploadPath}`);
    logger.info(`Output: ${outputDir}`);
    
    // Run the robust Python PDF parser
    const pythonScript = path.join(process.cwd(), 'parser', 'pdf_parser.py');
    const command = `python3 ${pythonScript} --input "${uploadPath}" --output "${outputDir}" --mode construction`;
    
    try {
      const { stdout, stderr } = await execAsync(command, { 
        timeout: 300000, // 5 minutes timeout for large PDFs
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
      
      if (stderr) {
        logger.warn(`Python parser warnings: ${stderr}`);
      }
      
      logger.info(`Python parser completed: ${stdout}`);
      
      // Read the extracted text from Python parser output
      const textFile = path.join(outputDir, 'extracted_text.txt');
      const metadataFile = path.join(outputDir, 'metadata.json');
      
      let extractedText = '';
      let metadata = {};
      
      try {
        extractedText = await fs.readFile(textFile, 'utf8');
        logger.info(`Extracted text length: ${extractedText.length} characters`);
      } catch (e) {
        logger.warn('No extracted text file found');
      }
      
      try {
        const metadataStr = await fs.readFile(metadataFile, 'utf8');
        metadata = JSON.parse(metadataStr);
        logger.info(`Metadata extracted: ${JSON.stringify(metadata)}`);
      } catch (e) {
        logger.warn('No metadata file found');
      }
      
      // Update document with properly extracted content
      await storage.updateDocument(documentId, {
        textContent: extractedText,
        pageCount: (metadata as any).page_count || null,
        analysisStatus: 'Ready'
        // Re-processed with Python parser
      });
      
      // Clean up temp files
      await fs.rm(outputDir, { recursive: true, force: true });
      
      logger.info(`Successfully re-processed document ${documentId}`);
      
      res.json({
        success: true,
        message: 'PDF re-processed successfully with Python parser',
        stats: {
          originalTextLength: document.textContent?.length || 0,
          newTextLength: extractedText.length,
          pageCount: (metadata as any).page_count || null,
          status: 'reprocessed'
        }
      });
      
    } catch (pythonError) {
      logger.error(`Python parser failed: ${pythonError}`);
      throw new Error(`PDF processing failed: ${pythonError instanceof Error ? pythonError.message : String(pythonError)}`);
    }
    
  } catch (error) {
    logger.error(`PDF re-processing failed for document ${documentId}`, { error });
    res.status(500).json({ 
      success: false, 
      message: 'PDF re-processing failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/reprocess-pdf/status/:documentId
 * Check if a document needs re-processing
 */
router.get('/status/:documentId', async (req, res) => {
  const { documentId } = req.params;
  
  try {
    const document = await storage.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    const needsReprocessing = (
      !document.pageCount || 
      !document.textContent || 
      document.textContent.length < 1000
    ) && (document.fileSize || 0) > 1000000; // Only for large files
    
    res.json({
      success: true,
      document: {
        filename: document.filename,
        fileSize: document.fileSize,
        pageCount: document.pageCount,
        textLength: document.textContent?.length || 0,
        analysisStatus: document.analysisStatus
      },
      needsReprocessing,
      reason: needsReprocessing ? 'Low text extraction for large file' : 'Document properly processed'
    });
    
  } catch (error) {
    logger.error(`Failed to check reprocessing status for document ${documentId}`, { error });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check status',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;