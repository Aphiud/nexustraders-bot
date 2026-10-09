import { readBulkPurchaseConfig } from './_bulk-purchase-config';
import { getDerivUserAccounts } from './_deriv-user';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

export default async (request: Request) => {
    const config = readBulkPurchaseConfig();
    if (!config) {
        return json({ error: 'Bulk Purchase is not configured on the server. Contact the site administrator.' }, 503);
    }
    const authorization = await getDerivUserAccounts(request);
    if (!authorization.ok) return json({ error: authorization.message }, authorization.status);

    const authorizedAccounts = new Map(authorization.accounts.map(account => [account.account_id, account.account_type]));
    return json({
        accounts: config.accounts.filter(account => authorizedAccounts.get(account.account_id) === account.account_type).map(({ account_id, label, account_type }) => ({
            account_id,
            label: label || account_id,
            account_type,
        })),
    });
};
