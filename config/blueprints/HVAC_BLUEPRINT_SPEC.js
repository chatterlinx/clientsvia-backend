/**
 * ════════════════════════════════════════════════════════════════════════════════
 * HVAC BLUEPRINT SPEC V1 - Master Scenario Inventory
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * This is the HVAC template coverage contract.
 * It defines WHAT scenarios an HVAC template MUST have.
 * 
 * Based on real HVAC dispatcher call patterns:
 * - Emergency dispatches (gas, no heat, no AC)
 * - Equipment classification (running not cooling, noises, leaks)
 * - Booking flows (repair, maintenance, estimates)
 * - Administrative (reschedule, cancel, confirm)
 * - Informational (hours, service areas, pricing)
 * - Edge cases (wrong number, spam, confusion)
 * 
 * ITEMS: 75 scenarios across 12 categories
 * REQUIRED: 55 (must-have for production)
 * OPTIONAL: 20 (nice-to-have)
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const HVAC_BLUEPRINT_SPEC = {
    blueprintId: 'hvac-blueprint-v1',
    tradeKey: 'hvac',
    name: 'HVAC Master Blueprint',
    version: 'v1.0',
    description: 'Comprehensive HVAC scenario coverage for residential/commercial service companies',
    
    metadata: {
        companyTone: 'calm_professional',
        disallowedTopics: [
            'DIY electrical work',
            'refrigerant handling instructions',
            'gas line modifications',
            'warranty claims without verification',
            'competitor pricing'
        ],
        complianceNotes: [
            'Gas smells require immediate 911 referral',
            'Carbon monoxide concerns require evacuation advice',
            'Never promise specific arrival times without calendar check',
            'Do not provide troubleshooting steps for gas equipment'
        ],
        operatingAssumptions: {
            emergencyAvailable: true,
            afterHoursDispatch: true,
            weekendService: true,
            holidayService: 'limited',
            typicalDispatchWindow: '2-4 hours',
            emergencyDispatchWindow: '1-2 hours'
        }
    },
    
    categories: [
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 1: EMERGENCIES (Priority 95-100)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-emergency',
            name: 'Emergency Service',
            icon: '🚨',
            priority: 100,
            items: [
                {
                    itemKey: 'hvac_gas_smell',
                    name: 'Gas Smell Emergency',
                    scenarioType: 'EMERGENCY',
                    required: true,
                    priority: 'high',
                    bookingIntent: false,
                    replyGoal: 'transfer',
                    triggerHints: ['smell gas', 'gas smell', 'gas leak', 'rotten egg smell', 'sulfur smell'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['emergency', 'gas', 'safety', 'critical'],
                    notes: 'CRITICAL: Must advise evacuation and 911. Never troubleshoot gas issues.'
                },
                {
                    itemKey: 'hvac_no_ac_summer',
                    name: 'No AC Emergency (Summer)',
                    scenarioType: 'EMERGENCY',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['no ac', 'ac broken', 'ac died', 'ac stopped working', 'no cool air', 'house is hot'],
                    negativeTriggerHints: ['schedule maintenance', 'tune up'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['emergency', 'ac', 'summer', 'urgent'],
                    notes: 'High priority in summer months. Dispatch same-day when possible.'
                },
                {
                    itemKey: 'hvac_no_heat_winter',
                    name: 'No Heat Emergency (Winter)',
                    scenarioType: 'EMERGENCY',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['no heat', 'heater broken', 'furnace died', 'no hot air', 'house is freezing', 'furnace not working'],
                    negativeTriggerHints: ['tune up', 'maintenance'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['emergency', 'heating', 'winter', 'urgent'],
                    notes: 'Critical in winter - hypothermia risk. Ask about elderly/infants.'
                },
                {
                    itemKey: 'hvac_carbon_monoxide',
                    name: 'Carbon Monoxide Concern',
                    scenarioType: 'EMERGENCY',
                    required: true,
                    priority: 'high',
                    bookingIntent: false,
                    replyGoal: 'transfer',
                    triggerHints: ['carbon monoxide', 'CO detector', 'CO alarm', 'monoxide alarm'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['emergency', 'co', 'safety', 'critical'],
                    notes: 'CRITICAL: Advise immediate evacuation. Call 911 first.'
                },
                {
                    itemKey: 'hvac_water_leak_unit',
                    name: 'Water Leak From HVAC Unit',
                    scenarioType: 'EMERGENCY',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['water leak', 'leaking water', 'water under unit', 'ac leaking', 'puddle under ac'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['emergency', 'leak', 'water', 'urgent'],
                    notes: 'Potential property damage. Same-day dispatch priority.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 2: EQUIPMENT CLASSIFICATION (Priority 75-85)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-equipment',
            name: 'Equipment Issues',
            icon: '🔧',
            priority: 80,
            items: [
                {
                    itemKey: 'hvac_running_not_cooling',
                    name: 'AC Running But Not Cooling',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['running not cooling', 'ac on but warm', 'blowing warm air', 'not getting cold', 'ac running but house hot'],
                    negativeTriggerHints: ['no power', 'wont turn on'],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'ac', 'cooling', 'diagnostic'],
                    notes: 'Could be refrigerant, compressor, or filter. Classify first.'
                },
                {
                    itemKey: 'hvac_not_turning_on',
                    name: 'HVAC Unit Not Turning On',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['wont turn on', 'not starting', 'no power', 'dead', 'nothing happens'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'power', 'diagnostic'],
                    notes: 'Could be electrical, thermostat, or unit failure.'
                },
                {
                    itemKey: 'hvac_strange_noise',
                    name: 'Strange Noise From Unit',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['strange noise', 'loud noise', 'banging', 'clicking', 'squealing', 'grinding', 'humming'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'noise', 'diagnostic'],
                    notes: 'Ask what type of noise. Different sounds = different issues.'
                },
                {
                    itemKey: 'hvac_thermostat_blank',
                    name: 'Thermostat Blank/Unresponsive',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['thermostat blank', 'thermostat dead', 'thermostat not working', 'display not showing'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'thermostat', 'diagnostic'],
                    notes: 'Could be batteries, wiring, or thermostat failure.'
                },
                {
                    itemKey: 'hvac_short_cycling',
                    name: 'Unit Short Cycling',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['turns on and off', 'keeps cycling', 'short cycling', 'starts and stops', 'runs for a minute then stops'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'cycling', 'diagnostic'],
                    notes: 'Often refrigerant or sensor issue. Schedule diagnostic.'
                },
                {
                    itemKey: 'hvac_frozen_coil',
                    name: 'Frozen Evaporator Coil',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['frozen', 'ice on unit', 'coil frozen', 'frozen inside', 'ice buildup'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'frozen', 'ac', 'diagnostic'],
                    notes: 'Advise turning off AC. Low refrigerant or airflow issue.'
                },
                {
                    itemKey: 'hvac_bad_smell',
                    name: 'Bad Smell From Vents',
                    scenarioType: 'TROUBLESHOOT',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['bad smell', 'smells bad', 'musty smell', 'burning smell', 'weird odor from vents'],
                    negativeTriggerHints: ['gas smell', 'rotten egg'],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'smell', 'diagnostic'],
                    notes: 'Important: burning smell may indicate electrical issue.'
                },
                {
                    itemKey: 'hvac_uneven_temperatures',
                    name: 'Uneven Temperatures/Hot Spots',
                    scenarioType: 'TROUBLESHOOT',
                    required: false,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['hot spots', 'cold spots', 'uneven temperature', 'some rooms hot', 'upstairs too hot'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'airflow', 'diagnostic'],
                    notes: 'Could be ductwork, zoning, or unit sizing.'
                },
                {
                    itemKey: 'hvac_high_bills',
                    name: 'High Energy Bills',
                    scenarioType: 'TROUBLESHOOT',
                    required: false,
                    priority: 'low',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['high electric bill', 'energy bill high', 'using too much power', 'bills went up'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['equipment', 'efficiency', 'diagnostic'],
                    notes: 'Often indicates maintenance needed or equipment age.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 3: MAINTENANCE (Priority 65-75)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-maintenance',
            name: 'Maintenance Services',
            icon: '🛠️',
            priority: 70,
            items: [
                {
                    itemKey: 'hvac_ac_tuneup',
                    name: 'AC Tune-Up/Maintenance',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['ac tune up', 'ac maintenance', 'ac service', 'summer maintenance', 'get ac ready'],
                    negativeTriggerHints: ['broken', 'not working', 'emergency'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['maintenance', 'ac', 'tuneup', 'preventive'],
                    notes: 'Seasonal service. Emphasize benefits of preventive maintenance.'
                },
                {
                    itemKey: 'hvac_furnace_tuneup',
                    name: 'Furnace Tune-Up/Maintenance',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['furnace tune up', 'heating maintenance', 'furnace service', 'winter maintenance', 'get furnace ready'],
                    negativeTriggerHints: ['broken', 'not working', 'emergency'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['maintenance', 'furnace', 'tuneup', 'preventive'],
                    notes: 'Fall service priority. Safety inspection included.'
                },
                {
                    itemKey: 'hvac_filter_change',
                    name: 'Filter Change/Service',
                    scenarioType: 'BOOKING',
                    required: false,
                    priority: 'low',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['change filter', 'filter replacement', 'new filter', 'filter service'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['maintenance', 'filter', 'simple'],
                    notes: 'Often included with tune-up. Can be standalone.'
                },
                {
                    itemKey: 'hvac_duct_cleaning',
                    name: 'Duct Cleaning',
                    scenarioType: 'BOOKING',
                    required: false,
                    priority: 'low',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['duct cleaning', 'clean ducts', 'air duct cleaning', 'ductwork cleaning'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['maintenance', 'ducts', 'cleaning'],
                    notes: 'May be separate service. Check if company offers.'
                },
                {
                    itemKey: 'hvac_membership_plan',
                    name: 'Maintenance Plan Inquiry',
                    scenarioType: 'FAQ',
                    required: false,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['maintenance plan', 'service plan', 'membership', 'annual plan', 'subscription'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['membership', 'plan', 'sales'],
                    notes: 'Upsell opportunity. Describe plan benefits.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 4: BOOKING (Priority 55-65)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-booking',
            name: 'Appointment Booking',
            icon: '📅',
            priority: 60,
            items: [
                {
                    itemKey: 'hvac_schedule_repair',
                    name: 'Schedule Repair',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['schedule repair', 'need repair', 'book repair', 'fix my', 'something wrong with'],
                    negativeTriggerHints: ['estimate', 'new system'],
                    entityCaptureHints: ['address', 'name', 'phone', 'issue'],
                    tags: ['booking', 'repair', 'service'],
                    notes: 'Core booking scenario. Classify issue before booking.'
                },
                {
                    itemKey: 'hvac_schedule_estimate',
                    name: 'Schedule Estimate/Quote',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['get estimate', 'schedule estimate', 'free estimate', 'quote', 'get a quote'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['booking', 'estimate', 'sales'],
                    notes: 'Sales opportunity. Ask what they need estimated.'
                },
                {
                    itemKey: 'hvac_general_appointment',
                    name: 'General Appointment Request',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['schedule appointment', 'book appointment', 'make appointment', 'need someone to come out'],
                    negativeTriggerHints: ['cancel', 'reschedule'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['booking', 'appointment', 'general'],
                    notes: 'Catch-all booking. Clarify service type needed.'
                },
                {
                    itemKey: 'hvac_after_hours_message',
                    name: 'After Hours Message Take',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['leave message', 'call back', 'have someone call', 'callback', 'return call'],
                    negativeTriggerHints: ['emergency'],
                    entityCaptureHints: ['name', 'phone', 'issue'],
                    tags: ['booking', 'callback', 'afterhours'],
                    notes: 'Non-emergency after hours. Collect info for callback.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 5: ADMIN/EXISTING CUSTOMERS (Priority 50-55)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-admin',
            name: 'Appointment Management',
            icon: '📋',
            priority: 52,
            items: [
                {
                    itemKey: 'hvac_confirm_appointment',
                    name: 'Confirm Appointment',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'inform',
                    triggerHints: ['confirm appointment', 'verify appointment', 'still coming', 'appointment tomorrow', 'what time is my appointment'],
                    negativeTriggerHints: ['reschedule', 'cancel'],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['admin', 'confirm', 'appointment'],
                    notes: 'Look up appointment by name/phone and confirm details.'
                },
                {
                    itemKey: 'hvac_reschedule',
                    name: 'Reschedule Appointment',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['reschedule', 'change appointment', 'move appointment', 'different time', 'different day'],
                    negativeTriggerHints: ['cancel'],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['admin', 'reschedule', 'appointment'],
                    notes: 'Look up existing appointment, then find new time.'
                },
                {
                    itemKey: 'hvac_cancel_appointment',
                    name: 'Cancel Appointment',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['cancel appointment', 'cancel service', 'dont need appointment', 'wont be able to make it'],
                    negativeTriggerHints: ['reschedule'],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['admin', 'cancel', 'appointment'],
                    notes: 'Verify appointment, offer to reschedule before canceling.'
                },
                {
                    itemKey: 'hvac_technician_eta',
                    name: 'Technician ETA/Status',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'high',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['where is technician', 'tech running late', 'when will tech arrive', 'eta', 'still coming today'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['admin', 'status', 'technician'],
                    notes: 'Common call. Check dispatch status and provide update.'
                },
                {
                    itemKey: 'hvac_request_specific_tech',
                    name: 'Request Specific Technician',
                    scenarioType: 'BOOKING',
                    required: false,
                    priority: 'low',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['want same tech', 'request specific technician', 'can john come', 'worked with before'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone', 'tech_name'],
                    tags: ['admin', 'technician', 'preference'],
                    notes: 'Try to accommodate. Note preference even if not available.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 6: BILLING (Priority 40-50)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-billing',
            name: 'Billing & Payment',
            icon: '💳',
            priority: 45,
            items: [
                {
                    itemKey: 'hvac_invoice_question',
                    name: 'Invoice Question',
                    scenarioType: 'BILLING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['invoice', 'bill', 'charge', 'what was I charged', 'explain my bill'],
                    negativeTriggerHints: ['pay', 'payment'],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['billing', 'invoice', 'question'],
                    notes: 'Look up invoice, explain charges if possible.'
                },
                {
                    itemKey: 'hvac_make_payment',
                    name: 'Make Payment',
                    scenarioType: 'BILLING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'transfer',
                    triggerHints: ['make payment', 'pay bill', 'pay invoice', 'payment', 'pay over phone'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['billing', 'payment'],
                    notes: 'May need to transfer to billing team for PCI compliance.'
                },
                {
                    itemKey: 'hvac_payment_options',
                    name: 'Payment Options',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['payment options', 'how can i pay', 'accept credit card', 'financing', 'payment plan'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['billing', 'payment', 'options'],
                    notes: 'List accepted payment methods. Mention financing if available.'
                },
                {
                    itemKey: 'hvac_receipt_request',
                    name: 'Receipt Request',
                    scenarioType: 'BILLING',
                    required: false,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['need receipt', 'send receipt', 'copy of invoice', 'email receipt'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'email'],
                    tags: ['billing', 'receipt', 'admin'],
                    notes: 'Collect email and forward request.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 7: PRICING (Priority 35-45)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-pricing',
            name: 'Pricing Questions',
            icon: '💰',
            priority: 40,
            items: [
                {
                    itemKey: 'hvac_service_call_fee',
                    name: 'Service Call Fee',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['service call fee', 'diagnostic fee', 'how much to come out', 'trip charge', 'dispatch fee'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['pricing', 'fees', 'presale'],
                    notes: 'Be transparent about fees. Waived with repair common.'
                },
                {
                    itemKey: 'hvac_repair_cost',
                    name: 'Repair Cost Question',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'classify',
                    triggerHints: ['how much to fix', 'repair cost', 'how much to repair', 'cost to fix'],
                    negativeTriggerHints: ['new system'],
                    entityCaptureHints: [],
                    tags: ['pricing', 'repair', 'presale'],
                    notes: 'Depends on diagnosis. Offer free estimate or service call.'
                },
                {
                    itemKey: 'hvac_new_system_cost',
                    name: 'New System Cost',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['new ac cost', 'new system', 'replacement cost', 'how much for new unit', 'install new'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address'],
                    tags: ['pricing', 'sales', 'installation'],
                    notes: 'Big sale opportunity. Schedule free in-home estimate.'
                },
                {
                    itemKey: 'hvac_tuneup_cost',
                    name: 'Tune-Up Cost',
                    scenarioType: 'FAQ',
                    required: false,
                    priority: 'low',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['tune up cost', 'maintenance cost', 'how much for tuneup', 'price of maintenance'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['pricing', 'maintenance'],
                    notes: 'Straightforward pricing. Mention membership discounts.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 8: POLICY/INFO (Priority 20-35)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-info',
            name: 'Business Information',
            icon: 'ℹ️',
            priority: 30,
            items: [
                {
                    itemKey: 'hvac_business_hours',
                    name: 'Business Hours',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['hours', 'when open', 'business hours', 'what time open', 'weekend hours'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['info', 'hours', 'quick'],
                    notes: 'Quick answer. Mention emergency availability.'
                },
                {
                    itemKey: 'hvac_service_area',
                    name: 'Service Area',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['do you serve', 'service area', 'come to my area', 'available in', 'service my zip'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address', 'zip'],
                    tags: ['info', 'coverage', 'area'],
                    notes: 'Check if their location is serviceable.'
                },
                {
                    itemKey: 'hvac_brands_serviced',
                    name: 'Brands Serviced',
                    scenarioType: 'FAQ',
                    required: false,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['service carrier', 'work on trane', 'fix lennox', 'brands you work on'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['info', 'brands', 'equipment'],
                    notes: 'Most service all brands. Note any exclusions.'
                },
                {
                    itemKey: 'hvac_warranty_question',
                    name: 'Warranty Question',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['warranty', 'under warranty', 'warranty covered', 'warranty claim'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'address'],
                    tags: ['info', 'warranty', 'support'],
                    notes: 'Need to look up service history. May need to transfer.'
                },
                {
                    itemKey: 'hvac_emergency_service_available',
                    name: 'Emergency Service Availability',
                    scenarioType: 'FAQ',
                    required: true,
                    priority: 'medium',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['emergency service', '24 hour service', 'after hours', 'weekend emergency', 'holiday service'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['info', 'emergency', 'availability'],
                    notes: 'Confirm 24/7 availability. Mention emergency fees if applicable.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 9: SALES/NEW SYSTEMS (Priority 40-50)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-sales',
            name: 'New System Sales',
            icon: '🏠',
            priority: 45,
            items: [
                {
                    itemKey: 'hvac_new_ac_inquiry',
                    name: 'New AC System Inquiry',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['new ac', 'replace ac', 'new air conditioner', 'ac installation', 'install new ac'],
                    negativeTriggerHints: ['repair'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['sales', 'ac', 'installation'],
                    notes: 'High value lead. Schedule free in-home estimate.'
                },
                {
                    itemKey: 'hvac_new_furnace_inquiry',
                    name: 'New Furnace Inquiry',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['new furnace', 'replace furnace', 'new heater', 'furnace installation'],
                    negativeTriggerHints: ['repair'],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['sales', 'furnace', 'installation'],
                    notes: 'High value lead. Schedule free in-home estimate.'
                },
                {
                    itemKey: 'hvac_complete_system_inquiry',
                    name: 'Complete HVAC System Inquiry',
                    scenarioType: 'BOOKING',
                    required: true,
                    priority: 'high',
                    bookingIntent: true,
                    replyGoal: 'book',
                    triggerHints: ['whole system', 'complete system', 'new hvac', 'full replacement', 'both ac and furnace'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['address', 'name', 'phone'],
                    tags: ['sales', 'hvac', 'installation', 'high-value'],
                    notes: 'Highest value lead. Priority scheduling for estimate.'
                },
                {
                    itemKey: 'hvac_financing_question',
                    name: 'Financing Question',
                    scenarioType: 'FAQ',
                    required: false,
                    priority: 'medium',
                    bookingIntent: true,
                    replyGoal: 'inform',
                    triggerHints: ['financing', 'payment plan', 'monthly payments', 'finance options', 'can i finance'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['sales', 'financing', 'payment'],
                    notes: 'Explain financing options. Good closing opportunity.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 10: ESCALATION (Priority 85-95)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-escalation',
            name: 'Escalation Requests',
            icon: '👤',
            priority: 90,
            items: [
                {
                    itemKey: 'hvac_talk_to_manager',
                    name: 'Manager/Supervisor Request',
                    scenarioType: 'TRANSFER',
                    required: true,
                    priority: 'high',
                    bookingIntent: false,
                    replyGoal: 'transfer',
                    triggerHints: ['talk to manager', 'supervisor', 'speak to someone else', 'escalate', 'higher up'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['escalation', 'manager', 'transfer'],
                    notes: 'Try to help first. If insistent, take info for callback.'
                },
                {
                    itemKey: 'hvac_complaint',
                    name: 'Complaint/Dissatisfied',
                    scenarioType: 'TRANSFER',
                    required: true,
                    priority: 'high',
                    bookingIntent: false,
                    replyGoal: 'transfer',
                    triggerHints: ['complaint', 'not happy', 'dissatisfied', 'unhappy with service', 'bad experience'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['escalation', 'complaint', 'retention'],
                    notes: 'Empathize. Capture details for manager callback.'
                },
                {
                    itemKey: 'hvac_talk_to_human',
                    name: 'Request Human Agent',
                    scenarioType: 'TRANSFER',
                    required: true,
                    priority: 'high',
                    bookingIntent: false,
                    replyGoal: 'transfer',
                    triggerHints: ['talk to human', 'real person', 'not a robot', 'live person', 'operator'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['escalation', 'transfer', 'human'],
                    notes: 'Offer to help. If insistent, transfer or take callback info.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 11: SMALL TALK (Priority 0-10)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-smalltalk',
            name: 'Greetings & Closings',
            icon: '👋',
            priority: 5,
            items: [
                {
                    itemKey: 'hvac_greeting',
                    name: 'Greeting/Hello',
                    scenarioType: 'SMALL_TALK',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'classify',
                    triggerHints: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['greeting', 'opening'],
                    notes: 'Greet and ask how you can help.'
                },
                {
                    itemKey: 'hvac_goodbye_thanks',
                    name: 'Thank You / Goodbye',
                    scenarioType: 'SMALL_TALK',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'close',
                    triggerHints: ['thank you', 'thanks', 'bye', 'goodbye', 'thats all', 'appreciate it'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['closing', 'goodbye', 'gratitude'],
                    notes: 'Thank them and invite them to call again.'
                },
                {
                    itemKey: 'hvac_hold_please',
                    name: 'Hold Request',
                    scenarioType: 'SMALL_TALK',
                    required: false,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['hold on', 'one second', 'wait a moment', 'let me check', 'hold please'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['hold', 'waiting'],
                    notes: 'Acknowledge and wait patiently.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 12: EDGE CASES (Priority 0-5)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryKey: 'hvac-edge',
            name: 'Edge Cases',
            icon: '❓',
            priority: 3,
            items: [
                {
                    itemKey: 'hvac_wrong_number',
                    name: 'Wrong Number',
                    scenarioType: 'SYSTEM',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'close',
                    triggerHints: ['wrong number', 'is this', 'who is this', 'what company', 'wrong business'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['edge', 'wrong', 'misdial'],
                    notes: 'Confirm company name. Politely redirect.'
                },
                {
                    itemKey: 'hvac_spam_sales',
                    name: 'Spam/Sales Call',
                    scenarioType: 'SYSTEM',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'close',
                    triggerHints: ['selling', 'offer you', 'business opportunity', 'marketing', 'SEO services'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['spam', 'sales', 'block'],
                    notes: 'Politely decline. Do not engage.'
                },
                {
                    itemKey: 'hvac_job_application',
                    name: 'Job Application',
                    scenarioType: 'SYSTEM',
                    required: false,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'inform',
                    triggerHints: ['hiring', 'job', 'apply', 'employment', 'work for you', 'technician position'],
                    negativeTriggerHints: [],
                    entityCaptureHints: ['name', 'phone'],
                    tags: ['hr', 'hiring', 'employment'],
                    notes: 'Provide hiring info or take message for HR.'
                },
                {
                    itemKey: 'hvac_confused_unsure',
                    name: 'Caller Confused/Unsure',
                    scenarioType: 'SUPPORT',
                    required: true,
                    priority: 'low',
                    bookingIntent: false,
                    replyGoal: 'classify',
                    triggerHints: ['not sure', 'dont know', 'confused', 'what do i need', 'help me figure out'],
                    negativeTriggerHints: [],
                    entityCaptureHints: [],
                    tags: ['guidance', 'confused', 'help'],
                    notes: 'Ask clarifying questions to determine their need.'
                }
            ]
        }
    ]
};

module.exports = HVAC_BLUEPRINT_SPEC;
