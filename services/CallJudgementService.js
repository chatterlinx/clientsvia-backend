// ============================================================================
// 🎯 CALL JUDGEMENT SERVICE - BRAIN-WIRED ANALYTICS
// ============================================================================
// PURPOSE: Analyze completed calls and compute metrics/judgements
// FEATURES:
//   - Compute timing metrics (latency, dead air, turns)
//   - Determine call outcome (BOOKED, TRANSFERRED, etc.)
//   - Calculate success score
//   - Generate LLM-based summary, intent, sentiment
// CALLED BY: v2AIAgentRuntime / CallFlowExecutor at end of call
// ============================================================================

const logger = require('../utils/logger');
const openaiClient = require('../config/openai');

class CallJudgementService {
    
    // ========================================================================
    // 🔢 COMPUTE METRICS FROM EVENTS
    // ========================================================================
    
    /**
     * Compute timing metrics from call events
     * @param {Array} events - Array of call events with timestamps
     * @param {Date} startedAt - Call start time
     * @param {Date} endedAt - Call end time
     * @returns {Object} metrics object
     */
    static computeMetrics(events, startedAt, endedAt) {
        try {
            const metrics = {
                avgAgentLatencyMs: 0,
                maxAgentLatencyMs: 0,
                deadAirMsTotal: 0,
                deadAirSegments: 0,
                turnsCaller: 0,
                turnsAgent: 0
            };
            
            if (!events || events.length === 0) {
                return metrics;
            }
            
            // Count turns
            metrics.turnsCaller = events.filter(e => e.type === 'caller_utterance').length;
            metrics.turnsAgent = events.filter(e => e.type === 'agent_reply').length;
            
            // Compute latencies (time from caller utterance to next agent reply)
            const latencies = [];
            
            for (let i = 0; i < events.length - 1; i++) {
                const currentEvent = events[i];
                const nextEvent = events[i + 1];
                
                if (currentEvent.type === 'caller_utterance' && nextEvent.type === 'agent_reply') {
                    const latency = nextEvent.at.getTime() - currentEvent.at.getTime();
                    latencies.push(latency);
                    
                    // Track max latency
                    if (latency > metrics.maxAgentLatencyMs) {
                        metrics.maxAgentLatencyMs = latency;
                    }
                    
                    // Dead air = latency > 1500ms
                    if (latency > 1500) {
                        metrics.deadAirMsTotal += latency;
                        metrics.deadAirSegments += 1;
                    }
                }
            }
            
            // Average latency
            if (latencies.length > 0) {
                metrics.avgAgentLatencyMs = Math.round(
                    latencies.reduce((sum, l) => sum + l, 0) / latencies.length
                );
            }
            
            logger.info('[CALL JUDGEMENT] Metrics computed', {
                turnsCaller: metrics.turnsCaller,
                turnsAgent: metrics.turnsAgent,
                avgLatency: metrics.avgAgentLatencyMs,
                deadAirSegments: metrics.deadAirSegments
            });
            
            return metrics;
            
        } catch (error) {
            logger.error('[CALL JUDGEMENT] Error computing metrics:', error);
            return {
                avgAgentLatencyMs: 0,
                maxAgentLatencyMs: 0,
                deadAirMsTotal: 0,
                deadAirSegments: 0,
                turnsCaller: 0,
                turnsAgent: 0
            };
        }
    }
    
    // ========================================================================
    // 🎯 DETERMINE OUTCOME
    // ========================================================================
    
    /**
     * Determine call outcome from events
     * @param {Array} events - Array of call events
     * @returns {Object} outcome object with status and details
     */
    static determineOutcome(events) {
        try {
            let status = 'UNKNOWN';
            let details = '';
            
            if (!events || events.length === 0) {
                return { status, details };
            }
            
            // Check for specific outcome events (priority order)
            if (events.some(e => e.type === 'booking_done')) {
                status = 'BOOKED';
                details = 'Customer successfully booked an appointment';
            } else if (events.some(e => e.type === 'distress_transfer')) {
                status = 'TRANSFERRED';
                details = 'Call transferred due to distress or escalation';
            } else if (events.some(e => e.type === 'call_transfer')) {
                status = 'TRANSFERRED';
                details = 'Call transferred to agent or specialist';
            } else if (events.some(e => e.type === 'escalation')) {
                status = 'TRANSFERRED';
                details = 'Call escalated to supervisor or specialist';
            } else if (events.some(e => e.type === 'hangup')) {
                // Determine if hangup was successful or failed
                const hasAgentReplies = events.some(e => e.type === 'agent_reply');
                if (hasAgentReplies && events.length >= 4) {
                    status = 'MESSAGE_TAKEN';
                    details = 'Call completed, message or information taken';
                } else {
                    status = 'HUNG_UP';
                    details = 'Customer hung up without resolution';
                }
            } else if (events.length > 0) {
                // Call in progress or incomplete
                status = 'IN_PROGRESS';
                details = 'Call still in progress or incomplete';
            }
            
            logger.info('[CALL JUDGEMENT] Outcome determined', { status, details });
            
            return { status, details };
            
        } catch (error) {
            logger.error('[CALL JUDGEMENT] Error determining outcome:', error);
            return {
                status: 'UNKNOWN',
                details: 'Error determining outcome'
            };
        }
    }
    
