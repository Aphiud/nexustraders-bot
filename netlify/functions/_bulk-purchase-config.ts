export type BulkPurchaseAccountConfig = {
    account_id: string;
    label?: string;
    account_type: 'demo' | 'real';
    token: string;
};

export function readBulkPurchaseConfig(): { appId: string; accounts: BulkPurchaseAccountConfig[] } | null {
    const appId = process.env.DERIV_BULK_PURCHASE_APP_ID?.trim();
    const accountsText = process.env.DERIV_BULK_PURCHASE_ACCOUNTS;
    if (!appId || !accountsText) return null;

    try {
        const accounts = JSON.parse(accountsText) as BulkPurchaseAccountConfig[];
        if (!Array.isArray(accounts)) return null;
        const accountIds = new Set<string>();
        for (const account of accounts) {
            if (
                !account ||
                typeof account.account_id !== 'string' || account.account_id.length < 1 || account.account_id.length > 64 ||
                accountIds.has(account.account_id) ||
                typeof account.token !== 'string' || account.token.length < 1 || account.token.length > 512 ||
                !['demo', 'real'].includes(account.account_type) ||
                (account.label !== undefined && typeof account.label !== 'string')
            ) return null;
            accountIds.add(account.account_id);
        }
        return { appId, accounts };
    } catch {
        return null;
    }
}
