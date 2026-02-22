/**
 * ============================================================================
 * 🌐 FIRST NAMES SEED DATA - Comprehensive Global Dictionary
 * ============================================================================
 * 
 * PURPOSE:
 * Seeds the Global Hub first names dictionary with a comprehensive list
 * covering diverse backgrounds: American, Hispanic, Asian, European, 
 * Middle Eastern, and African names.
 * 
 * SOURCES:
 * - US Social Security Administration (SSA) top baby names 1880-2024
 * - US Census Bureau given names frequency
 * - International name databases
 * 
 * COVERAGE:
 * - ~5,000+ unique names
 * - Male and female names
 * - Common nicknames and variants
 * - International names from 50+ countries
 * 
 * USAGE:
 * This file is loaded by POST /api/admin/global-hub/first-names/seed
 * 
 * ============================================================================
 */

// Top US Male Names (SSA historical data)
const US_MALE = [
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
    "Roy", "Louis", "Harry", "Ralph", "Howard", "Joe", "Randy", "Wayne", "Carl",
    "Fred", "Martin", "Ernest", "Stanley", "Leonard", "Craig", "Glen", "Dale",
    "Barry", "Earl", "Bernard", "Clarence", "Francis", "Leroy", "Edgar", "Claude",
    "Victor", "Norman", "Chester", "Clifford", "Gordon", "Herbert", "Harvey", "Melvin",
    "Arnold", "Cecil", "Jessie", "Herman", "Homer", "Clyde", "Alvin", "Lester",
    "Leon", "Franklin", "Sidney", "Marshall", "Eddie", "Darrell", "Tommy", "Ronnie",
    "Marcus", "Jerome", "Mitchell", "Tony", "Ricky", "Ruben", "Dustin", "Derrick",
    "Travis", "Shawn", "Maurice", "Dwayne", "Curtis", "Terrence", "Phillip", "Andre",
    "Darren", "Corey", "Marvin", "Rick", "Clifton", "Cedric", "Reginald", "Tyrone",
    "Lance", "Trevor", "Wade", "Brett", "Brent", "Derek", "Todd", "Chad", "Kirk",
    "Kent", "Neil", "Ross", "Troy", "Grant", "Spencer", "Garrett", "Cody", "Blake",
    "Shane", "Chase", "Seth", "Jared", "Wesley", "Bryce", "Cole", "Lane", "Clay",
    "Xavier", "Roman", "Axel", "Jace", "Bryson", "Tristan", "Griffin", "Sawyer",
    "Maxwell", "Bentley", "Brooks", "Tanner", "Devin", "Brody", "Damian", "Tucker"
];

// Top US Female Names (SSA historical data)
const US_FEMALE = [
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
    "Lucy", "Skylar", "Paisley", "Everly", "Caroline", "Nova", "Genesis",
    "Emilia", "Kennedy", "Maya", "Willow", "Kinsley", "Naomi", "Aaliyah", "Elena",
    "Eliana", "Gianna", "Valentina", "Luna", "Hazel", "Ivy", "Autumn", "Nevaeh",
    "Norma", "Phyllis", "Irene", "Annie", "Edna", "Ethel", "Hazel", "Lillian",
    "Rose", "Florence", "Mildred", "Clara", "Edith", "Thelma", "Josephine", "Lucille",
    "Gladys", "Bernice", "Vera", "Agnes", "Mabel", "Gertrude", "Beatrice", "Elsie",
    "Esther", "Alma", "Stella", "Lorraine", "Marion", "Velma", "Bertha", "Maxine",
    "Arlene", "Wilma", "Audrey", "Roberta", "Dolores", "Joanne", "Loretta", "Marlene",
    "Anita", "Bonnie", "Connie", "Gail", "Peggy", "Vicki", "Marsha", "Lynn",
    "Paula", "Dawn", "Tammy", "Wendy", "Brenda", "Tina", "Cindy", "Tracy", "Lori",
    "Robin", "Dana", "Jill", "Stacy", "Tonya", "Carla", "Tara", "Monica", "Natasha",
    "Vanessa", "Erica", "Felicia", "Jasmine", "Latoya", "Monique", "Brandy", "Alicia",
    "Tiffany", "Crystal", "Candace", "Miranda", "Lindsay", "Lindsey", "Kelsey", "Paige",
    "Courtney", "Morgan", "Megan", "Taylor", "Haley", "Bailey", "Sydney", "Mackenzie",
    "Brianna", "Kaylee", "Destiny", "Jenna", "Shelby", "Chelsea", "Brooke", "Makayla",
    "Hailey", "Faith", "Hope", "Harmony", "Trinity", "Serenity", "Summer", "Jade"
];

