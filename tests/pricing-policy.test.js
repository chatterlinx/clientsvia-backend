const request = require('supertest');
const { expect } = require('chai');

const app = require('../server');
const Company = require('../models/v2Company');
const CompanyPlaceholders = require('../models/CompanyPlaceholders');
const { getCatalog } = require('../config/placeholders/PlaceholderCatalog');
const { canTransferCall } = require('../services/pricing/TransferConsentGate');

describe('💰 Pricing Policy', function() {
    this.timeout(20000);

    let companyId;

    before(async function() {
        const company = await Company.create({
            companyName: 'Pricing Policy Test Co',
            companyPhone: '+15551234567',
            trade: 'HVAC',
            aiAgentSettings: {
                templateReferences: []
            }
        });

        companyId = company._id.toString();
    });

    after(async function() {
        if (companyId) {
            await CompanyPlaceholders.deleteOne({ companyId });
            await Company.findByIdAndDelete(companyId);
        }
    });

    async function seedPlaceholders({ mode, value }) {
        const catalog = getCatalog('HVAC');
        const requiredKeys = catalog.required.map(p => p.key);
        const placeholders = requiredKeys.map(key => {
            const isTarget = key === 'serviceCallFee';
            return {
                key,
                value: isTarget ? (value ?? '') : `value-${key}`,
                mode: isTarget ? mode : 'LITERAL'
            };
        });

        await CompanyPlaceholders.setAllPlaceholders(companyId, placeholders);
    }

    it('marks LITERAL pricing token with empty value as missing', async function() {
        await seedPlaceholders({ mode: 'LITERAL', value: '' });

        const res = await request(app)
            .get(`/api/admin/placeholders/company/${companyId}/values-merged`);

        expect(res.status).to.equal(200);
        expect(res.body.success).to.equal(true);
        expect(res.body.summary.missingRequiredByCatalog).to.equal(1);

        const row = res.body.rows.find(r => r.token === 'serviceCallFee');
        expect(row).to.exist;
        expect(row.effectiveMode).to.equal('LITERAL');
        expect(row.isSatisfied).to.equal(false);
    });

    it('treats OFFER_TRANSFER pricing token as satisfied even if empty', async function() {
        await seedPlaceholders({ mode: 'OFFER_TRANSFER', value: '' });

        const res = await request(app)
            .get(`/api/admin/placeholders/company/${companyId}/values-merged`);

        expect(res.status).to.equal(200);
        expect(res.body.success).to.equal(true);
        expect(res.body.summary.missingRequiredByCatalog).to.equal(0);

        const row = res.body.rows.find(r => r.token === 'serviceCallFee');
        expect(row).to.exist;
        expect(row.effectiveMode).to.equal('OFFER_TRANSFER');
        expect(row.isSatisfied).to.equal(true);
    });

    describe('TransferConsentGate', function() {
        it('blocks transfer when no pending offer', function() {
            const result = canTransferCall({ userText: 'yes', transferOfferPending: false });
            expect(result.allowed).to.equal(false);
            expect(result.decision).to.equal('none');
        });

        it('allows transfer on explicit yes when pending', function() {
            const result = canTransferCall({ userText: 'yes please', transferOfferPending: true });
            expect(result.allowed).to.equal(true);
            expect(result.decision).to.equal('accept');
        });

        it('denies transfer on explicit no when pending', function() {
            const result = canTransferCall({ userText: 'no thanks', transferOfferPending: true });
            expect(result.allowed).to.equal(false);
            expect(result.decision).to.equal('decline');
        });
    });
});
