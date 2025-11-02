/**
 * ============================================================================
 * TRANSCRIPT COLORIZER - VISUAL AI REASONING
 * ============================================================================
 * 
 * PURPOSE:
 * Generates color-coded transcript that shows HOW the AI understood each word.
 * Provides visual debugging and transparency into AI reasoning process.
 * 
 * COLOR SCHEME:
 * 🔵 BLUE/GRAY    = Filler words (ignored by AI)
 * 🟢 GREEN        = Synonyms (matched & translated)
 * 🟡 YELLOW/AMBER = Keywords (detected & weighted)
 * 🔴 RED          = Scenario triggers (caused the match)
 * 🟣 PURPLE       = LLM suggestions (should add to template)
 * ⚪ WHITE/LIGHT   = Context words (understood but neutral)
 * 
 * OUTPUT FORMAT:
 * Array of {word, color, reason, tooltip, suggestion}
 * 
 * ARCHITECTURE:
 * - Word-level analysis (split transcript into words)
 * - Priority-based color assignment (triggers > synonyms > keywords > fillers)
 * - Suggestion overlay (show what LLM suggests adding)
 * - Tooltip generation (explain WHY each color)
 * 
 * CHECKPOINT STRATEGY:
 * - Log word-by-word analysis
 * - Track color assignment reasoning
 * - Validate all inputs
 * - Enhanced error messages
 * 
 * DEPENDENCIES:
 * - None (pure logic, no external deps)
 * 
 * EXPORTS:
 * - TranscriptColorizer (class)
 * 
 * USED BY:
 * - Frontend Live Test Monitor
 * - routes/admin/enterpriseSuggestions (transcript API)
 * - EnterpriseTestMonitor.js (UI rendering)
 * 
 * ============================================================================
 */

class TranscriptColorizer {
    constructor() {
        console.log('🏗️ [CHECKPOINT 0] TranscriptColorizer initialized');
        
        // Color definitions
        this.colors = {
            FILLER: 'blue',
            SYNONYM: 'green',
            KEYWORD: 'yellow',
            TRIGGER: 'red',
            SUGGESTION: 'purple',
            CONTEXT: 'white'
        };
        
        // Priority order (highest first)
        this.colorPriority = [
            'TRIGGER',      // Most important (caused the match)
            'SYNONYM',      // Second (translated meaning)
            'KEYWORD',      // Third (supporting context)
            'SUGGESTION',   // Fourth (LLM wants to add)
            'FILLER',       // Fifth (ignored noise)
            'CONTEXT'       // Default (neutral)
        ];
    }
    
