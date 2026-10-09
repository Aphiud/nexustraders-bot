import purchaseHandler from '../bulk-purchase';
import accountsHandler from '../bulk-purchase-accounts';
import { getDerivUserAccounts } from '../_deriv-user';

jest.mock('../_deriv-user', () => ({ getDerivUserAccounts: jest.fn() }));

const mockedGetDerivUserAccounts = getDerivUserAccounts as jest.MockedFunction<typeof getDerivUserAccounts>;
const configured = [
    { account_id: 'VRTC1', label: 'Demo one', account_type: 'demo', token: 'server-only-pat-demo' },
    { account_id: 'VRTC2', label: 'Demo two', account_type: 'demo', token: 'server-only-pat-demo-2' },
    { account_id: 'CR1', label: 'Real one', account_type: 'real', token: 'server-only-pat-real' },
];
const requestBody = { account_type: 'demo', account_ids: ['VRTC1'], contract_parameters: { symbol: 'R_10', amount: 2 } };
const purchaseResponse = { data: { transactions: [{ account_id: 'VRTC1', contract_id: 42, buy_price: 2, transaction_id: 78 }] }, meta: { endpoint: '/contracts/bulk-purchase/demo', method: 'POST', timing: 1 } };
class TestResponse {
    status: number;
    ok: boolean;
    private value: string;
    constructor(value: string, init: { status: number }) { this.value = value; this.status = init.status; this.ok = init.status >= 200 && init.status < 300; }
    async json() { return JSON.parse(this.value); }
    async text() { return this.value; }
}
const request = (body: unknown, token = 'deriv-oauth-token') => ({
    method: 'POST',
    headers: { get: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null },
    json: async () => body,
}) as unknown as Request;

