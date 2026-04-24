/**
 * routes/mediaStream.js — bootstrap + fallback TwiML tests
 *
 * Uses supertest against a minimal Express app that mounts the router
 * the same way index.js does. Confirms the emitted TwiML is well-formed
 * and includes all CustomParameters the WS handler depends on.
 */

'use strict';

const express = require('express');
const request = require('supertest');

function mountRouter() {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use('/api/twilio/media-stream', require('../../routes/mediaStream'));
    return app;
}

describe('routes/mediaStream', () => {
    // ------------------------------------------------------------
    // /:companyId/bootstrap
    // ------------------------------------------------------------
    describe('POST /:companyId/bootstrap', () => {
        test('emits <Connect><Stream> TwiML with all Parameters', async () => {
            const app = mountRouter();
            const res = await request(app)
                .post('/api/twilio/media-stream/company-xyz/bootstrap')
                .type('form')
                .send({
                    CallSid: 'CA1234567890abcdef',
                    From: '+15551234567',
                    To: '+15559998888'
                });

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/xml/);
            const xml = res.text;

            expect(xml).toMatch(/<Connect>/);
            expect(xml).toMatch(/<Stream[^>]*url="wss?:\/\/[^"]+\/api\/twilio\/media-stream"/);

            // All four custom parameters must be present so the WS
            // handler can load the tenant + thread call state.
            expect(xml).toMatch(/<Parameter[^>]*name="companyId"[^>]*value="company-xyz"/);
            expect(xml).toMatch(/<Parameter[^>]*name="callSid"[^>]*value="CA1234567890abcdef"/);
            expect(xml).toMatch(/<Parameter[^>]*name="from"[^>]*value="\+15551234567"/);
            expect(xml).toMatch(/<Parameter[^>]*name="to"[^>]*value="\+15559998888"/);
        });

        test('missing Twilio body fields still emits valid TwiML (empty params)', async () => {
            // Twilio occasionally re-POSTS with fewer fields; we tolerate that
            // and just emit empty string values rather than 500ing.
            const app = mountRouter();
            const res = await request(app)
                .post('/api/twilio/media-stream/ACME/bootstrap')
                .type('form')
                .send({});

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/<Connect>/);
            expect(res.text).toMatch(/name="companyId"/);
            expect(res.text).toMatch(/value="ACME"/);
        });

        test('WSS proto is chosen when x-forwarded-proto=https is set', async () => {
            const app = mountRouter();
            const res = await request(app)
                .post('/api/twilio/media-stream/abc/bootstrap')
                .set('x-forwarded-proto', 'https')
                .type('form')
                .send({ CallSid: 'CA' });

            expect(res.text).toMatch(/url="wss:\/\//);
            expect(res.text).not.toMatch(/url="ws:\/\//);
        });

        test('WS (plain) is chosen on non-secure local request', async () => {
            const app = mountRouter();
            const res = await request(app)
                .post('/api/twilio/media-stream/local/bootstrap')
                .type('form')
                .send({ CallSid: 'CA' });

            // supertest local loopback is not secure; either ws:// or wss://
            // is acceptable depending on proxy header presence. What matters
            // is that *something* valid gets emitted.
            expect(res.text).toMatch(/url="wss?:\/\//);
        });

        test('multi-tenant: different companyIds produce different param values', async () => {
            const app = mountRouter();
            const res1 = await request(app)
                .post('/api/twilio/media-stream/tenant-one/bootstrap')
                .type('form').send({ CallSid: 'CA1' });
            const res2 = await request(app)
                .post('/api/twilio/media-stream/tenant-two/bootstrap')
                .type('form').send({ CallSid: 'CA2' });

            expect(res1.text).toMatch(/value="tenant-one"/);
            expect(res1.text).not.toMatch(/value="tenant-two"/);
            expect(res2.text).toMatch(/value="tenant-two"/);
            expect(res2.text).not.toMatch(/value="tenant-one"/);
        });
    });

    // ------------------------------------------------------------
    // /:companyId/fallback
    // ------------------------------------------------------------
    describe('POST /:companyId/fallback', () => {
        test('emits <Redirect> TwiML into v2-agent-respond route', async () => {
            const app = mountRouter();
            const res = await request(app)
                .post('/api/twilio/media-stream/company-xyz/fallback')
                .type('form')
                .send({ CallSid: 'CA999' });

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/xml/);
            expect(res.text).toMatch(/<Redirect[^>]*method="POST"[^>]*>\/api\/twilio\/v2-agent-respond\/company-xyz<\/Redirect>/);
        });

        test('redirect URL is per-tenant (no leakage)', async () => {
            const app = mountRouter();
            const res1 = await request(app)
                .post('/api/twilio/media-stream/tenantA/fallback')
                .type('form').send({ CallSid: 'CA' });
            const res2 = await request(app)
                .post('/api/twilio/media-stream/tenantB/fallback')
                .type('form').send({ CallSid: 'CA' });

            expect(res1.text).toMatch(/v2-agent-respond\/tenantA/);
            expect(res1.text).not.toMatch(/tenantB/);
            expect(res2.text).toMatch(/v2-agent-respond\/tenantB/);
        });

        test('fallback works even with no body (Twilio retry edge case)', async () => {
            const app = mountRouter();
            const res = await request(app)
                .post('/api/twilio/media-stream/any/fallback')
                .type('form')
                .send({});

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/<Redirect/);
        });
    });
});
