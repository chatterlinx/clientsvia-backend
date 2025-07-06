const request = require('supertest');
const express = require('express');

jest.resetModules();
jest.mock('../models/Company');
jest.mock('../services/agent', () => ({
  answerQuestion: jest.fn(),
  loadCompanyQAs: jest.fn()
}));
jest.mock('../models/KnowledgeEntry');
jest.mock('../utils/aiAgent', () => ({
  findCachedAnswer: jest.fn()
}));
jest.mock('../utils/personalityResponses', () => ({
  getRandomPersonalityResponse: jest.fn().mockResolvedValue('hi'),
  fetchCompanyResponses: jest.fn().mockResolvedValue({})
}));
const mockRedis = {
  get: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn()
};
jest.mock('../clients', () => ({ redisClient: mockRedis }));

const twilioRoutes = require('../routes/twilio');
const Company = require('../models/Company');
const KnowledgeEntry = require('../models/KnowledgeEntry');
const { answerQuestion } = require('../services/agent');
const { redisClient } = require('../clients');
const { findCachedAnswer } = require('../utils/aiAgent');

describe('Twilio Voice Route', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/twilio', twilioRoutes);

  const greeting = 'Hello from Test Co';
  const fallback =
    'Welcome to ClientsVia. We are unable to connect you to the company. Please try another number or try again later.';

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.get.mockResolvedValue(null);
    redisClient.setEx.mockResolvedValue(null);
    redisClient.del.mockResolvedValue(null);
    redisClient.incr.mockResolvedValue(1);
    redisClient.expire.mockResolvedValue(null);
    KnowledgeEntry.find.mockResolvedValue([]);
    findCachedAnswer.mockReturnValue(null);
  });

  test('returns company greeting when phone number matches', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: '1',
        twilioConfig: { phoneNumber: '+15551234567' },
        agentSetup: { agentGreeting: greeting }
      })
    });

    const res = await request(app)
      .post('/api/twilio/voice')
      .send({ To: '+15551234567' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    expect(res.text).toMatch(new RegExp(`<Gather[^>]*>.*${greeting}.*<\/Gather>`, 's'));
  });

  test('wraps greeting inside Gather say element', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: '1',
        twilioConfig: { phoneNumber: '+15551234567' },
        agentSetup: { agentGreeting: greeting }
      })
    });

    const res = await request(app)
      .post('/api/twilio/voice')
      .send({ To: '+15551234567' });

    const regex = new RegExp(
      `<Gather[^>]*>\\s*<Say[^>]*>${greeting}<\\/Say>`,
      'i'
    );
    expect(res.text).toMatch(regex);
  });

  test('plays audio greeting when configured', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: '1',
        twilioConfig: { phoneNumber: '+15551234567' },
        agentSetup: {
          greetingType: 'audio',
          greetingAudioUrl: 'https://example.com/greet.mp3'
        }
      })
    });

    const res = await request(app)
      .post('/api/twilio/voice')
      .send({ To: '+15551234567' });

    const regex = new RegExp(`<Gather[^>]*>\\s*<Play>https://example.com/greet.mp3<\\/Play>`, 'i');
    expect(res.text).toMatch(regex);
  });

  test('returns fallback message when no company matches', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null)
    });
    Company.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([])
    });

    const res = await request(app)
      .post('/api/twilio/voice')
      .send({ To: '+15550000000' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    expect(res.text).toMatch(/<Say[^>]*>.*<\/Say>.*<Hangup\/>/s);
  });

  test('returns knowledge answer when match found', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: '1',
        twilioConfig: { phoneNumber: '+15551234567' }
      })
    });
    KnowledgeEntry.find.mockResolvedValue([
      { question: 'Hi there', answer: 'mock KB answer', keywords: [] }
    ]);
    findCachedAnswer.mockReturnValue('mock KB answer');

    const res = await request(app)
      .post('/api/twilio/handle-speech')
      .set('host', 'example.com')
      .send({ To: '+15551234567', SpeechResult: 'Hi there', Confidence: '0.9' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    expect(res.text).toContain('mock KB answer');
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  test('reprompts when confidence below threshold', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: '1',
        twilioConfig: { phoneNumber: '+15551234567' },
        aiSettings: { twilioSpeechConfidenceThreshold: 0.6 }
      })
    });
    KnowledgeEntry.find.mockResolvedValue([]);
    findCachedAnswer.mockReturnValue(null);

    const res = await request(app)
      .post('/api/twilio/handle-speech')
      .set('host', 'example.com')
      .send({ To: '+15551234567', SpeechResult: 'Hi there', Confidence: '0.4' });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<Say[^>]*>.*<\/Say>/s);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  test('falls back to LLM when no knowledge answer', async () => {
    Company.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: '1',
        twilioConfig: { phoneNumber: '+15551234567' }
      })
    });
    KnowledgeEntry.find.mockResolvedValue([]);
    findCachedAnswer.mockReturnValue(null);

    const answer = { text: 'mock answer', escalate: false };
    answerQuestion.mockResolvedValue(answer);

    const res = await request(app)
      .post('/api/twilio/handle-speech')
      .set('host', 'example.com')
      .send({ To: '+15551234567', SpeechResult: 'Hi there', Confidence: '0.9' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    expect(res.text).toContain('<Redirect>');
    expect(answerQuestion).toHaveBeenCalled();
  });

  test('stops polling after maximum attempts', async () => {
    redisClient.get.mockResolvedValueOnce(null); // no answer
    redisClient.get.mockResolvedValueOnce(JSON.stringify({ voice: 'Google.en-US-Wavenet-A' }));
    redisClient.incr.mockResolvedValueOnce(11); // exceed limit

    const res = await request(app)
      .post('/api/twilio/process-ai-response')
      .set('host', 'example.com')
      .send({ CallSid: 'abc' });

    expect(redisClient.del).toHaveBeenCalledWith('twilio-context:abc');
    expect(redisClient.del).toHaveBeenCalledWith('twilio-answer:abc');
    expect(redisClient.del).toHaveBeenCalledWith('twilio-attempts:abc');
    expect(res.text).toMatch(/<Say[^>]*>.*<\/Say>/s);
  });
});
