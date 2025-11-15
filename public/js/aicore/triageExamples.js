/**
 * ============================================================================
 * TRIAGE SCENARIO EXAMPLES
 * ============================================================================
 * Purpose: Help admins understand how to write effective triage scenarios
 * Usage: Displayed in info modal in AI Triage Builder
 * ============================================================================
 */

export const TRIAGE_EXAMPLES = {
  HVAC: {
    title: 'HVAC',
    count: 50,
    categories: [
      {
        id: 'cat-a',
        name: 'Category A: Not Cooling / Not Heating',
        subtitle: 'High Priority Misclassification Cases',
        examples: [
          {
            id: 'hvac-1',
            title: 'AC not cooling, customer asks for maintenance (misclassified)',
            text: 'Customer reports the home is hot and the AC is blowing warm air. Caller believes this is a "maintenance" issue and asks for a tune-up. Loss of cooling is NEVER maintenance. This is always a REPAIR issue and must be classified as REPAIR, even if customer insists it\'s "just maintenance." No same-day maintenance scheduling allowed.'
          },
          {
            id: 'hvac-2',
            title: 'AC blowing warm air but customer wants a quote instead of service',
            text: 'Caller says the system is not cooling but wants "just an estimate" or "someone to take a look." AC blowing warm = REPAIR immediately. System failure must never be routed to quotes or consultations. Always classify as REPAIR.'
          },
          {
            id: 'hvac-3',
            title: 'No cooling, customer says system is "probably fine" and wants delay',
            text: 'Caller acknowledges no cooling but says "I\'m not in a rush" or "I can wait a week." System failure always requires REPAIR, regardless of customer minimizing urgency. Triage engine must classify as REPAIR.'
          },
          {
            id: 'hvac-4',
            title: 'AC cooling weakly, customer thinks it\'s low refrigerant',
            text: 'Caller says AC is "cool but not cold" or "not keeping up," house is rising above comfortable temperatures. This is early-stage REPAIR — not maintenance and not refrigerant refill scheduling. Classify as REPAIR, not MAINTENANCE.'
          },
          {
            id: 'hvac-5',
            title: 'AC intermittently cooling, comes on then shuts off',
            text: 'Customer reports cooling inconsistently. This is REPAIR (possible capacitor/thermostat/overheat issue). Caller may think it\'s programmable thermostat or maintenance — still REPAIR.'
          },
          {
            id: 'hvac-6',
            title: 'Heat not working, customer calls it a "simple tune-up"',
            text: 'No heat always = REPAIR. Caller mislabels as maintenance frequently. Triage must override and classify as REPAIR immediately.'
          },
          {
            id: 'hvac-7',
            title: 'Heat blowing cool air, customer thinks thermostat is broken',
            text: 'Caller blames thermostat, but any system blowing cold air during a heat call is a REPAIR. Triage engine must classify as REPAIR.'
          },
          {
            id: 'hvac-8',
            title: 'Heat working intermittently, pilot goes out',
            text: 'Intermittent heat or pilot issues = REPAIR. Caller may request "just come clean it" — incorrect. Must classify as REPAIR every time.'
          },
          {
            id: 'hvac-9',
            title: 'After-hours no cooling with vulnerable occupants (EMERGENCY)',
            text: 'Customer reports no cooling at night, with young children, elderly, pets, or health risks in home. Indoor temps rising dangerously. Must always classify as EMERGENCY REPAIR, even if caller says "whenever you can."'
          },
          {
            id: 'hvac-10',
            title: 'After-hours no heating below freezing (EMERGENCY)',
            text: 'If outside temperature is dangerously low and heat is out, this must be EMERGENCY REPAIR. Freeze risk to pipes, elderly, children. Caller may downplay urgency — triage must override.'
          }
        ]
      },
      {
        id: 'cat-b',
        name: 'Category B: Noises, Smells, and Physical Damage',
        subtitle: 'Sensory Indicators of System Failure',
        examples: [
          {
            id: 'hvac-11',
            title: 'Loud grinding or metal scraping noise',
            text: 'Caller reports grinding, scraping, or metal-on-metal noise from outdoor unit or furnace. This is REPAIR, not maintenance. Warn against running system. Never downgrade.'
          },
          {
            id: 'hvac-12',
            title: 'Burning smell when heat turns on (not dust smell)',
            text: 'If caller reports electrical/burning smell — that is REPAIR or EMERGENCY depending on intensity. Not maintenance. Must classify properly.'
          },
          {
            id: 'hvac-13',
            title: 'Chemical or refrigerant smell',
            text: 'Caller reports sweet, chemical, or strange odor. Potential refrigerant leak. Always REPAIR and must not be classified as MAINTENANCE.'
          },
          {
            id: 'hvac-14',
            title: 'AC making loud banging/clunking noise',
            text: 'Major mechanical failure indicators. Always REPAIR. Never maintenance.'
          },
          {
            id: 'hvac-15',
            title: 'Furnace making boom or delayed ignition sound',
            text: 'High risk. Must be REPAIR or EMERGENCY depending on severity.'
          },
          {
            id: 'hvac-16',
            title: 'Smoke smell or visible smoke from vents (EMERGENCY)',
            text: 'Any presence of smoke = EMERGENCY. Shut system off and escalate. Never treat as repair casually.'
          }
        ]
      },
      {
        id: 'cat-c',
        name: 'Category C: Water, Leaks, and Drain Issues',
        subtitle: 'Structural Risk Scenarios',
        examples: [
          {
            id: 'hvac-17',
            title: 'Water leaking from indoor unit',
            text: 'Water near air handler, soaked ceiling, or dripping pan always = REPAIR. Caller may think "just a clogged drain" (maintenance). Must be REPAIR.'
          },
          {
            id: 'hvac-18',
            title: 'Water in drain pan triggering float switch',
            text: 'Float switch trip = REPAIR. Do not downgrade to maintenance cleaning.'
          },
          {
            id: 'hvac-19',
            title: 'Flooding around furnace or closet',
            text: 'High risk to electrical components. Must classify as REPAIR.'
          },
          {
            id: 'hvac-20',
            title: 'Frozen indoor coil / frost on refrigerant lines',
            text: 'Customer sees ice or frost. This is REPAIR. Never maintenance. Must instruct customer to shut system off until tech arrives.'
          }
        ]
      },
      {
        id: 'cat-d',
        name: 'Category D: Airflow, Duct, and Ventilation Issues',
        subtitle: 'Performance Problems',
        examples: [
          {
            id: 'hvac-21',
            title: 'Very weak airflow from vents',
            text: 'Weak airflow = REPAIR. Customer may ask for duct cleaning or maintenance — still REPAIR unless proven otherwise.'
          },
          {
            id: 'hvac-22',
            title: 'One room not cooling/heating (zoning issue)',
            text: 'Zoning/fan/damper issues. Always REPAIR, never maintenance.'
          },
          {
            id: 'hvac-23',
            title: 'No air coming from vents but system running',
            text: 'Failure of blower motor or frozen coil — REPAIR.'
          },
          {
            id: 'hvac-24',
            title: 'Strange odor from only one room',
            text: 'Requires REPAIR/troubleshooting. Not maintenance.'
          },
          {
            id: 'hvac-25',
            title: 'Duct disconnected or collapsed',
            text: 'Customer reports air blowing into attic/garage. Always REPAIR.'
          }
        ]
      },
      {
        id: 'cat-e',
        name: 'Category E: System Power / Electrical Issues',
        subtitle: 'Safety-Critical Scenarios',
        examples: [
          {
            id: 'hvac-26',
            title: 'Breaker tripping repeatedly',
            text: 'Must never be classified as maintenance. Electrical issue — always REPAIR.'
          },
          {
            id: 'hvac-27',
            title: 'System won\'t turn on at all',
            text: 'No power = REPAIR. Customer may suspect thermostat batteries — but classification stays REPAIR.'
          },
          {
            id: 'hvac-28',
            title: 'Outdoor fan not spinning',
            text: 'Failure of capacitor, fan motor. Always REPAIR.'
          },
          {
            id: 'hvac-29',
            title: 'Thermostat blank or shutting off',
            text: 'Even if caller thinks thermostat is the issue, treat as REPAIR. Could be transformer or control board.'
          },
          {
            id: 'hvac-30',
            title: 'AC turning on/off rapidly (short cycling)',
            text: 'Indicates system malfunction. Always REPAIR.'
          }
        ]
      },
      {
        id: 'cat-f',
        name: 'Category F: Thermostat Confusion / Smart Home Issues',
        subtitle: 'Technology vs System Failure',
        examples: [
          {
            id: 'hvac-31',
            title: 'Customer complains thermostat misreading temperature',
            text: 'Temperature mismatch often indicates sensor/system issues — REPAIR.'
          },
          {
            id: 'hvac-32',
            title: 'Smart thermostat not connecting / system offline',
            text: 'If system fails to heat/cool while smart device shows errors, classify as REPAIR.'
          },
          {
            id: 'hvac-33',
            title: 'Thermostat wiring issue after installation',
            text: 'Always REPAIR — not maintenance, not quote.'
          },
          {
            id: 'hvac-34',
            title: 'Customer requests thermostat replacement because "AC isn\'t working"',
            text: 'If system failure caused thermostat suspicion, triage must still classify as REPAIR first.'
          }
        ]
      },
      {
        id: 'cat-g',
        name: 'Category G: Air Quality / Odors / Allergies',
        subtitle: 'Health-Related Concerns',
        examples: [
          {
            id: 'hvac-35',
            title: 'Customer wants maintenance because of bad smell',
            text: 'If smell originates from system malfunction (mold, burnt wire, coil issue), triage must classify as REPAIR.'
          },
          {
            id: 'hvac-36',
            title: 'Dust blowing out of vents suddenly',
            text: 'This can indicate duct issue or blower problem. Must classify as REPAIR.'
          },
          {
            id: 'hvac-37',
            title: 'Allergy or asthma concern tied to AC not cooling',
            text: 'If cooling/heating is compromised, it\'s REPAIR.'
          }
        ]
      },
      {
        id: 'cat-h',
        name: 'Category H: Maintenance Requests & Misroutes',
        subtitle: 'The Big Revenue Leak',
        examples: [
          {
            id: 'hvac-38',
            title: 'Customer requests maintenance but system has a problem',
            text: 'Any symptom overrides maintenance. Always REPAIR.'
          },
          {
            id: 'hvac-39',
            title: 'Customer wants tune-up because system is louder than before',
            text: 'Noise change = REPAIR.'
          },
          {
            id: 'hvac-40',
            title: 'Customer wants maintenance because AC "takes longer to cool"',
            text: 'Performance drop = REPAIR. Not maintenance.'
          },
          {
            id: 'hvac-41',
            title: 'Customer wants "coil cleaning" but system isn\'t cooling',
            text: 'Caller self-diagnosing incorrectly. Must classify as REPAIR.'
          },
          {
            id: 'hvac-42',
            title: 'Customer wants filter change because AC isn\'t cooling',
            text: 'Cooling failure is REPAIR even if filter is dirty.'
          },
          {
            id: 'hvac-43',
            title: 'Customer wants maintenance to fix thermostat problem',
            text: 'Thermostat = REPAIR, not maintenance.'
          }
        ]
      },
      {
        id: 'cat-i',
        name: 'Category I: Quotes, Consultations, and Non-Service Calls',
        subtitle: 'Sales vs Service Classification',
        examples: [
          {
            id: 'hvac-44',
            title: 'Customer wants a quote for replacement because AC is not cooling',
            text: 'Loss of cooling is REPAIR first. Replacement quotes come after diagnosis. Must classify as REPAIR.'
          },
          {
            id: 'hvac-45',
            title: 'Customer wants second opinion but has no cooling',
            text: 'Still REPAIR. Second opinion does not downgrade severity.'
          },
          {
            id: 'hvac-46',
            title: 'Home sale inspection issue',
            text: 'If inspector flags AC/heating not working, classify as REPAIR.'
          },
          {
            id: 'hvac-47',
            title: 'Customer wants "energy audit" but system isn\'t cooling',
            text: 'System malfunction overrides "audit." Must classify as REPAIR.'
          }
        ]
      },
      {
        id: 'cat-j',
        name: 'Category J: Tenant/Landlord / Property Management Scenarios',
        subtitle: 'Authorization vs Urgency Conflicts',
        examples: [
          {
            id: 'hvac-48',
            title: 'Tenant reports no cooling but landlord requests maintenance',
            text: 'Safety and working order override landlord preference. Must classify as REPAIR.'
          },
          {
            id: 'hvac-49',
            title: 'Renter says AC froze up, landlord wants tune-up',
            text: 'Frozen coil = REPAIR. Must not classify as maintenance even if landlord requests.'
          },
          {
            id: 'hvac-50',
            title: 'Commercial property "AC down in one zone"',
            text: 'Zone outage = REPAIR.'
          }
        ]
      }
    ]
  },
  
  DENTAL: [
    {
      id: 'dental-1',
      title: 'Severe toothache, can\'t sleep (urgent)',
      text: 'Patient reports severe toothache, throbbing pain, and difficulty sleeping or eating on that side. This is an URGENT / EMERGENCY dental issue, not a routine cleaning. The triage engine must classify as EMERGENCY/URGENT VISIT, even if the patient originally called asking for "a cleaning."'
    },
    {
      id: 'dental-2',
      title: 'Small chip on front tooth before big event',
      text: 'Patient chipped a front tooth but has minimal pain and normal function; they\'re worried about appearance for an upcoming event. This is an URGENT COSMETIC / PRIORITY APPOINTMENT, not a standard cleaning. The triage engine should classify as URGENT (same-week if possible), not as routine hygiene.'
    },
    {
      id: 'dental-3',
      title: 'Routine 6-month cleaning, no pain',
      text: 'Patient has no pain, no broken teeth, and simply wants a regular check-up and cleaning. The triage engine must classify this as ROUTINE CLEANING / HYGIENE and must NOT upgrade it to emergency or treatment.'
    },
    {
      id: 'dental-4',
      title: 'Broken filling, mild pain',
      text: 'Patient reports a filling fell out or broke and there is mild to moderate sensitivity but no extreme pain or swelling. This is a PRIORITY TREATMENT visit (within a few days), not a cleaning. The triage engine should classify as TREATMENT/RESTORATIVE, not routine hygiene.'
    },
    {
      id: 'dental-5',
      title: 'Swelling / facial infection signs',
      text: 'Patient reports facial swelling, significant pain, possible fever, or difficulty swallowing. This is a DENTAL EMERGENCY and may require same-day evaluation or ER referral per office policy. The triage engine must classify as EMERGENCY and never treat it as routine.'
    },
    {
      id: 'dental-6',
      title: 'New patient wanting second opinion',
      text: 'New patient calls for a second opinion on recommended treatment from another dentist; no current emergency symptoms. This is a NEW PATIENT CONSULTATION, not hygiene and not emergency. The triage engine must classify as CONSULTATION.'
    },
    {
      id: 'dental-7',
      title: 'Post-op pain within 24–48 hours',
      text: 'Existing patient calls after a recent extraction or procedure and reports expected mild pain controlled with medication, with no alarming signs. This is a NORMAL POST-OP QUESTION. The triage engine should classify as FOLLOW-UP/QUESTION, not emergency, and route through post-op protocol.'
    },
    {
      id: 'dental-8',
      title: 'Post-op uncontrolled bleeding / severe pain',
      text: 'Patient calls after surgery with uncontrolled bleeding, severe pain, or signs of infection. This is a POST-OP EMERGENCY. The triage engine must classify as EMERGENCY, trigger the surgeon/doctor contact protocol, and not treat it as a routine follow-up.'
    },
    {
      id: 'dental-9',
      title: 'Insurance/billing questions only',
      text: 'Caller only has questions about insurance coverage, statements, or payment plans. No clinical concerns. This is a BILLING/ADMIN scenario. The triage engine should classify as OTHER/BILLING and route to the billing team, not to clinical scheduling.'
    },
    {
      id: 'dental-10',
      title: 'Child dental trauma (tooth knocked out)',
      text: 'Parent calls because a child knocked out or severely loosened a tooth from trauma. This is a PEDIATRIC DENTAL EMERGENCY. The triage engine must classify as EMERGENCY and follow the trauma protocol, not routine pediatric appointment.'
    }
  ],
  
  ATTORNEY: [
    {
      id: 'attorney-1',
      title: 'Car accident yesterday, injuries reported',
      text: 'Caller was in a car accident within the last few days, has injuries, and is seeking representation. This is a NEW PERSONAL INJURY LEAD, not a generic "question." The triage engine must classify as NEW CASE INTAKE → PERSONAL INJURY and send through full intake script.'
    },
    {
      id: 'attorney-2',
      title: 'Existing client asking for case update',
      text: 'Existing client calls about the status of their active case, with no new incident. This is an EXISTING CLIENT UPDATE, not a new lead. The triage engine must classify as EXISTING CASE and route to the assigned attorney/team, not intake.'
    },
    {
      id: 'attorney-3',
      title: 'Domestic violence, needs immediate protection',
      text: 'Caller reports current or recent domestic violence and is asking about restraining orders or immediate protection. This is an EMERGENCY FAMILY LAW / PROTECTION ORDER situation. The triage engine must classify as EMERGENCY FAMILY LAW and trigger same-day escalation, not standard consultation.'
    },
    {
      id: 'attorney-4',
      title: 'Wants to "file for divorce eventually" (non-urgent)',
      text: 'Caller is exploring divorce but no immediate safety issues or deadlines. This is a STANDARD FAMILY LAW CONSULTATION. The triage engine should classify as NEW CLIENT CONSULT – FAMILY LAW, not emergency.'
    },
    {
      id: 'attorney-5',
      title: 'Arrested or expects arrest soon',
      text: 'Caller or their family member has just been arrested, is in custody, or expects arrest soon. This is CRIMINAL DEFENSE EMERGENCY. The triage engine must classify as EMERGENCY CRIMINAL and trigger after-hours/on-call rules if applicable.'
    },
    {
      id: 'attorney-6',
      title: 'Business owner wants contract review',
      text: 'Business owner needs a contract reviewed or drafted, with no active dispute or lawsuit. This is a BUSINESS/TRANSACTIONAL CONSULTATION. The triage engine should classify as BUSINESS LAW CONSULT, not litigation emergency.'
    },
    {
      id: 'attorney-7',
      title: 'Served with lawsuit, deadline approaching',
      text: 'Caller has been served with a complaint or legal notice and has a clear response deadline (e.g., 20 days) approaching soon. This is a LITIGATION URGENT MATTER. The triage engine must classify as URGENT CIVIL/LITIGATION and not as a casual "general question."'
    },
    {
      id: 'attorney-8',
      title: 'Immigration deadline / expiring status',
      text: 'Caller has an upcoming immigration deadline, expiring visa/green card, or upcoming hearing. This is an IMMIGRATION URGENT CASE depending on timing. The triage engine should classify as IMMIGRATION with priority level based on how close the deadline is, not generic consultation.'
    },
    {
      id: 'attorney-9',
      title: 'Only asking about payment plan / invoice',
      text: 'Existing client calls only about a bill, payment plan, or past-due statement. No case questions. This is BILLING/ADMIN, not legal triage. The triage engine should classify as BILLING and route to accounting/admin, not an attorney.'
    },
    {
      id: 'attorney-10',
      title: 'Wrong practice area (we don\'t handle this)',
      text: 'Caller is asking for help in a practice area the firm does NOT handle (e.g., caller wants patent work and the firm only does injury/family/criminal). The triage engine should classify this as NOT A FIT / NON-SERVICE AREA and follow the decline/referral script instead of trying to book a consultation.'
    }
  ],

  APPOINTMENT_MANAGEMENT: [
    {
      id: 'appt-1',
      title: 'Customer cannot be home for scheduled appointment',
      text: 'Customer explains they have a scheduled appointment at 1 PM today but will not be home due to an unexpected conflict. They request a reschedule or ask if the technician can come earlier or later. Brain requirement: Classify as APPOINTMENT MANAGEMENT, never REPAIR. Route to booking/reschedule flow. Do NOT confuse this with any HVAC issue.'
    },
    {
      id: 'appt-2',
      title: 'Customer wants to give key placement instructions',
      text: 'Customer states, "I won\'t be home but I\'ll leave the key under the mat / inside the grill / behind the flowerpot." They want the technician to enter using instructions. Brain requirement: Classify as ACCESS INSTRUCTIONS under APPOINTMENT MANAGEMENT, not HVAC triage. Send to 3-Tier booking module to attach notes.'
    },
    {
      id: 'appt-3',
      title: 'Customer requests technician to call before arrival',
      text: 'Customer says: "Can the technician call me when he\'s on the way?" They aren\'t reporting symptoms — they just want a courtesy call. Brain requirement: Classify as APPOINTMENT REQUEST → "Contact Preference." Route to booking module to update notes. NEVER classify as repair/emergency.'
    },
    {
      id: 'appt-4',
      title: 'Customer wants to update gate code or property access',
      text: 'Customer reports their gate code changed or the community guard requires a visitor pass. They want to update access instructions for the technician. Brain requirement: Classify as ACCESS INSTRUCTIONS. Route directly to booking notes update.'
    },
    {
      id: 'appt-5',
      title: 'Neighbor or family member will open the door',
      text: 'Customer says: "My neighbor Nancy will open the door for the tech. Her number is 239-333-3333." They are coordinating access through someone else. Brain requirement: Classify as APPOINTMENT ACCESS MANAGEMENT, not HVAC. Send to booking module to save the secondary contact info.'
    },
    {
      id: 'appt-6',
      title: 'Customer wants to confirm their appointment window',
      text: 'Caller says: "I forgot the time — what time is the tech coming again?" Need confirmation, NOT triage. Brain requirement: Categorize as APPOINTMENT CONFIRMATION, not a repair request. Route to booking data lookup.'
    },
    {
      id: 'appt-7',
      title: 'Customer is running late and wants technician to wait',
      text: 'Customer says: "I\'m running behind, can the technician wait or come later?" This is scheduling logistics. Brain requirement: Classify as APPOINTMENT SCHEDULING CHANGE, not repair. Route accordingly.'
    },
    {
      id: 'appt-8',
      title: 'Customer wants to cancel their appointment entirely',
      text: 'Customer says: "I don\'t need the appointment anymore — please cancel." No HVAC symptoms, no triage. Brain requirement: Classify as APPOINTMENT CANCELLATION. Send to booking flow → cancellation logic.'
    },
    {
      id: 'appt-9',
      title: 'Customer requests a specific technician by name',
      text: 'Customer says: "Can you send Dustin again? He was the one last time and I prefer him." This is not diagnostic. It is an operational preference. Brain requirement: Classify as TECHNICIAN PREFERENCE under Appointment Management. Do NOT treat as repair or maintenance.'
    },
    {
      id: 'appt-10',
      title: 'Customer wants to modify appointment notes',
      text: 'Customer says: "Please tell the technician to bring shoe covers," "Please avoid my driveway," "Baby is sleeping — don\'t ring the doorbell," "My dog will be locked up," "Please check the thermostat upstairs too," etc. Brain requirement: Classify as APPOINTMENT NOTE UPDATE. Route to booking module note-update workflow.'
    }
  ]
};

/**
 * Get examples for a specific industry
 * @param {string} industry - Industry key (HVAC, DENTAL, ATTORNEY, APPOINTMENT_MANAGEMENT)
 * @returns {Array} Array of example objects (flat list for rendering)
 */
export function getExamplesForIndustry(industry) {
  const key = industry.toUpperCase().replace(/\s+/g, '_');
  const data = TRIAGE_EXAMPLES[key];
  
  if (!data) return [];
  
  // HVAC has categorized structure
  if (data.categories) {
    return data.categories;
  }
  
  // Others have flat array
  return data;
}

/**
 * Get all available industries
 * @returns {Array} Array of industry objects with metadata
 */
export function getAvailableIndustries() {
  return [
    { key: 'HVAC', label: 'HVAC', count: 50 },
    { key: 'DENTAL', label: 'Dental Office', count: 10 },
    { key: 'ATTORNEY', label: 'Attorney/Law Firm', count: 10 },
    { key: 'APPOINTMENT_MANAGEMENT', label: 'Appointment Management (All Industries)', count: 10 }
  ];
}
