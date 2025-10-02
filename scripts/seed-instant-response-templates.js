/**
 * SEED INSTANT RESPONSE TEMPLATES
 * 
 * Purpose: Populate template library with common business scenarios
 * - General business templates
 * - Trade-specific templates (plumbing, HVAC, electrical, etc.)
 * - Templates are public and reusable across all companies
 * 
 * Usage: node scripts/seed-instant-response-templates.js
 * 
 * Last Updated: 2025-10-02
 */

require('dotenv').config();
const mongoose = require('mongoose');
const InstantResponseTemplate = require('../models/InstantResponseTemplate');
const v2User = require('../models/v2User');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const templates = [
  // === GENERAL BUSINESS TEMPLATES ===
  {
    name: 'General Business - Hours & Contact',
    category: 'general',
    description: 'Basic hours and contact information for any business',
    isPublic: true,
    tags: ['hours', 'contact', 'basic', 'general'],
    templates: [
      {
        trigger: 'what are your hours',
        response: 'We are open [INSERT YOUR HOURS]. Please call [INSERT PHONE] for more information.',
        category: 'hours',
        priority: 90
      },
      {
        trigger: 'are you open today',
        response: 'Yes, we are open today from [INSERT TODAY HOURS]. Feel free to stop by or give us a call!',
        category: 'hours',
        priority: 90
      },
      {
        trigger: 'when do you close',
        response: 'We close at [INSERT CLOSING TIME] today. We look forward to serving you!',
        category: 'hours',
        priority: 85
      },
      {
        trigger: 'what is your phone number',
        response: 'You can reach us at [INSERT PHONE]. We are happy to help!',
        category: 'contact',
        priority: 95
      },
      {
        trigger: 'where are you located',
        response: 'We are located at [INSERT ADDRESS]. Looking forward to seeing you!',
        category: 'location',
        priority: 95
      },
      {
        trigger: 'do you do appointments',
        response: 'Yes, we schedule appointments. Please call [INSERT PHONE] to book your appointment.',
        category: 'booking',
        priority: 80
      }
    ]
  },

  // === PLUMBING TEMPLATES ===
  {
    name: 'Plumber - Emergency & Services',
    category: 'plumbing',
    description: 'Emergency plumbing services and common questions',
    isPublic: true,
    tags: ['plumbing', 'emergency', 'services'],
    templates: [
      {
        trigger: 'do you do emergency plumbing',
        response: 'Yes! We offer 24/7 emergency plumbing services. Call [INSERT PHONE] immediately for urgent issues.',
        category: 'emergency',
        priority: 100
      },
      {
        trigger: 'how much do you charge',
        response: 'Our pricing depends on the service needed. Call [INSERT PHONE] for a free estimate!',
        category: 'pricing',
        priority: 85
      },
      {
        trigger: 'do you fix water heaters',
        response: 'Yes, we repair and install all types of water heaters. Call [INSERT PHONE] to schedule service.',
        category: 'services',
        priority: 80
      },
      {
        trigger: 'do you do drain cleaning',
        response: 'Absolutely! We provide professional drain cleaning services. Call [INSERT PHONE] to book.',
        category: 'services',
        priority: 80
      },
      {
        trigger: 'are you licensed',
        response: 'Yes, we are fully licensed and insured with [INSERT YEARS] years of experience.',
        category: 'other',
        priority: 75
      }
    ]
  },

  // === HVAC TEMPLATES ===
  {
    name: 'HVAC - Services & Maintenance',
    category: 'hvac',
    description: 'Heating, cooling, and HVAC maintenance services',
    isPublic: true,
    tags: ['hvac', 'heating', 'cooling', 'ac', 'furnace'],
    templates: [
      {
        trigger: 'do you fix air conditioners',
        response: 'Yes, we repair and service all types of air conditioning systems. Call [INSERT PHONE] to schedule.',
        category: 'services',
        priority: 90
      },
      {
        trigger: 'do you do furnace repair',
        response: 'Absolutely! We service all furnace brands and models. Call [INSERT PHONE] for service.',
        category: 'services',
        priority: 90
      },
      {
        trigger: 'do you offer maintenance plans',
        response: 'Yes! We offer annual HVAC maintenance plans. Call [INSERT PHONE] to learn more.',
        category: 'services',
        priority: 80
      },
      {
        trigger: 'do you install new systems',
        response: 'Yes, we install complete HVAC systems with financing options. Call [INSERT PHONE] for a quote.',
        category: 'services',
        priority: 85
      },
      {
        trigger: 'my ac is not working',
        response: 'We can help! Call [INSERT PHONE] now and we will get your AC running as soon as possible.',
        category: 'emergency',
        priority: 95
      }
    ]
  },

  // === ELECTRICAL TEMPLATES ===
  {
    name: 'Electrician - Services & Safety',
    category: 'electrical',
    description: 'Electrical services, repairs, and safety',
    isPublic: true,
    tags: ['electrical', 'electrician', 'wiring', 'safety'],
    templates: [
      {
        trigger: 'do you do electrical repairs',
        response: 'Yes! We handle all electrical repairs safely and professionally. Call [INSERT PHONE] to schedule.',
        category: 'services',
        priority: 90
      },
      {
        trigger: 'can you install outlets',
        response: 'Absolutely! We install new outlets and upgrade existing ones. Call [INSERT PHONE] for service.',
        category: 'services',
        priority: 80
      },
      {
        trigger: 'do you do panel upgrades',
        response: 'Yes, we upgrade electrical panels to meet current code. Call [INSERT PHONE] for a quote.',
        category: 'services',
        priority: 85
      },
      {
        trigger: 'my power is out',
        response: 'Call [INSERT PHONE] immediately. We provide emergency electrical services 24/7.',
        category: 'emergency',
        priority: 100
      },
      {
        trigger: 'are you licensed',
        response: 'Yes, we are fully licensed, bonded, and insured electricians with [INSERT YEARS] years of experience.',
        category: 'other',
        priority: 75
      }
    ]
  },

  // === RESTAURANT TEMPLATES ===
  {
    name: 'Restaurant - Hours & Reservations',
    category: 'restaurant',
    description: 'Restaurant hours, reservations, and menu questions',
    isPublic: true,
    tags: ['restaurant', 'food', 'dining', 'reservations'],
    templates: [
      {
        trigger: 'what are your hours',
        response: 'We are open [INSERT HOURS]. We look forward to serving you!',
        category: 'hours',
        priority: 95
      },
      {
        trigger: 'do you take reservations',
        response: 'Yes! Call [INSERT PHONE] or visit our website to make a reservation.',
        category: 'booking',
        priority: 90
      },
      {
        trigger: 'do you have outdoor seating',
        response: 'Yes, we have a lovely outdoor patio! Subject to weather conditions.',
        category: 'services',
        priority: 75
      },
      {
        trigger: 'do you do takeout',
        response: 'Yes! Call [INSERT PHONE] to place a takeout order.',
        category: 'services',
        priority: 85
      },
      {
        trigger: 'do you have vegetarian options',
        response: 'Yes, we have several vegetarian dishes on our menu. Check our website or call for details.',
        category: 'services',
        priority: 80
      }
    ]
  },

  // === MEDICAL/DENTAL TEMPLATES ===
  {
    name: 'Medical Office - Appointments & Insurance',
    category: 'medical',
    description: 'Medical/dental office appointments and insurance',
    isPublic: true,
    tags: ['medical', 'dental', 'healthcare', 'doctor'],
    templates: [
      {
        trigger: 'how do I make an appointment',
        response: 'Please call [INSERT PHONE] to schedule your appointment. We look forward to seeing you!',
        category: 'booking',
        priority: 95
      },
      {
        trigger: 'what insurance do you accept',
        response: 'We accept most major insurance plans. Call [INSERT PHONE] to verify your specific coverage.',
        category: 'other',
        priority: 90
      },
      {
        trigger: 'are you accepting new patients',
        response: 'Yes, we are accepting new patients! Call [INSERT PHONE] to schedule your first visit.',
        category: 'booking',
        priority: 85
      },
      {
        trigger: 'what are your office hours',
        response: 'Our office hours are [INSERT HOURS]. Call [INSERT PHONE] for appointments.',
        category: 'hours',
        priority: 90
      },
      {
        trigger: 'do you have same day appointments',
        response: 'We offer same-day appointments when available. Call [INSERT PHONE] to check availability.',
        category: 'booking',
        priority: 80
      }
    ]
  },

  // === AUTOMOTIVE TEMPLATES ===
  {
    name: 'Auto Repair - Services & Pricing',
    category: 'automotive',
    description: 'Auto repair shop services and pricing',
    isPublic: true,
    tags: ['automotive', 'auto', 'car', 'repair', 'mechanic'],
    templates: [
      {
        trigger: 'do you do oil changes',
        response: 'Yes! We offer quick and affordable oil changes. Call [INSERT PHONE] to schedule.',
        category: 'services',
        priority: 90
      },
      {
        trigger: 'do you do brake repair',
        response: 'Absolutely! We service all brake systems. Call [INSERT PHONE] for service.',
        category: 'services',
        priority: 90
      },
      {
        trigger: 'how much is an oil change',
        response: 'Oil change pricing varies by vehicle. Call [INSERT PHONE] for an exact quote!',
        category: 'pricing',
        priority: 85
      },
      {
        trigger: 'do you do inspections',
        response: 'Yes, we perform state inspections. Call [INSERT PHONE] to schedule.',
        category: 'services',
        priority: 80
      },
      {
        trigger: 'do I need an appointment',
        response: 'Appointments are recommended but we also accept walk-ins. Call [INSERT PHONE] to schedule.',
        category: 'booking',
        priority: 80
      }
    ]
  },

  // === CLEANING SERVICES TEMPLATES ===
  {
    name: 'Cleaning Services - Residential & Commercial',
    category: 'cleaning',
    description: 'House and commercial cleaning services',
    isPublic: true,
    tags: ['cleaning', 'housekeeping', 'maid', 'janitorial'],
    templates: [
      {
        trigger: 'how much do you charge',
        response: 'Our pricing depends on the size and type of cleaning needed. Call [INSERT PHONE] for a free quote!',
        category: 'pricing',
        priority: 90
      },
      {
        trigger: 'do you do deep cleaning',
        response: 'Yes! We offer deep cleaning services for homes and businesses. Call [INSERT PHONE] to schedule.',
        category: 'services',
        priority: 85
      },
      {
        trigger: 'are you insured',
        response: 'Yes, we are fully insured and bonded for your peace of mind.',
        category: 'other',
        priority: 75
      },
      {
        trigger: 'do you bring your own supplies',
        response: 'Yes, we bring all cleaning supplies and equipment. You do not need to provide anything!',
        category: 'services',
        priority: 70
      },
      {
        trigger: 'do you do weekly cleaning',
        response: 'Yes! We offer weekly, bi-weekly, and monthly cleaning plans. Call [INSERT PHONE] for details.',
        category: 'services',
        priority: 80
      }
    ]
  }
];

