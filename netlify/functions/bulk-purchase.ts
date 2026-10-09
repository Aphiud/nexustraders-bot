import { getUser } from '@netlify/identity';
import { readBulkPurchaseConfig } from './_bulk-purchase-config';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

export default async (request: Request) => {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to use Bulk Purchase.' }, 401);
    if (!user.roles?.includes('bulk-purchase')) return json({ error: 'Bulk Purchase access is not enabled for this user.' }, 403);

    const config = readBulkPurchaseConfig();
    if (!config) {
        return json({ error: 'Bulk Purchase is not configured on the server. Contact the site administrator.' }, 503);
    }

    let input: unknown;
    try {
        input = await request.json();
    } catch {
        return json({ error: 'The request body is invalid.' }, 400);
    }
    if (!input || typeof input !== 'object') return json({ error: 'The request body is invalid.' }, 400);
    const body = input as Record<string, unknown>;
    const accountType = body.account_type;
    const accountIds = body.account_ids;
    const contractParameters = body.contract_parameters;
    if (
        (accountType !== 'demo' && accountType !== 'real') ||
        !Array.isArray(accountIds) || accountIds.length < 1 || accountIds.length > 100 ||
        accountIds.some(id => typeof id !== 'string' || !id) ||
        new Set(accountIds).size !== accountIds.length ||
        !contractParameters || typeof contractParameters !== 'object' || Array.isArray(contractParameters) ||
        Object.keys(contractParameters).length === 0
    ) return json({ error: 'Choose accounts and provide a non-empty contract-parameters object.' }, 400);

    const selected = accountIds.map(id => config.accounts.find(account => account.account_id === id));
    if (selected.some(account => !account || account.account_type !== accountType)) {
        return json({ error: 'One or more selected accounts are unavailable for this environment.' }, 400);
    }
    const amount = (contractParameters as Record<string, unknown>).amount;
    if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)) {
        return json({ error: 'Amount must be a positive number.' }, 400);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        const upstream = await fetch(`https://api.derivws.com/trading/v1/options/contracts/bulk-purchase/${accountType}`, {
            method: 'POST',
            headers: { 'Deriv-App-ID': config.appId, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_parameters: contractParameters,
                accounts: selected.map(account => ({ token: account!.token, account_id: account!.account_id })),
            }),
            signal: controller.signal,
        });
        let response: unknown;
        try {
            response = await upstream.json();
        } catch {
            return json({ error: 'Deriv returned an unreadable response. Check account activity before submitting again.' }, 502);
        }
        if (!upstream.ok) {
            if (upstream.status === 401) return json({ error: 'Deriv rejected the account authorization. Check the configured PATs.' }, 401);
            if (upstream.status === 400) return json({ error: 'Deriv rejected the request. Review the contract parameters and account selection.' }, 400);
            if (upstream.status === 502 || upstream.status === 504) return json({ error: 'Deriv could not complete the request. Check account activity before submitting again.' }, 502);
            return json({ error: 'Deriv could not process the request. Check account activity before submitting again.' }, 502);
        }
        const data = (response as { data?: { transactions?: unknown }; meta?: unknown } | null)?.data;
        const metadata = (response as { meta?: unknown } | null)?.meta;
        if (
            !data || !Array.isArray(data.transactions) ||
            !metadata || typeof metadata !== 'object' ||
            typeof (metadata as Record<string, unknown>).endpoint !== 'string' ||
            (metadata as Record<string, unknown>).method !== 'POST' ||
            typeof (metadata as Record<string, unknown>).timing !== 'number'
        ) {
            return json({ error: 'Deriv returned an unexpected response. Check account activity before submitting again.' }, 502);
        }
        const transactions = data.transactions.map((row: unknown) => {
            if (!row || typeof row !== 'object') return null;
            const result = row as Record<string, unknown>;
            if (typeof result.account_id !== 'string') return null;
            if (result.error && typeof result.error === 'object') {
                const error = result.error as Record<string, unknown>;
                return { account_id: result.account_id, error: {
                    code: typeof error.code === 'string' ? error.code.slice(0, 100) : 'PurchaseFailed',
                    message: 'Deriv could not complete this account purchase. Review the account and contract details.',
                } };
            }
            if (!Number.isInteger(result.contract_id) || typeof result.buy_price !== 'number' || !Number.isInteger(result.transaction_id)) return null;
            return { account_id: result.account_id, contract_id: result.contract_id, buy_price: result.buy_price, transaction_id: result.transaction_id };
        });
        if (
            transactions.some(result => !result) ||
            transactions.length !== selected.length ||
            transactions.some(result => !selected.some(account => account!.account_id === result!.account_id))
        ) {
            return json({ error: 'Deriv returned an incomplete response. Check account activity before submitting again.' }, 502);
        }
        return json({ data: { transactions }, meta: metadata });
    } catch (error) {
        const timedOut = error instanceof Error && error.name === 'AbortError';
        return json({ error: timedOut
            ? 'The request timed out. Check account activity before submitting again.'
            : 'A network error interrupted the request. Check account activity before submitting again.' }, 504);
    } finally {
        clearTimeout(timeout);
    }
};
