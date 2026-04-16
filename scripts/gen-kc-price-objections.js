#!/usr/bin/env node
/**
 * gen-kc-price-objections.js
 * Generates kc-price-objections.json — handles caller pushback on pricing.
 *
 * PURPOSE:
 *   When a caller reacts to a quoted price with "that's too expensive", "can
 *   you give me a discount", or "other companies charge less" — that is NOT
 *   a new HVAC question. It's a pricing friction moment. The agent needs to
 *   acknowledge the concern, reframe the value, and redirect WITHOUT arguing
 *   about price or making up discounts.
 *
 * KEY DISTINCTION:
 *   Existing KCs handle "how much is X?" (informational).
 *   This KC handles "that's too much!" (emotional/objection).
 *
 * ROUTING SAFETY:
 *   - noAnchor=true — pricing pushback should NOT steal anchor from the
 *     service container that just quoted the price
 *   - HVAC negativeKeywords prevent matching on service-specific questions
 *   - tradeTerms empty — CueExtractor GATE 2.4 never fires
 *   - contentKeywords are pricing/value terms only
 *
 * WORKFLOW:
 *   1. Create empty container titled "Price Objections" in services.html
 *   2. Run: node scripts/gen-kc-price-objections.js
 *   3. Import kc-price-objections.json into the container
 *   4. Enable "No anchor (meta-container)" toggle
 *   5. Re-score All → Fix All → Generate Missing Audio
 *
 * 15 sections covering:
 *   - Core price pushback (0-4)
 *   - Competitor & value comparison (5-8)
 *   - Budget & affordability (9-11)
 *   - Trust & transparency (12-14)
 */
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// HVAC NEGATIVE KEYWORDS — same set as Recovery KC
// ═══════════════════════════════════════════════════════════════════════════

const HVAC_NEG_KEYWORDS = [
  'air conditioning', 'air conditioner', 'ac unit', 'heating', 'furnace',
  'thermostat', 'duct cleaning', 'duct work', 'compressor', 'refrigerant',
  'coolant', 'coil', 'condenser', 'evaporator', 'tune-up',
  'diagnostic fee', 'installation', 'replacement', 'hvac', 'blower',
  'filter', 'freon', 'capacitor', 'heat pump', 'dryer vent',
  'not cooling', 'not heating', 'no cool', 'no heat', 'frozen line',
  'ice on', 'leaking water', 'strange noise', 'burning smell',
  'maintenance plan', 'membership',
];

// ═══════════════════════════════════════════════════════════════════════════
// GROQ CONTENT CATEGORIES — pricing objection guidance for Groq (~400+ chars)
// ═══════════════════════════════════════════════════════════════════════════

