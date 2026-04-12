#!/usr/bin/env node
/**
 * gen-kc-duct-cleaning.js
 * Generates kc-duct-cleaning.json for Penguin Air "Duct Cleaning" card.
 *
 * WORKFLOW:
 *   1. Create empty container titled "Duct Cleaning" in services.html
 *   2. Run: node scripts/gen-kc-duct-cleaning.js
 *   3. Import kc-duct-cleaning.json into the container via services.html
 *   4. Re-score All → Fix All → Generate Missing Audio
 *
 * 24 sections covering:
 *   - Core questions (0-5)
 *   - Air quality & health (6-10)
 *   - When to get it done (11-14)
 *   - Process & what to expect (15-18)
 *   - Situation-specific (19-23)
 */
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// GROQ CONTENT CATEGORIES — reusable deep content templates (~350-400 words)
// ═══════════════════════════════════════════════════════════════════════════

const groqCat = {

  duct_pricing: `Duct cleaning pricing depends on several factors including the size of the home, the number of supply and return vents, the type of ductwork, and whether there are any access challenges. A standard residential duct cleaning for a typical single-story home with 10 to 15 vents generally falls within a predictable range, while larger homes, multi-story layouts, or systems with 20 or more vents cost more because of the additional time and labor required.

The process involves specialized equipment that is not inexpensive to operate. Professional duct cleaning uses a truck-mounted or portable negative air pressure machine that creates powerful suction at the main trunk line while technicians work through each individual vent with rotary brush systems and compressed air tools. The negative air machine pulls dislodged debris through the ductwork and captures it in a HEPA-filtered collection system so that nothing re-enters the living space. This equipment investment is part of what separates a legitimate duct cleaning from a low-cost bait-and-switch operation.

The scope of work includes cleaning all supply ducts, all return ducts, the main trunk lines, the plenum connections at the air handler, and the register boots where the vents connect to the duct runs. Some companies also include a basic cleaning of the blower compartment and evaporator coil housing as part of the standard service. If the system has dampers, access panels, or flex duct transitions, those are addressed as well.

For homes that have not had duct cleaning in many years or have never had it done, the initial cleaning may take longer because of heavier buildup. Homes with known contamination such as mold, pest debris, or post-construction dust may require additional steps and carry a different cost structure because of the specialized handling those situations require.

The best way to get an accurate price is to let the scheduling team know the approximate square footage, number of vents, and any specific concerns like mold or recent renovation. That allows them to provide a realistic estimate before the appointment. There are no hidden fees or surprise upcharges when the scope is communicated clearly upfront.

If the caller is ready to move forward, the next step is collecting their name, phone number, and address so the team can provide a quote and get them on the schedule.`,

  duct_service: `Professional duct cleaning is a systematic process that removes accumulated dust, debris, allergens, and contaminants from the entire air distribution system in the home. The service covers every component that air passes through from the air handler to the individual room vents, ensuring that the air circulating through the home is moving through clean pathways.

The process begins with a full inspection of the duct system. The technician examines accessible portions of the ductwork, checks for disconnections or damage, identifies any areas of concern like moisture intrusion or pest evidence, and determines the best access points for cleaning equipment. This inspection sets the scope for the cleaning and identifies anything that may need to be addressed beyond the standard service.

The primary cleaning method uses negative air pressure. A large vacuum unit, either truck-mounted or portable, is connected to the main trunk line near the air handler. This creates a powerful vacuum that pulls air through the entire duct system toward the collection point. While the vacuum runs, a technician works through each supply and return vent individually using a combination of rotary brush systems, compressed air whips, and agitation tools that dislodge debris from the interior walls of the ductwork. The negative air pressure ensures that everything dislodged moves toward the vacuum and gets captured in the HEPA filtration system rather than being pushed into the living space.

The trunk lines, which are the large main ducts that branch out to individual rooms, receive direct cleaning with larger brush systems. The plenum, which connects the air handler to the duct system, is cleaned as well. Register boots, which are the sheet metal boxes behind each vent cover, tend to collect significant debris and receive focused attention.

After the duct cleaning is complete, the technician reinstalls all vent covers and performs a final inspection to verify airflow at each register. The work area is cleaned up and any debris from the process is removed.

The entire process typically takes three to five hours for a standard residential system. Larger homes or systems with extensive contamination may take longer. The home's HVAC system should not be running during the cleaning process, and the technician will manage the system as needed throughout the service.`,

  air_quality_health: `Indoor air quality is directly affected by the condition of the ductwork because every cubic foot of conditioned air in the home passes through the duct system multiple times each day. When ducts contain accumulated dust, pollen, pet dander, mold spores, or other particulates, those contaminants become airborne each time the system cycles and are distributed throughout every room the ducts serve.

For people with allergies, asthma, or other respiratory sensitivities, this recirculation of irritants can trigger symptoms even when outdoor air quality is good. The home should be a refuge from airborne irritants, but a contaminated duct system works against that by continuously reintroducing the exact particles that cause problems. Dust mites, which are one of the most common indoor allergens, thrive in the dust that accumulates inside ductwork. Their waste particles become airborne when the system runs, and they are small enough to penetrate deep into the lungs.

Pet owners face a compounding challenge. Pet hair and dander accumulate inside ducts over time and become part of the recirculating air supply. Even with regular filter changes, smaller dander particles pass through standard filters and settle inside the duct system. Homes with multiple pets or pets that shed heavily see faster buildup, and the ductwork becomes a reservoir for allergens that no amount of surface cleaning in the home can address.

For families with infants, elderly members, or anyone with compromised immune systems, clean ductwork is especially important. These individuals are more vulnerable to airborne contaminants and may react to particulate levels that would not bother a healthy adult. Removing the accumulated burden from inside the ducts reduces the baseline particulate load in the home and gives the air filtration system a cleaner starting point to work from.

Duct cleaning does not replace air filtration, and it is not a cure for medical conditions. But it removes a significant source of accumulated contaminants that filters alone cannot address because the debris is already inside the system downstream of the filter. Combining clean ducts with proper filtration and regular filter changes creates the best possible indoor air environment.`,

  mold_concerns: `Mold in ductwork is a serious concern that requires specific attention because mold spores circulating through the air distribution system are delivered directly into every room of the home each time the HVAC system runs. Unlike surface mold on a bathroom wall that stays in one area, mold inside ductwork has a built-in delivery mechanism that spreads spores throughout the entire living space.

The most common indicator of mold in ducts is a persistent musty or earthy smell that occurs when the HVAC system is running. If the smell goes away when the system is off and returns when it cycles on, that strongly suggests a contamination source inside the duct system or air handler. Visible mold growth may appear around vent registers as dark spots or discoloration, or it may be visible inside the ducts when a vent cover is removed and the interior is inspected with a flashlight.

Mold develops in ductwork when moisture is present. Common causes include condensation from temperature differences between the duct surface and surrounding air, water intrusion from a roof leak or plumbing issue that reaches the ductwork, a clogged condensate drain that backs up into the air handler and plenum, or high indoor humidity levels that allow condensation to form inside the ducts. In humid climates, ductwork that runs through unconditioned spaces like attics or crawlspaces is particularly vulnerable because the temperature differential promotes condensation on the duct exterior, and any breach in the duct material allows moisture inside.

Addressing mold in ductwork involves more than standard duct cleaning. The cleaning removes existing mold growth and contaminated debris, but the moisture source that allowed mold to develop must also be identified and corrected. Without addressing the root cause, mold will return regardless of how thoroughly the ducts are cleaned.

The process for mold-contaminated ductwork includes HEPA-filtered negative air cleaning to contain spores during removal, antimicrobial treatment of affected surfaces after cleaning, and documentation of the moisture source and recommended remediation. In severe cases, sections of ductwork may need to be replaced if the material is too deteriorated for effective cleaning.

If a caller suspects mold, the first step is scheduling an inspection so the technician can assess the situation, identify the source, and recommend the appropriate scope of work.`,

  when_to_clean: `Knowing when duct cleaning is needed helps homeowners make informed decisions rather than cleaning on an arbitrary schedule or ignoring the system entirely. Several clear indicators signal that the ductwork has accumulated enough debris to warrant professional cleaning, and certain life events create conditions that make cleaning advisable regardless of the normal timeline.

The general recommendation for residential duct cleaning is every three to five years for a typical household. However, this is a baseline guideline that shifts based on specific conditions. Homes with pets, especially shedding breeds, accumulate dander and hair faster and may benefit from cleaning every two to three years. Homes with allergy or asthma sufferers benefit from more frequent cleaning to reduce the allergen load circulating through the system. Homes in areas with high outdoor dust, construction activity, or wildfire smoke exposure may need more frequent attention as well.

Visible signs that suggest duct cleaning is needed include dust buildup around vent registers that returns quickly after cleaning, visible debris or dust clouds when the system starts up, uneven airflow between rooms that is not explained by damper settings, and a musty or stale odor when the HVAC system runs. If removing a vent cover and looking inside reveals visible dust accumulation on the duct walls, that is a direct indicator that the entire system likely has similar buildup.

Specific events that trigger the need for duct cleaning regardless of the normal schedule include home renovation or remodeling, especially anything involving drywall, sanding, or demolition. Construction dust is extremely fine and penetrates deep into the duct system, and it circulates aggressively once the HVAC system runs. Purchasing a previously owned home is another trigger because there is no way to know the condition of the ductwork from the previous occupants. A pest issue involving rodents, insects, or birds in the ductwork leaves biological contamination that should be removed for both health and odor reasons.

If a caller is unsure whether their ducts need cleaning, describing their situation to the scheduling team allows for a recommendation based on the specific circumstances rather than a one-size-fits-all answer.`,

  duct_expectations: `Understanding what to expect from duct cleaning helps homeowners prepare for the service visit and set realistic expectations for the results. The process involves some disruption to the normal household routine but is designed to minimize impact on the home environment.

During the service, a technician or team needs access to every supply and return vent in the home. Vent covers are removed to allow cleaning equipment to reach inside the duct runs. Furniture or items blocking vent access should be moved before the appointment to avoid delays. The main trunk line access point is typically near the air handler, which may be in a utility closet, garage, attic, or basement. Clear access to this area is important for connecting the negative air machine.

The negative air machine generates a steady low-frequency hum during operation. It is not excessively loud inside the home but is noticeable. The rotary brush and compressed air tools used at each vent produce brief bursts of noise as the technician works through the system. Overall, the noise level is comparable to a vacuum cleaner and is intermittent rather than constant.

Dust containment is a priority throughout the process. The negative air pressure ensures that dislodged debris moves toward the collection system rather than into the living space. However, some minor dust disturbance near the vent openings being worked on is normal. The technician uses drop cloths or protective coverings around the work area as needed. At the end of the service, the work areas are cleaned up and vent covers are reinstalled.

After the cleaning, homeowners typically notice improved airflow from the vents, reduced dust accumulation on surfaces, and in many cases a fresher smell when the system runs. Homes with significant buildup often see the most dramatic improvement. The HVAC system may also run slightly more efficiently because improved airflow reduces the workload on the blower motor.

It is worth noting that duct cleaning addresses the ductwork itself. If the air filter is old, the evaporator coil is dirty, or the blower wheel has buildup, those components benefit from separate attention. Combining duct cleaning with a system tune-up or filter upgrade maximizes the air quality improvement.

Someone 18 or older needs to be present for the duration of the service to provide access and receive the technician's findings at the end.`,

  situational_duct: `Certain situations call for duct cleaning approaches that go beyond the standard residential service. Older homes, homes with duct damage, commercial properties, and situations where the caller is evaluating the quality and legitimacy of duct cleaning services all require specific knowledge and honest guidance.

Homes built more than 20 years ago often have original ductwork that has never been cleaned. Over two decades of use, the interior surfaces accumulate significant layers of dust, debris, and in some cases deteriorated duct liner material. Older duct systems may also have sections of ductwork that have separated at joints, developed holes from corrosion, or have insulation that has deteriorated and is shedding fibers into the airstream. A thorough inspection before or during cleaning identifies these issues so they can be addressed. In some cases, sections of aging ductwork benefit from repair or replacement rather than just cleaning, and the technician will advise honestly when that is the case.

Duct sealing and repair are closely related to duct cleaning because leaky ducts pull in contaminants from unconditioned spaces like attics, crawlspaces, and wall cavities. A duct system that loses conditioned air through leaks also pulls in dust, insulation fibers, and moisture from the surrounding environment, which accelerates contamination of the ductwork. Sealing and cleaning together address both the contamination and the source of ongoing contamination.

Commercial and office ductwork involves larger duct systems, different access requirements, and often more complex layouts than residential systems. The equipment and approach scale accordingly, and the scope of work is assessed individually based on the facility size, system type, and specific concerns.

Bundling duct cleaning with other services like an HVAC tune-up, dryer vent cleaning, or filter upgrade is common and often makes logistical and financial sense. Having the team already on-site with equipment reduces the overhead of a separate visit, and addressing the entire air system at once produces better results than addressing each component in isolation over time.

If the caller has questions about their specific situation, the best approach is to describe the circumstances and let the team recommend the appropriate scope of work.`,
};

