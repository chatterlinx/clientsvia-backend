/**
 * Knowledge Base Auto-Population Service
 * Automatically extracts and organizes knowledge from business sources
 */

const axios = require('axios');
const cheerio = require('cheerio');
const Company = require('../models/Company');

class KnowledgeAutoPopulationService {
    
    /**
     * Auto-populate knowledge base from business website
     */
    static async autoPopulateFromWebsite(companyId, websiteUrl) {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            // Extract content from website
            const extractedContent = await this.extractWebsiteContent(websiteUrl);
            
            // Generate Q&A entries from content
            const qaPairs = await this.generateQAFromContent(extractedContent, company);
            
            // Categorize and organize
            const organizedKnowledge = await this.organizeKnowledge(qaPairs);
            
            return {
                success: true,
                knowledgeEntries: organizedKnowledge,
                extractedSections: extractedContent.sections,
                suggestedCategories: extractedContent.categories
            };
        } catch (error) {
            console.error('Auto-population failed:', error);
            throw error;
        }
    }

    /**
     * Extract content from business website
     */
    static async extractWebsiteContent(url) {
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ClientsVia-Bot/1.0)'
                }
            });

            const $ = cheerio.load(response.data);
            
            const content = {
                title: $('title').text(),
                description: $('meta[name="description"]').attr('content') || '',
                sections: [],
                categories: [],
                contactInfo: {}
            };

            // Extract main sections
            $('h1, h2, h3').each((i, elem) => {
                const heading = $(elem).text().trim();
                const nextContent = $(elem).nextUntil('h1, h2, h3').text().trim();
                
                if (heading && nextContent) {
                    content.sections.push({
                        heading,
                        content: nextContent.substring(0, 500) // Limit length
                    });
                }
            });

            // Extract contact information
            const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            
            const pageText = $('body').text();
            const phones = pageText.match(phoneRegex) || [];
            const emails = pageText.match(emailRegex) || [];
            
            content.contactInfo = {
                phones: [...new Set(phones)].slice(0, 3),
                emails: [...new Set(emails)].slice(0, 2)
            };

            // Extract business hours
            const hoursText = pageText.toLowerCase();
            const hoursKeywords = ['hours', 'open', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const hoursMatch = hoursKeywords.find(keyword => hoursText.includes(keyword));
            if (hoursMatch) {
                const hoursSection = this.extractBusinessHours(pageText);
                if (hoursSection) {
                    content.businessHours = hoursSection;
                }
            }

            return content;
        } catch (error) {
            console.error('Website extraction failed:', error);
            return {
                sections: [],
                categories: [],
                contactInfo: {},
                error: 'Failed to extract website content'
            };
        }
    }

    /**
     * Generate Q&A pairs from extracted content
     */
    static async generateQAFromContent(content, company) {
        const qaPairs = [];

        // Generate basic Q&As
        if (content.contactInfo.phones.length > 0) {
            qaPairs.push({
                question: "What's your phone number?",
                answer: `You can reach us at ${content.contactInfo.phones[0]}.`,
                keywords: ["phone", "number", "call", "contact"],
                category: "contact",
                confidence: 0.95
            });
        }

        if (content.businessHours) {
            qaPairs.push({
                question: "What are your business hours?",
                answer: content.businessHours,
                keywords: ["hours", "open", "time", "when"],
                category: "hours",
                confidence: 0.9
            });
        }

        // Generate Q&As from sections
        content.sections.forEach(section => {
            if (section.content.length > 50) {
                const qa = this.generateQAFromSection(section);
                if (qa) {
                    qaPairs.push(qa);
                }
            }
        });

        // Add common business Q&As based on company type
        const commonQAs = this.getCommonQAsByBusinessType(company.selectedCategories || []);
        qaPairs.push(...commonQAs);

        return qaPairs;
    }

    /**
     * Generate Q&A from a content section
     */
    static generateQAFromSection(section) {
        const heading = section.heading.toLowerCase();
        const content = section.content;

        // Services section
        if (heading.includes('service') || heading.includes('what we do')) {
            return {
                question: "What services do you offer?",
                answer: content.substring(0, 300) + (content.length > 300 ? '...' : ''),
                keywords: ["services", "offer", "do", "provide"],
                category: "services",
                confidence: 0.8
            };
        }

        // About section
        if (heading.includes('about') || heading.includes('who we are')) {
            return {
                question: "Tell me about your company",
                answer: content.substring(0, 300) + (content.length > 300 ? '...' : ''),
                keywords: ["about", "company", "who", "what"],
                category: "about",
                confidence: 0.7
            };
        }

        // Location section
        if (heading.includes('location') || heading.includes('address') || heading.includes('where')) {
            return {
                question: "Where are you located?",
                answer: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
                keywords: ["location", "address", "where", "directions"],
                category: "location",
                confidence: 0.8
            };
        }

        return null;
    }

    /**
     * Get common Q&As based on business type
     */
    static getCommonQAsByBusinessType(categories) {
        const commonQAs = [];

        if (categories.includes('restaurants') || categories.includes('food-service')) {
            commonQAs.push(
                {
                    question: "Do you take reservations?",
                    answer: "Yes, we accept reservations. You can call us or book online.",
                    keywords: ["reservation", "book", "table"],
                    category: "reservations",
                    confidence: 0.7
                },
                {
                    question: "Do you offer delivery?",
                    answer: "Please contact us to inquire about delivery options in your area.",
                    keywords: ["delivery", "deliver", "bring"],
                    category: "delivery",
                    confidence: 0.6
                }
            );
        }

        if (categories.includes('hvac') || categories.includes('plumbing') || categories.includes('home-services')) {
            commonQAs.push(
                {
                    question: "Do you offer emergency service?",
                    answer: "Yes, we provide 24/7 emergency service. Please call us immediately for urgent issues.",
                    keywords: ["emergency", "urgent", "24/7", "immediate"],
                    category: "emergency",
                    confidence: 0.8
                },
                {
                    question: "Do you provide free estimates?",
                    answer: "Yes, we offer free estimates for most services. Contact us to schedule an evaluation.",
                    keywords: ["estimate", "quote", "cost", "price"],
                    category: "pricing",
                    confidence: 0.7
                }
            );
        }

        if (categories.includes('healthcare') || categories.includes('medical')) {
            commonQAs.push(
                {
                    question: "What insurance do you accept?",
                    answer: "We accept most major insurance plans. Please call to verify your specific coverage.",
                    keywords: ["insurance", "coverage", "accept", "plans"],
                    category: "insurance",
                    confidence: 0.8
                }
            );
        }

        return commonQAs;
    }

    /**
     * Organize knowledge into categories
     */
    static async organizeKnowledge(qaPairs) {
        const organized = {
            categories: {},
            suggestions: [],
            duplicates: [],
            lowConfidence: []
        };

        qaPairs.forEach(qa => {
            const category = qa.category || 'general';
            
            if (!organized.categories[category]) {
                organized.categories[category] = [];
            }

            if (qa.confidence < 0.7) {
                organized.lowConfidence.push(qa);
            } else {
                organized.categories[category].push(qa);
            }
        });

        // Detect potential duplicates
        organized.duplicates = this.detectDuplicateQAs(qaPairs);
        
        // Generate suggestions for improvement
        organized.suggestions = this.generateKnowledgeImprovementSuggestions(organized);

        return organized;
    }

    /**
     * Detect duplicate Q&As
     */
    static detectDuplicateQAs(qaPairs) {
        const duplicates = [];
        
        for (let i = 0; i < qaPairs.length; i++) {
            for (let j = i + 1; j < qaPairs.length; j++) {
                const similarity = this.calculateSimilarity(qaPairs[i].question, qaPairs[j].question);
                if (similarity > 0.8) {
                    duplicates.push({
                        qa1: qaPairs[i],
                        qa2: qaPairs[j],
                        similarity
                    });
                }
            }
        }
        
        return duplicates;
    }

    /**
     * Calculate similarity between two strings
     */
    static calculateSimilarity(str1, str2) {
        const words1 = str1.toLowerCase().split(' ');
        const words2 = str2.toLowerCase().split(' ');
        const intersection = words1.filter(word => words2.includes(word));
        const union = [...new Set([...words1, ...words2])];
        return intersection.length / union.length;
    }

    /**
     * Extract business hours from text
     */
    static extractBusinessHours(text) {
        const hoursPatterns = [
            /(?:hours?|open):?\s*([^.!?]*(?:am|pm|AM|PM)[^.!?]*)/i,
            /(mon|tue|wed|thu|fri|sat|sun)[^.!?]*(?:am|pm|AM|PM)[^.!?]*/i
        ];

        for (const pattern of hoursPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[0].trim();
            }
        }

        return null;
    }

    /**
     * Generate suggestions for knowledge improvement
     */
    static generateKnowledgeImprovementSuggestions(organized) {
        const suggestions = [];

        // Check for missing categories
        const essentialCategories = ['contact', 'hours', 'services', 'pricing'];
        essentialCategories.forEach(category => {
            if (!organized.categories[category] || organized.categories[category].length === 0) {
                suggestions.push({
                    type: 'missing_category',
                    message: `Consider adding Q&As about ${category}`,
                    priority: 'medium'
                });
            }
        });

        // Check for low confidence entries
        if (organized.lowConfidence.length > 0) {
            suggestions.push({
                type: 'low_confidence',
                message: `${organized.lowConfidence.length} entries need review for accuracy`,
                priority: 'high'
            });
        }

        // Check for duplicates
        if (organized.duplicates.length > 0) {
            suggestions.push({
                type: 'duplicates',
                message: `${organized.duplicates.length} potential duplicate entries found`,
                priority: 'medium'
            });
        }

        return suggestions;
    }

    /**
     * Bulk import from various sources
     */
    static async bulkImport(companyId, source, data) {
        try {
            let qaPairs = [];

            switch (source) {
                case 'csv':
                    qaPairs = this.parseCSVData(data);
                    break;
                case 'json':
                    qaPairs = this.parseJSONData(data);
                    break;
                case 'existing_faq':
                    qaPairs = this.parseExistingFAQ(data);
                    break;
                default:
                    throw new Error('Unsupported import source');
            }

            const organized = await this.organizeKnowledge(qaPairs);
            
            return {
                success: true,
                imported: qaPairs.length,
                organized: organized
            };
        } catch (error) {
            console.error('Bulk import failed:', error);
            throw error;
        }
    }

    static parseCSVData(csvData) {
        const lines = csvData.split('\n');
        const headers = lines[0].split(',');
        const qaPairs = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length >= 2) {
                qaPairs.push({
                    question: values[0]?.trim(),
                    answer: values[1]?.trim(),
                    keywords: values[2] ? values[2].split(';').map(k => k.trim()) : [],
                    category: values[3]?.trim() || 'general',
                    confidence: 0.8
                });
            }
        }

        return qaPairs;
    }

    static parseJSONData(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            return Array.isArray(data) ? data : [data];
        } catch (error) {
            throw new Error('Invalid JSON format');
        }
    }

    static parseExistingFAQ(faqData) {
        // Parse existing FAQ formats
        return faqData.map(item => ({
            question: item.question,
            answer: item.answer,
            keywords: item.keywords || [],
            category: item.category || 'general',
            confidence: 0.9
        }));
    }
}

module.exports = KnowledgeAutoPopulationService;