const groqCat = {

  too_expensive: `The caller thinks the quoted price is too high. This is an emotional reaction, not a request for a different price. The agent must NOT argue about the price, apologize for it, or offer a discount that does not exist.

RESPONSE APPROACH: Acknowledge the concern genuinely. Then reframe the value of what is included. The goal is to help the caller understand what they are getting, not to convince them the price is low. If the service includes a thorough inspection, licensed technician, warranty on work, or same-day availability, mention those as part of the value. Let the caller decide — do not pressure.

TONE RULES: Empathetic but confident. The agent should not sound defensive about the price or apologetic. The price is the price. What the agent CAN do is make sure the caller understands the full scope of what is included. Confidence in the value is more persuasive than discounting.

REDIRECT STRATEGY: After reframing value, ask if they would like to go ahead and schedule. Give them the choice without pressure. If they still object, respect it and offer to keep their information on file. Never beg or repeatedly push.

WHAT TO AVOID: Never make up discounts. Never say "I can see what I can do about the price" unless there is an actual mechanism for that. Never badmouth competitors. Never apologize for the price. Never sound desperate to close. Never minimize their concern.

RECOVERY FORMULA: Acknowledge ("I understand, pricing is definitely a factor") → Reframe value ("What is included is...") → Offer choice ("Would you like to go ahead and get that scheduled?") → Respect their decision.`,

  competitor_comparison: `The caller is comparing the company's price to a competitor or claiming they can get it cheaper elsewhere. This is a negotiation tactic or genuine comparison shopping.

RESPONSE APPROACH: Do not badmouth the competitor. Do not match their price. Instead, focus on what differentiates the service — licensed and insured technicians, warranty on work, response time, thoroughness of service, company reputation. Let the value proposition speak for itself. The caller is looking for a reason to choose, not a price war.

TONE RULES: Professional and unhurried. This caller is making a decision and giving the company a chance to make their case. Treat it as an opportunity, not an attack. Confidence without arrogance. Facts without desperation.

REDIRECT STRATEGY: After differentiating, ask a forward-looking question. "Would you like to go ahead and get this scheduled?" or "Would you like to see what availability we have?" This assumes the sale without pressuring. If they want to shop more, let them go gracefully.

WHAT TO AVOID: Never say "you get what you pay for" — it sounds condescending. Never ask who the competitor is. Never disparage other companies. Never match or beat a competitor price unless there is an actual price-match policy. Never sound threatened by comparison shopping.

RECOVERY FORMULA: Acknowledge ("That makes sense, it is smart to compare") → Differentiate ("What we include is...") → Offer next step → Respect their choice.`,

  discount_request: `The caller is directly asking for a discount, coupon, deal, or special pricing. They want to pay less.

RESPONSE APPROACH: If there is a legitimate promotion, maintenance plan discount, or first-time customer offer, mention it. If there is no discount available, be honest and brief about it, then reframe the value. Do not invent discounts or promise to "check with a manager" if that is not a real process. Honesty builds more trust than a fake negotiation.

TONE RULES: Helpful and straightforward. The caller asked a fair question — answer it directly. If there is a deal, share it enthusiastically. If there is not, say so without being apologetic or dismissive. "We do not have a discount running right now, but what is included in that price is..." is clean and honest.

REDIRECT STRATEGY: If a discount exists (maintenance plan, seasonal offer), present it as a natural option. If no discount exists, pivot to value and schedule. The caller is ready to buy — they just want to feel smart about it.

WHAT TO AVOID: Never make up coupons. Never promise to "see what I can do" and then come back with nothing. Never make the caller feel cheap for asking. Never offer unauthorized discounts. Never say "that is the best price" in a way that sounds like you are shutting them down.

RECOVERY FORMULA: Answer honestly → If promotion exists, share it → If not, reframe value → Move to scheduling.`,

  sticker_shock: `The caller was not expecting the price to be what it is. This is surprise more than objection — they may still proceed, they just need a moment to process.

RESPONSE APPROACH: Normalize the reaction. "I know it can feel like a lot when you are not expecting it." Then break down what is included so the price makes sense. When people understand the components, the total feels more reasonable. Do not rush them — give them space to decide.

TONE RULES: Patient and understanding. This caller is not saying no — they are saying "wow." The agent's job is to help the price make sense, not to defend it. A calm breakdown of what is included usually resolves sticker shock without any negotiation.

REDIRECT STRATEGY: After the breakdown, check in with them. "Does that help clarify what is included?" Then offer to schedule. Most sticker shock callers proceed once they understand the value.

WHAT TO AVOID: Never say "it is actually a good price" — that invalidates their surprise. Never rush them past their reaction. Never add pressure. Never compare to what it could cost if they wait (scare tactics). Just explain and let them decide.

RECOVERY FORMULA: Normalize ("I understand, let me break down what that covers") → Explain components → Check in ("Does that make sense?") → Offer to schedule.`,

  value_questioning: `The caller wants to know exactly what they are paying for. They may ask "what am I getting for that price" or "what does that include." This is a buying signal disguised as an objection — they want justification to say yes.

RESPONSE APPROACH: This is a great question — treat it as one. Walk through what is included clearly and specifically. The more concrete the breakdown, the more comfortable the caller feels. Licensed technician, full inspection checklist, warranty on work, parts included, cleanup, etc. Make the value tangible.

TONE RULES: Enthusiastic and detailed. This caller wants to feel smart about spending money. Help them feel that way by being specific about what they get. Do not be vague — vague answers fuel suspicion. Concrete answers build confidence.

REDIRECT STRATEGY: After the breakdown, the natural next step is scheduling. "So with all of that included, would you like to go ahead and get that on the schedule?" The value case has been made — now offer the action.

WHAT TO AVOID: Never be vague about what is included. Never say "it is just the standard service" — that sounds dismissive. Never skip this question — it is a buying signal. Never make the caller feel like asking is unusual or annoying.

RECOVERY FORMULA: Welcome the question → Detailed breakdown → Confirm understanding → Offer to schedule.`,

  negotiation: `The caller is trying to negotiate — "what is the best you can do" or "can you come down on that." This is a direct negotiation attempt.

RESPONSE APPROACH: Be honest about whether the price is negotiable. If there is a maintenance plan that offers discounts, mention it as a legitimate way to save. If the price is firm, say so clearly and without apology. "That is our standard rate and it covers everything I just described." Firm and fair is more respected than fake flexibility.

TONE RULES: Confident and fair. Negotiation is normal — do not treat it as offensive. But also do not fold. If the price is the price, own it with confidence. The caller respects certainty more than wobbling.

REDIRECT STRATEGY: If the price is firm, pivot to the value one more time, then offer to schedule. If there is a maintenance plan or seasonal offer, present it as the way to get better pricing. Give them a path forward that feels like a win.

WHAT TO AVOID: Never negotiate a price you are not authorized to negotiate. Never say "let me check with my manager" unless that is a real thing. Never create false urgency ("this price is only good today"). Never sound offended by negotiation.

RECOVERY FORMULA: Acknowledge the ask → Be honest about flexibility → If a plan/offer exists, present it → Restate value → Offer to schedule.`,

  budget_concern: `The caller genuinely cannot afford the service right now. This is not a negotiation tactic — they are telling you about a real financial constraint. Treat it with dignity.

RESPONSE APPROACH: Show genuine empathy without pity. If financing or payment plans exist, offer them as an option. If a maintenance plan reduces costs, mention it. If there is truly no flexibility, be honest and offer to keep their information on file for when they are ready. Never pressure someone who has told you they cannot afford it.

TONE RULES: Compassionate and respectful. Financial stress is real and personal. The caller may feel embarrassed for saying they cannot afford it. Make them feel comfortable. No judgment, no pressure, no guilt.

REDIRECT STRATEGY: Offer any available payment options first. If none exist, offer to prioritize what is most urgent (if applicable). If they truly need to wait, let them know they can call back anytime and you will take care of them. Leave the door open warmly.

WHAT TO AVOID: Never pressure someone who says they cannot afford it. Never say "it will cost more if you wait" as a scare tactic. Never make them feel judged. Never rush past their concern. Never assume they are negotiating — take them at their word.

RECOVERY FORMULA: Empathize → Offer payment options if available → If not, offer alternatives → Leave door open warmly.`,

  financing_question: `The caller wants to know about payment plans, financing options, or ways to spread out the cost. They are interested in the service but need financial flexibility.

RESPONSE APPROACH: If financing exists, explain it clearly and simply — monthly payments, interest terms, approval process. If no formal financing exists, be honest. Some companies offer check/credit card options or can break a project into phases. Share whatever flexibility exists.

TONE RULES: Helpful and informative. This caller is trying to find a way to say yes. Help them. Do not make financing sound complicated or exclusive. Present it as a normal, common option that many customers use.

REDIRECT STRATEGY: After explaining options, ask if they would like to explore that route. "Would you like me to get that started?" or "Would you like to see what options are available?" Keep momentum toward scheduling.

WHAT TO AVOID: Never make financing sound like charity. Never judge them for needing it. Never over-complicate the explanation. Never promise terms you are not sure about. Keep it simple and honest.

RECOVERY FORMULA: Explain options clearly → Normalize it ("Many of our customers use this") → Offer to proceed → Schedule.`,

  diy_alternative: `The caller is considering doing it themselves instead of paying for professional service. They may be handy or may be underestimating the complexity.

RESPONSE APPROACH: Respect their capability without discouraging DIY on safe tasks. For tasks that require licensing, specialized tools, or involve safety risks (electrical, refrigerant, gas), mention those considerations factually. Frame the professional service as peace of mind and warranty protection, not as the caller being incapable.

TONE RULES: Respectful and factual. Never talk down to a DIY-minded caller. They are competent people making a cost-benefit decision. Provide facts about what professional service includes (warranty, licensing, proper tools, safety) and let them decide.

REDIRECT STRATEGY: If the task is genuinely simple (replacing a filter, cleaning around the condenser), acknowledge that and offer professional help for anything beyond that. If the task requires a pro, frame it as safety and warranty — not as the caller being unable.

WHAT TO AVOID: Never mock DIY. Never say "you could make it worse." Never be condescending. Never discourage them from doing safe tasks themselves. Focus on what professional service adds, not what DIY lacks.

RECOVERY FORMULA: Respect their approach → Share what professional service includes (safety, warranty, tools) → Offer to help if they decide they want a pro → Leave door open.`,

  second_opinion: `The caller wants to get another quote before committing. They may have already received a quote or diagnosis and want to verify it.

RESPONSE APPROACH: Encourage it. A second opinion is smart and shows the caller is being responsible. Offer to schedule an evaluation. If they already have a diagnosis, offer to have a technician verify it. This positions the company as transparent and confident in their work. The company that encourages a second opinion is the one the caller trusts.

TONE RULES: Supportive and confident. Never sound threatened by the caller wanting a second opinion. Confidence means welcoming scrutiny. "That is a smart move, we are happy to take a look" is more persuasive than any sales pitch.

REDIRECT STRATEGY: Offer to schedule the evaluation. "Would you like us to send someone out to take a look? We can give you our assessment and you can compare." This moves the caller toward action while respecting their process.

WHAT TO AVOID: Never discourage second opinions. Never say "our price is the best." Never sound insecure about competition. Never pressure them to decide now. Never badmouth whoever gave them the first opinion.

RECOVERY FORMULA: Encourage ("That is a smart approach") → Offer evaluation → Frame as transparent → Schedule.`,

  hidden_fees: `The caller is concerned about additional charges beyond the quoted price. They want to know if there are hidden costs, add-ons, or surprise bills.

RESPONSE APPROACH: Be completely transparent. Walk through exactly what the quoted price covers and what it does not. If there could be additional costs (parts, repairs found during diagnostic), explain that clearly and explain how the caller will be informed before any additional work happens. Transparency kills fear.

TONE RULES: Open and direct. This caller has probably been burned before by hidden fees. The best thing you can do is be the opposite of that experience. Clear, upfront, no surprises. If there is a chance of additional costs, explain the process for how those are communicated and approved.

REDIRECT STRATEGY: After explaining the pricing transparency, ask if they feel comfortable proceeding. "So there are no surprises — you will know exactly what everything costs before any work is done. Would you like to get that scheduled?"

WHAT TO AVOID: Never be vague about potential additional costs. Never say "it depends" without explaining what it depends on. Never hide the fact that parts or additional repairs might cost extra. Full transparency, always.

RECOVERY FORMULA: Acknowledge concern → Explain exactly what is included → Explain process for any additional costs → Reassure no surprises → Schedule.`,

  upfront_pricing: `The caller wants a firm price before anyone comes out. They do not want to pay for a diagnostic just to find out what the repair costs.

RESPONSE APPROACH: Be honest about what can and cannot be priced upfront. Some services have flat rates (tune-up, diagnostic, duct cleaning). Repairs often require on-site evaluation because the root cause determines the fix. Explain this honestly. The diagnostic fee is the investment that gives them a clear picture and a firm repair quote before any work begins.

TONE RULES: Honest and understanding. The caller has a fair concern — they do not want an open-ended commitment. Explain the process so they understand their exposure is limited to the diagnostic fee, and after that they get a firm quote they can accept or decline.

REDIRECT STRATEGY: Frame the diagnostic as their protection. "The diagnostic gives you a clear answer and a firm quote. If you decide to move forward with the repair, you know exactly what it costs. If you decide not to, the diagnostic fee is all you pay." This makes the process feel safe.

WHAT TO AVOID: Never promise a repair price without seeing the system. Never say "I can give you a rough estimate" without heavy caveats. Never make the caller feel trapped by the diagnostic fee. Frame it as their tool for making an informed decision.

RECOVERY FORMULA: Acknowledge the desire for certainty → Explain what has flat pricing → Explain diagnostic as the path to a firm quote → Reassure they control the decision → Schedule.`,

  fair_price_trust: `The caller is questioning whether the price is fair or whether they are being overcharged. This is a trust issue, not a price issue.

RESPONSE APPROACH: Build trust through transparency and credentials. Mention licensing, insurance, warranty on work, years in business, reviews, or any other credibility markers. The caller does not need a lower price — they need confidence that the price is fair. Offer to explain what goes into the pricing if that helps.

TONE RULES: Steady and transparent. Do not get defensive. A fair-price question is a trust test — pass it with openness. "That is a fair question, let me walk you through what goes into that" is the right energy. Calm, detailed, honest.

REDIRECT STRATEGY: After building confidence, offer to schedule. The caller who asks "is this fair" is close to buying — they just need the final piece of trust. Provide it and then offer action.

WHAT TO AVOID: Never say "our prices are the lowest." Never get defensive. Never take it personally. Never dismiss the concern. Never say "that is just what it costs" without explanation.

RECOVERY FORMULA: Welcome the question → Explain what drives the price (licensing, parts, warranty, expertise) → Offer transparency → Schedule.`,
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTIONS — 15 sections
// ═══════════════════════════════════════════════════════════════════════════

const sections = [

  // ════════════════════════════════════════════════════════════════════════
  // CORE PRICE PUSHBACK (0-4)
  // ════════════════════════════════════════════════════════════════════════

  { // 0
    label: 'Too Expensive Reaction',
    content: 'I completely understand, pricing is definitely a factor. What is included in that price covers a thorough job by a licensed technician with warranty on the work. Would you like me to walk you through everything that is covered?',
    groqKey: 'too_expensive',
    callerPhrases: [
      'that is too expensive',
      'that is too much',
      'that is way too high',
      'I was not expecting it to cost that much',
      'that seems really expensive',
      'that is more than I thought',
      'I cannot pay that much',
      'that price is too steep',
      'that is a lot of money',
      'wow that is expensive',
      'I think that is overpriced',
      'that is higher than I expected',
      'you want how much',
      'are you serious with that price',
      'that is out of my price range',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 1
    label: 'Sticker Shock Response',
    content: 'I understand that can catch you off guard. Let me break down what that includes so you can see the full picture. The price covers everything from the inspection through the completed work with a warranty. No hidden charges.',
    groqKey: 'sticker_shock',
    callerPhrases: [
      'whoa I was not ready for that number',
      'that is a lot more than I budgeted',
      'I had no idea it would cost that much',
      'I was thinking it would be much less',
      'that just caught me off guard',
      'I was not prepared for that price',
      'that is double what I was expecting',
      'I thought it would be around half that',
      'that number really surprised me',
      'I was not expecting anything close to that',
      'my jaw just dropped at that price',
      'that is significantly more than I thought',
      'I am in shock at that number',
      'is that the right price because that seems high',
      'I was expecting something much more reasonable',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 2
    label: 'Value Questioning',
    content: 'Great question. That price includes a licensed technician, a complete inspection, all labor and standard materials, plus a warranty on the work. You are covered from start to finish with no surprise charges after the fact.',
    groqKey: 'value_questioning',
    callerPhrases: [
      'what am I paying for exactly',
      'what does that price include',
      'what do I get for that money',
      'break it down for me',
      'what is included in that price',
      'why does it cost that much',
      'what justifies that price',
      'can you explain why it costs that',
      'what makes it worth that much',
      'I want to understand the pricing',
      'what am I actually getting for that',
      'tell me what is covered in that price',
      'why should I pay that much',
      'what goes into that cost',
      'help me understand the pricing',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 3
    label: 'Discount Request',
    content: 'I appreciate you asking. If we have any current promotions or plan member discounts available I would be happy to apply those. The price includes everything needed for a thorough professional job. Would you like me to check what options we have?',
    groqKey: 'discount_request',
    callerPhrases: [
      'can you give me a discount',
      'do you have any coupons',
      'is there a special going on',
      'do you offer any deals',
      'can you do any better on the price',
      'is there a first time customer discount',
      'do you have any promotions right now',
      'can you knock anything off the price',
      'is there any way to bring that down',
      'do you offer senior discounts',
      'do you have a military discount',
      'any specials running right now',
      'can you match a lower price',
      'is there a coupon I can use',
      'do you run any seasonal deals',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 4
    label: 'Negotiation Attempt',
    content: 'I hear you. That is our standard rate and it covers a complete professional job by a licensed and insured technician. If we have a maintenance plan that offers savings I would be happy to share those details with you.',
    groqKey: 'negotiation',
    callerPhrases: [
      'what is the best you can do',
      'can you come down on that at all',
      'is that your final price',
      'there is no flexibility on the price',
      'can we work something out',
      'is there any wiggle room',
      'what if I pay cash',
      'can you do it for less',
      'that is not going to work for me price wise',
      'I need you to do better than that',
      'is that negotiable',
      'you have to give me a better price',
      'come on you can do better than that',
      'what is the lowest you can go',
      'meet me halfway on the price',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // COMPETITOR & VALUE COMPARISON (5-8)
  // ════════════════════════════════════════════════════════════════════════

  { // 5
    label: 'Competitor Price Comparison',
    content: 'It is smart to compare and I respect that. What we include is a licensed and insured technician, warranty on the work, and a thorough job from start to finish. Would you like me to walk through everything that is covered?',
    groqKey: 'competitor_comparison',
    callerPhrases: [
      'other companies charge less',
      'I got a lower quote from someone else',
      'the other company is cheaper',
      'I can get it done for less elsewhere',
      'your competitor quoted me half that',
      'why are you more expensive than everyone else',
      'another company can do it for less',
      'I found a better price online',
      'the guy down the street charges less',
      'I have seen lower prices for the same thing',
      'your prices are higher than most',
      'someone else quoted me a much better price',
      'I am comparing prices right now',
      'why should I go with you when others are cheaper',
      'the other estimate was way lower',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 6
    label: 'Second Opinion Or Quote Shopping',
    content: 'That is a really smart approach and we support that. We are happy to have a technician come out and give you our assessment so you can compare. You will get an honest evaluation with no pressure to commit.',
    groqKey: 'second_opinion',
    callerPhrases: [
      'I want to get another quote first',
      'I am going to shop around',
      'I need to compare before I decide',
      'let me think about it and get other estimates',
      'I am getting a few quotes',
      'I want a second opinion on this',
      'I need to compare your price with others',
      'I am not ready to commit I want to look around',
      'I want to see what other companies charge',
      'let me get a couple more estimates',
      'I never go with the first quote',
      'I like to compare before I spend money',
      'I am going to call around first',
      'I want to make sure I am getting a fair deal',
      'I need to do some more research on pricing',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 7
    label: 'DIY Consideration',
    content: 'I respect that and some things are definitely doable yourself. For anything that involves electrical, refrigerant, or gas connections a licensed technician is the safe route. We are here whenever you need professional help.',
    groqKey: 'diy_alternative',
    callerPhrases: [
      'I will just do it myself',
      'I can probably fix that on my own',
      'how hard can it be to do myself',
      'I am handy I will figure it out',
      'I do not need to pay someone for that',
      'I will just watch a youtube video',
      'my neighbor said he could do it',
      'I have a friend who can do it cheaper',
      'I know a guy who does this on the side',
      'I will try to fix it myself first',
      'maybe I will just handle it on my own',
      'I think I can take care of it myself',
      'I would rather try it myself and save the money',
      'is this something I could do on my own',
      'do I really need a professional for this',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 8
    label: 'Fair Price Trust Concern',
    content: 'That is a completely fair question. Our pricing reflects licensed and insured technicians, quality parts, and warranty on all work. We are transparent about what everything costs and there are no surprises after the fact.',
    groqKey: 'fair_price_trust',
    callerPhrases: [
      'how do I know that is a fair price',
      'how do I know you are not overcharging me',
      'is that really what this should cost',
      'that seems higher than it should be',
      'I feel like I am being overcharged',
      'are your prices in line with the industry',
      'is this what everyone charges',
      'how do I know this is not inflated',
      'why should I trust that price',
      'can you justify this pricing',
      'this feels like a markup',
      'I want to make sure I am not getting ripped off',
      'is this pricing standard or premium',
      'that seems inflated to me',
      'I just want to make sure the price is fair',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // BUDGET & AFFORDABILITY (9-11)
  // ════════════════════════════════════════════════════════════════════════

  { // 9
    label: 'Budget Concern',
    content: 'I completely understand that and there is no pressure at all. If we have any payment options or a way to phase the work I am happy to share those. You are welcome to call back anytime when you are ready.',
    groqKey: 'budget_concern',
    callerPhrases: [
      'I cannot afford that right now',
      'that is not in my budget',
      'I do not have the money for that',
      'I was not planning on spending that much',
      'money is tight right now',
      'I just cannot swing that right now',
      'that is going to be hard to pay for',
      'I am on a fixed income',
      'that is more than I can spend right now',
      'I do not have that kind of money',
      'I wish I could but I cannot afford it',
      'that is outside my budget',
      'I need something more affordable',
      'is there a cheaper option',
      'I was hoping it would be more budget friendly',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 10
    label: 'Financing Or Payment Plan Question',
    content: 'Great question. We do work with customers on payment options to make things more manageable. Let me share what is available so you can see if that works for your situation. Many of our customers take advantage of those options.',
    groqKey: 'financing_question',
    callerPhrases: [
      'do you offer financing',
      'can I make payments on this',
      'do you have a payment plan',
      'can I pay in installments',
      'is there a way to spread out the cost',
      'do you offer monthly payments',
      'can I finance this',
      'do you have zero interest options',
      'what payment options do you have',
      'can I put this on a payment plan',
      'is there a way to pay over time',
      'do you offer credit',
      'can I split the payments up',
      'what are your financing terms',
      'I need a payment plan for this',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 11
    label: 'Cheaper Option Request',
    content: 'I hear you. Let me see if there is a way to prioritize what is most important right now and address the rest later. Sometimes we can phase the work so you can take care of the urgent part first.',
    groqKey: 'budget_concern',
    callerPhrases: [
      'is there a cheaper way to do this',
      'do you have a more affordable option',
      'what is the minimum I could do',
      'can we just do the most important part',
      'is there a basic option',
      'what if I only want part of it done',
      'can you just do the essential part',
      'what is the least I could spend',
      'do you have a budget option',
      'is there a way to keep costs down',
      'what is the bare minimum to fix this',
      'can we skip anything to save money',
      'is there a stripped down version',
      'what absolutely has to be done right now',
      'can we start with just the urgent stuff',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // TRUST & TRANSPARENCY (12-14)
  // ════════════════════════════════════════════════════════════════════════

  { // 12
    label: 'Hidden Fees Concern',
    content: 'Great question and I want to be upfront. The price I quoted covers everything. If anything additional comes up during the visit, the technician will explain it and get your approval before doing any extra work. No surprises.',
    groqKey: 'hidden_fees',
    callerPhrases: [
      'are there any hidden fees',
      'is that the total cost or are there extras',
      'are there additional charges on top of that',
      'is there anything else I would have to pay',
      'what about parts is that extra',
      'does that include everything or just labor',
      'are there any surprise charges',
      'will the bill be higher when they get here',
      'is that the final number or does it go up',
      'what else will I be charged for',
      'I do not want any surprise costs',
      'is there a trip charge on top of that',
      'does that include tax and everything',
      'I have been hit with hidden fees before',
      'will there be any add on charges',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 13
    label: 'Upfront Pricing Request',
    content: 'I understand wanting to know the cost before committing. Some services have a set price, and for repairs the diagnostic gives you a firm quote before any work begins. You always know the cost before we start and you decide whether to proceed.',
    groqKey: 'upfront_pricing',
    callerPhrases: [
      'can you tell me the exact cost before coming out',
      'I want to know the price upfront',
      'I do not want to pay just to find out the price',
      'can you give me a firm price right now',
      'I need to know exactly what this will cost',
      'do not send someone unless I know the cost',
      'I want a price before I agree to anything',
      'will you quote me before starting work',
      'I need a number before I commit',
      'how much will it be total before they start',
      'I am not paying for someone to come tell me a price',
      'give me the total before you come out',
      'I want everything in writing before you start',
      'can I get a guaranteed price',
      'I need to know costs upfront no surprises',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 14
    label: 'Diagnostic Fee vs Repair Cost Concern',
    content: 'I hear that concern. The diagnostic fee gets you a clear answer on what is going on and a firm repair quote. If you move forward with the repair you have the full picture. If not, the diagnostic fee is all you pay. You are in control the whole time.',
    groqKey: 'upfront_pricing',
    callerPhrases: [
      'I do not want to pay a diagnostic just to find out it costs more',
      'what if the repair costs too much after the diagnostic',
      'am I stuck paying for the diagnostic and then more for the repair',
      'I feel like the diagnostic is just a way to get more money',
      'the diagnostic fee plus the repair seems like double charging',
      'why should I pay to find out it is going to cost even more',
      'that is two charges to get one thing fixed',
      'I do not want to pay twice',
      'the diagnostic fee is just the start and then I get hit with more',
      'what is the point of the diagnostic if I still have to pay for the repair',
      'I would rather just know the total cost upfront',
      'paying for a diagnostic just to hear I need to pay more is frustrating',
      'so I pay the diagnostic and then I still have to decide on the repair',
      'how much will the repair be on top of the diagnostic',
      'I just want one price for the whole thing',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },
];


// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

const output = {
  kcTitle: 'Price Objections',
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
  if (wc < 25 || wc > 50) {
    console.warn(`\u26A0 Section ${s.index} "${s.label}" content: ${wc} words (target 30-42)`);
  }
  if (!s.groqContent) {
    console.error(`\u2717 Section ${s.index} "${s.label}" missing groqContent`);
    errors++;
  } else if (s.groqContent.length < 400) {
    console.error(`\u2717 Section ${s.index} "${s.label}" groqContent only ${s.groqContent.length} chars (min 400)`);
    errors++;
  }
  if (s.callerPhrases.length < 5) {
    console.error(`\u2717 Section ${s.index} "${s.label}" only ${s.callerPhrases.length} phrases (min 5)`);
    errors++;
  }
  const emptyPhrases = s.callerPhrases.filter(p => !p.trim());
  if (emptyPhrases.length) {
    console.error(`\u2717 Section ${s.index} "${s.label}" has ${emptyPhrases.length} empty phrases`);
    errors++;
  }
}
if (errors > 0) { console.error(`\n\u2717 ${errors} error(s).`); process.exit(1); }

const outPath = path.join(__dirname, 'kc-price-objections.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`\n\u2705 Generated ${outPath}`);
console.log(`   ${output.sectionCount} sections`);
console.log(`   ${output.sections.reduce((n, s) => n + s.callerPhrases.length, 0)} total callerPhrases`);
console.log(`   ${new Set(output.sections.map(s => s.groqContent)).size} unique groqContent templates`);
const cw = output.sections.map(s => s.content.split(/\s+/).length);
const gc = output.sections.filter(s => s.groqContent).map(s => s.groqContent.length);
console.log(`   Content words: min=${Math.min(...cw)} max=${Math.max(...cw)} avg=${Math.round(cw.reduce((a,b)=>a+b,0)/cw.length)}`);
console.log(`   GroqContent chars: min=${Math.min(...gc)} max=${Math.max(...gc)} avg=${Math.round(gc.reduce((a,b)=>a+b,0)/gc.length)}`);
console.log('\nNEXT STEPS:');
console.log('  1. Create empty "Price Objections" container in services.html');
console.log('  2. Import kc-price-objections.json');
console.log('  3. Enable "No anchor (meta-container)" toggle');
console.log('  4. Re-score All \u2192 Fix All \u2192 Generate Missing Audio');