async function seedTemplates() {
  try {
    console.log('🌱 Starting instant response template seeding...\n');

    // Find or create admin user for template creation
    let adminUser = await v2User.findOne({ email: 'admin@clientsvia.com' });
    
    if (!adminUser) {
      console.log('⚠️ Admin user not found. Templates will be created without user reference.');
      console.log('Run create-admin.js first to create proper admin user.\n');
      
      // Create a temporary admin user for seeding
      adminUser = new v2User({
        email: 'system@clientsvia.com',
        password: 'temp-password-change-me',
        role: 'admin',
        isActive: true
      });
      await adminUser.save();
      console.log('✅ Created temporary system user for seeding\n');
    }

    // Clear existing templates (optional - comment out to keep existing)
    // await InstantResponseTemplate.deleteMany({});
    // console.log('🗑️ Cleared existing templates\n');

    let created = 0;
    let skipped = 0;

    for (const templateData of templates) {
      // Check if template already exists
      const existing = await InstantResponseTemplate.findOne({ 
        name: templateData.name,
        category: templateData.category
      });

      if (existing) {
        console.log(`⏭️ Skipping "${templateData.name}" - already exists`);
        skipped++;
        continue;
      }

      // Create new template
      const template = new InstantResponseTemplate({
        ...templateData,
        createdBy: adminUser._id,
        usageCount: 0
      });

      await template.save();
      console.log(`✅ Created "${templateData.name}" (${templateData.templates.length} responses)`);
      created++;
    }

    console.log('\n📊 Seeding Summary:');
    console.log(`   ✅ Created: ${created} templates`);
    console.log(`   ⏭️ Skipped: ${skipped} templates (already exist)`);
    console.log(`   📝 Total: ${templates.length} templates in seed data\n`);

    // Display template statistics
    const allTemplates = await InstantResponseTemplate.find({ isPublic: true });
    console.log('📈 Template Library Statistics:');
    console.log(`   Total Public Templates: ${allTemplates.length}`);
    
    const byCategory = {};
    allTemplates.forEach(t => {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    });
    
    console.log('   By Category:');
    Object.entries(byCategory).forEach(([category, count]) => {
      console.log(`      ${category}: ${count}`);
    });

    console.log('\n✅ Template seeding completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding templates:', error);
    process.exit(1);
  }
}

seedTemplates();