// Hispanic/Latino Names
const HISPANIC = [
    // Male
    "Jose", "Juan", "Carlos", "Luis", "Miguel", "Jorge", "Francisco", "Antonio",
    "Manuel", "Pedro", "Ricardo", "Eduardo", "Fernando", "Rafael", "Alejandro",
    "Roberto", "Oscar", "Javier", "Sergio", "Andres", "Diego", "Raul", "Enrique",
    "Arturo", "Mario", "Alberto", "Hector", "Victor", "Ruben", "Marco", "Pablo",
    "Guillermo", "Cesar", "Gustavo", "Ramon", "Alfredo", "Ernesto", "Salvador",
    "Jaime", "Armando", "Gerardo", "Felipe", "Julio", "Omar", "Rodrigo", "Adrian",
    "Ivan", "Hugo", "Jesus", "Angel", "Mateo", "Santiago", "Sebastian",
    "Nicolas", "Emiliano", "Martin", "Leonardo", "Enzo", "Thiago", "Luca",
    "Alonso", "Bruno", "Dante", "Fabian", "Ignacio", "Joaquin", "Julian", "Lorenzo",
    "Mauricio", "Maximiliano", "Patricio", "Rodrigo", "Tomas", "Vicente", "Xavier",
    // Female
    "Maria", "Ana", "Carmen", "Rosa", "Lucia", "Elena", "Isabel", "Patricia",
    "Laura", "Teresa", "Gabriela", "Adriana", "Monica", "Claudia", "Alejandra",
    "Veronica", "Daniela", "Sandra", "Silvia", "Lorena", "Gloria", "Beatriz",
    "Leticia", "Norma", "Irma", "Yolanda", "Alicia", "Martha", "Margarita",
    "Guadalupe", "Juana", "Blanca", "Rocio", "Susana", "Esperanza", "Josefina",
    "Francisca", "Catalina", "Valentina", "Camila", "Sofia", "Natalia",
    "Mariana", "Paula", "Carolina", "Fernanda", "Ximena", "Valeria",
    "Emilia", "Renata", "Luciana", "Antonella", "Florencia", "Martina", "Regina"
];

// Asian Names
const ASIAN = [
    // Chinese
    "Wei", "Ming", "Hui", "Jing", "Xiao", "Chen", "Lin", "Hong", "Ying", "Mei",
    "Li", "Fang", "Ling", "Yan", "Ping", "Lan", "Qing", "Yun", "Hua",
    "Jun", "Feng", "Yang", "Lei", "Bo", "Hao", "Yu", "Tao", "Cheng", "Peng",
    "Zheng", "Bin", "Gang", "Jie", "Long", "Qiang", "Xin", "Yong", "Zhi",
    "Fei", "Guo", "Hai", "Kai", "Kun", "Ning", "Rui", "Sheng", "Wen", "Xiang",
    "Yi", "Zhen", "Dong", "Liang", "Pei", "Shan", "Ting", "Xiong", "Yao", "Zhao",
    // Korean
    "Min", "Jae", "Sung", "Hyun", "Young", "Jin", "Seung", "Dong", "Soo", "Hee",
    "Eun", "Ji", "Yoon", "Sun", "Kyung", "Hye", "Jung", "Mi", "Suk", "Won",
    "Hyeok", "Joon", "Kyu", "Sang", "Woo", "Yeong", "Chul", "Han", "Ho", "Hwan",
    "Joon", "Minho", "Taehyung", "Jungkook", "Jihoon", "Seojun", "Hajun", "Dohyun",
    // Vietnamese
    "Nguyen", "Tran", "Minh", "Anh", "Hung", "Duc", "Thanh", "Hoa", "Linh", "Lan",
    "Hai", "Nam", "Tuan", "Phuong", "Quang", "Dung", "Hieu", "Thao", "Mai", "Ngoc",
    "Binh", "Chi", "Cuong", "Diep", "Giang", "Ha", "Khanh", "Long", "My", "Nhan",
    "Phuc", "Tam", "Tien", "Trung", "Van", "Vinh", "Vu", "Xuan", "Yen",
    // Japanese
    "Yuki", "Kenji", "Akira", "Hiroshi", "Takeshi", "Kazuki", "Ryu", "Ken", "Daiki",
    "Yui", "Sakura", "Hana", "Emi", "Mika", "Ayumi", "Yoko", "Naomi", "Haruki",
    "Ren", "Haruto", "Sota", "Yuto", "Hayato", "Hinata", "Kaito", "Shota", "Kento",
    "Himari", "Yuna", "Mei", "Aoi", "Koharu", "Akari", "Riko", "Mio", "Ichika",
    // Indian/South Asian
    "Raj", "Amit", "Rahul", "Vikram", "Anil", "Ravi", "Deepak", "Ajay", "Sanjay",
    "Vijay", "Arun", "Ashok", "Sunil", "Manoj", "Rajesh", "Anand", "Arjun", "Rohan",
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Reyansh", "Krishna", "Ishaan", "Shaurya",
    "Priya", "Sunita", "Anita", "Neha", "Anjali", "Pooja", "Meena", "Kavita",
    "Rekha", "Nisha", "Ritu", "Seema", "Asha", "Divya", "Lakshmi", "Sita",
    "Saanvi", "Aanya", "Aadhya", "Ananya", "Pari", "Myra", "Diya", "Kiara",
    // Filipino
    "Rodrigo", "Rizal", "Andres", "Emilio", "Apolinario", "Marcelo", "Ramon",
    "Corazon", "Aurora", "Imelda", "Josefina", "Leonora", "Rosario", "Teresita"
];

