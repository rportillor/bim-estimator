import { Router } from 'express';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const router = Router();
const execAsync = promisify(exec);

/**
 * POST /api/fix-specs
 * Quick fix for the broken specifications document
 */
router.post('/', async (req, res) => {
  try {
    const documentId = "6c8647ba-822a-4098-9d25-cc6f27b4d608";
    
    logger.info(`Fixing specifications document ${documentId} with proper PDF extraction`);
    
    // Get current document status
    const document = await storage.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Specifications document not found' 
      });
    }
    
    logger.info(`Current document status: pageCount=${document.pageCount}, textLength=${document.textContent?.length || 0}`);
    
    // Run the Python extraction directly and capture output
    const command = `cd /home/runner/workspace && python3 -c "
import pdfplumber
import json

try:
    with pdfplumber.open('uploads/1755967887385_b8fa8c0dc62e7754_Specifications_R1_1_May_21.pdf') as pdf:
        all_text = []
        for page in pdf.pages:
            text = page.extract_text()
            if text and text.strip():
                all_text.append(text.strip())
        
        full_text = '\\n\\n'.join(all_text)
        
        result = {
            'success': True,
            'pageCount': len(pdf.pages),
            'textLength': len(full_text),
            'textContent': full_text[:500000]  # First 500k chars to avoid memory issues
        }
        print(json.dumps(result))
        
except Exception as e:
    result = {'success': False, 'error': str(e)}
    print(json.dumps(result))
"`;
    
    logger.info(`Running Python extraction...`);
    
    const { stdout, stderr } = await execAsync(command, { 
      timeout: 120000, // 2 minutes
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });
    
    if (stderr) {
      logger.warn(`Python extraction warnings: ${stderr}`);
    }
    
    const result = JSON.parse(stdout.trim());
    
    if (!result.success) {
      throw new Error(`Python extraction failed: ${result.error}`);
    }
    
    logger.info(`Python extraction successful: ${result.textLength} characters from ${result.pageCount} pages`);
    
    // Update the document with extracted content
    await storage.updateDocument(documentId, {
      textContent: result.textContent,
      pageCount: result.pageCount,
      analysisStatus: 'Ready',
      // Updated document with Python extraction results
    });
    
    logger.info(`Document ${documentId} updated successfully`);
    
    res.json({
      success: true,
      message: 'Specifications document fixed successfully',
      before: {
        pageCount: document.pageCount,
        textLength: document.textContent?.length || 0
      },
      after: {
        pageCount: result.pageCount,
        textLength: result.textLength
      },
      improvement: {
        pagesFound: result.pageCount,
        textMultiplier: Math.round(result.textLength / (document.textContent?.length || 1))
      }
    });
    
  } catch (error) {
    logger.error(`Failed to fix specifications document`, { error });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fix specifications document',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;