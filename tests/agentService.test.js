const { getDB } = require('../db');
const KnowledgeEntry = require('../models/KnowledgeEntry');
jest.mock('../clients', () => ({ redisClient: {}, pinecone: {}, getPineconeIndex: jest.fn() }));

jest.mock('googleapis', () => {
  return {
    google: {
      auth: {
        GoogleAuth: jest.fn().mockImplementation(() => ({
          getClient: jest.fn().mockResolvedValue('client'),
          getProjectId: jest.fn().mockResolvedValue('proj')
        }))
      },
      aiplatform: jest.fn().mockReturnValue({
        projects: {
          locations: {
            publishers: {
              models: {
                generateContent: jest.fn().mockResolvedValue({
                  data: {
                    candidates: [
                      { content: { parts: [{ text: 'mock response' }] } }
                    ]
                  }
                })
              }
            }
          }
        }
      })
    }
  };
});
jest.mock("@google-cloud/vertexai", () => ({ VertexAI: jest.fn().mockImplementation(() => ({ previewModel: () => ({ generateContent: jest.fn().mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: "mock response" }] } }] } }) }) })) }));

jest.mock('../db');
jest.mock('../models/KnowledgeEntry');
jest.mock('../models/SuggestedKnowledgeEntry');

const { answerQuestion } = require('../services/agent');

describe('answerQuestion', () => {
  const companyId = '507f191e810c19729de860ac';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns knowledge entry answer when found', async () => {
    const mockDB = {
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          agentSetup: { categories: ['cat1', 'cat2'] },
          aiSettings: { llmFallbackEnabled: true }
        })
      })
    };
    getDB.mockReturnValue(mockDB);

    KnowledgeEntry.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ answer: 'stored answer' })
    });

    const answer = await answerQuestion(companyId, 'sample');
    expect(answer.text).toBe('stored answer');
    expect(answer.escalate).toBe(false);
    expect(KnowledgeEntry.findOne).toHaveBeenCalledWith(expect.objectContaining({ companyId }));
    expect(KnowledgeEntry.findOne).toHaveBeenCalledTimes(1);
  });

  test('falls back to model when no entry found', async () => {
    const mockDB = {
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ agentSetup: { categories: [] }, aiSettings: { llmFallbackEnabled: true } })
      })
    };
    getDB.mockReturnValue(mockDB);

    KnowledgeEntry.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null)
    });

    const answer = await answerQuestion(companyId, 'hello');
    expect(answer.text).toBe('mock response');
    expect(answer.escalate).toBe(false);
  });

  test('retries model call when generateContent fails initially', async () => {
    const { google } = require('googleapis');
    const generateMock =
      google
        .aiplatform()
        .projects.locations.publishers.models.generateContent;

    generateMock.mockRejectedValueOnce({ response: { status: 404 } });
    generateMock.mockResolvedValueOnce({
      data: { candidates: [{ content: { parts: [{ text: 'retry text' }] } }] }
    });

    const mockDB = {
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ agentSetup: { categories: [] }, aiSettings: { llmFallbackEnabled: true } })
      })
    };
    getDB.mockReturnValue(mockDB);

    KnowledgeEntry.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null)
    });

    const answer = await answerQuestion(companyId, 'hi');
    expect(answer.text).toBe('retry text');
    expect(answer.escalate).toBe(false);
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  test('falls back to model when category Q&A has match', async () => {
    const { google } = require('googleapis');
    const generateMock =
      google
        .aiplatform()
        .projects.locations.publishers.models.generateContent;

    const mockDB = {
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          _id: '507f191e810c19729de860ac',
          agentSetup: {
            categories: [],
            categoryQAs: 'Q: Hello\nA: Hi there'
          },
          aiSettings: { llmFallbackEnabled: true }
        })
      })
    };
    getDB.mockReturnValue(mockDB);

    KnowledgeEntry.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null)
    });

    const answer = await answerQuestion(companyId, 'Hello');
    expect(answer.text).toBe('mock response');
    expect(answer.escalate).toBe(false);
    expect(generateMock).toHaveBeenCalled();
  });
});
