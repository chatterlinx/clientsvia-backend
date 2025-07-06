const mongoose = require('mongoose');
const AgentPrompt = require('../models/AgentPrompt');

const defaultPrompts = [
  {
    intent: 'decisionNudge',
    variants: [
      "Just to confirm, would you like to get this scheduled today?",
      "If you’re ready, I can lock in that appointment for you now.",
      "Shall I go ahead and reserve that spot for you?",
      "I can hold that time for you—does that work?",
      "Is there anything else you need to know before we set this up?"
    ]
  },
  {
    intent: 'optionsFraming',
    variants: [
      "We have a couple of options: Would you prefer morning or afternoon?",
      "Would you like the first available time, or is later in the week better?",
      "Which of these dates works best for you?",
      "Would you rather we come out as soon as possible, or do you want to choose a specific time?"
    ]
  },
  {
    intent: 'reassuranceCloser',
    variants: [
      "You’ll be in good hands—our techs are experienced and professional.",
      "We’ll make sure everything’s taken care of for you.",
      "I’ll follow up and make sure you’re taken care of from start to finish.",
      "I can answer any questions you have before we book this."
    ]
  },
  {
    intent: 'gentleUrgency',
    variants: [
      "These slots fill up fast, so I recommend reserving now if you can.",
      "I want to make sure you get the time that works for you—shall I secure this spot?",
      "We’re almost fully booked this week, but I still have one or two openings. Want me to grab one for you?"
    ]
  },
  {
    intent: 'confirmAndMoveForward',
    variants: [
      "Great, I’ve got all your details—let’s get you on the schedule.",
      "Perfect, I’ll get you set up. Is there anything else you need from me today?",
      "Awesome, you’re all set. You’ll get a confirmation shortly."
    ]
  },
  {
    intent: 'afterObjection',
    variants: [
      "No problem, but just so you know, you can always book now and reschedule if you need to.",
      "I’m happy to answer anything that’s holding you back.",
      "If you’d like, I can pencil you in and you can confirm later—no obligation."
    ]
  },
  {
    intent: 'deadAir',
    variants: [
      "Take your time, but whenever you’re ready, I can get this going for you.",
      "Just let me know what works best and I’ll handle the rest.",
      "Whenever you’re ready, I’m here to help you get this done."
    ]
  },
  // Additional prompt sets can be added here following the same pattern
  {
    intent: 'misunderstood',
    variants: [
      "I’m sorry, I didn’t quite catch that. Could you repeat it?",
      "Apologies, would you mind clarifying that for me?"
    ]
  },
  {
    intent: 'notClear',
    variants: [
      "I want to make sure I’m helping correctly—can you rephrase that?",
      "Just to be certain, could you explain that another way?"
    ]
  },
  {
    intent: 'outOfCategory',
    variants: [
      "That’s outside what we typically handle, but I can find out who does.",
      "Let me connect you with the right person for that question."
    ]
  },
  {
    intent: 'transferLive',
    variants: [
      "One moment while I transfer you to a live agent who can assist.",
      "Let me get someone on the line who can help you right away."
    ]
  },
  {
    intent: 'closed',
    variants: [
      "Thanks for calling! Have a wonderful day.",
      "I appreciate your time. Goodbye!"
    ]
  },
  {
    intent: 'frustrated',
    variants: [
      "I’m sorry for the trouble. Let’s see how we can fix this.",
      "I understand this is frustrating. I’m here to help."
    ]
  },
  {
    intent: 'businessHours',
    variants: [
      "Our normal hours are 8am to 5pm, Monday through Friday.",
      "We’re open weekdays 8 to 5 if that helps plan your visit."
    ]
  },
  {
    intent: 'connectionTrouble',
    variants: [
      "It sounds like the line is breaking up—can you still hear me?",
      "I’m having trouble hearing you. Let’s try again or I can call back."    ]
  },
  {
    intent: 'agentNotClear',
    variants: [
      "Let me double-check that and get right back to you.",
      "I’m not certain about that—give me a second to verify."
    ]
  }
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const p of defaultPrompts) {
    await AgentPrompt.updateOne(
      { companyId: null, intent: p.intent },
      { $set: { variants: p.variants, updatedAt: new Date() } },
      { upsert: true }
    );
  }
  console.log('Global default prompts seeded.');
  process.exit(0);
})();
