/**
 * INSTANT RESPONSE VARIATIONS DICTIONARY
 * 
 * Purpose: In-house variation dictionary for instant response matching
 * - Provides semantic matching without external LLMs
 * - Supports multi-language variations
 * - Enables fuzzy matching for common misspellings and abbreviations
 * 
 * Structure:
 * - Each entry has a canonical form and variations
 * - Variations include synonyms, misspellings, abbreviations, and context-specific terms
 * - All matching is case-insensitive
 * 
 * Usage:
 * - Used by v2InstantResponseMatcher.js for query normalization
 * - Used by variationSuggestionEngine.js for suggesting new variations
 * 
 * Last Updated: 2025-10-02
 */

module.exports = {
  // === HOURS & SCHEDULING ===
  hours: {
    canonical: 'hours',
    variations: [
      'hours',
      'hour',
      'hrs',
      'open',
      'opened',
      'opening',
      'opening hours',
      'business hours',
      'open hours',
      'operating hours',
      'schedule',
      'when open',
      'time open',
      'what time',
      'open when',
      'open today',
      'hours today',
      'hours of operation',
      'operation hours',
      'availability',
      'when available',
      'open time',
      'close',
      'closed',
      'closing',
      'closing time',
      'when close'
    ]
  },

  // === LOCATION & ADDRESS ===
  location: {
    canonical: 'location',
    variations: [
      'location',
      'address',
      'where',
      'located',
      'where located',
      'where are you',
      'directions',
      'how to get there',
      'where is',
      'find you',
      'your address',
      'street address',
      'physical address',
      'office location',
      'store location',
      'shop location',
      'office',
      'store',
      'shop'
    ]
  },

  // === PRICING & COSTS ===
  pricing: {
    canonical: 'pricing',
    variations: [
      'pricing',
      'price',
      'prices',
      'cost',
      'costs',
      'how much',
      'rate',
      'rates',
      'fee',
      'fees',
      'charge',
      'charges',
      'pricing info',
      'information',
      'info',
      'cost estimate',
      'quote',
      'price quote',
      'estimate',
      'service cost',
      'service price',
      'pay',
      'payment',
      'afford',
      'expensive',
      'cheap',
      'value'
    ]
  },

  // === SERVICES OFFERED ===
  services: {
    canonical: 'services',
    variations: [
      'services',
      'service',
      'what services',
      'what do you do',
      'what you do',
      'offerings',
      'what offer',
      'service list',
      'services offered',
      'services available',
      'available services',
      'service options',
      'options'
    ]
  },

  // === CONTACT & PHONE ===
  contact: {
    canonical: 'contact',
    variations: [
      'contact',
      'call',
      'phone',
      'phone number',
      'call you',
      'reach you',
      'contact info',
      'contact information',
      'get in touch',
      'how to contact',
      'email',
      'email address',
      'fax',
      'contact details'
    ]
  },

  // === BOOKING & APPOINTMENTS ===
  booking: {
    canonical: 'booking',
    variations: [
      'booking',
      'book',
      'appointment',
      'schedule',
      'reserve',
      'reservation',
      'make appointment',
      'book appointment',
      'schedule appointment',
      'set appointment',
      'arrange appointment',
      'book service',
      'schedule service',
      'appointment booking'
    ]
  },

  // === EMERGENCY & URGENT ===
  emergency: {
    canonical: 'emergency',
    variations: [
      'emergency',
      'urgent',
      'asap',
      'right now',
      'immediate',
      'emergency service',
      'urgent service',
      'emergency help',
      'urgent help',
      'help now',
      'need help',
      'crisis',
      'urgent need'
    ]
  },

  // === PAYMENT & METHODS ===
  payment: {
    canonical: 'payment',
    variations: [
      'payment',
      'pay',
      'payment methods',
      'payment options',
      'how to pay',
      'accept payment',
      'credit card',
      'debit card',
      'cash',
      'check',
      'financing',
      'payment plan',
      'installment',
      'invoice',
      'bill'
    ]
  },

  // === INSURANCE ===
  insurance: {
    canonical: 'insurance',
    variations: [
      'insurance',
      'insured',
      'insurance accepted',
      'take insurance',
      'accept insurance',
      'insurance coverage',
      'coverage',
      'insurance plan',
      'insurance company',
      'insurance provider'
    ]
  },

  // === AVAILABILITY & BOOKING ===
  availability: {
    canonical: 'availability',
    variations: [
      'availability',
      'available',
      'availability today',
      'available today',
      'open slot',
      'slot available',
      'free time',
      'openings',
      'next available',
      'when available',
      'available times',
      'available dates'
    ]
  },

  // === STAFF & PERSONNEL ===
  staff: {
    canonical: 'staff',
    variations: [
      'staff',
      'team',
      'who works',
      'employees',
      'technician',
      'technicians',
      'specialist',
      'specialists',
      'professional',
      'professionals',
      'worker',
      'workers',
      'personnel'
    ]
  },

  // === EXPERIENCE & QUALIFICATIONS ===
  experience: {
    canonical: 'experience',
    variations: [
      'experience',
      'experienced',
      'years experience',
      'how long business',
      'qualified',
      'qualifications',
      'certified',
      'certification',
      'licensed',
      'license',
      'credentials',
      'background'
    ]
  },

  // === WARRANTY & GUARANTEE ===
  warranty: {
    canonical: 'warranty',
    variations: [
      'warranty',
      'guarantee',
      'guaranteed',
      'warranty coverage',
      'warranty period',
      'warranty info',
      'guarantee work',
      'stand behind work',
      'workmanship guarantee'
    ]
  },

  // === REVIEWS & REPUTATION ===
  reviews: {
    canonical: 'reviews',
    variations: [
      'reviews',
      'review',
      'rating',
      'ratings',
      'feedback',
      'testimonial',
      'testimonials',
      'reputation',
      'references',
      'customer reviews',
      'client reviews'
    ]
  },

  // === AREA & COVERAGE ===
  area: {
    canonical: 'area',
    variations: [
      'area',
      'service area',
      'coverage',
      'coverage area',
      'service region',
      'service zone',
      'where service',
      'areas covered',
      'areas served',
      'service locations',
      'do you service',
      'come to'
    ]
  },

  // === COMMON QUESTION PATTERNS ===
  yes_no: {
    canonical: 'yes_no',
    variations: [
      'do you',
      'can you',
      'are you',
      'is it',
      'will you',
      'does it',
      'have you',
      'did you'
    ]
  },

  // === TIME EXPRESSIONS ===
  time: {
    canonical: 'time',
    variations: [
      'today',
      'tomorrow',
      'tonight',
      'this week',
      'this weekend',
      'next week',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'weekday',
      'weekend',
      'now',
      'asap',
      'soon',
      'later'
    ]
  },

  // === COMMON FILLERS & CONNECTORS ===
  fillers: {
    canonical: 'fillers',
    variations: [
      'um',
      'uh',
      'like',
      'you know',
      'i mean',
      'basically',
      'actually',
      'so',
      'well',
      'okay',
      'alright',
      'right'
    ]
  },

  // Helper function to get all variations for a concept
  getAllVariations: function(concept) {
    if (this[concept] && this[concept].variations) {
      return this[concept].variations;
    }
    return [];
  },

  // Helper function to find canonical form for a given term
  findCanonical: function(term) {
    const lowerTerm = term.toLowerCase().trim();
    for (const [key, value] of Object.entries(this)) {
      if (typeof value === 'object' && value.variations) {
        if (value.variations.includes(lowerTerm)) {
          return value.canonical;
        }
      }
    }
    return null;
  },

  // Helper function to check if two terms are variations of the same concept
  areRelated: function(term1, term2) {
    const canonical1 = this.findCanonical(term1);
    const canonical2 = this.findCanonical(term2);
    return canonical1 && canonical2 && canonical1 === canonical2;
  },

  // Get all concepts
  getAllConcepts: function() {
    return Object.keys(this).filter(key => 
      typeof this[key] === 'object' && this[key].canonical
    );
  }
};
