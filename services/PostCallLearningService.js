// services/PostCallLearningService.js
//
// Runs AFTER a call is resolved to update:
//  - CallerIntentHistory
//  - IntentResolutionPath
//  - ResponseCache

const CallerIntentHistory = require("../models/memory/CallerIntentHistory");
const IntentResolutionPath = require("../models/memory/IntentResolutionPath");
const ResponseCache = require("../models/memory/ResponseCache");
const logger = require('../utils/logger');

async function learnFromCall(context) {
  try {
    const {
      companyID,
      callState,
      matchedScenario,
      finalAction,
      triageResult,
      finalResponse,
      userInput,
      userInputNormalized,
      frontlineIntelResult
    } = context;

    if (!companyID || !callState || !callState.from) {
      logger.debug('[POST-CALL LEARNING] Missing companyId or phone number, skipping learning');
      return;
    }

    const phoneNumber = callState.from;

    logger.info('[POST-CALL LEARNING] 📚 Starting post-call learning', {
      companyId: companyID,
      callId: context.callId,
      finalAction,
      phoneNumber: phoneNumber.substring(0, 8) + '***'
    });

    // Define what you call a "successful" call
    const success =
      finalAction === "BOOKED" ||
      finalAction === "TRANSFER_SUCCESS" ||
      finalAction === "NORMAL_END" ||
      finalAction === "continue"; // Added "continue" as successful completion

    if (!success) {
      logger.debug('[POST-CALL LEARNING] Call not successful, skipping learning', {
        finalAction,
        callId: context.callId
      });
      return;
    }

    // Extract intent from multiple possible sources
    const intent =
      triageResult?.intent ||
      frontlineIntelResult?.detectedIntent ||
      matchedScenario?.intent ||
      matchedScenario?.name ||
      "UNKNOWN";

    const triageCategory = 
      triageResult?.category || 
      frontlineIntelResult?.triageDecision ||
      null;

    logger.debug('[POST-CALL LEARNING] Extracted intent and category', {
      intent,
      triageCategory,
      sources: {
        triageResult: Boolean(triageResult),
        frontlineIntel: Boolean(frontlineIntelResult),
        matchedScenario: Boolean(matchedScenario)
      }
    });

    // 1) CallerIntentHistory
    await CallerIntentHistory.updateOne(
      { companyId: companyID, phoneNumber, intent },
      {
        $inc: {
          totalCount: 1,
          successCount: 1
        },
        $set: {
          lastOutcome: finalAction,
          lastCallAt: new Date(),
          triageCategory
        }
      },
      { upsert: true }
    );

    logger.debug('[POST-CALL LEARNING] ✅ Updated CallerIntentHistory', {
      companyId: companyID,
      intent
    });

    // 2) IntentResolutionPath
    if (matchedScenario && (matchedScenario._id || matchedScenario.scenarioId)) {
      const scenarioId = (matchedScenario._id ? matchedScenario._id.toString() : matchedScenario.scenarioId);

      const path = await IntentResolutionPath.findOneAndUpdate(
        { companyId: companyID, intent, triageCategory, scenarioId },
        {
          $inc: {
            sampleSize: 1,
            successCount: 1
          }
        },
        {
          upsert: true,
          new: true
        }
      );

      if (path.sampleSize >= 3) {
        path.successRate =
          path.successCount > 0
            ? path.successCount / path.sampleSize
            : 0.0;
        await path.save();
      }

      logger.debug('[POST-CALL LEARNING] ✅ Updated IntentResolutionPath', {
        companyId: companyID,
        intent,
        scenarioId,
        sampleSize: path.sampleSize,
        successRate: path.successRate
      });
    }

    // 3) ResponseCache
    if (finalResponse && userInputNormalized) {
      await ResponseCache.updateOne(
        {
          companyId: companyID,
          normalizedHash: userInputNormalized
        },
        {
          $setOnInsert: {
            userText: userInput,
            intent,
            triageCategory
          },
          $set: {
            responseText: finalResponse,
            lastUsedAt: new Date()
          },
          $inc: {
            hitCount: 1
          }
        },
        { upsert: true }
      );

      logger.debug('[POST-CALL LEARNING] ✅ Updated ResponseCache', {
        companyId: companyID,
        normalizedHash: userInputNormalized.substring(0, 30) + '...'
      });
    }

    logger.info('[POST-CALL LEARNING] ✅ Post-call learning complete', {
      companyId: companyID,
      callId: context.callId,
      intent,
      updatedRecords: {
        callerHistory: true,
        resolutionPath: Boolean(matchedScenario),
        responseCache: Boolean(finalResponse && userInputNormalized)
      }
    });

  } catch (err) {
    // Never let learning failures kill calls
    logger.error("[POST-CALL LEARNING] learnFromCall error:", {
      error: err.message,
      stack: err.stack,
      companyId: context.companyID,
      callId: context.callId
    });
  }
}

module.exports = {
  learnFromCall
};