    // ========================================================================
    // 📊 CALCULATE SUCCESS SCORE
    // ========================================================================
    
    /**
     * Calculate success score (0-100) based on multiple factors
     * @param {Object} params - Factors for score calculation
     * @returns {Number} successScore (0-100)
     */
    static calculateSuccessScore({ outcome, metrics, sentiment, usedFallback, confidence }) {
        try {
            let score = 100;
            
            // Outcome impact (biggest factor)
            if (outcome.status === 'BOOKED') {
                score -= 0; // Perfect outcome
            } else if (outcome.status === 'TRANSFERRED' || outcome.status === 'MESSAGE_TAKEN') {
                score -= 10; // Good outcome, minor deduction
            } else if (outcome.status === 'HUNG_UP') {
                score -= 40; // Poor outcome
            } else if (outcome.status === 'FAILED') {
                score -= 60; // Very poor outcome
            } else {
                score -= 20; // Unknown/in progress
            }
            
            // Latency impact
            if (metrics.avgAgentLatencyMs > 3000) {
                score -= 20; // Very slow
            } else if (metrics.avgAgentLatencyMs > 2000) {
                score -= 10; // Slow
            } else if (metrics.avgAgentLatencyMs > 1000) {
                score -= 5; // Acceptable
            }
            
            // Dead air impact
            if (metrics.deadAirSegments > 3) {
                score -= 15;
            } else if (metrics.deadAirSegments > 1) {
                score -= 10;
            }
            
            // Sentiment impact
            if (sentiment === 'frustrated' || sentiment === 'negative') {
                score -= 15;
            } else if (sentiment === 'neutral') {
                score -= 5;
            }
            // Positive sentiment = no deduction
            
            // Fallback impact
            if (usedFallback) {
                score -= 10;
            }
            
            // Low confidence impact
            if (confidence && confidence < 0.5) {
                score -= 10;
            } else if (confidence && confidence < 0.7) {
                score -= 5;
            }
            
            // Ensure score is between 0-100
            score = Math.max(0, Math.min(100, score));
            
            logger.info('[CALL JUDGEMENT] Success score calculated', { score });
            
            return Math.round(score);
            
        } catch (error) {
            logger.error('[CALL JUDGEMENT] Error calculating success score:', error);
            return 50; // Default to neutral score on error
        }
    }
    
    // ========================================================================
    // 🤖 GENERATE LLM-BASED ANALYSIS
    // ========================================================================
    
    /**
     * Generate summary, intent, and sentiment using LLM
     * @param {Object} callData - Call data with transcript/events
     * @returns {Object} { summary, callerIntent, sentiment, sentimentScore }
     */
    static async generateAnalysis(callData) {
        try {
            const { customerQuery, aiResponse, events, conversation } = callData;
            
            // Build transcript from events or conversation turns
            let transcript = '';
            
            if (conversation && conversation.turns && conversation.turns.length > 0) {
                transcript = conversation.turns
                    .map(turn => `${turn.role || turn.speaker}: ${turn.text}`)
                    .join('\n');
            } else if (events && events.length > 0) {
                transcript = events
                    .filter(e => e.type === 'caller_utterance' || e.type === 'agent_reply')
                    .map(e => `${e.type === 'caller_utterance' ? 'Caller' : 'Agent'}: ${e.text || ''}`)
                    .join('\n');
            } else if (customerQuery && aiResponse) {
                transcript = `Caller: ${customerQuery}\nAgent: ${aiResponse}`;
            }
            
            if (!transcript) {
                logger.warn('[CALL JUDGEMENT] No transcript available for analysis');
                return {
                    summary: 'No transcript available',
                    callerIntent: 'Unknown',
                    sentiment: 'neutral',
                    sentimentScore: 0
                };
            }
            
            // Truncate transcript if too long (OpenAI context limit)
            const maxLength = 3000;
            const truncatedTranscript = transcript.length > maxLength 
                ? transcript.substring(0, maxLength) + '...[truncated]'
                : transcript;
            
            // Call OpenAI for analysis
            const prompt = `Analyze this customer service call transcript:

${truncatedTranscript}

Provide a JSON response with:
1. summary: One-paragraph summary of the call (2-3 sentences max)
2. callerIntent: What the caller wanted in 1 short sentence
3. sentiment: Overall caller sentiment (positive/neutral/negative/frustrated)
4. sentimentScore: Numeric sentiment score from -1 (very negative) to +1 (very positive)

Respond ONLY with valid JSON:`;
            
            const completion = await openaiClient.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a call analysis expert. Respond only with valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 500
            });
            