// ═══════════════════════════════════════════════════════════════════════════
// groqMap — section index → groqCat key
// ═══════════════════════════════════════════════════════════════════════════

const groqMap = {
  0: 'duct_pricing',
  1: 'duct_service',
  2: 'duct_service',
  3: 'when_to_clean',
  4: 'duct_pricing',
  5: 'duct_expectations',
  6: 'air_quality_health',
  7: 'air_quality_health',
  8: 'mold_concerns',
  9: 'air_quality_health',
  10: 'air_quality_health',
  11: 'when_to_clean',
  12: 'when_to_clean',
  13: 'when_to_clean',
  14: 'when_to_clean',
  15: 'duct_service',
  16: 'duct_expectations',
  17: 'duct_expectations',
  18: 'duct_expectations',
  19: 'situational_duct',
  20: 'situational_duct',
  21: 'situational_duct',
  22: 'situational_duct',
  23: 'situational_duct',
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const sections = [

  // ════════════════════════════════════════════════════════════════════════
  // CORE QUESTIONS (0-5)
  // ════════════════════════════════════════════════════════════════════════

  { // 0
    label: 'How Much Is Duct Cleaning',
    content: 'Duct cleaning pricing depends on the size of your home and the number of vents. We can put together an accurate quote once we know the square footage and any specific concerns you have. Let me get your information and we can go from there.',
    callerPhrases: [
      'how much is duct cleaning',
      'what is the cost for duct cleaning',
      'how much do you charge for duct cleaning',
      'what is the price for cleaning my ducts',
      'how much does it cost to clean air ducts',
      'can you tell me the price for duct cleaning',
      'what do you charge to clean ductwork',
      'how much for a whole house duct cleaning',
      'i need a quote for duct cleaning',
      'what is the rate for duct cleaning service',
      'how much to get my ducts cleaned',
      'do you have pricing for duct cleaning',
      'can i get an estimate for duct cleaning',
      'what does duct cleaning run for a normal house',
      'how much is it to clean the air ducts in my home',
    ],
    negativeKeywords: [
      'dryer vent cleaning pricing',
      'ac repair estimate',
      'furnace replacement cost',
      'duct installation pricing',
      'air purifier cost',
      'mold remediation pricing',
    ],
  },

  { // 1
    label: 'What Is Included In Duct Cleaning',
    content: 'Our duct cleaning covers all the supply vents, return vents, main trunk lines, and the plenum at the air handler. We use a negative air pressure machine with HEPA filtration and rotary brush systems to dislodge and capture everything inside the ductwork.',
    callerPhrases: [
      'what is included in duct cleaning',
      'what does your duct cleaning service include',
      'what all do you clean during duct cleaning',
      'what does the duct cleaning cover',
      'can you tell me what is involved in duct cleaning',
      'what exactly do you do when you clean the ducts',
      'do you clean all the vents or just some',
      'what parts of the duct system do you clean',
      'does duct cleaning include the main trunk line',
      'do you clean supply and return ducts',
      'how thorough is your duct cleaning service',
      'what does a full duct cleaning involve',
      'do you clean the plenum and air handler area',
      'what equipment do you use for duct cleaning',
      'is the blower compartment included in duct cleaning',
    ],
    negativeKeywords: [
      'ac tune-up details',
      'furnace inspection scope',
      'air purifier features',
      'duct installation specs',
      'dryer vent cleaning details',
      'filter replacement details',
    ],
  },

  { // 2
    label: 'How Long Does Duct Cleaning Take',
    content: 'A standard duct cleaning usually takes about three to five hours depending on the size of your home and the number of vents. Larger homes or systems with heavier buildup can take a bit longer. We will give you a time estimate when we schedule.',
    callerPhrases: [
      'how long does duct cleaning take',
      'how many hours for duct cleaning',
      'how long will the duct cleaning take',
      'how much time does duct cleaning take',
      'how long should i plan for duct cleaning',
      'is duct cleaning an all day thing',
      'will duct cleaning take the whole day',
      'how long is a typical duct cleaning appointment',
      'how much time do i need to set aside for duct cleaning',
      'about how long for a whole house duct cleaning',
      'how long does it take to clean all the ducts',
      'is duct cleaning a quick service',
      'what is the duration of a duct cleaning service',
      'how many hours will the crew be here for duct cleaning',
      'how long does the duct cleaning process take start to finish',
    ],
    negativeKeywords: [
      'ac repair time',
      'furnace installation timeline',
      'tune-up duration',
      'dryer vent cleaning time',
      'air purifier installation time',
      'duct installation time',
    ],
  },

  { // 3
    label: 'How Often Should I Get Ducts Cleaned',
    content: 'For most homes, every three to five years is the general recommendation. If you have pets, allergies, or a lot of dust in the home, every two to three years is a better target. We can take a look and let you know what makes sense for your situation.',
    callerPhrases: [
      'how often should i get my ducts cleaned',
      'how frequently should ducts be cleaned',
      'how often do you recommend duct cleaning',
      'when should i get my ducts cleaned again',
      'how many years between duct cleanings',
      'do i need duct cleaning every year',
      'is duct cleaning something i need to do regularly',
      'how often should air ducts be cleaned',
      'what is the recommended frequency for duct cleaning',
      'should i clean my ducts every few years',
      'how often does ductwork need to be cleaned',
      'is duct cleaning a once a year thing',
      'how often should i schedule duct cleaning',
      'do ducts need to be cleaned on a regular schedule',
      'how many years can i go between duct cleanings',
    ],
    negativeKeywords: [
      'filter replacement frequency',
      'tune-up frequency',
      'refrigerant recharge schedule',
      'thermostat battery schedule',
      'dryer vent cleaning frequency',
      'coil cleaning frequency',
    ],
  },

  { // 4
    label: 'Scheduling Duct Cleaning',
    content: 'We can absolutely get that on the schedule for you. I just need your name, phone number, and address. We will get you a quote and find a time that works. Most appointments are booked within the next week or two depending on the season.',
    callerPhrases: [
      'i want to schedule duct cleaning',
      'can i book a duct cleaning appointment',
      'i need to schedule duct cleaning',
      'how do i schedule duct cleaning',
      'can you schedule my duct cleaning',
      'i would like to set up a duct cleaning',
      'i am ready to book duct cleaning',
      'when is the next available duct cleaning',
      'can i make an appointment for duct cleaning',
      'i want to get on the schedule for duct cleaning',
      'schedule me for duct cleaning please',
      'let me book a duct cleaning',
      'can we set up a duct cleaning appointment',
      'i need to get my ducts cleaned can you book that',
      'how soon can i get duct cleaning scheduled',
    ],
    negativeKeywords: [
      'schedule a repair',
      'schedule a tune-up',
      'emergency appointment',
      'thermostat installation appointment',
      'duct installation appointment',
      'dryer vent cleaning appointment',
    ],
  },

  { // 5
    label: 'Do I Need To Be Home For Duct Cleaning',
    content: 'Yes, someone 18 or older does need to be at the home during the duct cleaning. The technician needs access to every vent in the house plus the air handler area, and they will walk you through their findings when the work is complete.',
    callerPhrases: [
      'do i need to be home for duct cleaning',
      'does someone need to be there for duct cleaning',
      'can you do duct cleaning if i am not home',
      'do i have to be present during duct cleaning',
      'does the homeowner need to be there',
      'can i leave during duct cleaning',
      'do i need to take off work for duct cleaning',
      'is someone required to be home for the appointment',
      'can you clean the ducts while i am at work',
      'who needs to be home for duct cleaning',
      'do i need to stay for the whole duct cleaning',
      'can i just leave a key for the duct cleaning crew',
      'does an adult need to be present for duct cleaning',
      'how much access do you need inside the home',
      'do you need to get into every room for duct cleaning',
    ],
    negativeKeywords: [
      'repair access requirements',
      'tune-up access needs',
      'installation access',
      'key lockbox question',
      'office hours question',
      'commercial building access',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // AIR QUALITY & HEALTH (6-10)
  // ════════════════════════════════════════════════════════════════════════

  { // 6
    label: 'Duct Cleaning For Allergies',
    content: 'Duct cleaning can make a real difference for allergy sufferers. Dust, pollen, pet dander, and dust mite particles build up inside the ductwork and get recirculated every time the system runs. Removing that buildup reduces the allergen load in the air you are breathing at home.',
    callerPhrases: [
      'will duct cleaning help with my allergies',
      'i have allergies and want my ducts cleaned',
      'can duct cleaning reduce allergens in my home',
      'i need duct cleaning for allergy relief',
      'do dirty ducts make allergies worse',
      'will cleaning the ducts help with dust allergies',
      'my allergies are bad and i think it is the ducts',
      'can duct cleaning help with pollen in the house',
      'i have asthma and want to get the ducts cleaned',
      'will duct cleaning improve my indoor allergies',
      'does duct cleaning help with dust mites',
      'i am sneezing a lot and wonder if the ducts are dirty',
      'can dirty air ducts cause allergy symptoms',
      'will cleaning the ductwork reduce allergy flare-ups',
      'i need to get the allergens out of my duct system',
    ],
    negativeKeywords: [
      'air purifier recommendation',
      'allergy medication question',
      'mold testing service',
      'humidifier question',
      'outdoor allergy concern',
      'carpet cleaning referral',
    ],
  },

  { // 7
    label: 'Duct Cleaning For Dust Problem',
    content: 'If you are noticing a lot of dust in the home even after cleaning, the ductwork is often the hidden source. Dust settles inside the ducts over time and gets blown back into the rooms every cycle. A thorough duct cleaning removes that buildup at the source.',
    callerPhrases: [
      'i have a lot of dust in my house',
      'my house is always dusty even after i clean',
      'can duct cleaning reduce dust in my home',
      'will cleaning the ducts help with the dust problem',
      'i need duct cleaning because of excessive dust',
      'there is dust everywhere and i think it is the ducts',
      'do dirty ducts cause more dust in the house',
      'i keep dusting but it comes right back',
      'can you clean my ducts to reduce the dust',
      'dust comes out of the vents when the ac runs',
      'i see dust blowing from my vents',
      'my home gets dusty really fast is it the ductwork',
      'will duct cleaning fix my dust problem',
      'i need help with the dust situation in my house',
      'the dust in my home is out of control and i think the ducts are the problem',
    ],
    negativeKeywords: [
      'air purifier recommendation',
      'filter upgrade question',
      'carpet cleaning question',
      'construction dust outside',
      'dust on outdoor unit',
      'humidifier dust concern',
    ],
  },

  { // 8
    label: 'Mold In Ductwork',
    content: 'If you are seeing dark spots around the vents or smelling something musty when the system runs, that could be mold in the ductwork. We take that seriously. We use HEPA-filtered equipment and antimicrobial treatment, and we identify the moisture source so it does not come back.',
    callerPhrases: [
      'i think there is mold in my ducts',
      'i can see mold around my air vents',
      'my ducts smell musty like mold',
      'can you check for mold in the ductwork',
      'do you do mold remediation in duct systems',
      'there is black stuff around my vent registers',
      'i smell mold when the ac turns on',
      'how do you handle mold in ductwork',
      'can duct cleaning remove mold from the ducts',
      'i need my ducts cleaned because of mold',
      'there is a musty smell coming from the vents',
      'i found mold inside my air duct',
      'can you treat mold in the duct system',
      'the air smells moldy when the system runs',
      'i am worried about mold in my air ducts',
    ],
    negativeKeywords: [
      'bathroom mold removal',
      'mold on walls or ceiling',
      'mold inspection company referral',
      'humidifier mold question',
      'window condensation mold',
      'attic mold question',
    ],
  },

  { // 9
    label: 'Pet Owner Duct Cleaning',
    content: 'Pet hair and dander build up inside the ductwork over time and keep recirculating through the home even with regular filter changes. If you have dogs or cats, duct cleaning removes that accumulated buildup and makes a noticeable difference in air quality and how much pet hair settles on surfaces.',
    callerPhrases: [
      'i have pets and need my ducts cleaned',
      'will duct cleaning help with pet dander',
      'can duct cleaning remove pet hair from the ducts',
      'i have dogs and the ducts are probably full of hair',
      'do you recommend duct cleaning for pet owners',
      'my pets are making the air dusty should i clean the ducts',
      'i have cats and want to get the ducts cleaned',
      'will duct cleaning reduce pet odor in the home',
      'pet hair keeps coming out of the vents',
      'i need duct cleaning because of my animals',
      'can dirty ducts make pet allergies worse',
      'we have multiple pets and the ducts have never been cleaned',
      'does pet dander build up in the ductwork',
      'i think pet hair is clogging my duct system',
      'how often should pet owners get duct cleaning',
    ],
    negativeKeywords: [
      'pet grooming referral',
      'pet stain cleaning',
      'carpet cleaning for pets',
      'air purifier for pets',
      'pet odor in furniture',
      'veterinary referral',
    ],
  },

  { // 10
    label: 'New Baby Or Health Concerns',
    content: 'When you have a newborn or someone with health concerns at home, clean air matters even more. Duct cleaning removes accumulated dust, allergens, and particles from the system so the air quality is as clean as possible for the people who need it most.',
    callerPhrases: [
      'we have a new baby and want the ducts cleaned',
      'i want clean air for my newborn baby',
      'is duct cleaning important for a baby in the home',
      'i need the ducts cleaned for health reasons',
      'my family member has a health condition and i want clean air',
      'can duct cleaning help with respiratory issues',
      'i want to improve indoor air quality for my family',
      'we have an elderly parent living with us and want clean ducts',
      'i am pregnant and want the ducts cleaned before the baby comes',
      'is duct cleaning recommended when you have young children',
      'someone in my home has a compromised immune system',
      'can dirty ducts affect the health of a newborn',
      'i want to make sure the air is clean for my kids',
      'do you recommend duct cleaning for families with health concerns',
      'we need the best possible air quality at home',
    ],
    negativeKeywords: [
      'pediatric referral',
      'medical advice request',
      'air quality testing service',
      'humidifier recommendation',
      'air purifier medical grade',
      'health insurance question',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // WHEN TO GET IT DONE (11-14)
  // ════════════════════════════════════════════════════════════════════════

  { // 11
    label: 'Signs You Need Duct Cleaning',
    content: 'The most common signs are dust building up around the vents faster than normal, a musty smell when the system kicks on, allergy symptoms that flare up indoors, or visible debris inside a vent. If you are noticing any of those, it is probably time.',
    callerPhrases: [
      'how do i know if my ducts need cleaning',
      'what are the signs i need duct cleaning',
      'how can i tell if my ducts are dirty',
      'do my ducts need to be cleaned',
      'what are the indicators that ducts need cleaning',
      'when do you know it is time to clean your ducts',
      'is there a way to tell if the ducts are dirty',
      'how do i know if i need duct cleaning',
      'what should i look for to know if ducts need cleaning',
      'are there warning signs that ducts need cleaning',
      'my vents look dusty does that mean i need duct cleaning',
      'i am not sure if my ducts need cleaning how do i check',
      'what does it look like when ducts need to be cleaned',
      'should i get my ducts inspected to see if they need cleaning',
      'i noticed dust around my vents do i need duct cleaning',
    ],
    negativeKeywords: [
      'ac not working signs',
      'furnace failure signs',
      'filter replacement signs',
      'thermostat malfunction signs',
      'refrigerant leak signs',
      'duct damage signs',
    ],
  },

  { // 12
    label: 'Duct Cleaning After Renovation',
    content: 'Absolutely. After any remodel or renovation, the ductwork is full of construction dust, drywall particles, and debris that get circulated through the home every time the system runs. Getting the ducts cleaned after construction work is one of the most important times to do it.',
    callerPhrases: [
      'i need duct cleaning after a renovation',
      'we just remodeled and need the ducts cleaned',
      'can you clean the ducts after construction',
      'there is drywall dust in the ducts from our remodel',
      'do i need duct cleaning after a home renovation',
      'we had construction work done and the ducts are dusty',
      'should i get the ducts cleaned after remodeling',
      'there is construction dust in the ductwork',
      'we just finished renovating and want the air ducts cleaned',
      'is duct cleaning recommended after home improvement work',
      'the house is dusty from construction and i think it is in the ducts',
      'do you do post-construction duct cleaning',
      'we had our kitchen remodeled and need the ducts cleaned now',
      'drywall dust is everywhere after our renovation including the vents',
      'i need to get the construction debris out of my ducts',
    ],
    negativeKeywords: [
      'construction company referral',
      'drywall repair question',
      'home renovation estimate',
      'duct installation after remodel',
      'new construction ductwork',
      'painting question',
    ],
  },

  { // 13
    label: 'Duct Cleaning For New Home Purchase',
    content: 'Getting the ducts cleaned when you move into a previously owned home is a smart move. You do not know what the last owners left behind in the ductwork. Starting fresh with clean ducts gives you a known baseline for air quality.',
    callerPhrases: [
      'i just bought a house and want the ducts cleaned',
      'should i get duct cleaning for my new home',
      'we are moving into a new house and want the ducts done',
      'is duct cleaning recommended when you buy a house',
      'i want to clean the ducts in my new home before we move in',
      'do you recommend duct cleaning for a new home purchase',
      'the previous owners had pets and i want the ducts cleaned',
      'we just closed on a house and want fresh air in the ducts',
      'should i clean the ducts after buying a used home',
      'i am a new homeowner and want the ductwork cleaned',
      'we do not know when the ducts were last cleaned in our new house',
      'can you clean the ducts before we move our stuff in',
      'i want to start fresh with clean ducts in our new home',
      'the home we bought smells a little and i think it is the ducts',
      'is it normal to get duct cleaning when you buy a home',
    ],
    negativeKeywords: [
      'home inspection referral',
      'real estate question',
      'new construction ductwork',
      'home warranty question',
      'moving company referral',
      'duct installation for new build',
    ],
  },

  { // 14
    label: 'Duct Cleaning After Pest Issue',
    content: 'If you have had rodents, insects, or any pests in the ductwork, getting those ducts cleaned is critical. They leave behind droppings, nesting material, and debris that can carry bacteria and odors. We clean and sanitize the system to get it back to a safe, clean condition.',
    callerPhrases: [
      'i had mice in my ducts and need them cleaned',
      'rodents were in the ductwork and i need it cleaned',
      'can you clean ducts after a pest problem',
      'there were rats in my air ducts',
      'i need duct cleaning after an exterminator treated my home',
      'insects were nesting in my ductwork',
      'i found rodent droppings in my air vents',
      'we had a pest issue and need the ducts sanitized',
      'can you remove animal debris from the duct system',
      'there is a bad smell in the ducts from a dead animal',
      'birds got into my ductwork and left debris',
      'i need the ducts cleaned after a mouse infestation',
      'do you handle duct cleaning after pest removal',
      'the exterminator said i should get my ducts cleaned',
      'rodent contamination in the duct system needs to be cleaned out',
    ],
    negativeKeywords: [
      'pest control referral',
      'exterminator recommendation',
      'dead animal removal service',
      'crawlspace pest question',
      'attic pest problem',
      'termite inspection',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // PROCESS & WHAT TO EXPECT (15-18)
  // ════════════════════════════════════════════════════════════════════════

  { // 15
    label: 'Duct Cleaning Process Explained',
    content: 'The technician connects a negative air machine to the main trunk line to create powerful suction through the entire system. Then they work through every vent with rotary brushes and compressed air to dislodge buildup. Everything gets pulled into HEPA-filtered collection so nothing enters your home.',
    callerPhrases: [
      'how does duct cleaning work',
      'what is the duct cleaning process',
      'can you explain how you clean the ducts',
      'what method do you use for duct cleaning',
      'how do you actually clean inside the ductwork',
      'what equipment do you use to clean ducts',
      'do you use a vacuum or brushes for duct cleaning',
      'what is the step by step process for duct cleaning',
      'how does the negative air pressure method work',
      'can you walk me through the duct cleaning process',
      'what does the duct cleaning technician actually do',
      'do you use rotary brushes for duct cleaning',
      'how do you get the debris out of the ducts',
      'what kind of machine do you use to clean ducts',
      'i want to understand the duct cleaning process before i book',
    ],
    negativeKeywords: [
      'ac repair process',
      'furnace installation process',
      'tune-up process details',
      'duct installation method',
      'air purifier installation',
      'dryer vent cleaning method',
    ],
  },

  { // 16
    label: 'Will Duct Cleaning Be Messy',
    content: 'The process is designed to contain everything. The negative air machine pulls debris toward the collection system, not into the home. There may be minor dust near the vent being worked on, but the technician uses protective coverings and cleans up the work area when finished.',
    callerPhrases: [
      'will duct cleaning make a mess in my house',
      'is duct cleaning a messy process',
      'does duct cleaning create a lot of dust in the home',
      'will dust go everywhere during duct cleaning',
      'how messy is duct cleaning',
      'should i cover my furniture before duct cleaning',
      'will the duct cleaning stir up dust in the house',
      'is duct cleaning going to be noisy and messy',
      'do i need to worry about dust getting on my stuff',
      'how do you keep the dust contained during cleaning',
      'will duct cleaning be disruptive to my household',
      'is there a lot of cleanup after duct cleaning',
      'does duct cleaning make the air dustier temporarily',
      'should i put things away before duct cleaning',
      'will the duct cleaning process damage anything in my home',
    ],
    negativeKeywords: [
      'repair mess concerns',
      'installation dust concerns',
      'construction cleanup',
      'carpet cleaning after service',
      'water damage from service',
      'paint or wall damage',
    ],
  },

  { // 17
    label: 'Before And After Duct Cleaning',
    content: 'Most homeowners notice better airflow from the vents, less dust settling on surfaces, and fresher air when the system runs. If there was a musty smell, that usually goes away. The biggest improvement is in homes where the ducts have never been cleaned or have heavy buildup.',
    callerPhrases: [
      'what difference will i notice after duct cleaning',
      'what are the results of duct cleaning',
      'will i see a difference after duct cleaning',
      'what should i expect after getting my ducts cleaned',
      'does duct cleaning actually make a difference',
      'is duct cleaning worth it what will i notice',
      'what changes after you clean the ducts',
      'will my home be less dusty after duct cleaning',
      'how much improvement will i see after duct cleaning',
      'does duct cleaning really work',
      'what does it look like before and after duct cleaning',
      'will the air quality actually improve after cleaning',
      'how much dust will come out of my ducts',
      'will my allergies improve after duct cleaning',
      'what kind of results do people usually see from duct cleaning',
    ],
    negativeKeywords: [
      'repair results guarantee',
      'replacement improvement',
      'air purifier effectiveness',
      'filter upgrade results',
      'tune-up improvement',
      'insulation improvement results',
    ],
  },

  { // 18
    label: 'Duct Cleaning Vs Air Purifier',
    content: 'They actually work best together. Duct cleaning removes the buildup that is already inside the system, while an air purifier catches particles as they circulate going forward. Cleaning the ducts first gives the purifier a much cleaner starting point to work from.',
    callerPhrases: [
      'should i get duct cleaning or an air purifier',
      'is duct cleaning or an air purifier better',
      'do i need duct cleaning if i have an air purifier',
      'will an air purifier do the same thing as duct cleaning',
      'what is the difference between duct cleaning and air filtration',
      'should i buy an air purifier instead of cleaning the ducts',
      'can an air purifier replace duct cleaning',
      'is it better to clean the ducts or add filtration',
      'do i need both duct cleaning and an air purifier',
      'will a better filter eliminate the need for duct cleaning',
      'is duct cleaning necessary if i use a hepa air purifier',
      'what helps more with air quality ducts cleaning or a purifier',
      'can i skip duct cleaning if i have good filters',
      'would upgrading my air filter be enough or do i need duct cleaning',
      'should i clean the ducts first and then get an air purifier',
    ],
    negativeKeywords: [
      'air purifier purchase recommendation',
      'filter brand recommendation',
      'humidifier vs purifier',
      'uv light system question',
      'ionizer safety question',
      'whole home filtration install',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SITUATION-SPECIFIC (19-23)
  // ════════════════════════════════════════════════════════════════════════

  { // 19
    label: 'Duct Cleaning For Older Home',
    content: 'In older homes, the ductwork has had decades to accumulate dust, debris, and sometimes deteriorating duct liner material. We inspect the duct condition as part of the cleaning and let you know if any sections need repair or replacement alongside the cleaning.',
    callerPhrases: [
      'my home is old and the ducts have never been cleaned',
      'i have an older home and need duct cleaning',
      'the ducts in my house are over 20 years old',
      'should i get duct cleaning on an older home',
      'do old ducts need to be cleaned differently',
      'i have original ductwork from when the house was built',
      'my home is 30 years old and i want the ducts cleaned',
      'can you clean ducts in an older home safely',
      'are old ducts more likely to need cleaning',
      'the ductwork in my house is really old should i get it cleaned',
      'i am worried about the condition of my old ductwork',
      'do older ducts collect more dust over time',
      'is duct cleaning safe on aging ductwork',
      'my house has old flex duct that probably needs cleaning',
      'can you inspect old ductwork during the cleaning',
    ],
    negativeKeywords: [
      'duct replacement estimate',
      'new ductwork installation',
      'home renovation question',
      'duct insulation replacement',
      'historical home restoration',
      'asbestos duct question',
    ],
  },

  { // 20
    label: 'Duct Cleaning With Duct Repair Or Sealing',
    content: 'If your ducts have leaks or disconnected sections, cleaning and sealing them together makes the most sense. Leaky ducts pull in dust and contaminants from attics and crawlspaces, so sealing the leaks stops the contamination at the source while cleaning removes what has already built up.',
    callerPhrases: [
      'do you also seal ducts when you clean them',
      'my ducts are leaking can you clean and repair them',
      'can you do duct sealing along with duct cleaning',
      'i think my ducts have holes can you fix them during cleaning',
      'should i seal my ducts and clean them at the same time',
      'do leaky ducts need to be cleaned',
      'can you repair damaged ductwork during a cleaning visit',
      'my ducts are disconnected in the attic and need cleaning',
      'i need duct repair and duct cleaning together',
      'is it worth sealing the ducts if i am getting them cleaned',
      'can you check for leaks when you clean the ducts',
      'my energy bills are high and i think the ducts are leaking',
      'do you offer duct sealing as part of the duct cleaning service',
      'i want the ducts cleaned and any gaps sealed up',
      'should i fix duct leaks before or after cleaning',
    ],
    negativeKeywords: [
      'new ductwork installation',
      'duct replacement estimate',
      'ductless system question',
      'plumbing leak repair',
      'insulation installation',
      'window sealing question',
    ],
  },

  { // 21
    label: 'Commercial Duct Cleaning',
    content: 'We do handle commercial duct cleaning for offices and business spaces. Commercial systems are typically larger with different access requirements, so we assess each property individually. Let us know the type of building and approximate size and we can put together a scope of work for you.',
    callerPhrases: [
      'do you do commercial duct cleaning',
      'can you clean the ducts in my office building',
      'i need duct cleaning for my business',
      'do you handle commercial ductwork cleaning',
      'we need duct cleaning for our office space',
      'can you clean ductwork in a commercial property',
      'how much is duct cleaning for a commercial building',
      'do you service commercial hvac duct systems',
      'i need duct cleaning for a retail space',
      'can you do duct cleaning for a restaurant',
      'we have a warehouse that needs duct cleaning',
      'our office building needs the ducts cleaned',
      'do you offer duct cleaning for businesses',
      'i need commercial air duct cleaning for my facility',
      'how do you handle duct cleaning for larger commercial spaces',
    ],
    negativeKeywords: [
      'residential only question',
      'commercial hvac installation',
      'commercial ac repair',
      'office cleaning service referral',
      'janitorial service question',
      'commercial kitchen hood cleaning',
    ],
  },

  { // 22
    label: 'Duct Cleaning Scam Awareness',
    content: 'Great question. A legitimate duct cleaning takes specialized equipment and several hours to do properly. If someone is offering your whole house for an extremely low price, there is usually a catch. A real service involves negative air machines, HEPA filtration, and access to every vent.',
    callerPhrases: [
      'i saw a really cheap duct cleaning deal is it legit',
      'are those 99 dollar duct cleaning offers a scam',
      'how do i know if a duct cleaning company is legitimate',
      'what should i look for in a duct cleaning company',
      'someone offered duct cleaning for a really low price',
      'is cheap duct cleaning too good to be true',
      'what is the difference between cheap and real duct cleaning',
      'i got a coupon for duct cleaning is it a scam',
      'how can i tell if a duct cleaning offer is a bait and switch',
      'why is your duct cleaning more expensive than the ads i see',
      'someone knocked on my door offering cheap duct cleaning',
      'are those duct cleaning mailers with low prices legit',
      'what makes a duct cleaning company reputable vs a scam',
      'i do not want to get ripped off on duct cleaning',
      'how do i avoid duct cleaning scams',
    ],
    negativeKeywords: [
      'report a scam',
      'bbb complaint filing',
      'legal action question',
      'competitor pricing comparison',
      'refund from another company',
      'attorney referral',
    ],
  },

  { // 23
    label: 'Duct Cleaning Combined With Other Services',
    content: 'Bundling duct cleaning with a tune-up, dryer vent cleaning, or filter upgrade is a smart way to address the whole system at once. Having the crew already on-site saves you a separate visit, and tackling everything together gives you the best overall result for air quality and system performance.',
    callerPhrases: [
      'can i get duct cleaning and a tune-up together',
      'do you offer duct cleaning with other services',
      'can you clean my ducts and my dryer vent at the same time',
      'i want duct cleaning plus a maintenance tune-up',
      'do you bundle duct cleaning with other hvac services',
      'can i add duct cleaning to my tune-up appointment',
      'is there a discount if i do duct cleaning with a tune-up',
      'i want to get the ducts cleaned and replace my filter too',
      'can you do duct cleaning and dryer vent in one visit',
      'do you offer a package deal with duct cleaning',
      'i need duct cleaning and also want the ac checked',
      'can we combine duct cleaning with a system inspection',
      'should i get duct cleaning and a tune-up at the same time',
      'i want to do everything at once ducts dryer vent and tune-up',
      'what other services can i add to a duct cleaning appointment',
    ],
    negativeKeywords: [
      'duct installation with ac replacement',
      'new system package pricing',
      'renovation services bundle',
      'plumbing and hvac combo',
      'electrical and hvac combo',
      'carpet cleaning bundle',
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// BUILD & VALIDATE JSON
// ═══════════════════════════════════════════════════════════════════════════

const output = {
  kcTitle: 'Duct Cleaning',
  kcId: null,
  exportedAt: new Date().toISOString(),
  sectionCount: sections.length,
  sections: sections.map((s, i) => ({
    index: i,
    label: s.label,
    content: s.content,
    groqContent: groqCat[groqMap[i]] || null,
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
  if (wc < 25 || wc > 50) {
    console.warn(`⚠ Section ${s.index} "${s.label}" content: ${wc} words (target 35-42)`);
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
  if (s.callerPhrases.length < 5) {
    console.error(`✗ Section ${s.index} "${s.label}" only ${s.callerPhrases.length} phrases (min 5)`);
    errors++;
  }
  if (s.negativeKeywords.length < 4) {
    console.warn(`⚠ Section ${s.index} "${s.label}" only ${s.negativeKeywords.length} negativeKeywords (target 6)`);
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
const outPath = path.join(__dirname, 'kc-duct-cleaning.json');
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
console.log('  1. Create empty "Duct Cleaning" container in services.html');
console.log('  2. Import kc-duct-cleaning.json into the container');
console.log('  3. Re-score All → Fix All → Generate Missing Audio');
