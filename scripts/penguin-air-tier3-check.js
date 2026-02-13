/**
 * QUICK TIER 3 DIAGNOSTIC FOR PENGUIN AIR
 * Run this in MongoDB shell or via script
 */

// 1. Check intelligence config
db.v2companies.findOne(
    { _id: ObjectId("68e3f77a9d623b8058c700c4") },
    { 
        "companyName": 1,
        "aiAgentSettings.useGlobalIntelligence": 1,
        "aiAgentSettings.productionIntelligence": 1,
        "aiAgentSettings.templateId": 1
    }
)

// 2. Check global intelligence (if using global)
db.adminsettings.findOne(
    {},
    {
        "globalProductionIntelligence.enabled": 1,
        "globalProductionIntelligence.thresholds": 1
    }
)

// 3. Count scenarios from template
db.globalinstantresponsetemplates.aggregate([
    { $match: { _id: ObjectId("68fb535130d19aec696d8123") } },
    { $project: { 
        templateName: 1,
        scenarioCount: { $size: { $ifNull: ["$scenarios", []] } }
    }}
])

// 4. Check recent BlackBox calls for tier usage
db.blackboxrecordings.aggregate([
    { $match: { 
        companyId: "68e3f77a9d623b8058c700c4",
        startedAt: { $gte: new Date(Date.now() - 24*60*60*1000) } // Last 24 hours
    }},
    { $unwind: "$events" },
    { $match: { 
        "events.type": { $in: [
            "TIER3_FAST_MATCH", 
            "TIER3_EMBEDDING_MATCH", 
            "TIER3_LLM_FALLBACK_CALLED"
        ]}
    }},
    { $group: {
        _id: "$events.type",
        count: { $sum: 1 }
    }},
    { $sort: { count: -1 } }
])
