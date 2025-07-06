const request = require('supertest');
const express = require('express');

jest.mock('googleapis', () => {
  return {
    google: {
      auth: { GoogleAuth: jest.fn().mockImplementation(() => ({ getClient: jest.fn().mockResolvedValue('client') })) },
      texttospeech: jest.fn().mockReturnValue({
        voices: {
          list: jest.fn().mockResolvedValue({
            data: { voices: [{ name: 'en-US-Wavenet-F', languageCodes: ['en-US'], ssmlGender: 'FEMALE' }] }
          })
        },
        text: { synthesize: jest.fn().mockResolvedValue({ data: { audioContent: 'abc' } }) }
      })
    }
  };
});

const googleTTSRoutes = require('../routes/googleTTS');

describe('Google TTS Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/google-tts', googleTTSRoutes);

  test('GET /api/google-tts/voices returns list', async () => {
    const res = await request(app).get('/api/google-tts/voices');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toEqual({
      name: 'en-US-Wavenet-F',
      language: 'en-US',
      gender: 'FEMALE',
      displayName: '[en-US] WaveNet F (FEMALE)'
    });
  });

  test('POST /api/google-tts/synthesize requires text and voice', async () => {
    const res = await request(app)
      .post('/api/google-tts/synthesize')
      .send({ text: 'hi', voiceName: 'en-US-Wavenet-F' });
    expect(res.status).toBe(200);
    expect(res.body.audioContent).toBe('abc');
  });
});
