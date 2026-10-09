import { getDerivUserAccounts } from '../_deriv-user';

class TestResponse {
    ok: boolean;
    status: number;
    private body: unknown;
    constructor(body: unknown, status = 200) { this.body = body; this.status = status; this.ok = status >= 200 && status < 300; }
    async json() { return this.body; }
}
const request = (authorization?: string) => ({
    headers: { get: (name: string) => name.toLowerCase() === 'authorization' ? authorization ?? null : null },
}) as unknown as Request;

describe('Deriv user session verification', () => {
    const originalFetch = global.fetch;

    afterEach(() => { global.fetch = originalFetch; });

    it('requires the existing Deriv OAuth session before contacting Deriv', async () => {
        global.fetch = jest.fn() as jest.Mock;
        await expect(getDerivUserAccounts(request())).resolves.toEqual({
            ok: false,
            status: 401,
            message: 'Sign in with Deriv using the site header to use Bulk Purchase.',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('uses OAuth only to read the signed-in user account list', async () => {
        global.fetch = jest.fn().mockResolvedValue(new TestResponse({ data: [
            { account_id: 'VRTC1', account_type: 'demo' },
            { account_id: 'CR1', account_type: 'real' },
            { account_id: 'ignored', account_type: 'unknown' },
        ] })) as jest.Mock;
        await expect(getDerivUserAccounts(request('Bearer existing-deriv-token'))).resolves.toEqual({ ok: true, accounts: [
            { account_id: 'VRTC1', account_type: 'demo' },
            { account_id: 'CR1', account_type: 'real' },
        ] });
        expect((global.fetch as jest.Mock).mock.calls[0]).toEqual([
            'https://api.derivws.com/trading/v1/options/accounts',
            expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer existing-deriv-token' }, cache: 'no-store' }),
        ]);
    });

    it('converts expired Deriv authentication into a safe login message', async () => {
        global.fetch = jest.fn().mockResolvedValue(new TestResponse({ errors: [{ message: 'private token details' }] }, 401)) as jest.Mock;
        const result = await getDerivUserAccounts(request('Bearer existing-deriv-token'));
        expect(result).toEqual({ ok: false, status: 401, message: 'Your Deriv session expired or lacks trading access. Sign in again with the site header.' });
        expect(JSON.stringify(result)).not.toContain('private token details');
    });

    it('does not expose token or upstream details when Deriv cannot be reached', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('socket failure involving secret')) as jest.Mock;
        const result = await getDerivUserAccounts(request('Bearer existing-deriv-token'));
        expect(result).toEqual({ ok: false, status: 502, message: 'A network error interrupted Deriv account verification.' });
    });
});