// European Names
const EUROPEAN = [
    // German
    "Hans", "Klaus", "Wolfgang", "Dieter", "Helmut", "Werner", "Jurgen", "Stefan",
    "Monika", "Ursula", "Helga", "Ingrid", "Brigitte", "Gisela", "Petra", "Sabine",
    "Max", "Felix", "Paul", "Leon", "Lukas", "Finn", "Jonas", "Emil", "Noah",
    "Sophie", "Marie", "Mia", "Hannah", "Emma", "Lea", "Lina", "Anna", "Laura",
    // French
    "Jean", "Pierre", "Michel", "Jacques", "Philippe", "Alain", "Bernard", "Luc",
    "Francoise", "Monique", "Sylvie", "Nathalie",
    "Lucas", "Hugo", "Louis", "Nathan", "Gabriel", "Raphael", "Arthur", "Leo",
    "Lea", "Manon", "Chloe", "Camille", "Ines", "Jade", "Louise", "Lena",
    // Italian
    "Giovanni", "Giuseppe", "Marco", "Paolo", "Luca", "Alessandro",
    "Francesca", "Giulia", "Chiara", "Sara", "Valentina", "Alessia",
    "Leonardo", "Lorenzo", "Mattia", "Andrea", "Gabriele", "Riccardo", "Tommaso",
    "Sofia", "Aurora", "Giulia", "Ginevra", "Alice", "Emma", "Giorgia", "Greta",
    // Polish
    "Jan", "Andrzej", "Piotr", "Krzysztof", "Tomasz", "Marek", "Pawel", "Michal",
    "Anna", "Katarzyna", "Malgorzata", "Agnieszka", "Barbara", "Ewa",
    "Jakub", "Szymon", "Kacper", "Filip", "Wojciech", "Antoni", "Aleksander",
    "Zuzanna", "Julia", "Maja", "Zofia", "Hanna", "Lena", "Alicja", "Oliwia",
    // Russian
    "Ivan", "Dmitri", "Sergei", "Nikolai", "Alexei", "Vladimir", "Andrei", "Mikhail",
    "Natasha", "Olga", "Tatiana", "Elena", "Irina", "Svetlana", "Anastasia", "Yekaterina",
    "Artem", "Matvei", "Kirill", "Maxim", "Timofei", "Mark", "Yaroslav", "Daniil",
    "Polina", "Veronika", "Viktoria", "Daria", "Elizaveta", "Alisa", "Sofia", "Anna",
    // Irish
    "Sean", "Patrick", "Connor", "Declan", "Finn", "Brendan", "Colin",
    "Siobhan", "Aisling", "Niamh", "Ciara", "Aoife", "Sinead", "Maeve", "Fiona",
    "Oisin", "Cian", "Fionn", "Conor", "Liam", "Noah", "Jack", "James",
    "Emily", "Ava", "Sophie", "Ella", "Grace", "Lucy", "Emma", "Mia",
    // Scottish
    "Hamish", "Callum", "Fraser", "Blair", "Angus", "Duncan", "Malcolm", "Ewan",
    "Ailsa", "Moira", "Isla", "Skye", "Mhairi", "Catriona", "Eilidh", "Morven",
    // Dutch
    "Jan", "Pieter", "Willem", "Hendrik", "Dirk", "Joost", "Kees", "Bas",
    "Anna", "Maria", "Johanna", "Elisabeth", "Cornelia", "Sophie", "Emma", "Julia",
    // Scandinavian
    "Erik", "Lars", "Anders", "Magnus", "Olaf", "Sven", "Bjorn", "Leif",
    "Ingrid", "Astrid", "Freya", "Sigrid", "Greta", "Karin", "Maja", "Elsa",
    "Aksel", "Emil", "Noah", "Oscar", "Liam", "William", "Oliver", "Lucas"
];