            const responseText = completion.choices[0].message.content.trim();
            
            // Parse JSON response
            let analysis;
            try {
                // Remove markdown code blocks if present
                const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                analysis = JSON.parse(cleanedResponse);
            } catch (parseError) {
                logger.error('[CALL JUDGEMENT] Failed to parse LLM response:', parseError);
                throw parseError;
            }
            
            logger.info('[CALL JUDGEMENT] LLM analysis generated', {
                sentiment: analysis.sentiment,
                sentimentScore: analysis.sentimentScore
            });
            
            return {
                summary: analysis.summary || 'No summary available',
                callerIntent: analysis.callerIntent || 'Unknown',
                sentiment: analysis.sentiment || 'neutral',
                sentimentScore: analysis.sentimentScore || 0
            };
            
        } catch (error) {
            logger.error('[CALL JUDGEMENT] Error generating LLM analysis:', error);
            return {
                summary: 'Error generating summary',
                callerIntent: 'Unknown',
                sentiment: 'neutral',
                sentimentScore: 0
            };
        }
    }
    
    // ========================================================================
    // 🎯 MAIN METHOD: ANALYZE COMPLETE CALL
    // ========================================================================
    
    /**
     * Analyze a completed call and return all judgement fields
     * @param {Object} callLogDraft - Call log with events, transcript, etc.
     * @returns {Object} Complete analysis with outcome, metrics, summary, etc.
     */
    static async analyze(callLogDraft) {
        try {
            logger.info('[CALL JUDGEMENT] Starting call analysis', {
                callId: callLogDraft.callId,
                eventsCount: callLogDraft.events?.length || 0
            });
            
            const {
                events,
                startedAt,
                endedAt,
                usedFallback,
                confidence,
                conversation
            } = callLogDraft;
            
            // 1. Compute metrics from events
            const metrics = this.computeMetrics(events, startedAt, endedAt);
            
            // 2. Determine outcome
            const outcome = this.determineOutcome(events);
            
            // 3. Generate LLM analysis (summary, intent, sentiment)
            const analysis = await this.generateAnalysis(callLogDraft);
            
            // 4. Calculate success score
            const successScore = this.calculateSuccessScore({
                outcome,
                metrics,
                sentiment: analysis.sentiment,
                usedFallback,
                confidence
            });
            
            // 5. Determine if it's a "good call"
            const goodCall = successScore >= 70;
            
            // Update outcome with success score and goodCall flag
            outcome.successScore = successScore;
            outcome.goodCall = goodCall;
            
            logger.info('[CALL JUDGEMENT] Analysis complete', {
                callId: callLogDraft.callId,
                outcomeStatus: outcome.status,
                successScore,
                goodCall,
                sentiment: analysis.sentiment
            });
            
            return {
                outcome,
                metrics,
                summary: analysis.summary,
                callerIntent: analysis.callerIntent,
                sentiment: analysis.sentiment,
                sentimentScore: analysis.sentimentScore
            };
            
        } catch (error) {
            logger.error('[CALL JUDGEMENT] Error analyzing call:', error);
            
            // Return safe defaults on error
            return {
                outcome: {
                    status: 'UNKNOWN',
                    details: 'Error analyzing call',
                    successScore: 50,
                    goodCall: false
                },
                metrics: {
                    avgAgentLatencyMs: 0,
                    maxAgentLatencyMs: 0,
                    deadAirMsTotal: 0,
                    deadAirSegments: 0,
                    turnsCaller: 0,
                    turnsAgent: 0
                },
                summary: 'Error generating summary',
                callerIntent: 'Unknown',
                sentiment: 'neutral',
                sentimentScore: 0
            };
        }
    }
}

module.exports = CallJudgementService;

