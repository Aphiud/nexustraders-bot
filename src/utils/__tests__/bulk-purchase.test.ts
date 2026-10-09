import { classifyBulkPurchaseResponse, MAX_BULK_ACCOUNTS, validateBulkPurchaseInput } from '../bulk-purchase';

describe('Bulk Purchase validation', () => {
    it('accepts valid contract parameters and multiple account items', () => {
        expect(validateBulkPurchaseInput({
            accountIds: ['VRTC1', 'VRTC2'],
            contractParametersText: '{"contract_type":"CALL","symbol":"R_10","amount":2}',
        })).toBeNull();
    });

    it('rejects empty account selections and empty contract definitions', () => {
        expect(validateBulkPurchaseInput({ accountIds: [], contractParametersText: '{}' })).toMatch(/Select at least one/);
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1'], contractParametersText: '{}' })).toMatch(/non-empty|Enter/);
    });

    it('rejects invalid JSON, arrays, and non-object parameters', () => {
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1'], contractParametersText: '{' })).toMatch(/valid JSON/);
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1'], contractParametersText: '[]' })).toMatch(/JSON object/);
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1'], contractParametersText: 'null' })).toMatch(/JSON object/);
    });

    it('rejects invalid amounts, duplicate accounts, and more than 100 accounts', () => {
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1'], contractParametersText: '{"amount":0}' })).toMatch(/positive number/);
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1'], contractParametersText: '{"amount":"2"}' })).toMatch(/positive number/);
        expect(validateBulkPurchaseInput({ accountIds: ['VRTC1', 'VRTC1'], contractParametersText: '{"symbol":"R_10"}' })).toMatch(/once/);
        expect(validateBulkPurchaseInput({ accountIds: Array.from({ length: MAX_BULK_ACCOUNTS + 1 }, (_, index) => `VRTC${index}`), contractParametersText: '{"symbol":"R_10"}' })).toMatch(/no more than 100/);
    });
});

describe('Bulk Purchase response validation', () => {
    it('accepts the documented success response and retains purchase identifiers', () => {
        const result = classifyBulkPurchaseResponse({ data: { transactions: [{ account_id: 'VRTC1', contract_id: 42, buy_price: 1.25, transaction_id: 78 }] }, meta: { endpoint: '/contracts/bulk-purchase/demo', method: 'POST', timing: 12 } });
        expect(result?.data.transactions[0]).toMatchObject({ contract_id: 42, transaction_id: 78, buy_price: 1.25 });
    });

    it('accepts partial failure entries and rejects malformed envelopes', () => {
        const meta = { endpoint: '/contracts/bulk-purchase/demo', method: 'POST', timing: 12 };
        expect(classifyBulkPurchaseResponse({ data: { transactions: [{ account_id: 'VRTC1', error: { code: 'InsufficientBalance', message: 'failed' } }] }, meta })).not.toBeNull();
        expect(classifyBulkPurchaseResponse({ data: { transactions: [{ account_id: 'VRTC1' }] }, meta })).toBeNull();
        expect(classifyBulkPurchaseResponse({ data: {} })).toBeNull();
    });
});
