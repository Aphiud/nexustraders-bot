import { getUser } from '@netlify/identity';
import { readBulkPurchaseConfig } from './_bulk-purchase-config';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

export default async () => {
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to use Bulk Purchase.' }, 401);
    if (!user.roles?.includes('bulk-purchase')) return json({ error: 'Bulk Purchase access is not enabled for this user.' }, 403);

    const config = readBulkPurchaseConfig();
    if (!config) {
        return json({ error: 'Bulk Purchase is not configured on the server. Contact the site administrator.' }, 503);
    }
    return json({
        accounts: config.accounts.map(({ account_id, label, account_type }) => ({
            account_id,
            label: label || account_id,
            account_type,
        })),
    });
};