    /**
     * ============================================================================
     * COLORIZE TRANSCRIPT (Main Entry Point)
     * ============================================================================
     * Generates color-coded word array from transcript and tier results
     * 
     * @param {String} transcript - Original customer phrase
     * @param {Object} tierResults - Results from IntelligentRouter
     * @param {Array} suggestions - LLM suggestions (optional)
     * @returns {Array} Colored word objects
     * 
     * CHECKPOINT FLOW:
     * 1. Validate inputs
     * 2. Split transcript into words
     * 3. Analyze each word
     * 4. Assign colors by priority
     * 5. Generate tooltips
     * 6. Return colored array
     * ============================================================================
     */
    colorizeTranscript(transcript, tierResults, suggestions = []) {
        console.log('🔵 [CHECKPOINT 1] colorizeTranscript() started');
        console.log('🔵 [CHECKPOINT 1.1] Transcript:', transcript.substring(0, 50) + '...');
        
        try {
            // ============================================
            // STEP 1: VALIDATE INPUTS
            // ============================================
            if (!transcript || typeof transcript !== 'string') {
                console.error('❌ [CHECKPOINT 1.2] Invalid transcript');
                throw new Error('transcript must be a non-empty string');
            }
            
            if (!tierResults || !tierResults.tier1) {
                console.error('❌ [CHECKPOINT 1.3] Invalid tierResults');
                throw new Error('tierResults must include tier1 data');
            }
            
            console.log('✅ [CHECKPOINT 1.4] Inputs validated');
            
            // ============================================
            // STEP 2: SPLIT INTO WORDS
            // ============================================
            console.log('🔵 [CHECKPOINT 2] Splitting transcript into words...');
            
            const words = this.splitIntoWords(transcript);
            
            console.log('✅ [CHECKPOINT 2.1] Split into', words.length, 'words');
            
            // ============================================
            // STEP 3: BUILD WORD INDEX
            // ============================================
            console.log('🔵 [CHECKPOINT 3] Building word classification index...');
            
            const wordClassifications = this.buildWordIndex(tierResults, suggestions);
            
            console.log('✅ [CHECKPOINT 3.1] Word index built');
            
            // ============================================
            // STEP 4: COLORIZE EACH WORD
            // ============================================
            console.log('🔵 [CHECKPOINT 4] Colorizing words...');
            
            const coloredWords = words.map((word, index) => 
                this.colorizeWord(word, index, wordClassifications, tierResults)
            );
            
            console.log('✅ [CHECKPOINT 4.1] Colorized', coloredWords.length, 'words');
            
            // ============================================
            // STEP 5: RETURN RESULTS
            // ============================================
            console.log('✅ [CHECKPOINT 5] colorizeTranscript() complete!');
            
            return coloredWords;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT ERROR] colorizeTranscript() failed:', error.message);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * SPLIT INTO WORDS
     * ============================================================================
     * Intelligently splits transcript into words, preserving punctuation context
     * 
     * @param {String} transcript - Text to split
     * @returns {Array} Array of word objects with metadata
     * ============================================================================
     */
    splitIntoWords(transcript) {
        // Split on whitespace but preserve original casing for display
        const rawWords = transcript.split(/\s+/);
        
        return rawWords.map((word, index) => ({
            original: word,                          // Original word with punctuation
            normalized: word.toLowerCase().replace(/[^\w]/g, ''),  // Normalized for matching
            index,
            position: index === 0 ? 'first' : index === rawWords.length - 1 ? 'last' : 'middle'
        }));
    }
    
    /**
     * ============================================================================
     * BUILD WORD INDEX
     * ============================================================================
     * Creates lookup maps for fast word classification
     * 
     * @param {Object} tierResults - Tier matching results
     * @param {Array} suggestions - LLM suggestions
     * @returns {Object} Classification maps
     * ============================================================================
     */
    buildWordIndex(tierResults, suggestions) {
        console.log('🔵 [CHECKPOINT - INDEX] Building word classification index...');
        
        const index = {
            fillers: new Set(),
            synonyms: new Map(),
            keywords: new Set(),
            triggers: new Set(),
            suggestions: new Map()
        };
        
        try {
            // Fillers (matched by Tier 1)
            tierResults.tier1?.matchedFillers?.forEach(filler => {
                index.fillers.add(filler.toLowerCase());
            });
            
            // Synonyms (matched by Tier 1)
            if (tierResults.tier1?.matchedSynonyms) {
                Object.entries(tierResults.tier1.matchedSynonyms).forEach(([synonym, technical]) => {
                    index.synonyms.set(synonym.toLowerCase(), technical);
                });
            }
            
            // Keywords (matched by Tier 1)
            tierResults.tier1?.matchedKeywords?.forEach(keyword => {
                index.keywords.add(keyword.toLowerCase());
            });
            
            // Triggers (matched by Tier 1)
            tierResults.tier1?.matchedTriggers?.forEach(trigger => {
                index.triggers.add(trigger.toLowerCase());
            });
            
            // LLM Suggestions (what should be added)
            suggestions?.forEach(suggestion => {
                suggestion.suggestedWords?.forEach(word => {
                    index.suggestions.set(word.toLowerCase(), {
                        type: suggestion.type,
                        priority: suggestion.priority,
                        reason: suggestion.description
                    });
                });
            });
            
            console.log('✅ [CHECKPOINT - INDEX] Index built:', {
                fillers: index.fillers.size,
                synonyms: index.synonyms.size,
                keywords: index.keywords.size,
                triggers: index.triggers.size,
                suggestions: index.suggestions.size
            });
            
            return index;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - INDEX ERROR]:', error.message);
            return index; // Return partial index
        }
    }
    
