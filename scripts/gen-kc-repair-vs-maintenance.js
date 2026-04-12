#!/usr/bin/env node
/**
 * gen-kc-repair-vs-maintenance.js
 * Generates kc-repair-vs-maintenance.json for "Repair Service vs. Maintenance" card.
 *
 * WORKFLOW:
 *   1. Create empty container titled "Repair Service vs. Maintenance" in services.html
 *   2. Run: node scripts/gen-kc-repair-vs-maintenance.js
 *   3. Import kc-repair-vs-maintenance.json into the container via services.html
 *   4. Re-score All → Fix All → Generate Missing Audio
 *
 * 24 sections covering:
 *   - Price trigger sections (0-2)
 *   - Downgrade attempt sections (3-8)
 *   - Objection handling (9-14)
 *   - Explanation modules (15-20)
 *   - Resolution (21-23)
 *
 * Handles ONE specific argument: callers with a broken AC (not cooling) who
 * try to mentally downgrade a {reg_diagnostic_fee} diagnostic visit into a cheaper maintenance
 * visit. Each section is a tiny reusable audio brick — the agent responds
 * with the RIGHT small module for the EXACT moment in the conversation.
 */
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// GROQ CONTENT CATEGORIES — reusable deep content templates (~350-400 words)
// ═══════════════════════════════════════════════════════════════════════════

