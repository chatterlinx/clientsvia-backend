// utils/responseTraceLogger.js
// Transparent AI Response Trace Logger for Test Intelligence Engine

class ResponseTraceLogger {
  constructor() {
    this.traceSteps = [];
    this.selectedSource = null;
    this.selectedConfidence = 0;
    this.selectionReason = '';
    this.selectedData = null;
    this.startTime = Date.now();
    this.userQuery = '';
    this.extractedKeywords = [];
  }

  /**
   * Initialize trace logging for a new query
   */
  startTrace(userQuery, extractedKeywords = []) {
    this.userQuery = userQuery;
    this.extractedKeywords = extractedKeywords;
    this.startTime = Date.now();
    this.traceSteps = [];
    this.selectedSource = null;
    this.selectedConfidence = 0;
    this.selectionReason = '';
    this.selectedData = null;
    
    console.log(`[TRACE] 🔍 Starting AI decision trace for: "${userQuery}"`);
    console.log(`[TRACE] 📋 Extracted keywords: [${extractedKeywords.join(', ')}]`);
  }

  /**
   * Log a source check with detailed matching information
   */
  logSourceCheck(sourceName, sourceData, matchResult) {
    const step = {
      stepNumber: this.traceSteps.length + 1,
      source: sourceName,
      timestamp: Date.now(),
      details: sourceData || {},
      matchResult: {
        matched: matchResult.matched || false,
        matchedKeywords: matchResult.matchedKeywords || [],
        totalMatches: matchResult.totalMatches || 0,
        totalAvailable: matchResult.totalAvailable || 0,
        confidence: matchResult.confidence || 0,
        reason: matchResult.reason || matchResult.details || 'Standard check performed'
      }
    };

    this.traceSteps.push(step);
    
    const statusIcon = step.matchResult.matched ? '✅' : '❌';
    const summary = this.generateMatchSummary(step.matchResult);
    console.log(`[TRACE] ${statusIcon} ${step.stepNumber}. ${sourceName} → ${summary}`);
    
    return step;
  }

  /**
   * Set the selected source and reason - ENHANCED WITH DEBUG LOGGING
   */
  setSelectedSource(sourceName, reason, confidence, matchedData = null) {
    this.selectedSource = sourceName;
    this.selectedConfidence = confidence;
    this.selectionReason = reason;
    this.selectedData = matchedData;
    
    console.log(`[TRACE] ✅ HARD FIX - Selected: ${sourceName} (${reason}) - Confidence: ${confidence}`);
    console.log(`[TRACE] ✅ HARD FIX - Selected Data:`, {
      hasData: !!matchedData,
      dataKeys: matchedData ? Object.keys(matchedData) : [],
      question: matchedData?.question || 'N/A',
      answer: matchedData?.answer || 'N/A',
      answerLength: matchedData?.answer?.length || 0
    });
    console.log(`[TRACE] ✅ HARD FIX - Full Selected Data Object:`, matchedData);
  }

  /**
   * Generate a human-readable match summary
   */
  generateMatchSummary(matchResult) {
    const { totalMatches = 0, totalAvailable = 0, matchedKeywords = [] } = matchResult;
    
    if (totalMatches === 0) {
      return "0/0 matches";
    }
    
    const percentage = totalAvailable > 0 ? Math.round((totalMatches / totalAvailable) * 100) : 0;
    const keywordList = matchedKeywords.length > 0 ? ` (${matchedKeywords.join(', ')})` : '';
    
    return `${totalMatches}/${totalAvailable} match${totalMatches !== 1 ? 'es' : ''} - ${percentage}%${keywordList}`;
  }

  /**
   * Get complete trace log for debugging/display - FIXED TO USE ACTUAL STORED DATA
   */
  getTraceLog() {
    const totalTime = Date.now() - this.startTime;
    
    return {
      query: this.userQuery,
      keywords: this.extractedKeywords,
      totalTime: totalTime,
      steps: this.traceSteps,
      selectedSource: this.selectedSource || 'None',
      selectionReason: this.selectionReason || 'No matches found in any source',
      selectedConfidence: this.selectedConfidence || 0,
      selectedData: this.selectedData || null,
      summary: this.generateTraceSummary()
    };
  }