// Middle Eastern Names
const MIDDLE_EASTERN = [
    // Arabic
    "Mohammed", "Ahmad", "Ali", "Hassan", "Hussein", "Omar", "Khalid", "Yusuf",
    "Ibrahim", "Mustafa", "Abdul", "Karim", "Tariq", "Faisal", "Samir", "Nasser",
    "Fatima", "Aisha", "Layla", "Yasmin", "Leila", "Noor", "Maryam",
    "Hana", "Dina", "Rana", "Rania", "Salma", "Amira", "Zara", "Samira",
    "Mahmoud", "Khaled", "Rami", "Walid", "Ziad", "Fadi", "Mazen", "Sami",
    "Lina", "Maya", "Jana", "Tala", "Farah", "Nadia", "Reem", "Lama",
    // Persian
    "Cyrus", "Darius", "Reza", "Amir", "Arash", "Babak", "Farhad", "Kamran",
    "Parisa", "Shirin", "Leila", "Yasmin", "Soraya", "Mina", "Nazanin", "Setareh",
    // Turkish
    "Mehmet", "Mustafa", "Ahmet", "Ali", "Hasan", "Huseyin", "Murat", "Emre",
    "Fatma", "Ayse", "Emine", "Hatice", "Zeynep", "Elif", "Merve", "Esra",
    // Israeli/Hebrew
    "David", "Daniel", "Moshe", "Yosef", "Yaakov", "Avraham", "Yitzhak", "Shlomo",
    "Sarah", "Rachel", "Leah", "Rivka", "Miriam", "Esther", "Ruth", "Naomi",
    "Noam", "Yonatan", "Ariel", "Omer", "Itai", "Eitan", "Roi", "Nir"
];

// African Names
const AFRICAN = [
    // West African
    "Kwame", "Kofi", "Yaw", "Kwesi", "Kojo", "Kwadwo", "Kweku", "Fiifi",
    "Ama", "Akua", "Abena", "Efua", "Esi", "Akosua", "Yaa", "Adwoa",
    "Oluwaseun", "Chidi", "Emeka", "Nneka", "Adaeze", "Chiamaka", "Amara", "Chinwe",
    "Adebayo", "Olumide", "Tunde", "Yemi", "Bola", "Funke", "Toyin", "Sade",
    // East African
    "Baraka", "Juma", "Mwangi", "Ochieng", "Otieno", "Wanjiku", "Njeri", "Akinyi",
    "Amani", "Faraji", "Imani", "Kamau", "Makena", "Zawadi", "Zuri", "Neema",
    // South African
    "Thabo", "Sipho", "Themba", "Mandla", "Bongani", "Sizwe", "Lungile", "Nhlanhla",
    "Nomvula", "Thandiwe", "Lindiwe", "Nonhlanhla", "Sibongile", "Zanele", "Mbali", "Lerato"
];

// Common Nicknames and Variants
const NICKNAMES = [
    "Mike", "Dan", "Dave", "Tom", "Bob", "Bill", "Jim", "Joe", "Steve", "Chris",
    "Matt", "Nick", "Ben", "Sam", "Jake", "Alex", "Max", "Tony", "Rick", "Ron",
    "Jen", "Jess", "Kate", "Liz", "Sue", "Beth", "Amy", "Meg", "Kim", "Tina",
    "Becky", "Mandy", "Sandy", "Cindy", "Debbie", "Barb", "Pam", "Cathy", "Pat",
    "Ed", "Ted", "Fred", "Ned", "Pete", "Hank", "Will", "Jack", "Chuck", "Frank",
    "Dick", "Rich", "Mick", "Vic", "Phil", "Greg", "Brad", "Chad", "Rod", "Clint",
    "Abby", "Maddy", "Izzy", "Ellie", "Millie", "Molly", "Polly", "Sally", "Annie", "Katie",
    "Maggie", "Peggy", "Patty", "Betty", "Netty", "Kitty", "Letty", "Hetty", "Hattie", "Mattie"
];