    /**
     * ============================================================================
     * COLORIZE WORD
     * ============================================================================
     * Assigns color and metadata to a single word
     * 
     * @param {Object} wordObj - Word object from splitIntoWords
     * @param {Number} index - Word index in transcript
     * @param {Object} classifications - Word classification index
     * @param {Object} tierResults - Tier results for context
     * @returns {Object} Colored word object
     * ============================================================================
     */
    colorizeWord(wordObj, index, classifications, tierResults) {
        const { original, normalized } = wordObj;
        
        // ============================================
        // PRIORITY 1: TRIGGER (caused the match)
        // ============================================
        if (classifications.triggers.has(normalized)) {
            return {
                word: original,
                color: this.colors.TRIGGER,
                colorName: 'TRIGGER',
                reason: 'Trigger word - caused scenario match',
                tooltip: `🔴 TRIGGER: "${original}" matched the scenario`,
                classification: 'trigger',
                index
            };
        }
        
        // ============================================
        // PRIORITY 2: SYNONYM (translated)
        // ============================================
        if (classifications.synonyms.has(normalized)) {
            const technical = classifications.synonyms.get(normalized);
            return {
                word: original,
                color: this.colors.SYNONYM,
                colorName: 'SYNONYM',
                reason: `Synonym matched: ${original} → ${technical}`,
                tooltip: `🟢 SYNONYM: "${original}" translated to "${technical}"`,
                classification: 'synonym',
                technical,
                index
            };
        }
        
        // ============================================
        // PRIORITY 3: KEYWORD (supporting context)
        // ============================================
        if (classifications.keywords.has(normalized)) {
            return {
                word: original,
                color: this.colors.KEYWORD,
                colorName: 'KEYWORD',
                reason: 'Keyword detected - supporting context',
                tooltip: `🟡 KEYWORD: "${original}" provided context for matching`,
                classification: 'keyword',
                index
            };
        }
        
        // ============================================
        // PRIORITY 4: SUGGESTION (LLM wants to add)
        // ============================================
        if (classifications.suggestions.has(normalized)) {
            const suggestion = classifications.suggestions.get(normalized);
            return {
                word: original,
                color: this.colors.SUGGESTION,
                colorName: 'SUGGESTION',
                reason: `LLM suggests adding "${original}" as ${suggestion.type}`,
                tooltip: `🟣 SUGGESTED: Add "${original}" to improve matching (${suggestion.priority} priority)`,
                classification: 'suggestion',
                suggestionType: suggestion.type,
                suggestionPriority: suggestion.priority,
                index
            };
        }
        
        // ============================================
        // PRIORITY 5: FILLER (ignored noise)
        // ============================================
        if (classifications.fillers.has(normalized)) {
            return {
                word: original,
                color: this.colors.FILLER,
                colorName: 'FILLER',
                reason: 'Filler word - ignored by AI',
                tooltip: `🔵 FILLER: "${original}" was ignored (conversational noise)`,
                classification: 'filler',
                index
            };
        }
        
        // ============================================
        // DEFAULT: CONTEXT (neutral)
        // ============================================
        return {
            word: original,
            color: this.colors.CONTEXT,
            colorName: 'CONTEXT',
            reason: 'Context word - understood but neutral',
            tooltip: `⚪ CONTEXT: "${original}" provided general context`,
            classification: 'context',
            index
        };
    }
    
