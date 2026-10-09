export type DerivUserAccount = { account_id: string; account_type: 'demo' | 'real' };
export type DerivUserAuthResult =
    | { ok: true; accounts: DerivUserAccount[] }
    | { ok: false; status: number; message: string };

/** Validate the site's existing Deriv OAuth session with Deriv itself. */
export async function getDerivUserAccounts(request: Request): Promise<DerivUserAuthResult> {
    const authorization = request.headers.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(authorization);
    if (authorization.length > 4_103) return { ok: false, status: 401, message: 'Sign in with Deriv using the site header to use Bulk Purchase.' };
    if (!match) return { ok: false, status: 401, message: 'Sign in with Deriv using the site header to use Bulk Purchase.' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            method: 'GET',
            headers: { Authorization: `Bearer ${match[1]}` },
            cache: 'no-store',
            signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
            return { ok: false, status: 401, message: 'Your Deriv session expired or lacks trading access. Sign in again with the site header.' };
        }
        if (!response.ok) return { ok: false, status: 502, message: 'Deriv could not verify your account. Try again later.' };

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            return { ok: false, status: 502, message: 'Deriv returned an unreadable account response.' };
        }
        const rows = (payload as { data?: unknown } | null)?.data;
        if (!Array.isArray(rows)) return { ok: false, status: 502, message: 'Deriv returned an unexpected account response.' };

        const accounts: DerivUserAccount[] = [];
        for (const row of rows) {
            if (
                row && typeof row === 'object' &&
                typeof (row as Record<string, unknown>).account_id === 'string' &&
                ['demo', 'real'].includes((row as Record<string, unknown>).account_type as string)
            ) {
                accounts.push({
                    account_id: (row as Record<string, unknown>).account_id as string,
                    account_type: (row as Record<string, unknown>).account_type as 'demo' | 'real',
                });
            }
        }
        return { ok: true, accounts };
    } catch (error) {
        return {
            ok: false,
            status: error instanceof Error && error.name === 'AbortError' ? 504 : 502,
            message: error instanceof Error && error.name === 'AbortError'
                ? 'Timed out while verifying your Deriv session.'
                : 'A network error interrupted Deriv account verification.',
        };
    } finally {
        clearTimeout(timeout);
    }
}