  /**
   * Generate a formatted trace summary for display - FIXED TO USE ACTUAL DATA
   */
  generateTraceSummary() {
    const lines = [];
    
    lines.push(`🔍 AI Decision Trace: "${this.userQuery}"`);
    lines.push(`📋 Keywords: [${this.extractedKeywords.join(', ')}]`);
    lines.push('');
    
    this.traceSteps.forEach(step => {
      const icon = step.source === this.selectedSource ? '✅' : '🔹';
      const selected = step.source === this.selectedSource ? ' ✅ SELECTED' : '';
      lines.push(`${icon} ${step.stepNumber}. ${step.source} → ${step.matchSummary}${selected}`);
    });
    
    lines.push('');
    lines.push(`🎯 Final Source: ${this.selectedSource || 'None'}`);
    lines.push(`📊 Confidence: ${this.selectedConfidence || 0}`);
    
    return lines.join('\n');
  }

  /**
   * Export trace for Admin UI display
   */
  exportForUI() {
    return {
      trace: this.getTraceLog(),
      formatted: this.generateTraceSummary(),
      html: this.generateHTMLTrace()
    };
  }

  /**
   * Generate HTML-formatted trace for web display
   */
  generateHTMLTrace() {
    const trace = this.getTraceLog();
    
    let html = `
      <div class="ai-trace-log">
        <h4>🔍 AI Response Trace Log</h4>
        <div class="trace-header">
          <strong>Query:</strong> "${trace.query}"<br>
          <strong>Keywords:</strong> [${trace.keywords.join(', ')}]<br>
          <strong>Execution Time:</strong> ${trace.executionTime}
        </div>
        <ul class="trace-steps">
    `;
    
    trace.steps.forEach(step => {
      const isSelected = step.source === trace.selected.source;
      const className = isSelected ? 'trace-step selected' : 'trace-step';
      const icon = isSelected ? '✅' : '🔹';
      
      html += `
        <li class="${className}">
          ${icon} <strong>${step.stepNumber}.</strong> ${step.source} → ${step.matchSummary}
          ${isSelected ? ' <span class="selected-badge">SELECTED</span>' : ''}
        </li>
      `;
    });
    
    html += `
        </ul>
        <div class="trace-footer">
          <strong>🎯 Final Decision:</strong> ${trace.selected.source} 
          (${trace.selected.reason}) - Confidence: ${trace.selected.confidence}
        </div>
      </div>
    `;
    
    return html;
  }

  /**
   * Static helper to create keyword matching result
   */
  static createMatchResult(matchedKeywords, totalAvailable, details = null, confidence = null) {
    const totalMatches = matchedKeywords.length;
    const calculatedConfidence = confidence !== null ? confidence : 
      (totalAvailable > 0 ? totalMatches / totalAvailable : 0);
    
    return {
      matchedKeywords,
      totalMatches,
      totalAvailable,
      confidence: Math.round(calculatedConfidence * 100) / 100,
      details
    };
  }

  /**
   * Log Local LLM usage for trace logging
   */
  logLocalLLMCheck(prompt, response, model = 'llama3.1:8b-instruct-q4_0', processingTime = 0) {
    const step = {
      stepNumber: this.traceSteps.length + 1,
      source: 'Offline Local LLM',
      timestamp: Date.now(),
      details: {
        model: model,
        promptLength: prompt.length,
        responseLength: response?.length || 0,
        processingTime: processingTime
      },
      matchResult: {
        matched: !!response,
        matchedKeywords: this.extractedKeywords,
        totalMatches: this.extractedKeywords.length,
        totalAvailable: this.extractedKeywords.length,
        confidence: response ? 0.8 : 0, // 80% confidence for LLM responses
        reason: response ? `Offline LLM generated response using ${model}` : 'LLM generation failed'
      }
    };

    this.traceSteps.push(step);
    
    const statusIcon = step.matchResult.matched ? '🧠' : '❌';
    const summary = response ? `Generated ${response.length} chars via ${model}` : 'Generation failed';
    console.log(`[TRACE] ${statusIcon} ${step.stepNumber}. Offline Local LLM → ${summary}`);
    
    return step;
  }
}

module.exports = ResponseTraceLogger;