    /**
     * ============================================================================
     * GENERATE COLOR LEGEND
     * ============================================================================
     * Creates legend explaining color meanings
     * 
     * @returns {Array} Legend items
     * ============================================================================
     */
    generateColorLegend() {
        return [
            {
                color: this.colors.TRIGGER,
                emoji: '🔴',
                name: 'Trigger',
                description: 'Words that caused the scenario to match'
            },
            {
                color: this.colors.SYNONYM,
                emoji: '🟢',
                name: 'Synonym',
                description: 'Colloquial words matched to technical terms'
            },
            {
                color: this.colors.KEYWORD,
                emoji: '🟡',
                name: 'Keyword',
                description: 'Supporting context words that helped matching'
            },
            {
                color: this.colors.FILLER,
                emoji: '🔵',
                name: 'Filler',
                description: 'Conversational noise words that were ignored'
            },
            {
                color: this.colors.SUGGESTION,
                emoji: '🟣',
                name: 'Suggested',
                description: 'LLM suggests adding this word to template'
            },
            {
                color: this.colors.CONTEXT,
                emoji: '⚪',
                name: 'Context',
                description: 'General context words (understood but neutral)'
            }
        ];
    }
    
    /**
     * ============================================================================
     * GENERATE HTML TRANSCRIPT
     * ============================================================================
     * Converts colored words to HTML for display
     * 
     * @param {Array} coloredWords - Output from colorizeTranscript
     * @returns {String} HTML string
     * ============================================================================
     */
    generateHTMLTranscript(coloredWords) {
        console.log('🔵 [CHECKPOINT - HTML] Generating HTML transcript...');
        
        const htmlWords = coloredWords.map(wordObj => {
            const colorClass = `color-${wordObj.colorName.toLowerCase()}`;
            const tooltip = wordObj.tooltip.replace(/"/g, '&quot;');
            
            return `<span class="${colorClass}" data-tooltip="${tooltip}" title="${tooltip}">${wordObj.word}</span>`;
        });
        
        const html = htmlWords.join(' ');
        
        console.log('✅ [CHECKPOINT - HTML] HTML generated:', html.length, 'chars');
        
        return html;
    }
    
    /**
     * ============================================================================
     * GENERATE ANALYSIS SUMMARY
     * ============================================================================
     * Creates summary of color distribution
     * 
     * @param {Array} coloredWords - Output from colorizeTranscript
     * @returns {Object} Summary stats
     * ============================================================================
     */
    generateAnalysisSummary(coloredWords) {
        const summary = {
            totalWords: coloredWords.length,
            triggers: 0,
            synonyms: 0,
            keywords: 0,
            fillers: 0,
            suggestions: 0,
            context: 0
        };
        
        coloredWords.forEach(word => {
            switch (word.classification) {
                case 'trigger': summary.triggers++; break;
                case 'synonym': summary.synonyms++; break;
                case 'keyword': summary.keywords++; break;
                case 'filler': summary.fillers++; break;
                case 'suggestion': summary.suggestions++; break;
                case 'context': summary.context++; break;
            }
        });
        
        // Calculate percentages
        summary.triggerPercentage = (summary.triggers / summary.totalWords) * 100;
        summary.fillerPercentage = (summary.fillers / summary.totalWords) * 100;
        summary.suggestionPercentage = (summary.suggestions / summary.totalWords) * 100;
        
        return summary;
    }
    
    /**
     * ============================================================================
     * EXPORT FOR FRONTEND
     * ============================================================================
     * Generates complete package for frontend display
     * 
     * @param {String} transcript - Original transcript
     * @param {Object} tierResults - Tier results
     * @param {Array} suggestions - LLM suggestions
     * @returns {Object} Complete display package
     * ============================================================================
     */
    exportForFrontend(transcript, tierResults, suggestions) {
        console.log('🔵 [CHECKPOINT - EXPORT] Generating frontend package...');
        
        try {
            const coloredWords = this.colorizeTranscript(transcript, tierResults, suggestions);
            const html = this.generateHTMLTranscript(coloredWords);
            const summary = this.generateAnalysisSummary(coloredWords);
            const legend = this.generateColorLegend();
            
            console.log('✅ [CHECKPOINT - EXPORT] Frontend package ready');
            
            return {
                transcript,
                coloredWords,
                html,
                summary,
                legend,
                generatedAt: new Date()
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - EXPORT ERROR]:', error.message);
            throw error;
        }
    }
}

module.exports = TranscriptColorizer;

