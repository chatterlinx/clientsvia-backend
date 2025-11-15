/**
 * ============================================================================
 * TRIAGE SCENARIO EXAMPLES
 * ============================================================================
 * Purpose: Help admins understand how to write effective triage scenarios
 * Usage: Displayed in info modal in AI Triage Builder
 * ============================================================================
 */

export const TRIAGE_EXAMPLES = {
  HVAC: [
    {
      id: 'hvac-1',
      title: 'AC not cooling, customer asks for maintenance (misclassified)',
      text: `Customer called because the AC is not cooling and the house is hot. Customer incorrectly thinks this is a maintenance request, but this situation is always a REPAIR issue. We do NOT schedule same-day maintenance, and maintenance is NOT appropriate for a system that isn't cooling. The triage engine must classify this as REPAIR every time, even if the customer insists it's "just maintenance."`
    },
    {
      id: 'hvac-2',
      title: 'AC making loud grinding noise, still cooling',
      text: `Customer reports loud grinding or metal-on-metal noise from the outdoor unit, but the system is still blowing cool air. This is an early REPAIR issue, not maintenance. The triage engine must classify this as REPAIR and warn against running the system, not downgrade it to maintenance just because it's still cooling.`
    },
    {
      id: 'hvac-3',
      title: 'Water dripping from air handler / ceiling stain',
      text: `Customer noticed water dripping from the air handler or a new water stain on the ceiling near the AC. The AC may still cool. This is treated as a REPAIR/LEAK issue, not maintenance. The triage engine must classify as REPAIR to prevent ceiling damage, even if the customer only asks for a "check-up."`
    },
    {
      id: 'hvac-4',
      title: 'Burning or electrical smell when AC runs',
      text: `Customer smells burning, electrical, or plastic odor when the system runs. Whether or not it's cooling, this is a PRIORITY REPAIR and potential safety issue. The triage engine must classify as REPAIR (and, if your rules say so, EMERGENCY after hours) and never as routine maintenance.`
    },
    {
      id: 'hvac-5',
      title: 'Thermostat blank / no power to system',
      text: `Customer reports the thermostat is blank and the AC won't turn on. They may ask if it's "just batteries" or "maintenance." This is always a NO-COOL / NO-POWER REPAIR triage path. The triage engine must classify as REPAIR and follow the no-power checklist, not maintenance.`
    },
    {
      id: 'hvac-6',
      title: 'Routine seasonal tune-up (system working fine)',
      text: `Customer's AC/heat is working fine; they specifically want a seasonal tune-up for efficiency and inspection. No comfort issues, no noises, no leaks. The triage engine must classify this as MAINTENANCE ONLY and must NOT upgrade this to REPAIR or EMERGENCY.`
    },
    {
      id: 'hvac-7',
      title: 'Filter change / simple question',
      text: `Customer calls only to ask how often to change filters, which filter size to buy, or how to replace it. System is working fine. This is an INFORMATION/OTHER scenario, not REPAIR and not MAINTENANCE appointment unless the customer requests a tech to come out. The triage engine should classify as OTHER (advice/education) unless the caller clearly wants a visit.`
    },
    {
      id: 'hvac-8',
      title: 'Duct cleaning request, system cooling fine',
      text: `Customer calls asking for duct cleaning or "air quality cleaning" while the system is working normally. This is NOT a REPAIR and NOT an emergency. The triage engine should classify as SPECIALTY SERVICE / MAINTENANCE-TYPE, and never convert this into a repair call.`
    },
    {
      id: 'hvac-9',
      title: 'After-hours no cooling with vulnerable occupants',
      text: `Customer reports no cooling at night, with small children, elderly, or health concerns in the home, and indoor temperature is very high. This should be classified as EMERGENCY REPAIR after hours. The triage engine must classify as EMERGENCY, not standard REPAIR, even if the caller says "whenever you can."`
    },
    {
      id: 'hvac-10',
      title: 'Quote/second opinion on new system',
      text: `Customer's system has been working or was recently condemned by another company, and they want a quote or second opinion on replacement. No urgent comfort issue at the moment. This is a SALES/CONSULTATION scenario, not REPAIR and not MAINTENANCE. The triage engine must classify as OTHER/SALES and route to estimate booking, not emergency repair.`
    }
  ],
  
  DENTAL: [
    {
      id: 'dental-1',
      title: 'Severe toothache, can\'t sleep (urgent)',
      text: `Patient reports severe toothache, throbbing pain, and difficulty sleeping or eating on that side. This is an URGENT / EMERGENCY dental issue, not a routine cleaning. The triage engine must classify as EMERGENCY/URGENT VISIT, even if the patient originally called asking for "a cleaning."`
    },
    {
      id: 'dental-2',
      title: 'Small chip on front tooth before big event',
      text: `Patient chipped a front tooth but has minimal pain and normal function; they're worried about appearance for an upcoming event. This is an URGENT COSMETIC / PRIORITY APPOINTMENT, not a standard cleaning. The triage engine should classify as URGENT (same-week if possible), not as routine hygiene.`
    },
    {
      id: 'dental-3',
      title: 'Routine 6-month cleaning, no pain',
      text: `Patient has no pain, no broken teeth, and simply wants a regular check-up and cleaning. The triage engine must classify this as ROUTINE CLEANING / HYGIENE and must NOT upgrade it to emergency or treatment.`
    },
    {
      id: 'dental-4',
      title: 'Broken filling, mild pain',
      text: `Patient reports a filling fell out or broke and there is mild to moderate sensitivity but no extreme pain or swelling. This is a PRIORITY TREATMENT visit (within a few days), not a cleaning. The triage engine should classify as TREATMENT/RESTORATIVE, not routine hygiene.`
    },
    {
      id: 'dental-5',
      title: 'Swelling / facial infection signs',
      text: `Patient reports facial swelling, significant pain, possible fever, or difficulty swallowing. This is a DENTAL EMERGENCY and may require same-day evaluation or ER referral per office policy. The triage engine must classify as EMERGENCY and never treat it as routine.`
    },
    {
      id: 'dental-6',
      title: 'New patient wanting second opinion',
      text: `New patient calls for a second opinion on recommended treatment from another dentist; no current emergency symptoms. This is a NEW PATIENT CONSULTATION, not hygiene and not emergency. The triage engine must classify as CONSULTATION.`
    },
    {
      id: 'dental-7',
      title: 'Post-op pain within 24–48 hours',
      text: `Existing patient calls after a recent extraction or procedure and reports expected mild pain controlled with medication, with no alarming signs. This is a NORMAL POST-OP QUESTION. The triage engine should classify as FOLLOW-UP/QUESTION, not emergency, and route through post-op protocol.`
    },
    {
      id: 'dental-8',
      title: 'Post-op uncontrolled bleeding / severe pain',
      text: `Patient calls after surgery with uncontrolled bleeding, severe pain, or signs of infection. This is a POST-OP EMERGENCY. The triage engine must classify as EMERGENCY, trigger the surgeon/doctor contact protocol, and not treat it as a routine follow-up.`
    },
    {
      id: 'dental-9',
      title: 'Insurance/billing questions only',
      text: `Caller only has questions about insurance coverage, statements, or payment plans. No clinical concerns. This is a BILLING/ADMIN scenario. The triage engine should classify as OTHER/BILLING and route to the billing team, not to clinical scheduling.`
    },
    {
      id: 'dental-10',
      title: 'Child dental trauma (tooth knocked out)',
      text: `Parent calls because a child knocked out or severely loosened a tooth from trauma. This is a PEDIATRIC DENTAL EMERGENCY. The triage engine must classify as EMERGENCY and follow the trauma protocol, not routine pediatric appointment.`
    }
  ],
  
  ATTORNEY: [
    {
      id: 'attorney-1',
      title: 'Car accident yesterday, injuries reported',
      text: `Caller was in a car accident within the last few days, has injuries, and is seeking representation. This is a NEW PERSONAL INJURY LEAD, not a generic "question." The triage engine must classify as NEW CASE INTAKE → PERSONAL INJURY and send through full intake script.`
    },
    {
      id: 'attorney-2',
      title: 'Existing client asking for case update',
      text: `Existing client calls about the status of their active case, with no new incident. This is an EXISTING CLIENT UPDATE, not a new lead. The triage engine must classify as EXISTING CASE and route to the assigned attorney/team, not intake.`
    },
    {
      id: 'attorney-3',
      title: 'Domestic violence, needs immediate protection',
      text: `Caller reports current or recent domestic violence and is asking about restraining orders or immediate protection. This is an EMERGENCY FAMILY LAW / PROTECTION ORDER situation. The triage engine must classify as EMERGENCY FAMILY LAW and trigger same-day escalation, not standard consultation.`
    },
    {
      id: 'attorney-4',
      title: 'Wants to "file for divorce eventually" (non-urgent)',
      text: `Caller is exploring divorce but no immediate safety issues or deadlines. This is a STANDARD FAMILY LAW CONSULTATION. The triage engine should classify as NEW CLIENT CONSULT – FAMILY LAW, not emergency.`
    },
    {
      id: 'attorney-5',
      title: 'Arrested or expects arrest soon',
      text: `Caller or their family member has just been arrested, is in custody, or expects arrest soon. This is CRIMINAL DEFENSE EMERGENCY. The triage engine must classify as EMERGENCY CRIMINAL and trigger after-hours/on-call rules if applicable.`
    },
    {
      id: 'attorney-6',
      title: 'Business owner wants contract review',
      text: `Business owner needs a contract reviewed or drafted, with no active dispute or lawsuit. This is a BUSINESS/TRANSACTIONAL CONSULTATION. The triage engine should classify as BUSINESS LAW CONSULT, not litigation emergency.`
    },
    {
      id: 'attorney-7',
      title: 'Served with lawsuit, deadline approaching',
      text: `Caller has been served with a complaint or legal notice and has a clear response deadline (e.g., 20 days) approaching soon. This is a LITIGATION URGENT MATTER. The triage engine must classify as URGENT CIVIL/LITIGATION and not as a casual "general question."`
    },
    {
      id: 'attorney-8',
      title: 'Immigration deadline / expiring status',
      text: `Caller has an upcoming immigration deadline, expiring visa/green card, or upcoming hearing. This is an IMMIGRATION URGENT CASE depending on timing. The triage engine should classify as IMMIGRATION with priority level based on how close the deadline is, not generic consultation.`
    },
    {
      id: 'attorney-9',
      title: 'Only asking about payment plan / invoice',
      text: `Existing client calls only about a bill, payment plan, or past-due statement. No case questions. This is BILLING/ADMIN, not legal triage. The triage engine should classify as BILLING and route to accounting/admin, not an attorney.`
    },
    {
      id: 'attorney-10',
      title: 'Wrong practice area (we don\'t handle this)',
      text: `Caller is asking for help in a practice area the firm does NOT handle (e.g., caller wants patent work and the firm only does injury/family/criminal). The triage engine should classify this as NOT A FIT / NON-SERVICE AREA and follow the decline/referral script instead of trying to book a consultation.`
    }
  ]
};

/**
 * Get examples for a specific industry
 * @param {string} industry - Industry key (HVAC, DENTAL, ATTORNEY, etc.)
 * @returns {Array} Array of example objects
 */
export function getExamplesForIndustry(industry) {
  const key = industry.toUpperCase().replace(/\s+/g, '_');
  return TRIAGE_EXAMPLES[key] || [];
}

/**
 * Get all available industries
 * @returns {Array} Array of industry names
 */
export function getAvailableIndustries() {
  return Object.keys(TRIAGE_EXAMPLES);
}

