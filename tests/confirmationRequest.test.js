const { detectConfirmationRequest } = require('../utils/confirmationRequest');

describe('utils/confirmationRequest.detectConfirmationRequest', () => {
  const triggers = ["did you get my", "can you repeat", "is that right", "is that correct"];

  test('detects name confirmation request', () => {
    expect(detectConfirmationRequest('did you get my name right', { triggers })).toBe('name');
  });

  test('detects phone confirmation request', () => {
    expect(detectConfirmationRequest('can you repeat my phone number', { triggers })).toBe('phone');
  });

  test('detects address confirmation request', () => {
    expect(detectConfirmationRequest('is that address correct', { triggers })).toBe('address');
  });

  test('detects direct "what is my last name" without requiring explicit confirm triggers', () => {
    expect(detectConfirmationRequest('what is my last name', { triggers })).toBe('name');
    expect(detectConfirmationRequest("what's my phone number", { triggers })).toBe('phone');
  });

  test('returns null when no trigger and no fallback pattern', () => {
    expect(detectConfirmationRequest('hello there', { triggers })).toBe(null);
  });
});