describe('Netlify bulk purchase functions', () => {
    const originalAppId = process.env.DERIV_BULK_PURCHASE_APP_ID;
    const originalAccounts = process.env.DERIV_BULK_PURCHASE_ACCOUNTS;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetDerivUserAccounts.mockResolvedValue({ ok: true, accounts: [
            { account_id: 'VRTC1', account_type: 'demo' },
            { account_id: 'VRTC2', account_type: 'demo' },
            { account_id: 'CR1', account_type: 'real' },
        ] });
        process.env.DERIV_BULK_PURCHASE_APP_ID = 'test-app-id';
        process.env.DERIV_BULK_PURCHASE_ACCOUNTS = JSON.stringify(configured);
        (global as any).Response = TestResponse;
        global.fetch = jest.fn().mockResolvedValue(new TestResponse(JSON.stringify(purchaseResponse), { status: 200 })) as jest.Mock;
    });

    afterAll(() => {
        if (originalAppId === undefined) delete process.env.DERIV_BULK_PURCHASE_APP_ID;
        else process.env.DERIV_BULK_PURCHASE_APP_ID = originalAppId;
        if (originalAccounts === undefined) delete process.env.DERIV_BULK_PURCHASE_ACCOUNTS;
        else process.env.DERIV_BULK_PURCHASE_ACCOUNTS = originalAccounts;
    });

    it('rejects unauthenticated requests and accounts not owned by the Deriv user', async () => {
        mockedGetDerivUserAccounts.mockResolvedValueOnce({ ok: false, status: 401, message: 'Sign in with Deriv.' });
        expect((await purchaseHandler(request(requestBody))).status).toBe(401);
        mockedGetDerivUserAccounts.mockResolvedValueOnce({ ok: true, accounts: [{ account_id: 'CR1', account_type: 'real' }] });
        expect((await purchaseHandler(request(requestBody))).status).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports missing server credentials without calling Deriv', async () => {
        delete process.env.DERIV_BULK_PURCHASE_APP_ID;
        const response = await purchaseHandler(request(requestBody));
        expect(response.status).toBe(503);
        expect((await response.json()).error).toMatch(/not configured/);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects invalid server account mappings and duplicate account IDs', async () => {
        process.env.DERIV_BULK_PURCHASE_ACCOUNTS = JSON.stringify([
            configured[0],
            { ...configured[0], token: 'different-token' },
        ]);
        const response = await purchaseHandler(request(requestBody));
        expect(response.status).toBe(503);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns only account metadata and never exposes configured PATs', async () => {
        const response = await accountsHandler(request({}));
        const text = await response.text();
        expect(response.status).toBe(200);
        expect(text).toContain('VRTC1');
        expect(text).not.toContain('server-only-pat');
    });

    it('sends the documented schema, app id, and no bulk bearer token', async () => {
        const response = await purchaseHandler(request(requestBody));
        expect(response.status).toBe(200);
        const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://api.derivws.com/trading/v1/options/contracts/bulk-purchase/demo');
        expect(options.headers).toEqual({ 'Deriv-App-ID': 'test-app-id', 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body)).toEqual({
            contract_parameters: requestBody.contract_parameters,
            accounts: [{ account_id: 'VRTC1', token: 'server-only-pat-demo' }],
        });
        expect(options.headers.Authorization).toBeUndefined();
        expect(await response.json()).toEqual(purchaseResponse);
    });

    it('selects the real endpoint only for configured real accounts', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(new TestResponse(JSON.stringify({
            data: { transactions: [{ account_id: 'CR1', contract_id: 43, buy_price: 1, transaction_id: 79 }] },
            meta: purchaseResponse.meta,
        }), { status: 200 }));
        const response = await purchaseHandler(request({ ...requestBody, account_type: 'real', account_ids: ['CR1'] }));
        expect(response.status).toBe(200);
        expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/bulk-purchase/real');
        expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).accounts).toEqual([{ account_id: 'CR1', token: 'server-only-pat-real' }]);
    });

    it('rejects empty, duplicate, invalid-amount, and cross-environment requests', async () => {
        const invalid = [
            { ...requestBody, account_ids: [] },
            { ...requestBody, account_ids: ['VRTC1', 'VRTC1'] },
            { ...requestBody, contract_parameters: { amount: 0 } },
            { ...requestBody, account_type: 'real' },
        ];
        for (const body of invalid) {
            expect((await purchaseHandler(request(body))).status).toBe(400);
        }
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('preserves partial failures while replacing upstream error text with safe wording', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(new TestResponse(JSON.stringify({ data: { transactions: [
            { account_id: 'VRTC1', contract_id: 42, buy_price: 2, transaction_id: 78 },
            { account_id: 'VRTC2', error: { code: 'InsufficientBalance', message: 'private upstream detail' } },
        ] }, meta: purchaseResponse.meta }), { status: 200 }));
        const response = await purchaseHandler(request({ ...requestBody, account_ids: ['VRTC1', 'VRTC2'] }));
        const result = await response.json();
        expect(result.data.transactions).toHaveLength(2);
        expect(result.data.transactions[1].error.code).toBe('InsufficientBalance');
        expect(result.data.transactions[1].error.message).not.toContain('private upstream detail');
    });

    it('handles authentication, network, timeout, and malformed upstream responses without retrying', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(new TestResponse(JSON.stringify({ errors: [{ code: 'Unauthorized', message: 'secret' }] }), { status: 401 }));
        expect((await purchaseHandler(request(requestBody))).status).toBe(401);
        const networkError = new Error('network down');
        (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);
        expect((await purchaseHandler(request(requestBody))).status).toBe(504);
        const timeout = new Error('aborted'); timeout.name = 'AbortError';
        (global.fetch as jest.Mock).mockRejectedValueOnce(timeout);
        expect((await purchaseHandler(request(requestBody))).status).toBe(504);
        (global.fetch as jest.Mock).mockResolvedValueOnce(new TestResponse('{', { status: 200 }));
        expect((await purchaseHandler(request(requestBody))).status).toBe(502);
        expect(global.fetch).toHaveBeenCalledTimes(4);
    });
});