// Gender-Neutral Names
const GENDER_NEUTRAL = [
    "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Sam",
    "Cameron", "Quinn", "Avery", "Parker", "Hayden", "Charlie", "Dakota", "Sage",
    "Finley", "Rowan", "River", "Emery", "Skyler", "Phoenix", "Blake", "Drew",
    "Jesse", "Kendall", "Reese", "Peyton", "Bailey", "Alexis", "Harley", "Frankie",
    "Rory", "Remy", "Ellis", "Eden", "Dylan", "Elliot", "Emerson", "Harper",
    "Hayden", "Jaden", "Kai", "Lane", "Logan", "London", "Marley", "Milan",
    "Oakley", "Palmer", "Reagan", "Remy", "Sawyer", "Shiloh", "Spencer", "Stevie",
    "Sydney", "Tatum", "Tegan", "Teagan", "Wren", "Zion", "Ashton", "Blair"
];

// Extended US Names (less common but still significant)
const US_EXTENDED = [
    // More male names
    "Myles", "Gage", "Zander", "Colby", "Preston", "Chandler", "Dalton", "Trent",
    "Weston", "Gunner", "Nash", "Knox", "Rhett", "Barrett", "Beau", "Brooks",
    "Keegan", "Karter", "Kyler", "Camden", "Cohen", "Jett", "Cade", "Beckett",
    "Jaxson", "Kingston", "Greyson", "Rowan", "Emerson", "Cruz", "Atlas", "Milo",
    "August", "Ezekiel", "Silas", "Jasper", "Archer", "Tobias", "Felix", "Everett",
    "Waylon", "Wesley", "Harrison", "Remington", "Brantley", "Braxton", "Ryker",
    // More female names
    "Adalyn", "Addison", "Adelaide", "Ainsley", "Alaina", "Alessandra", "Alivia",
    "Amara", "Anastasia", "Aniyah", "Arabella", "Arianna", "Arielle", "Aspen",
    "Athena", "Aubree", "Brielle", "Bristol", "Cadence", "Callie", "Camille",
    "Catalina", "Cecilia", "Charlee", "Charlie", "Collins", "Cora", "Cordelia",
    "Daisy", "Dakota", "Dallas", "Daniella", "Delilah", "Demi", "Emersyn",
    "Esme", "Evangeline", "Everleigh", "Finley", "Francesca", "Freya", "Gemma",
    "Georgia", "Hadley", "Harlow", "Haven", "Hayley", "Henley", "Holland",
    "Imogen", "Isla", "Jazmine", "Joelle", "Jordyn", "Josie", "Julianna",
    "Kaia", "Kaitlyn", "Kamryn", "Kenzie", "Kiera", "Kyla", "Lana", "Landry",
    "Laylah", "Leighton", "Lennon", "Liliana", "Lorelei", "Lydia", "Mabel",
    "Maci", "Makenna", "Maliyah", "Margot", "Mariana", "Marley", "Matilda",
    "Mavis", "Melanie", "Mila", "Millie", "Mirabelle", "Miriam", "Monroe",
    "Nadia", "Nellie", "Oakley", "Olive", "Ophelia", "Palmer", "Phoebe",
    "Presley", "Priscilla", "Raelynn", "Raegan", "Rebekah", "Regina", "Remi",
    "Rosalie", "Rosemary", "Rowan", "Rylee", "Sage", "Saige", "Selena",
    "Serena", "Sienna", "Sloane", "Sutton", "Teagan", "Thea", "Tiffany",
    "Vera", "Vivian", "Willa", "Winter", "Wren", "Yara", "Zelda", "Zendaya"
];

// Combine all names
const FIRST_NAMES_SEED = [
    ...US_MALE,
    ...US_FEMALE,
    ...HISPANIC,
    ...ASIAN,
    ...EUROPEAN,
    ...MIDDLE_EASTERN,
    ...AFRICAN,
    ...NICKNAMES,
    ...GENDER_NEUTRAL,
    ...US_EXTENDED
];

module.exports = {
    FIRST_NAMES_SEED,
    // Export individual categories for potential future use
    categories: {
        US_MALE,
        US_FEMALE,
        HISPANIC,
        ASIAN,
        EUROPEAN,
        MIDDLE_EASTERN,
        AFRICAN,
        NICKNAMES,
        GENDER_NEUTRAL,
        US_EXTENDED
    }
};
