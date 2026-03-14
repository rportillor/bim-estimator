/**
 * 📄 Document Chunking Service
 * 
 * Breaks large specifications documents into optimal chunks for Claude analysis
 * following CSI division boundaries for professional construction estimation
 */

export interface DocumentChunk {
  id: string;
  title: string;
  content: string;
  csiDivisions: string[];
  tokenEstimate: number;
  chunkIndex: number;
  totalChunks: number;
}

export interface ChunkingStrategy {
  name: string;
  maxTokensPerChunk: number;
  chunks: {
    title: string;
    csiDivisions: string[];
    keywords: string[];
  }[];
}

export class DocumentChunker {
  
  // 🎯 Professional CSI Division Chunking Strategy
  private readonly CSI_CHUNKING_STRATEGY: ChunkingStrategy = {
    name: "CSI Division Professional Chunking",
    maxTokensPerChunk: 40000, // Optimal for Claude analysis
    chunks: [
      {
        title: "Early Divisions - Foundation & Structure",
        csiDivisions: ["01", "02", "03", "04", "05"],
        keywords: [
          "general requirements", "existing conditions", "concrete", "masonry", "metals",
          "foundation", "structure", "steel", "reinforcement", "excavation",
          "site work", "demolition", "temporary", "quality control"
        ]
      },
      {
        title: "Building Envelope - Thermal & Openings", 
        csiDivisions: ["06", "07", "08"],
        keywords: [
          "wood", "plastics", "thermal", "moisture", "openings",
          "insulation", "roofing", "waterproofing", "windows", "doors",
          "framing", "sheathing", "vapor barrier", "sealants"
        ]
      },
      {
        title: "Finishes & Systems - Interior & MEP",
        csiDivisions: ["09", "10", "11", "12", "13", "14", "15", "16"],
        keywords: [
          "finishes", "specialties", "equipment", "furnishings", "special construction",
          "conveying", "fire suppression", "plumbing", "hvac", "electrical",
          "drywall", "flooring", "ceiling", "paint", "mechanical", "communications"
        ]
      }
    ]
  };

  /**
   * 🔧 Chunk large specification document by CSI divisions
   */
  async chunkSpecificationDocument(
    content: string, 
    filename: string
  ): Promise<DocumentChunk[]> {
    console.log(`📄 Chunking specifications document: ${filename}`);
    console.log(`📊 Original content size: ${content.length} characters`);
    
    const chunks: DocumentChunk[] = [];
    const strategy = this.CSI_CHUNKING_STRATEGY;
    
    for (let i = 0; i < strategy.chunks.length; i++) {
      const chunkDef = strategy.chunks[i];
      
      // Extract content for this CSI division group
      const chunkContent = this.extractContentForDivisions(
        content, 
        chunkDef.csiDivisions, 
        chunkDef.keywords
      );
      
      if (chunkContent.trim().length > 0) {
        const chunk: DocumentChunk = {
          id: `chunk_${i + 1}`,
          title: chunkDef.title,
          content: chunkContent,
          csiDivisions: chunkDef.csiDivisions,
          tokenEstimate: Math.ceil(chunkContent.length / 4), // Rough token estimate
          chunkIndex: i + 1,
          totalChunks: strategy.chunks.length
        };
        
        chunks.push(chunk);
        console.log(`📦 Created chunk ${i + 1}: ${chunk.title} (${chunk.tokenEstimate} tokens)`);
      }
    }
    
    console.log(`✅ Created ${chunks.length} chunks from ${filename}`);
    return chunks;
  }

  /**
   * 🔍 Extract content relevant to specific CSI divisions
   */
  private extractContentForDivisions(
    content: string, 
    divisions: string[], 
    keywords: string[]
  ): string {
    const lines = content.split('\n');
    const relevantLines: string[] = [];
    let capturing = false;
    let context = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const originalLine = lines[i];
      
      // Check for CSI division headers (e.g., "DIVISION 03", "03 30 00")
      const divisionMatch = divisions.some(div => 
        line.includes(`division ${div}`) || 
        line.includes(`${div} `) ||
        line.includes(`${div}.`)
      );
      
      // Check for relevant keywords
      const keywordMatch = keywords.some(keyword => 
        line.includes(keyword.toLowerCase())
      );
      
      // Start capturing when we find relevant content
      if (divisionMatch || keywordMatch) {
        capturing = true;
        context = originalLine;
      }
      
      // Continue capturing context (next 5-10 lines after match)
      if (capturing) {
        relevantLines.push(originalLine);
        
        // Stop capturing after enough context or when we hit another division
        if (relevantLines.length > context.length / 10 + 50) {
          const nextDivisionMatch = divisions.some(_div =>
            lines[i + 1]?.toLowerCase().includes(`division`) && 
            !divisions.includes(lines[i + 1]?.toLowerCase().match(/division (\d+)/)?.[1] || '')
          );
          
          if (nextDivisionMatch) {
            capturing = false;
          }
        }
      }
    }
    
    return relevantLines.join('\n');
  }

  /**
   * 🎯 Create analysis prompt for chunked processing
   */
  createChunkedAnalysisPrompt(
    chunk: DocumentChunk, 
    projectContext: string = ""
  ): string {
    return `You are a professional construction estimator analyzing construction specifications.

**PROJECT CONTEXT:** ${projectContext}

**CHUNK ANALYSIS:** ${chunk.title}
**CSI DIVISIONS:** ${chunk.csiDivisions.join(', ')}
**CHUNK ${chunk.chunkIndex} OF ${chunk.totalChunks}**

**FOCUSED 6-STEP METHODOLOGY FOR THIS CHUNK:**

**📋 STEP 1: SPECIFICATIONS REVIEW (${chunk.csiDivisions.join(', ')})**
Review ALL specifications in these CSI divisions:
- Material specifications and standards
- Quality requirements and grades  
- Construction methods and procedures
- Workmanship standards

**🗝️ STEP 2: SYMBOLS FOR THESE DIVISIONS**
Identify symbols and abbreviations related to:
${chunk.csiDivisions.map(div => `- Division ${div} elements and materials`).join('\n')}

**🔧 STEP 3: ASSEMBLIES FOR THESE DIVISIONS**
Focus on construction assemblies in divisions ${chunk.csiDivisions.join(', ')}:
- Assembly compositions and layer build-ups
- Connection details and methods
- Component relationships within these divisions

**🏗️ STEP 4: CONSTRUCTION APPROACH FOR THESE SYSTEMS**
How these specific building systems will be constructed:
- Installation sequences for these divisions
- Coordination with other systems
- Quality control requirements

**📍 STEP 5: REFERENCE POINTS FOR THESE ELEMENTS**
Establish reference points for elements in these divisions

**🔍 STEP 6: DETAILED CSI QUANTIFICATION**
Create detailed line items for EACH specification in these divisions.

**REQUIRED JSON OUTPUT - DETAILED CSI BREAKDOWN:**
{
  "chunk_info": {
    "title": "${chunk.title}",
    "divisions": ${JSON.stringify(chunk.csiDivisions)}
  },
  "detailed_csi_items": {
    ${chunk.csiDivisions.map(div => `"division_${div}": []`).join(',\n    ')}
  }
}

**CRITICAL:** Create multiple detailed line items per division, not just one summary item.

Document Content:
${chunk.content}`;
  }
}