const groqCat = {

  price_comparison: `The diagnostic service call is {reg_diagnostic_fee} and the maintenance visit is {reg_maintenance_fee} for a 20-point checkup. These two services exist at different price points because they serve completely different purposes and are dispatched, staffed, and scoped differently.

The {reg_diagnostic_fee} diagnostic service call is for a system that has an active problem. The caller has described a symptom — no cooling, warm air from vents, system not turning on, unusual noises, or some other indication that something is not working correctly. The technician arrives specifically to evaluate the system, identify the root cause of the problem, and present the findings along with repair options and pricing before any work is done. The {reg_diagnostic_fee} covers the technician coming out, performing the evaluation, and going over everything with the homeowner. If the homeowner approves a repair, the work begins. If not, there is no obligation beyond the diagnostic fee. This visit is reactive and focused on solving the specific issue the caller reported.

The {reg_maintenance_fee} maintenance visit is a 20-point preventive checkup for a system that is currently operating. It is scheduled in advance, typically every six months, and the technician works through a structured inspection checklist covering electrical, mechanical, refrigerant, airflow, and safety components. The goal is to keep a working system working — to catch small issues before they become expensive failures, maintain efficiency, and protect the manufacturer warranty. Maintenance technicians follow the preventive checklist and document findings. They are not dispatched to troubleshoot an active breakdown.

The pricing difference reflects the difference in purpose. The diagnostic is lower in cost because it is a focused evaluation visit. The maintenance is higher because it is a comprehensive preventive service covering every major component. One is not a substitute for the other. A caller whose system is not cooling needs the diagnostic visit because that is what identifies the cause and leads to the repair. Booking maintenance on a system that is not working does not address the active problem and can delay getting the caller fixed. The correct path for a system that is not cooling is the {reg_diagnostic_fee} diagnostic service call, where the technician evaluates the system and goes over findings and repair options with the homeowner before any work begins.`,

  downgrade_redirect: `When a caller hears the {reg_diagnostic_fee} diagnostic fee and then asks about maintenance pricing, they are often trying to find a less expensive path to getting their system looked at. This is a natural reaction — nobody wants to spend more than they have to. But booking a maintenance visit for a system that is not cooling does not save money. It costs more and does not address the problem.

A maintenance visit is a preventive service for a system that is currently working. The technician follows a structured 20-point inspection checklist designed to keep a healthy system running well. They clean coils, check refrigerant pressures, test capacitors, verify airflow, and inspect electrical connections — all under the assumption that the system is operating and the goal is to keep it that way. A maintenance technician is not dispatched to troubleshoot why a system stopped cooling. They are scheduled differently, routed differently, and their visit is scoped for routine preventive work, not active problem diagnosis.

When a system is not cooling, the problem could be a failed capacitor, a seized compressor, a refrigerant leak, a bad contactor, a tripped safety switch, a control board issue, or any number of electrical and mechanical failures. Diagnosing the actual cause requires a technician who arrives specifically to evaluate that symptom, with the tools, parts availability, and schedule time allocated for troubleshooting. That is what the diagnostic visit provides.

The analogy works like this: if a car will not start, taking it in for an oil change does not get it started. The oil change mechanic may notice the engine has a problem, but they are not there to diagnose it, they do not have the diagnostic equipment, and they are not allocated the time. The car owner would still need a separate diagnostic visit, having lost time and potentially allowed the problem to worsen.

Booking a maintenance visit when the system is not cooling means the caller pays {reg_maintenance_fee} for a service that does not diagnose or fix their problem. They would still need a diagnostic visit afterward. The fastest and most cost-effective path to getting a non-cooling system evaluated and repaired is the {reg_diagnostic_fee} diagnostic service call, where the technician identifies the cause and goes over repair options before any additional work is done.`,

  scope_creep: `Callers sometimes ask whether the maintenance technician can just look at their problem while performing the tune-up, or they assume that because they have not serviced the system in a long time, maybe all it needs is cleaning or a filter change. These are reasonable assumptions, but they misunderstand how maintenance visits are structured and what causes a system to stop cooling.

A maintenance appointment is planned in advance for routine preventive service. The technician is scheduled with a specific time block based on a standard inspection checklist. They arrive prepared for a 20-point checkup — not for open-ended troubleshooting. If the maintenance technician notices an obvious problem during the checkup, they will flag it. But they cannot open a diagnostic case, pull parts from inventory, or allocate the additional time needed to fully troubleshoot and repair an active breakdown. Those are separate appointments with separate scoping, scheduling, and parts preparation.

When a caller says they are overdue for maintenance and maybe that is why the system stopped cooling, they may be partially right — lack of maintenance can contribute to accelerated wear on components. But being overdue for service does not mean a tune-up will restore cooling. A system that has stopped cooling has a specific mechanical, electrical, or refrigerant issue that needs to be identified. It could be a failed capacitor, a bad compressor, a refrigerant leak, a faulty contactor, a failed control board, or a wiring issue. A maintenance checklist does not diagnose these conditions.

Similarly, when a caller says maybe the system just needs a filter or the coils cleaned, they are hoping the fix is simple and inexpensive. And sometimes it is — a severely clogged filter or a frozen evaporator coil from restricted airflow can cause a system to stop cooling. But those conditions are symptoms that a diagnostic technician evaluates as part of a broader troubleshooting process. The diagnostic technician checks airflow, electrical components, refrigerant levels, controls, and mechanical operation to determine the actual cause. If it turns out to be a simple airflow restriction, the repair may be straightforward. But assuming the cause before diagnosis risks booking the wrong visit and delaying the actual fix.

The proper sequence is diagnostic first, then maintenance once the system is operational again.`,

  objection_handling: `When a caller pushes back on the diagnostic fee or the policy of not booking maintenance for an active breakdown, the response should validate their concern while clearly explaining why the process exists to protect them, not restrict them.

The {reg_diagnostic_fee} diagnostic fee covers a licensed technician coming to the property, evaluating the system, identifying the root cause of the problem, and going over findings and repair options with the homeowner before any additional work is done. There is no obligation to approve any repairs. The caller gets a clear picture of what is wrong and what it costs to fix before making any decisions. This is not a trip charge with no value — it is a professional evaluation that tells the caller exactly what they are dealing with.

When a caller says the company is trying to upsell them, the answer is straightforward: a maintenance visit and a diagnostic visit are two different services scheduled differently, routed differently, and often assigned to different technicians. Recommending the diagnostic for an active breakdown is not an upsell — it is routing the caller to the correct service for their situation. Booking maintenance would actually cost the caller more and would not address the active problem.

When a caller insists on booking maintenance anyway because they are willing to pay the higher price, the answer remains the same. The issue is not about willingness to pay — it is about the type of appointment. Maintenance appointments are scoped for preventive service on a working system. Even at the higher price, the maintenance technician is not dispatched to diagnose an active breakdown. The caller would still need a separate diagnostic visit afterward, having spent {reg_maintenance_fee} on a service that did not address their problem.

When a caller asks why they cannot just book whatever they want, the framing should always be about helping them avoid the wrong visit. The company does not book maintenance as a substitute for an active breakdown because it delays getting the caller fixed. The fastest path to a working system is the diagnostic visit, where the technician evaluates the specific issue and presents repair options. After the system is repaired, the company can absolutely help the caller set up a maintenance schedule going forward to prevent future problems.`,

  service_definitions: `A maintenance visit and a diagnostic service call are two fundamentally different services with different purposes, different scheduling, different technician preparation, and different outcomes. Understanding the distinction helps the caller get the right service for their situation without wasting time or money.

Maintenance is preventive service for a system that is currently operating. It is a 20-point checkup performed every six months at {reg_maintenance_fee} per visit. During maintenance, the technician works through a structured inspection checklist covering the condenser coil, evaporator coil, refrigerant pressures, capacitor values, contactor condition, electrical connections, condensate drain, blower motor and wheel, air filter, thermostat calibration, temperature split, and safety controls. For heating systems, the checklist also covers the heat exchanger, ignition sequence, flame sensor, gas pressure, inducer motor, and flue venting. The purpose is to keep every component clean, calibrated, and operating within specification so the system runs efficiently and avoids unexpected breakdowns. Maintenance is scheduled in advance during regular business hours and is planned for routine servicing.

A diagnostic service call is reactive. It is scheduled because the system has a specific problem — not cooling, blowing warm air, making unusual noises, leaking water, cycling on and off, or not turning on at all. The technician arrives specifically to evaluate the system and identify the root cause of the reported symptom. The diagnostic fee is {reg_diagnostic_fee} and covers the technician coming out, performing the evaluation, and going over findings and repair options with the homeowner before any work is done.

Maintenance keeps a working system working. Diagnostic identifies why a system stopped working. A system that is not cooling right now has an active problem that requires diagnosis, not preventive maintenance. Booking a maintenance visit for an active breakdown does not address the problem, costs more than the diagnostic, and delays getting the system repaired. The correct appointment for a system that is not cooling is the {reg_diagnostic_fee} diagnostic service call.

Once the current issue is diagnosed and repaired, maintenance can be scheduled going forward to help prevent future problems and keep the system running at peak performance.`,

  operational_reality: `Maintenance visits and diagnostic repair visits are dispatched, routed, and staffed differently because they serve different operational purposes. Understanding how the scheduling works explains why booking the wrong visit type can delay getting the caller fixed.

Maintenance visits are typically planned in advance and scheduled during standard business hours. The scheduling team assigns a time block based on the preventive inspection checklist, usually 45 to 90 minutes depending on the system type. The technician arrives prepared for routine servicing — cleaning coils, checking electrical connections, testing capacitors, measuring pressures, and documenting findings. Their truck is stocked for standard maintenance components and their schedule is built around a predictable workflow.

Diagnostic repair visits are dispatched based on urgency and symptom. When a caller reports that their system is not cooling, the dispatch team prioritizes the call as an active breakdown and routes a technician who is equipped for troubleshooting. The repair technician carries diagnostic tools, common replacement parts like capacitors, contactors, relays, and control boards, and has the schedule flexibility to spend the time needed to identify the root cause and complete the repair if approved.

When a maintenance appointment is booked for a system that is not cooling, the scheduling system treats it as a routine preventive visit. The technician arrives expecting a working system. If they discover an active breakdown, they are not positioned to diagnose and repair it within the maintenance appointment window. They may not have the specific parts needed, their schedule may not allow the additional troubleshooting time, and the visit is scoped for a preventive checklist, not open-ended diagnosis.

The result is a wasted visit. The caller pays {reg_maintenance_fee} for maintenance that cannot address their active problem, then still needs to schedule and pay for a separate diagnostic visit. Meanwhile, the system remains down and the caller has lost a day waiting for a visit that was never going to fix the issue.

Booking the right appointment type from the start — the {reg_diagnostic_fee} diagnostic service call for a system that is not cooling — sends the right technician with the right tools and the right schedule allocation to get the problem identified and repaired as efficiently as possible.`,

  resolution: `When the caller agrees to book the diagnostic service call, the transition should be warm and efficient. The goal is to acknowledge their decision positively and move directly into collecting the booking information without unnecessary explanation or continued selling. The caller has already been through a conversation about the difference between maintenance and diagnostic services. They understand the distinction and have agreed to the correct appointment type. Restating the difference at this point would feel repetitive and could introduce doubt.

The booking process requires the caller's name, phone number, and address. The scheduling team matches the caller with the next available technician based on location and availability. For active breakdowns like a system not cooling, the scheduling priority is higher than routine maintenance, which often means shorter wait times for an appointment.

Once the current issue is diagnosed and repaired, maintenance becomes a natural next step. A system that has just been repaired is an ideal candidate for a maintenance plan because the repair technician has already evaluated the system's overall condition. If other components showed signs of wear during the diagnostic, the maintenance visit addresses those proactively. Setting up a regular maintenance schedule — typically every six months at {reg_maintenance_fee} per visit for a 20-point checkup — helps prevent the exact situation the caller is experiencing now. Regular preventive service catches failing capacitors, dirty coils, refrigerant issues, and electrical problems before they cause a complete breakdown.

The after-repair maintenance conversation should feel like a helpful suggestion, not a sales push. The caller just went through an unexpected breakdown and paid for a repair. Framing maintenance as a way to avoid this situation in the future resonates naturally because the caller is experiencing the consequences of not having preventive service. If they are interested, the booking can be set up on the same call. If not, no pressure — they know the option exists for whenever they are ready.`,
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const sections = [

  // ════════════════════════════════════════════════════════════════════════
  // PRICE TRIGGER SECTIONS (0-2)
  // ════════════════════════════════════════════════════════════════════════

  { // 0
    label: 'Diagnostic Price When System Not Cooling',
    content: 'I am sorry to hear that. We can absolutely get a technician out to diagnose it. Our diagnostic service call is {reg_diagnostic_fee}. That covers the full evaluation and the technician goes over findings and repair options with you before any work is done.',
    groqKey: 'price_comparison',
    callerPhrases: [
      'how much to come out and look at it',
      'how much is it for someone to come out',
      'what does it cost to have someone check my ac',
      'how much for a service call',
      'what is the fee for a technician to come out',
      'how much do you charge for a diagnostic',
      'what is the cost to diagnose my ac',
      'how much to figure out why it is not cooling',
      'can you tell me the price to check my system',
      'how much is a service call for no cooling',
      'what do you charge to look at my ac',
      'how much to send someone out',
      'what is the diagnostic fee',
      'how much for someone to check why my ac is not working',
      'how much is the service call fee',
    ],
    negativeKeywords: [
      'how much is maintenance',
      'tune-up cost',
      'replacement estimate',
      'installation quote',
      'duct cleaning pricing',
      'new system pricing',
    ],
  },

  { // 1
    label: 'Maintenance Price Question After Hearing Diagnostic Fee',
    content: 'Our maintenance is a 20-point checkup for {reg_maintenance_fee} every six months. That service is for a system that is currently operating and needs routine servicing. Since your system is not cooling right now, you would need a diagnostic visit so the technician can properly troubleshoot the issue.',
    groqKey: 'price_comparison',
    callerPhrases: [
      'how much is maintenance',
      'how much is a tune-up',
      'what does maintenance cost',
      'how much is a checkup',
      'what is the price for a tune-up',
      'how much for maintenance instead',
      'can I do maintenance instead of the diagnostic',
      'what is your maintenance price',
      'how much is the tune-up visit',
      'how much for a tune-up on my ac',
      'what do you charge for a tune-up',
      'is there a maintenance option',
      'what about just getting a tune-up',
      'how much is it for a checkup instead',
      'can you tell me the maintenance price',
    ],
    negativeKeywords: [
      'system working fine needs tune-up',
      'schedule seasonal maintenance',
      'annual checkup on working unit',
      'enroll in maintenance plan',
      'routine service no issue',
      'preventive only system is fine',
    ],
  },

  { // 2
    label: 'Comparing Maintenance And Diagnostic Pricing',
    content: 'I understand the question. Maintenance is {reg_maintenance_fee} for a preventive checkup on a working system. The diagnostic is {reg_diagnostic_fee} for a system that has a problem. They are different services dispatched differently. For a system not cooling, the diagnostic is the correct visit.',
    groqKey: 'price_comparison',
    callerPhrases: [
      'why can I not just do the maintenance and get both',
      'maintenance costs more so it should cover more right',
      'if I pay more for maintenance does it include diagnosis',
      'the maintenance is more so why not just do that',
      'does the maintenance cover diagnosing my problem too',
      'can the maintenance visit also figure out what is wrong',
      'since maintenance costs more would it cover the repair',
      'why would I pay less for the diagnostic when maintenance covers more',
      'if I get the maintenance would they fix it too',
      'I will pay the higher price just do the maintenance',
      'the {reg_maintenance_fee} should cover checking the problem too',
      'why not just book maintenance it costs more anyway',
      'does the {reg_maintenance_fee} checkup include troubleshooting',
      'can I combine both into one visit',
      'why are there two separate visits',
    ],
    negativeKeywords: [
      'working system maintenance',
      'seasonal tune-up booking',
      'annual checkup',
      'maintenance plan pricing',
      'just book me for maintenance',
      'take my chances with tune-up',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // DOWNGRADE ATTEMPT SECTIONS (3-8)
  // ════════════════════════════════════════════════════════════════════════

  { // 3
    label: 'Just Book Me For Maintenance Instead',
    content: 'I understand why you are asking. A maintenance appointment is not the same as a repair diagnosis. Maintenance calls are routed differently, usually booked in advance, and the technician may not be scheduled with the time, tools, or parts needed for a no-cooling issue.',
    groqKey: 'downgrade_redirect',
    callerPhrases: [
      'just book me for maintenance',
      'can you just schedule me a tune-up',
      'I want maintenance not the diagnostic',
      'let me just do the maintenance instead',
      'can I do the tune-up instead of the service call',
      'just book me a maintenance visit',
      'can you send a maintenance guy instead',
      'I would rather do the maintenance',
      'forget the diagnostic just do the tune-up',
      'can I switch to a maintenance appointment',
      'book me for a tune-up instead',
      'I just want the maintenance visit',
      'can I get the maintenance instead of the {reg_diagnostic_fee} visit',
      'let me do the maintenance it has been a while anyway',
      'schedule me for a maintenance please not the diagnostic',
    ],
    negativeKeywords: [
      'schedule routine tune-up working system',
      'maybe just needs tune-up',
      'oil change analogy',
      'can tech look at it too',
      'I will take the chance',
      'why will you not let me',
    ],
  },

  { // 4
    label: 'Maybe It Just Needs A Tune-Up',
    content: 'It could be something simple, or it could be a failed part, a refrigerant issue, or an electrical problem. There is no way to know until the technician diagnoses it. A tune-up follows a preventive checklist. The diagnostic is what identifies the actual cause.',
    groqKey: 'downgrade_redirect',
    callerPhrases: [
      'maybe it just needs a tune-up',
      'maybe a tune-up would fix it',
      'what if it just needs maintenance',
      'can a tune-up fix whatever is wrong',
      'it probably just needs servicing',
      'maybe it just needs a tune-up to start working again',
      'could a maintenance visit fix my cooling issue',
      'I think it just needs a tune-up',
      'maybe all it needs is a checkup',
      'can the tune-up fix it',
      'I bet a tune-up would take care of it',
      'a good tune-up would probably solve it',
      'it might just need routine service',
      'maybe it just needs some maintenance to get going',
      'do you think a tune-up could fix it',
    ],
    negativeKeywords: [
      'just book maintenance directly',
      'like an oil change',
      'maybe just dirty coils',
      'can tech look while there',
      'overdue for service',
      'filter change only',
    ],
  },

  { // 5
    label: 'Oil Change Analogy Caller Uses',
    content: 'I hear you on that. But if the car will not start, an oil change does not get it running again. Same idea here. Maintenance keeps a working system healthy. When a system stops cooling, the technician needs to diagnose the actual cause first.',
    groqKey: 'downgrade_redirect',
    callerPhrases: [
      'it is like a car just needs an oil change',
      'maybe it just needs an oil change type thing',
      'like a car maybe it just needs routine service',
      'maybe it only needs basic maintenance like an oil change',
      'it is like taking a car in for a tune-up',
      'can you just do the equivalent of an oil change',
      'maybe it just needs some routine service and it will be fine',
      'it has not been serviced in a while maybe that is all it needs',
      'I think it just needs basic upkeep',
      'it is probably just routine stuff',
      'maybe it is like changing the oil and it will run fine',
      'like a car that has not had an oil change',
      'can not you just do routine service and see if it fixes it',
      'I have not serviced it in a while maybe that is the problem',
      'maybe it just needs a basic tune-up like a car',
    ],
    negativeKeywords: [
      'just book me maintenance',
      'maybe needs tune-up only',
      'dirty coils or filter',
      'overdue for maintenance',
      'can tech check while there',
      'take my chances book it',
    ],
  },

  { // 6
    label: 'Can The Maintenance Tech Just Look At It',
    content: 'A maintenance appointment is planned for routine servicing on a set checklist. The technician may not have the schedule time, parts, or troubleshooting scope needed for an active no-cooling issue. A diagnostic visit is set up specifically for that.',
    groqKey: 'scope_creep',
    callerPhrases: [
      'can the maintenance guy just look at it while he is there',
      'can the tune-up tech check why it is not cooling',
      'while doing maintenance can they see what is wrong',
      'if I book maintenance can they also diagnose it',
      'can the tech just look at it during the tune-up',
      'can they check the problem while doing the checkup',
      'if they are already here can they see why it stopped cooling',
      'can the maintenance technician check what is going on',
      'while the tech is here for the tune-up can they troubleshoot',
      'can the maintenance visit include checking the problem',
      'can they do the tune-up and also see what is wrong',
      'would the tech look at the cooling issue during maintenance',
      'can I get both in one visit',
      'can the tune-up cover diagnosing the issue too',
      'while doing the checkup can they figure out the problem',
    ],
    negativeKeywords: [
      'just book maintenance directly',
      'maybe just needs tune-up',
      'overdue for service caused it',
      'dirty filter or coils only',
      'oil change comparison',
      'I will take my chances',
    ],
  },

  { // 7
    label: 'I Am Overdue For Maintenance Maybe That Is Why',
    content: 'Being overdue for maintenance may be part of the picture, but it does not replace a diagnosis on a system that is not cooling. There could be a failed component, a refrigerant issue, or an electrical problem. The diagnostic visit identifies the actual cause.',
    groqKey: 'scope_creep',
    callerPhrases: [
      'I have not had it serviced in a long time maybe that is why',
      'maybe it stopped working because I never got maintenance',
      'I am probably overdue for a tune-up that is probably the issue',
      'it has not been maintained in years maybe that is all it needs',
      'could lack of maintenance be the reason it is not cooling',
      'I have never had it serviced maybe that is the problem',
      'maybe if I had done maintenance this would not have happened',
      'it probably needs maintenance since it has not been done in years',
      'I skipped maintenance for a while maybe that caused it',
      'maybe the lack of a tune-up is why it stopped',
      'I bet it stopped cooling because I never got it serviced',
      'nobody has serviced it since we moved in',
      'the previous owner never had it maintained',
      'it has not been touched in years so maybe that is it',
      'I am way overdue for maintenance could that be why',
    ],
    negativeKeywords: [
      'just book me for maintenance',
      'maybe just needs cleaning',
      'like an oil change for car',
      'can tech look while there',
      'dirty filter might fix it',
      'take my chances on tune-up',
    ],
  },

  { // 8
    label: 'Maybe It Just Needs Cleaning Or A Filter',
    content: 'It could be an airflow issue, but no cooling can also be electrical, refrigerant, a failed component, or a controls problem. The diagnostic technician checks all of it to find the actual cause before any work is done.',
    groqKey: 'scope_creep',
    callerPhrases: [
      'maybe it just needs a new filter',
      'maybe the coils just need cleaning',
      'I think it just needs a filter change',
      'could it be the filter causing the problem',
      'maybe the coils are dirty and that is why',
      'I just need someone to clean the coils',
      'maybe it just needs a cleaning',
      'what if the filter is clogged and that is it',
      'I bet it is just a dirty filter',
      'can you just come clean the coils',
      'maybe the evaporator coil is frozen from a dirty filter',
      'it is probably just airflow I bet the filter is bad',
      'if I change the filter will it start cooling',
      'maybe it just needs to be cleaned out',
      'could dirty coils cause it to stop cooling',
    ],
    negativeKeywords: [
      'just book me for tune-up',
      'overdue for maintenance caused it',
      'like an oil change analogy',
      'can tech look during checkup',
      'skip diagnostic do maintenance',
      'take my chances with tune-up',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION HANDLING (9-14)
  // ════════════════════════════════════════════════════════════════════════

  { // 9
    label: 'Price Objection Too Expensive',
    content: 'I understand. The {reg_diagnostic_fee} covers the technician coming out, evaluating the system, identifying the cause, and going over your findings and repair options before any work is done. There is no obligation beyond the evaluation.',
    groqKey: 'objection_handling',
    callerPhrases: [
      '{reg_diagnostic_fee} just to come out that is too much',
      'that is a lot just to look at it',
      'why so expensive just to diagnose it',
      'I am not paying {reg_diagnostic_fee} for someone to look at my ac',
      'that is too much for a service call',
      'can you waive the diagnostic fee',
      'do you have anything cheaper',
      'is there a less expensive option',
      '{reg_diagnostic_fee} seems high for just a visit',
      'that is a lot of money just to tell me what is wrong',
      'I do not want to pay {reg_diagnostic_fee} and still have to pay for the repair',
      'can you send someone out for free',
      'other companies do free diagnostics',
      'why do I have to pay just for you to come look',
      'is there any way to lower the diagnostic fee',
    ],
    negativeKeywords: [
      'sounds like upselling',
      'just book maintenance anyway',
      'what does diagnostic include',
      'I will take my chances',
      'why will you not let me',
      'replacement cost too high',
    ],
  },

  { // 10
    label: 'Caller Thinks Company Is Upselling',
    content: 'I understand why it may sound that way. These are simply two different services. Maintenance is preventive service for a working system. A diagnostic is for a system that is not working properly now. They are scheduled differently and often assigned differently.',
    groqKey: 'objection_handling',
    callerPhrases: [
      'sounds like you are just trying to upsell me',
      'you just want me to pay for the diagnostic',
      'this feels like a sales pitch',
      'are you just trying to get more money out of me',
      'you are just pushing the more expensive option',
      'sounds like you are trying to upsell the diagnostic',
      'I feel like you are steering me to the more expensive visit',
      'why are you pushing the diagnostic so hard',
      'this sounds like a scam',
      'you just do not want to book the cheaper option',
      'it sounds like you just want the diagnostic fee',
      'you are making this harder than it needs to be',
      'I feel like I am being pressured into the diagnostic',
      'why will you not just book what I am asking for',
      'are you on commission or something',
    ],
    negativeKeywords: [
      'price is too much',
      'just book maintenance anyway',
      'pay more get maintenance',
      'same day urgent request',
      'what does {reg_diagnostic_fee} cover',
      'why can I not choose',
    ],
  },

  { // 11
    label: 'Caller Wants Same Day But Asks For Maintenance',
    content: 'I hear you on wanting someone out quickly. Maintenance is routine and usually booked in advance, not for active breakdowns. For a system not cooling, the diagnostic is the fastest proper path to getting a technician out.',
    groqKey: 'objection_handling',
    callerPhrases: [
      'I need someone out today but not for {reg_diagnostic_fee}',
      'can I get maintenance today instead of the diagnostic',
      'I need same day service can I just do the tune-up',
      'can you send someone today for a maintenance instead',
      'I need help now but I do not want the diagnostic fee',
      'can I get a same day tune-up',
      'I need someone out today just book the maintenance',
      'the house is hot I need someone now but do the maintenance',
      'can someone come today for a tune-up my ac is not working',
      'I want someone today but for the maintenance price',
      'can I get the maintenance visit today',
      'I need immediate help but schedule it as maintenance',
      'can you rush a tune-up my system is down',
      'I need same day but I want the maintenance visit',
      'is there a way to get maintenance today for my broken ac',
    ],
    negativeKeywords: [
      'price objection only',
      'upsell accusation',
      'pay more for maintenance',
      'take my chances anyway',
      'why not let me book it',
      'what diagnostic covers',
    ],
  },

  { // 12
    label: 'Caller Says They Will Take The Chance',
    content: 'I hear you on that. The issue is we do not book a maintenance visit as a substitute for an active breakdown. To get the correct service for a no-cooling issue, the right step is to schedule the diagnostic visit.',
    groqKey: 'downgrade_redirect',
    callerPhrases: [
      'I will take that chance just book the maintenance',
      'I will risk it just send the maintenance tech',
      'let me take the chance on the tune-up',
      'I do not care just book me for maintenance',
      'I am willing to take that chance book it',
      'even if it does not fix it I want maintenance',
      'I understand the risk just schedule the tune-up',
      'I will take my chances with the maintenance visit',
      'just book it I know it might not work',
      'that is fine I still want the maintenance',
      'it is my money let me try the maintenance',
      'I accept the risk just book the tune-up',
      'I would rather try maintenance first',
      'let me try the maintenance and see what happens',
      'just give me the maintenance I will deal with it',
    ],
    negativeKeywords: [
      'price too expensive',
      'sounds like upselling',
      'pay more get both',
      'need same day help',
      'why not let me choose',
      'what does diagnostic cover',
    ],
  },

  { // 13
    label: 'Even If I Pay More Why Not Maintenance',
    content: 'I appreciate you being willing to pay more. But the issue is not about cost — it is about the appointment type. Maintenance is scoped for preventive service on a working system. Even at {reg_maintenance_fee}, the technician is not dispatched for an active breakdown.',
    groqKey: 'objection_handling',
    callerPhrases: [
      '{reg_maintenance_fee} gets me both right',
      'if I pay the {reg_maintenance_fee} can they diagnose it too',
      'I will pay more just do the maintenance and check the problem',
      'the maintenance costs more so it should cover more',
      'I am paying more for maintenance so it should include the diagnostic',
      'if I pay the higher price will they fix the cooling issue',
      'I do not mind paying {reg_maintenance_fee} if they look at the problem too',
      'why can I not pay the {reg_maintenance_fee} and get everything checked',
      'even if I pay more why not just do the maintenance',
      'I will pay whatever just send someone who can fix it',
      'let me pay the {reg_maintenance_fee} and have them troubleshoot',
      'the maintenance costs more why does it not include diagnosis',
      'can I pay extra for the maintenance to cover the diagnostic',
      'for {reg_maintenance_fee} they should be able to figure it out',
      'I am willing to pay more so why not maintenance',
    ],
    negativeKeywords: [
      'price too expensive',
      'sounds like upselling',
      'take my chances anyway',
      'same day maintenance urgent',
      'why not let me choose',
      'already agreed to diagnostic',
    ],
  },

  { // 14
    label: 'Why Can I Not Book Maintenance For This',
    content: 'It is not about permission. We want to send the right technician under the right call type so you do not waste time or money. Maintenance is not built for active breakdowns. The diagnostic gets you the answers you need.',
    groqKey: 'objection_handling',
    callerPhrases: [
      'why will you not let me book maintenance',
      'why can I not just book what I want',
      'why are you not letting me do the maintenance',
      'why can not I choose which appointment to book',
      'why are you restricting what I can book',
      'why can I not schedule maintenance for this',
      'why will you not just book me for the tune-up',
      'what is the reason I can not do maintenance for this',
      'why do you get to decide which appointment I need',
      'I want maintenance why can not you just book it',
      'why is it so hard to just schedule a maintenance',
      'why are you making this difficult',
      'I do not understand why I can not just get maintenance',
      'why is maintenance not an option for this',
      'why are you not allowing me to choose maintenance',
    ],
    negativeKeywords: [
      'price too much objection',
      'upsell accusation',
      'take the chance anyway',
      'pay more get both services',
      'same day urgent breakdown',
      'already agreed book diagnostic',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // EXPLANATION MODULES (15-20)
  // ════════════════════════════════════════════════════════════════════════

  { // 15
    label: 'Maintenance Is Preventive Service',
    content: 'Maintenance is preventive service for a working system. It is a scheduled 20-point checkup designed to keep everything running well and catch small issues early. It is not the correct appointment type for an active breakdown.',
    groqKey: 'service_definitions',
    callerPhrases: [
      'what is maintenance exactly',
      'what does maintenance mean',
      'what is the difference between maintenance and repair',
      'is maintenance the same as a repair visit',
      'what is maintenance for',
      'can you explain what maintenance is',
      'what does the maintenance visit do',
      'how is maintenance different from a diagnostic',
      'what is the purpose of maintenance',
      'is maintenance just cleaning',
      'what exactly is a tune-up',
      'what is a maintenance checkup',
      'does maintenance fix things',
      'what does preventive maintenance mean',
      'is maintenance for broken systems or working ones',
    ],
    negativeKeywords: [
      'what is a diagnostic',
      'what does {reg_diagnostic_fee} cover',
      'how are they dispatched',
      'tech qualification difference',
      'booking wrong visit risk',
      'agreed to book diagnostic',
    ],
  },

  { // 16
    label: 'Diagnostic Is For Active Issues',
    content: 'When a system is not cooling, the technician needs to diagnose why. That requires a diagnostic service call. The technician evaluates the system, identifies the root cause, and goes over findings and repair options with you before any work is done.',
    groqKey: 'service_definitions',
    callerPhrases: [
      'what is the diagnostic visit for',
      'what does the diagnostic cover',
      'what happens during a diagnostic visit',
      'what does the technician do on a diagnostic call',
      'how is a diagnostic different from maintenance',
      'what does the diagnostic service call include',
      'what do I get with the diagnostic fee',
      'what is the purpose of the diagnostic visit',
      'can you explain what the diagnostic involves',
      'what exactly is a diagnostic service call',
      'what does the {reg_diagnostic_fee} diagnostic get me',
      'how does a diagnostic visit work',
      'what is the diagnostic process',
      'what do they check during a diagnostic',
      'what is included in the diagnostic fee',
    ],
    negativeKeywords: [
      'what is maintenance',
      'how are they scheduled',
      'tech preparation difference',
      'wrong visit delay risk',
      'what does {reg_diagnostic_fee} include',
      'already agreed to diagnostic',
    ],
  },

  { // 17
    label: 'Routing And Scheduling Difference',
    content: 'Maintenance calls and diagnostic calls are routed differently. Maintenance is booked in advance for routine servicing. Diagnostic visits are dispatched based on the active issue. Different visit types go through different scheduling and technician assignment.',
    groqKey: 'operational_reality',
    callerPhrases: [
      'why are they scheduled differently',
      'how are they dispatched differently',
      'why do you route them differently',
      'what is different about how they are scheduled',
      'do different technicians come for each',
      'why can not the same tech do both',
      'how is dispatching different for maintenance and diagnostic',
      'why does scheduling matter for this',
      'what is the difference in how they are booked',
      'are maintenance and repair visits separate schedules',
      'why are maintenance calls booked differently than repair calls',
      'does a different tech come for maintenance versus diagnostic',
      'what is the scheduling difference between the two',
      'why does the type of appointment matter for scheduling',
      'how does dispatch decide which tech to send',
    ],
    negativeKeywords: [
      'what is maintenance for',
      'what does diagnostic cover',
      'tech qualifications question',
      'wrong visit consequences',
      'price objection',
      'already agreed book it',
    ],
  },

  { // 18
    label: 'Technician Qualification And Preparation',
    content: 'A maintenance technician may not have the time, parts, or troubleshooting scope needed for an active no-cooling issue. The diagnostic technician arrives specifically equipped and scheduled to evaluate, diagnose, and repair the problem.',
    groqKey: 'operational_reality',
    callerPhrases: [
      'is the maintenance tech qualified to look at it',
      'can the maintenance tech fix a broken system',
      'why can not the tune-up tech diagnose it',
      'does the maintenance tech carry repair parts',
      'is the maintenance technician different from the repair tech',
      'why can not any technician diagnose the issue',
      'does the maintenance tech have the tools for repairs',
      'what is different about the repair technician',
      'can any hvac tech diagnose a cooling issue',
      'why is the maintenance tech not able to troubleshoot',
      'are they not all licensed technicians',
      'what is different about how the diagnostic tech is prepared',
      'does the maintenance tech have time to troubleshoot',
      'why can not the tech who does tune-ups also diagnose',
      'is the diagnostic technician more qualified',
    ],
    negativeKeywords: [
      'what is maintenance for',
      'what does diagnostic include',
      'how are they routed',
      'wrong visit delay risk',
      'price too expensive',
      'already agreed to diagnostic',
    ],
  },

  { // 19
    label: 'Booking Wrong Visit Delays Repair',
    content: 'I just want to help you avoid booking the wrong visit and delaying the repair. For a system that is not cooling, the proper appointment is the diagnostic service call. That gets the right technician out to identify the problem and get you fixed.',
    groqKey: 'operational_reality',
    callerPhrases: [
      'what happens if I book the wrong visit',
      'would it delay things if I book maintenance',
      'will booking maintenance slow down my repair',
      'what is the downside of booking the wrong appointment',
      'could booking maintenance waste my time',
      'will I lose time if I book a tune-up instead',
      'what if the maintenance tech can not fix it',
      'will I have to schedule another visit if I book maintenance',
      'could I end up paying twice if I book the wrong one',
      'is there a risk to booking maintenance for this',
      'will it take longer to get fixed if I do maintenance first',
      'what if maintenance does not solve it',
      'will I just need another visit after the tune-up anyway',
      'could booking the wrong visit make things worse',
      'would I waste money booking the wrong appointment',
    ],
    negativeKeywords: [
      'what is maintenance for',
      'what is diagnostic for',
      'how dispatch works',
      'tech carries different parts',
      'price objection',
      'already agreed book it',
    ],
  },

  { // 20
    label: 'What The Diagnostic Fee Covers',
    content: 'The {reg_diagnostic_fee} diagnostic covers a full system evaluation. The technician identifies the root cause, documents what they find, and walks you through findings and repair options with pricing before any work is done. You decide what gets fixed.',
    groqKey: 'price_comparison',
    callerPhrases: [
      'what does the {reg_diagnostic_fee} cover',
      'what do I get for the diagnostic fee',
      'what is included in the {reg_diagnostic_fee}',
      'what does the {reg_diagnostic_fee} diagnostic include',
      'what am I paying for with the {reg_diagnostic_fee}',
      'does the {reg_diagnostic_fee} go toward the repair',
      'what exactly do I get for the service call fee',
      'is the {reg_diagnostic_fee} just for showing up',
      'what does the diagnostic fee pay for',
      'do I get anything for the {reg_diagnostic_fee} besides the visit',
      'what is the {reg_diagnostic_fee} service call all about',
      'is there value in the diagnostic fee',
      'what happens during the {reg_diagnostic_fee} visit',
      'what does the technician do for the {reg_diagnostic_fee}',
      'does the diagnostic fee include any repair work',
    ],
    negativeKeywords: [
      'how much is maintenance',
      'what is maintenance for',
      'how dispatch works',
      'tech qualifications',
      'wrong visit consequences',
      'already agreed to book',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // RESOLUTION (21-23)
  // ════════════════════════════════════════════════════════════════════════

  { // 21
    label: 'Caller Agrees To Book Diagnostic',
    content: 'Absolutely. Let us get that diagnostic set up for you right away.',
    groqKey: 'resolution',
    callerPhrases: [
      'okay let us do the diagnostic',
      'fine book the diagnostic',
      'alright schedule the {reg_diagnostic_fee} visit',
      'okay I will do the diagnostic',
      'go ahead and book it',
      'let us do the service call',
      'okay set it up',
      'alright I will go with the diagnostic',
      'fine let us just do the diagnostic then',
      'okay book me for the diagnostic visit',
      'yes go ahead and schedule that',
      'alright let us get someone out here',
      'okay I will take the {reg_diagnostic_fee} diagnostic',
      'fine schedule the diagnostic service call',
      'alright let us do that',
    ],
    negativeKeywords: [
      'still wants maintenance instead',
      'price objection continuing',
      'not convinced yet',
      'wants to think about it',
      'asking about maintenance after repair',
      'questioning diagnostic value',
    ],
  },

  { // 22
    label: 'After Repair Maintenance Upsell',
    content: 'Once the current issue is diagnosed and repaired, we can absolutely help you set up a maintenance schedule going forward. Regular checkups help prevent this kind of situation from happening again.',
    groqKey: 'resolution',
    callerPhrases: [
      'can I do maintenance after the repair',
      'once it is fixed can I schedule maintenance',
      'after the repair can I set up regular maintenance',
      'I want maintenance too but after it is fixed',
      'can we schedule a tune-up once the repair is done',
      'I would like to do maintenance going forward',
      'after you fix it I want to start doing maintenance',
      'can I get on a maintenance schedule after the repair',
      'once it is working again I want regular service',
      'I want to prevent this from happening again',
      'how do I keep this from happening again',
      'can I sign up for maintenance after this',
      'I should probably do regular maintenance after this',
      'once it is repaired can we set up a tune-up schedule',
      'after we fix this I want to talk about maintenance',
    ],
    negativeKeywords: [
      'still pushing for maintenance',
      'not agreed to diagnostic yet',
      'price objection active',
      'wants maintenance to fix problem',
      'questioning service difference',
      'upselling accusation active',
    ],
  },

  { // 23
    label: 'So Maintenance Will Not Fix A Broken System',
    content: 'That is correct. Maintenance helps prevent problems by keeping a working system in good shape. A diagnostic visit is for finding the cause of a problem that is already happening. For a system not cooling, the diagnostic is the right appointment.',
    groqKey: 'service_definitions',
    callerPhrases: [
      'so maintenance will not fix a broken system',
      'so a tune-up can not fix my cooling problem',
      'so maintenance is only for working systems',
      'so the tune-up will not fix it',
      'so I definitely need the diagnostic',
      'so maintenance does not diagnose problems',
      'so the maintenance tech can not repair my ac',
      'so maintenance is just for prevention',
      'so the tune-up is not for broken systems',
      'okay so I need the diagnostic not maintenance',
      'so if it is not cooling I need the diagnostic',
      'so maintenance is not going to solve this',
      'so the only option is the diagnostic',
      'so there is no way maintenance can fix it',
      'so the tune-up will not help with the no cooling issue',
    ],
    negativeKeywords: [
      'wants maintenance after repair done',
      'agreed to book diagnostic',
      'price objection continuing',
      'upsell accusation',
      'same day urgency',
      'tech qualification question',
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// BUILD & VALIDATE JSON
// ═══════════════════════════════════════════════════════════════════════════

const output = {
  kcTitle: 'Repair Service vs. Maintenance',
  kcId: null,
  exportedAt: new Date().toISOString(),
  sectionCount: sections.length,
  sections: sections.map((s, i) => ({
    index: i,
    label: s.label,
    content: s.content,
    groqContent: groqCat[s.groqKey] || null,
    callerPhrases: s.callerPhrases,
    negativeKeywords: s.negativeKeywords,
    isFixed: true,
    hasAudio: false,
    isActive: true,
  })),
};

// ── Validation ───────────────────────────────────────────────────────────
let errors = 0;
for (const s of output.sections) {
  const wc = s.content.split(/\s+/).length;
  if (wc < 10 || wc > 50) {
    console.warn(`⚠ Section ${s.index} "${s.label}" content: ${wc} words (target 35-42, min 10 for short closes)`);
  }
  if (!s.groqContent) {
    console.error(`✗ Section ${s.index} "${s.label}" missing groqContent`);
    errors++;
  } else {
    const gwc = s.groqContent.split(/\s+/).length;
    if (gwc < 300 || gwc > 450) {
      console.warn(`⚠ Section ${s.index} "${s.label}" groqContent: ${gwc} words (target 350-400)`);
    }
  }
  if (s.callerPhrases.length !== 15) {
    console.error(`✗ Section ${s.index} "${s.label}" has ${s.callerPhrases.length} phrases (need exactly 15)`);
    errors++;
  }
  if (s.negativeKeywords.length !== 6) {
    console.warn(`⚠ Section ${s.index} "${s.label}" has ${s.negativeKeywords.length} negativeKeywords (need exactly 6)`);
  }
  // Check for empty phrases
  const emptyPhrases = s.callerPhrases.filter(p => !p.trim());
  if (emptyPhrases.length) {
    console.error(`✗ Section ${s.index} "${s.label}" has ${emptyPhrases.length} empty phrases`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} error(s) found. Fix before importing.`);
  process.exit(1);
}

// ── Write output ─────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'kc-repair-vs-maintenance.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`\n✅ Generated ${outPath}`);
console.log(`   ${output.sectionCount} sections`);
console.log(`   ${output.sections.reduce((n, s) => n + s.callerPhrases.length, 0)} total callerPhrases`);
console.log(`   ${new Set(output.sections.map(s => s.groqContent)).size} unique groqContent templates`);

// Stats
const contentWords = output.sections.map(s => s.content.split(/\s+/).length);
const groqWords = output.sections.filter(s => s.groqContent).map(s => s.groqContent.split(/\s+/).length);
console.log(`   Content words: min=${Math.min(...contentWords)} max=${Math.max(...contentWords)} avg=${Math.round(contentWords.reduce((a,b)=>a+b,0)/contentWords.length)}`);
console.log(`   GroqContent words: min=${Math.min(...groqWords)} max=${Math.max(...groqWords)} avg=${Math.round(groqWords.reduce((a,b)=>a+b,0)/groqWords.length)}`);

console.log('\nNEXT STEPS:');
console.log('  1. Create empty "Repair Service vs. Maintenance" container in services.html');
console.log('  2. Import kc-repair-vs-maintenance.json into the container');
console.log('  3. Re-score All → Fix All → Generate Missing Audio');
