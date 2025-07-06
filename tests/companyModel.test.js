jest.mock('../clients', () => ({ redisClient: {}, pinecone: {}, getPineconeIndex: jest.fn() }));
const Company = require('../models/Company');

describe('Company Model', () => {
  test('requires companyName', () => {
    const company = new Company();
    const error = company.validateSync();
    expect(error.errors.companyName).toBeDefined();
  });

  test('applies default timezone', () => {
    const company = new Company({
      companyName: 'Test Co',
      ownerName: 'Owner',
      ownerEmail: 'owner@example.com',
      contactPhone: '555-1111'
    });
    expect(company.timezone).toBe('America/New_York');
    expect(company.agentSetup.greetingType).toBe('tts');
  });
});
