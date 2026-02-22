#!/usr/bin/env node
/**
 * ============================================================================
 * SEED FIRST NAMES - Global Hub Dictionary Seeder
 * ============================================================================
 * 
 * PURPOSE:
 * Seeds the Global Hub first names dictionary with a comprehensive list of
 * common first names from diverse backgrounds.
 * 
 * SOURCES:
 * - US Social Security Administration top names (1900-2024)
 * - US Census Bureau common names
 * - International names (Hispanic, Asian, European, Middle Eastern)
 * 
 * USAGE:
 *   node scripts/seed-first-names.js
 * 
 * REQUIREMENTS:
 * - MongoDB connection (uses MONGODB_URI from .env)
 * - AdminSettings model
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ============================================================================
// COMPREHENSIVE FIRST NAMES LIST
// ============================================================================
// Curated from SSA, Census, and international sources
// Includes: American, Hispanic, Asian, European, Middle Eastern names
// ============================================================================

const FIRST_NAMES = [
    // ========== TOP US NAMES (Male) - SSA Most Popular ==========
    "James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph",
    "Thomas", "Christopher", "Charles", "Daniel", "Matthew", "Anthony", "Mark",
    "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian",
    "George", "Timothy", "Ronald", "Edward", "Jason", "Jeffrey", "Ryan", "Jacob",
    "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott",
    "Brandon", "Benjamin", "Samuel", "Raymond", "Gregory", "Frank", "Alexander",
    "Patrick", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Jose", "Adam",
    "Nathan", "Henry", "Douglas", "Zachary", "Peter", "Kyle", "Noah", "Ethan",
    "Jeremy", "Walter", "Christian", "Keith", "Roger", "Terry", "Austin", "Sean",
    "Gerald", "Carl", "Dylan", "Harold", "Jordan", "Jesse", "Bryan", "Lawrence",
    "Arthur", "Gabriel", "Bruce", "Logan", "Billy", "Albert", "Willie", "Alan",
    "Eugene", "Russell", "Vincent", "Philip", "Bobby", "Johnny", "Bradley",
    "Liam", "Mason", "Elijah", "Oliver", "Aiden", "Lucas", "Jackson", "Sebastian",
    "Mateo", "Owen", "Theodore", "Caleb", "Ezra", "Isaiah", "Hunter", "Connor",
    "Eli", "Wyatt", "Luke", "Lincoln", "Jaxon", "Asher", "Levi", "Leo", "Adrian",
    "Cameron", "Miles", "Dominic", "Nolan", "Ian", "Evan", "Colton", "Easton",
    "Maverick", "Jayden", "Cooper", "Landon", "Grayson", "Kai", "Carter", "Jameson",
    
    // ========== TOP US NAMES (Female) - SSA Most Popular ==========
    "Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan",
    "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Margaret", "Sandra",
    "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Dorothy", "Carol",
    "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura",
    "Cynthia", "Kathleen", "Amy", "Angela", "Shirley", "Anna", "Brenda", "Pamela",
    "Emma", "Nicole", "Helen", "Samantha", "Katherine", "Christine", "Debra",
    "Rachel", "Carolyn", "Janet", "Catherine", "Maria", "Heather", "Diane",
    "Ruth", "Julie", "Olivia", "Joyce", "Virginia", "Victoria", "Kelly", "Lauren",
    "Christina", "Joan", "Evelyn", "Judith", "Megan", "Andrea", "Cheryl", "Hannah",
    "Jacqueline", "Martha", "Gloria", "Teresa", "Ann", "Sara", "Madison", "Frances",
    "Kathryn", "Janice", "Jean", "Abigail", "Alice", "Judy", "Sophia", "Grace",
    "Denise", "Amber", "Doris", "Marilyn", "Danielle", "Beverly", "Isabella",
    "Theresa", "Diana", "Natalie", "Brittany", "Charlotte", "Marie", "Kayla",
    "Alexis", "Lori", "Ava", "Mia", "Chloe", "Zoe", "Lily", "Eleanor", "Penelope",
    "Riley", "Layla", "Zoey", "Nora", "Camila", "Aria", "Scarlett", "Stella",
    "Violet", "Aurora", "Savannah", "Audrey", "Brooklyn", "Bella", "Claire",
    "Lucy", "Skylar", "Paisley", "Everly", "Anna", "Caroline", "Nova", "Genesis",
    "Emilia", "Kennedy", "Maya", "Willow", "Kinsley", "Naomi", "Aaliyah", "Elena",
    "Eliana", "Gianna", "Valentina", "Luna", "Hazel", "Ivy", "Autumn", "Nevaeh",
    
    // ========== HISPANIC/LATINO NAMES ==========
    "Jose", "Juan", "Carlos", "Luis", "Miguel", "Jorge", "Francisco", "Antonio",
    "Manuel", "Pedro", "Ricardo", "Eduardo", "Fernando", "Rafael", "Alejandro",
    "Roberto", "Oscar", "Javier", "Sergio", "Andres", "Diego", "Raul", "Enrique",
    "Arturo", "Mario", "Alberto", "Hector", "Victor", "Ruben", "Marco", "Pablo",
    "Guillermo", "Cesar", "Gustavo", "Ramon", "Alfredo", "Ernesto", "Salvador",
    "Jaime", "Armando", "Gerardo", "Felipe", "Julio", "Omar", "Rodrigo", "Adrian",
    "Ivan", "Hugo", "Jesus", "Angel", "Gabriel", "Mateo", "Santiago", "Sebastian",
    "Nicolas", "Emiliano", "Martin", "Leonardo", "Enzo", "Thiago", "Luca",
    
    "Maria", "Ana", "Carmen", "Rosa", "Lucia", "Elena", "Isabel", "Patricia",
    "Laura", "Teresa", "Gabriela", "Adriana", "Monica", "Claudia", "Alejandra",
    "Veronica", "Daniela", "Sandra", "Silvia", "Lorena", "Gloria", "Beatriz",
    "Leticia", "Norma", "Irma", "Yolanda", "Alicia", "Martha", "Margarita",
    "Guadalupe", "Juana", "Blanca", "Rocio", "Susana", "Esperanza", "Josefina",
    "Francisca", "Catalina", "Valentina", "Camila", "Sofia", "Isabella", "Natalia",
    "Mariana", "Paula", "Andrea", "Carolina", "Fernanda", "Ximena", "Valeria",
    
    // ========== ASIAN NAMES ==========
    // Chinese
    "Wei", "Ming", "Hui", "Jing", "Xiao", "Chen", "Lin", "Hong", "Ying", "Mei",
    "Li", "Fang", "Ling", "Yan", "Ping", "Juan", "Lan", "Qing", "Yun", "Hua",
    "Jun", "Feng", "Yang", "Lei", "Bo", "Hao", "Yu", "Tao", "Cheng", "Peng",
    
    // Korean
    "Min", "Jae", "Sung", "Hyun", "Young", "Jin", "Seung", "Dong", "Soo", "Hee",
    "Eun", "Ji", "Yoon", "Sun", "Kyung", "Hye", "Jung", "Mi", "Suk", "Won",
    
    // Vietnamese
    "Nguyen", "Tran", "Minh", "Anh", "Hung", "Duc", "Thanh", "Hoa", "Linh", "Lan",
    "Hai", "Nam", "Tuan", "Phuong", "Quang", "Dung", "Hieu", "Thao", "Mai", "Ngoc",
    
    // Japanese
    "Yuki", "Kenji", "Akira", "Hiroshi", "Takeshi", "Kazuki", "Ryu", "Ken", "Daiki",
    "Yui", "Sakura", "Hana", "Emi", "Mika", "Ayumi", "Yoko", "Naomi", "Haruki",
    
    // Indian/South Asian
    "Raj", "Amit", "Rahul", "Vikram", "Anil", "Ravi", "Deepak", "Ajay", "Sanjay",
    "Vijay", "Arun", "Ashok", "Sunil", "Manoj", "Rajesh", "Anand", "Arjun", "Rohan",
    "Priya", "Sunita", "Anita", "Neha", "Anjali", "Pooja", "Meena", "Kavita",
    "Rekha", "Nisha", "Ritu", "Seema", "Asha", "Divya", "Lakshmi", "Sita",
    
    // Filipino
    "Juan", "Jose", "Antonio", "Manuel", "Pedro", "Francisco", "Rodrigo",
    "Maria", "Ana", "Rosa", "Carmen", "Luz", "Fe", "Grace", "Joy",
    
    // ========== EUROPEAN NAMES ==========
    // German
    "Hans", "Klaus", "Wolfgang", "Dieter", "Helmut", "Werner", "Jurgen", "Stefan",
    "Monika", "Ursula", "Helga", "Ingrid", "Brigitte", "Gisela", "Petra", "Sabine",
    
    // French
    "Jean", "Pierre", "Michel", "Jacques", "Philippe", "Alain", "Bernard", "Luc",
    "Marie", "Jeanne", "Francoise", "Monique", "Nicole", "Sylvie", "Nathalie",
    
    // Italian
    "Giovanni", "Giuseppe", "Marco", "Paolo", "Francesco", "Luca", "Alessandro",
    "Francesca", "Giulia", "Chiara", "Sara", "Anna", "Valentina", "Alessia",
    
    // Polish
    "Jan", "Andrzej", "Piotr", "Krzysztof", "Tomasz", "Marek", "Pawel", "Michal",
    "Anna", "Maria", "Katarzyna", "Malgorzata", "Agnieszka", "Barbara", "Ewa",
    
    // Russian
    "Ivan", "Dmitri", "Sergei", "Nikolai", "Alexei", "Vladimir", "Andrei", "Mikhail",
    "Natasha", "Olga", "Tatiana", "Elena", "Irina", "Svetlana", "Anastasia", "Yekaterina",
    
    // Irish
    "Sean", "Patrick", "Connor", "Liam", "Declan", "Finn", "Brendan", "Colin",
    "Siobhan", "Aisling", "Niamh", "Ciara", "Aoife", "Sinead", "Maeve", "Fiona",
    
    // ========== MIDDLE EASTERN NAMES ==========
    "Mohammed", "Ahmad", "Ali", "Hassan", "Hussein", "Omar", "Khalid", "Yusuf",
    "Ibrahim", "Mustafa", "Abdul", "Karim", "Tariq", "Faisal", "Samir", "Nasser",
    "Fatima", "Aisha", "Layla", "Yasmin", "Leila", "Noor", "Sara", "Maryam",
    "Hana", "Dina", "Rana", "Rania", "Salma", "Amira", "Zara", "Samira",
    
    // ========== AFRICAN NAMES ==========
    "Kwame", "Kofi", "Yaw", "Kwesi", "Ama", "Akua", "Abena", "Efua",
    "Oluwaseun", "Chidi", "Emeka", "Nneka", "Adaeze", "Chiamaka", "Amara",
    
    // ========== ADDITIONAL COMMON VARIATIONS ==========
    "Mike", "Dan", "Dave", "Tom", "Bob", "Bill", "Jim", "Joe", "Steve", "Chris",
    "Matt", "Nick", "Ben", "Sam", "Jake", "Alex", "Max", "Tony", "Rick", "Ron",
    "Jen", "Jess", "Kate", "Liz", "Sue", "Beth", "Amy", "Meg", "Kim", "Tina",
    "Becky", "Mandy", "Sandy", "Cindy", "Debbie", "Barb", "Pam", "Cathy", "Pat",
    
    // ========== GENDER-NEUTRAL NAMES ==========
    "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Alex", "Sam",
    "Cameron", "Quinn", "Avery", "Parker", "Hayden", "Charlie", "Dakota", "Sage",
    "Finley", "Rowan", "River", "Emery", "Skyler", "Phoenix", "Blake", "Drew"
];

// ============================================================================
// MAIN SEEDING FUNCTION
// ============================================================================

async function seedFirstNames() {
    console.log('🌐 [SEED] Starting First Names seeding...');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not found in environment');
        process.exit(1);
    }
    
    try {
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Load AdminSettings model
        const AdminSettings = require('../models/AdminSettings');
        
        // Get current settings
        const settings = await AdminSettings.getSettings();
        
        // Normalize and deduplicate names
        const seen = new Set();
        const normalizedNames = [];
        
        for (const name of FIRST_NAMES) {
            const trimmed = name.trim();
            if (!trimmed) continue;
            
            // Title case
            const titleCase = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
            const lowerKey = titleCase.toLowerCase();
            
            if (!seen.has(lowerKey)) {
                seen.add(lowerKey);
                normalizedNames.push(titleCase);
            }
        }
        
        // Sort alphabetically
        normalizedNames.sort((a, b) => a.localeCompare(b));
        
        console.log(`📊 Total unique names: ${normalizedNames.length}`);
        
        // Initialize globalHub structure if needed
        if (!settings.globalHub) {
            settings.globalHub = {};
        }
        if (!settings.globalHub.dictionaries) {
            settings.globalHub.dictionaries = {};
        }
        
        // Update first names
        settings.globalHub.dictionaries.firstNames = normalizedNames;
        settings.globalHub.dictionaries.firstNamesUpdatedAt = new Date();
        settings.globalHub.dictionaries.firstNamesUpdatedBy = 'seed-script';
        
        // Mark as modified and save
        settings.markModified('globalHub');
        await settings.save();
        
        console.log('✅ First names saved successfully!');
        console.log(`📊 Sample names: ${normalizedNames.slice(0, 10).join(', ')}...`);
        
    } catch (error) {
        console.error('❌ Error seeding first names:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    seedFirstNames().then(() => {
        console.log('🎉 Seeding complete!');
        process.exit(0);
    });
}

module.exports = { FIRST_NAMES, seedFirstNames };
